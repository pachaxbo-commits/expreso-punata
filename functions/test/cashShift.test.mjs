import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import {
  openCashShift,
  closeCashShift,
  registerCashExpense,
  collectShipmentPayment,
  createShipment,
} from '../index.js'

// Inicializar Firebase Admin apuntando a los emuladores locales
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-cash-test' })
}

const db = getFirestore()
const auth = getAuth()

async function clearCollections() {
  const collections = [
    'users',
    'cash_shifts',
    'cash_shift_active_locks',
    'financial_movements',
    'shipments',
    'counters',
    'idempotency_keys',
    'audit_logs',
    'system_locks',
  ]
  for (const col of collections) {
    const snapshot = await db.collection(col).get()
    const batch = db.batch()
    snapshot.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

before(async () => {
  await clearCollections()
})

beforeEach(async () => {
  await clearCollections()
})

// Auxiliares de prueba
async function createTestUser(uid, role, primaryBranchId, allowedBranchIds = [primaryBranchId]) {
  await db.collection('users').doc(uid).set({
    uid,
    fullName: `Usuario ${uid}`,
    email: `${uid}@expresopunata.com`,
    role,
    primaryBranchId,
    allowedBranchIds,
    isActive: true,
  })
}

test('1. APERTURA DE CAJA: Secretaria Punata abre turno con Bs 100 (10000 cts) y se genera fondo inicial separado', async () => {
  await createTestUser('sec-punata-1', 'secretaria', 'punata')

  const res = await openCashShift.run({
    auth: { uid: 'sec-punata-1', token: { email: 'sec-punata-1@expresopunata.com' } },
    data: {
      branchId: 'punata',
      initialCashCents: 10000, // Bs 100.00
      initialCashBreakdown: { '100': 1 },
      notes: 'Apertura de turno mañana',
    },
  })

  assert.equal(res.success, true)
  assert.equal(res.shift.branchId, 'punata')
  assert.equal(res.shift.operatorUid, 'sec-punata-1')
  assert.equal(res.shift.initialCashCents, 10000)
  assert.equal(res.shift.expectedCashCents, 10000)
  assert.equal(res.shift.status, 'open')
  assert.match(res.shift.id, /^TUR-PUN-/)

  // Verificar candado activo determinístico
  const lockDoc = await db.collection('cash_shift_active_locks').doc('sec-punata-1_punata').get()
  assert.equal(lockDoc.exists, true)
  assert.equal(lockDoc.data().status, 'open')
  assert.equal(lockDoc.data().shiftId, res.shift.id)

  // Verificar movimiento financiero de fondo inicial (NO es venta comercial)
  const movDoc = await db.collection('financial_movements').doc(`MOV-INIT-${res.shift.id}`).get()
  assert.equal(movDoc.exists, true)
  assert.equal(movDoc.data().type, 'initial_cash')
  assert.equal(movDoc.data().amountCents, 10000)
  assert.equal(movDoc.data().concept, 'Fondo inicial de apertura de caja (cambio/sencillo)')
})

test('2. CONCURRENCIA Y DOBLE CLIC: Impide abrir un segundo turno si ya tiene uno abierto', async () => {
  await createTestUser('sec-punata-2', 'secretaria', 'punata')

  // Primera apertura exitosa
  await openCashShift.run({
    auth: { uid: 'sec-punata-2', token: { email: 'sec-punata-2@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 5000 },
  })

  // Intento de segunda apertura concurrente o por doble clic
  await assert.rejects(
    async () =>
      openCashShift.run({
        auth: { uid: 'sec-punata-2', token: { email: 'sec-punata-2@expresopunata.com' } },
        data: { branchId: 'punata', initialCashCents: 5000 },
      }),
    (err) => {
      assert.equal(err.code, 'failed-precondition')
      assert.match(err.message, /Ya existe un turno de caja abierto para este operador/)
      return true
    }
  )
})

test('3. RESTRICCIÓN DE SUCURSAL Y ROL: Secretaria de Cochabamba no puede operar caja de Punata', async () => {
  await createTestUser('sec-cbb-1', 'secretaria', 'cochabamba', ['cochabamba'])

  await assert.rejects(
    async () =>
      openCashShift.run({
        auth: { uid: 'sec-cbb-1', token: { email: 'sec-cbb-1@expresopunata.com' } },
        data: { branchId: 'punata', initialCashCents: 10000 },
      }),
    (err) => {
      assert.equal(err.code, 'permission-denied')
      assert.match(err.message, /No tiene permiso para operar la caja de la sucursal 'punata'/)
      return true
    }
  )

  // Rol conductor tampoco puede abrir caja
  await createTestUser('chofer-1', 'conductor', 'punata')
  await assert.rejects(
    async () =>
      openCashShift.run({
        auth: { uid: 'chofer-1', token: { email: 'chofer-1@expresopunata.com' } },
        data: { branchId: 'punata', initialCashCents: 10000 },
      }),
    (err) => {
      assert.equal(err.code, 'permission-denied')
      return true
    }
  )
})

test('4. COBRO EN EFECTIVO VINCULADO A CAJA: Encomienda de Bs 15 en efectivo sube esperado de Bs 100 a Bs 115', async () => {
  await createTestUser('sec-operaciones', 'secretaria', 'punata')

  // Abrir turno con Bs 100 (10000 centavos)
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-operaciones', token: { email: 'sec-operaciones@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = shiftRes.shift.id

  // Registrar encomienda con tarifa de 1500 centavos (Bs 15) pagada en efectivo en origen
  const shipRes = await createShipment.run({
    auth: { uid: 'sec-operaciones', token: { email: 'sec-operaciones@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Remitente Punata', phone: '71711111' },
      recipient: { name: 'Destinatario Cbb', phone: '72222222' },
      items: [{ description: 'Paquete de prueba', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      // No enviamos cashShiftId para probar la resolución automática desde el lock
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `ship-cash-${Date.now()}`,
    },
  })

  assert.equal(shipRes.isDuplicate, false)
  assert.equal(shipRes.shipment.paymentStatus, 'paid')
  assert.equal(shipRes.shipment.paymentMethod, 'cash')
  assert.equal(shipRes.shipment.cashShiftId, shiftId)
  assert.equal(shipRes.shipment.finalAmountCents, 1500)

  // Verificar que el movimiento financiero existe
  const movDoc = await db.collection('financial_movements').doc(`MOV-${shipRes.shipment.trackingCode}`).get()
  assert.equal(movDoc.exists, true)
  assert.equal(movDoc.data().amountCents, 1500)
  assert.equal(movDoc.data().paymentMethod, 'cash')
  assert.equal(movDoc.data().type, 'shipment_income')

  // Verificar que el efectivo esperado en el turno aumentó exactamente a Bs 115 (11500 centavos)
  const updatedShiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(updatedShiftDoc.data().expectedCashCents, 11500)
  assert.equal(updatedShiftDoc.data().breakdown.cashIncomeCents, 1500)
  assert.equal(updatedShiftDoc.data().breakdown.totalIncomeCents, 1500)
})

test('5. COBRO POR QR NO AUMENTA EFECTIVO FÍSICO: Cobro de Bs 20 por QR no aumenta expectedCashCents', async () => {
  await createTestUser('sec-qr', 'secretaria', 'punata')

  // Abrir turno con Bs 100
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-qr', token: { email: 'sec-qr@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = shiftRes.shift.id

  // Primer cobro: efectivo Bs 15 -> esperado pasa a 11500
  await createShipment.run({
    auth: { uid: 'sec-qr', token: { email: 'sec-qr@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Cliente 1', phone: '71711111' },
      recipient: { name: 'Cliente 2', phone: '72222222' },
      items: [{ description: 'Sobre 1', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `efectivo-1-${Date.now()}`,
    },
  })

  // Segundo cobro: QR Bs 15 (1500 cts)
  const qrShipRes = await createShipment.run({
    auth: { uid: 'sec-qr', token: { email: 'sec-qr@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Cliente QR', phone: '71733333' },
      recipient: { name: 'Cliente Destino', phone: '72244444' },
      items: [{ description: 'Sobre QR', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'qr',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `qr-1-${Date.now()}`,
    },
  })

  assert.equal(qrShipRes.shipment.paymentStatus, 'paid')
  assert.equal(qrShipRes.shipment.paymentMethod, 'qr')

  // Verificar movimiento QR
  const qrMovDoc = await db.collection('financial_movements').doc(`MOV-${qrShipRes.shipment.trackingCode}`).get()
  assert.equal(qrMovDoc.exists, true)
  assert.equal(qrMovDoc.data().paymentMethod, 'qr')

  // Comprobar el turno: el efectivo esperado sigue en 11500 (NO subió por el QR)
  const shiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  const data = shiftDoc.data()
  assert.equal(data.expectedCashCents, 11500, 'El efectivo físico esperado no debe incrementarse con pagos QR')
  assert.equal(data.breakdown.qrIncomeCents, 1500, 'El desglose de QR debe registrar 1500 cts')
  assert.equal(data.breakdown.cashIncomeCents, 1500, 'El desglose de efectivo debe registrar 1500 cts')
  assert.equal(data.breakdown.totalIncomeCents, 3000, 'El total comercial acumulado debe registrar 3000 cts')
})

test('6. IDEMPOTENCIA: Petición repetida no vuelve a cobrar ni a duplicar movimientos', async () => {
  await createTestUser('sec-idemp', 'secretaria', 'punata')

  await openCashShift.run({
    auth: { uid: 'sec-idemp', token: { email: 'sec-idemp@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })

  const idempotencyKey = `idemp-test-${Date.now()}`
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'Cliente Idemp', phone: '71711111' },
    recipient: { name: 'Destino Idemp', phone: '72222222' },
    items: [{ description: 'Carga Idemp', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    paymentMethod: 'cash',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey,
  }

  // Primera llamada
  const res1 = await createShipment.run({
    auth: { uid: 'sec-idemp', token: { email: 'sec-idemp@expresopunata.com' } },
    data: payload,
  })
  assert.equal(res1.isDuplicate, false)

  // Segunda llamada idéntica
  const res2 = await createShipment.run({
    auth: { uid: 'sec-idemp', token: { email: 'sec-idemp@expresopunata.com' } },
    data: payload,
  })
  assert.equal(res2.isDuplicate, true)
  assert.equal(res2.shipment.trackingCode, res1.shipment.trackingCode)

  // Solo debe existir exactamente un movimiento financiero
  const movDocs = await db.collection('financial_movements')
    .where('trackingCode', '==', res1.shipment.trackingCode)
    .get()
  assert.equal(movDocs.docs.length, 1)
})

test('7. RECHAZO SIN CAJA ABIERTA: origin_paid sin turno abierto y sin fallback falla con failed-precondition', async () => {
  await createTestUser('sec-sin-caja', 'secretaria', 'punata')
  // No abrimos caja

  await assert.rejects(
    async () =>
      createShipment.run({
        auth: { uid: 'sec-sin-caja', token: { email: 'sec-sin-caja@expresopunata.com' } },
        data: {
          originBranchId: 'punata',
          destinationBranchId: 'cochabamba',
          sender: { name: 'Cliente Sin Caja', phone: '71711111' },
          recipient: { name: 'Destino', phone: '72222222' },
          items: [{ description: 'Item', quantity: 1, weightKg: 1 }],
          paymentTiming: 'origin_paid',
          paymentMethod: 'cash',
          prohibitedGoodsNoticeAccepted: true,
          idempotencyKey: `no-shift-err-${Date.now()}`,
        },
      }),
    (err) => {
      assert.equal(err.code, 'failed-precondition')
      assert.match(err.message, /No tiene un turno de caja abierto en la sucursal de origen/)
      return true
    }
  )
})

test('8. CIERRE DE CAJA CON ARQUEO CONFORME: Arqueo exacto con diferencia cero', async () => {
  await createTestUser('sec-cierre-ok', 'secretaria', 'punata')

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-cierre-ok', token: { email: 'sec-cierre-ok@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = openRes.shift.id

  // Cobro en efectivo de Bs 15 -> Esperado = Bs 115 (11500 cts)
  await createShipment.run({
    auth: { uid: 'sec-cierre-ok', token: { email: 'sec-cierre-ok@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Cierre Remitente', phone: '71711111' },
      recipient: { name: 'Cierre Destino', phone: '72222222' },
      items: [{ description: 'Paquete Cierre', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `cierre-ok-${Date.now()}`,
    },
  })

  // Cierre contando exactamente 11500 centavos
  const closeRes = await closeCashShift.run({
    auth: { uid: 'sec-cierre-ok', token: { email: 'sec-cierre-ok@expresopunata.com' } },
    data: {
      shiftId,
      actualCashCents: 11500,
      actualCashBreakdown: { '100': 1, '10': 1, '5': 1 },
      notes: 'Arqueo perfecto sin novedades',
    },
  })

  assert.equal(closeRes.success, true)
  assert.equal(closeRes.shift.status, 'closed')
  assert.equal(closeRes.shift.expectedCashCents, 11500)
  assert.equal(closeRes.shift.actualCashCents, 11500)
  assert.equal(closeRes.shift.differenceCents, 0)
  assert.equal(closeRes.shift.differenceStatus, 'conforme')

  // Candado determinístico debe quedar cerrado
  const lockDoc = await db.collection('cash_shift_active_locks').doc('sec-cierre-ok_punata').get()
  assert.equal(lockDoc.data().status, 'closed')
})

test('9. CIERRE CON FALTANTE: Registra diferencia negativa y movimiento de ajuste', async () => {
  await createTestUser('sec-faltante', 'secretaria', 'punata')

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-faltante', token: { email: 'sec-faltante@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = openRes.shift.id

  // Cobro Bs 15 -> Esperado = 11500 cts
  await createShipment.run({
    auth: { uid: 'sec-faltante', token: { email: 'sec-faltante@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Remitente', phone: '71711111' },
      recipient: { name: 'Destino', phone: '72222222' },
      items: [{ description: 'Paquete', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `faltante-${Date.now()}`,
    },
  })

  // Operador cuenta físicamente solo 10000 cts (faltan 1500 cts)
  const closeRes = await closeCashShift.run({
    auth: { uid: 'sec-faltante', token: { email: 'sec-faltante@expresopunata.com' } },
    data: {
      shiftId,
      actualCashCents: 10000,
      notes: 'Faltante en caja por cambio errado',
    },
  })

  assert.equal(closeRes.shift.differenceCents, -1500)
  assert.equal(closeRes.shift.differenceStatus, 'faltante')

  // Movimiento de ajuste auditable
  const adjDoc = await db.collection('financial_movements').doc(`MOV-ADJ-${shiftId}`).get()
  assert.equal(adjDoc.exists, true)
  assert.equal(adjDoc.data().type, 'adjustment')
  assert.equal(adjDoc.data().amountCents, -1500)
})

test('10. TURNO CERRADO BLOQUEA MOVIMIENTOS POSTERIORES: No permite cobrar con un turno cerrado', async () => {
  await createTestUser('sec-bloqueo', 'secretaria', 'punata')

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-bloqueo', token: { email: 'sec-bloqueo@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = openRes.shift.id

  // Cerrar el turno
  await closeCashShift.run({
    auth: { uid: 'sec-bloqueo', token: { email: 'sec-bloqueo@expresopunata.com' } },
    data: { shiftId, actualCashCents: 10000 },
  })

  // Intentar cobrar especificando el ID del turno ya cerrado
  await assert.rejects(
    async () =>
      createShipment.run({
        auth: { uid: 'sec-bloqueo', token: { email: 'sec-bloqueo@expresopunata.com' } },
        data: {
          originBranchId: 'punata',
          destinationBranchId: 'cochabamba',
          sender: { name: 'Cliente Tardío', phone: '71711111' },
          recipient: { name: 'Destino', phone: '72222222' },
          items: [{ description: 'Paquete tardío', quantity: 1, weightKg: 1 }],
          paymentTiming: 'origin_paid',
          paymentMethod: 'cash',
          cashShiftId: shiftId,
          prohibitedGoodsNoticeAccepted: true,
          idempotencyKey: `bloqueo-cerrado-${Date.now()}`,
        },
      }),
    (err) => {
      assert.equal(err.code, 'failed-precondition')
      assert.match(err.message, /no está abierto/)
      return true
    }
  )
})

test('11. REGISTRO DE EGRESO AUTORIZADO: Descuenta efectivo disponible y registra movimiento', async () => {
  await createTestUser('sec-egreso', 'secretaria', 'punata')

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-egreso', token: { email: 'sec-egreso@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 }, // Bs 100
  })
  const shiftId = openRes.shift.id

  // Registrar egreso de Bs 20 (2000 cts) por artículos de limpieza
  const expRes = await registerCashExpense.run({
    auth: { uid: 'sec-egreso', token: { email: 'sec-egreso@expresopunata.com' } },
    data: {
      branchId: 'punata',
      amountCents: 2000,
      concept: 'Compra de cinta de embalaje y marcadores',
      category: 'oficina',
      voucherNumber: 'REC-00124',
    },
  })

  assert.equal(expRes.success, true)
  assert.equal(expRes.newExpectedCashCents, 8000)

  // Verificar movimiento financiero de egreso con signo negativo
  const movDoc = await db.collection('financial_movements').doc(expRes.movementId).get()
  assert.equal(movDoc.exists, true)
  assert.equal(movDoc.data().type, 'expense')
  assert.equal(movDoc.data().amountCents, -2000)

  // Verificar que el turno de caja redujo el efectivo esperado a 8000
  const shiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(shiftDoc.data().expectedCashCents, 8000)
  assert.equal(shiftDoc.data().breakdown.expensesCents, 2000)
})

test('12. COBRO EN VENTANILLA DE ENCOMIENDA PENDIENTE: collectShipmentPayment confirma cobro y suma a caja activa', async () => {
  await createTestUser('sec-pendiente', 'secretaria', 'punata')

  // 1. Crear encomienda como origin_pending (cliente deja paquete y pagará después)
  const shipRes = await createShipment.run({
    auth: { uid: 'sec-pendiente', token: { email: 'sec-pendiente@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Cliente Pendiente', phone: '71711111' },
      recipient: { name: 'Destino', phone: '72222222' },
      items: [{ description: 'Paquete por pagar', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_pending',
      allowPendingFallback: true,
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `pending-${Date.now()}`,
    },
  })

  assert.equal(shipRes.shipment.paymentStatus, 'pending')
  assert.equal(shipRes.shipment.financialMovementId, null)

  // 2. Abrir caja con Bs 100
  const openRes = await openCashShift.run({
    auth: { uid: 'sec-pendiente', token: { email: 'sec-pendiente@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = openRes.shift.id

  // 3. El cliente viene a ventanilla y paga en efectivo los Bs 15 (1500 cts)
  const collectRes = await collectShipmentPayment.run({
    auth: { uid: 'sec-pendiente', token: { email: 'sec-pendiente@expresopunata.com' } },
    data: {
      trackingCode: shipRes.shipment.trackingCode,
      paymentMethod: 'cash',
      branchId: 'punata',
    },
  })

  assert.equal(collectRes.success, true)
  assert.equal(collectRes.trackingCode, shipRes.shipment.trackingCode)

  // Verificar encomienda actualizada a pagada
  const updatedShipDoc = await db.collection('shipments').doc(shipRes.shipment.trackingCode).get()
  assert.equal(updatedShipDoc.data().paymentStatus, 'paid')
  assert.equal(updatedShipDoc.data().cashShiftId, shiftId)

  // Verificar movimiento financiero creado
  const movDoc = await db.collection('financial_movements').doc(`MOV-${shipRes.shipment.trackingCode}`).get()
  assert.equal(movDoc.exists, true)
  assert.equal(movDoc.data().amountCents, 1500)

  // Verificar que el efectivo esperado pasó de 10000 a 11500
  const shiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(shiftDoc.data().expectedCashCents, 11500)
})


test('13. RESTRICCIÓN DE SUCURSAL EN COBRO PENDIENTE: collectShipmentPayment en origen_pending rechaza cobro si no es la sucursal de origen', async () => {
  await createTestUser('sec-origen-pun', 'secretaria', 'punata')
  await createTestUser('sec-dest-cbba', 'secretaria', 'cochabamba')

  // Crear encomienda origin_pending en Punata
  await db.collection('shipments').doc('EP-TEST-PEND-1').set({
    trackingCode: 'EP-TEST-PEND-1',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    paymentTiming: 'origin_pending',
    paymentStatus: 'pending',
    finalAmountCents: 2500,
    status: 'received',
  })

  // Abrir turno en Cochabamba
  await openCashShift.run({
    auth: { uid: 'sec-dest-cbba', token: { email: 'sec-dest-cbba@expresopunata.com' } },
    data: { branchId: 'cochabamba', initialCashCents: 5000 },
  })

  // Secretaria de Cochabamba intenta cobrar el pago que corresponde a origen (Punata) -> debe fallar
  await assert.rejects(
    async () => {
      await collectShipmentPayment.run({
        auth: { uid: 'sec-dest-cbba', token: { email: 'sec-dest-cbba@expresopunata.com' } },
        data: {
          trackingCode: 'EP-TEST-PEND-1',
          paymentMethod: 'cash',
          branchId: 'cochabamba',
        },
      })
    },
    (err) => {
      assert.equal(err.code, 'failed-precondition')
      assert.match(err.message, /solo puede ser cobrado en la sucursal de origen/i)
      return true
    }
  )
})

test('14. RESTRICCIÓN DE SUCURSAL EN COD: collectShipmentPayment en destination_cod rechaza cobro si no es la sucursal de destino', async () => {
  await createTestUser('sec-cod-pun', 'secretaria', 'punata')

  // Encomienda COD con destino Cochabamba
  await db.collection('shipments').doc('EP-TEST-COD-1').set({
    trackingCode: 'EP-TEST-COD-1',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    paymentTiming: 'destination_cod',
    paymentStatus: 'pending',
    finalAmountCents: 3000,
    status: 'received_at_dest',
  })

  // Abrir turno en Punata
  await openCashShift.run({
    auth: { uid: 'sec-cod-pun', token: { email: 'sec-cod-pun@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 5000 },
  })

  // Intentar cobrar contraentrega en Punata (origen) en lugar de Cochabamba (destino) -> debe fallar
  await assert.rejects(
    async () => {
      await collectShipmentPayment.run({
        auth: { uid: 'sec-cod-pun', token: { email: 'sec-cod-pun@expresopunata.com' } },
        data: {
          trackingCode: 'EP-TEST-COD-1',
          paymentMethod: 'cash',
          branchId: 'punata',
        },
      })
    },
    (err) => {
      assert.equal(err.code, 'failed-precondition')
      assert.match(err.message, /solo puede realizarse en la sucursal de destino/i)
      return true
    }
  )
})

test('15. COBRO ANTICIPADO DE COD IMPEDIDO: No permite cobrar destination_cod si la encomienda aún no arribó a destino', async () => {
  await createTestUser('sec-anticipada-cbba', 'secretaria', 'cochabamba')

  // Encomienda COD aún en tránsito
  await db.collection('shipments').doc('EP-TEST-COD-TRANSIT').set({
    trackingCode: 'EP-TEST-COD-TRANSIT',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    paymentTiming: 'destination_cod',
    paymentStatus: 'pending',
    finalAmountCents: 4000,
    status: 'in_transit', // Aún no ha arribado a Cochabamba
  })

  await openCashShift.run({
    auth: { uid: 'sec-anticipada-cbba', token: { email: 'sec-anticipada-cbba@expresopunata.com' } },
    data: { branchId: 'cochabamba', initialCashCents: 5000 },
  })

  await assert.rejects(
    async () => {
      await collectShipmentPayment.run({
        auth: { uid: 'sec-anticipada-cbba', token: { email: 'sec-anticipada-cbba@expresopunata.com' } },
        data: {
          trackingCode: 'EP-TEST-COD-TRANSIT',
          paymentMethod: 'cash',
          branchId: 'cochabamba',
        },
      })
    },
    (err) => {
      assert.equal(err.code, 'failed-precondition')
      assert.match(err.message, /No se puede realizar el cobro contraentrega anticipado/i)
      return true
    }
  )
})

test('16. COBRO EXITOSO DE COD EN DESTINO: Permite cobrar destination_cod cuando status es received_at_dest', async () => {
  await createTestUser('sec-cod-ok-cbba', 'secretaria', 'cochabamba')

  await db.collection('shipments').doc('EP-TEST-COD-OK').set({
    trackingCode: 'EP-TEST-COD-OK',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    paymentTiming: 'destination_cod',
    paymentStatus: 'pending',
    finalAmountCents: 3500,
    status: 'received_at_dest',
  })

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-cod-ok-cbba', token: { email: 'sec-cod-ok-cbba@expresopunata.com' } },
    data: { branchId: 'cochabamba', initialCashCents: 10000 },
  })

  const collectRes = await collectShipmentPayment.run({
    auth: { uid: 'sec-cod-ok-cbba', token: { email: 'sec-cod-ok-cbba@expresopunata.com' } },
    data: {
      trackingCode: 'EP-TEST-COD-OK',
      paymentMethod: 'cash',
      branchId: 'cochabamba',
    },
  })

  assert.equal(collectRes.success, true)
  assert.equal(collectRes.amountCents, 3500)

  // Verificar que el turno incrementó expectedCashCents y codIncomeCents
  const shiftDoc = await db.collection('cash_shifts').doc(openRes.shift.id).get()
  assert.equal(shiftDoc.data().expectedCashCents, 13500)
  assert.equal(shiftDoc.data().breakdown.codIncomeCents, 3500)
})

test('17. IDEMPOTENCIA EN REGISTRO DE EGRESO: Petición duplicada con el mismo idempotencyKey devuelve el movimiento previo sin descontar doble', async () => {
  await createTestUser('sec-idem-exp', 'secretaria', 'punata')

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-idem-exp', token: { email: 'sec-idem-exp@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 20000 },
  })

  const idempotencyKey = 'key-exp-doble-clic-123'

  // Primera llamada: egreso de Bs 20 (2000 cts)
  const res1 = await registerCashExpense.run({
    auth: { uid: 'sec-idem-exp', token: { email: 'sec-idem-exp@expresopunata.com' } },
    data: {
      branchId: 'punata',
      amountCents: 2000,
      concept: 'Compra de cinta de embalaje',
      category: 'insumos',
      idempotencyKey,
    },
  })
  assert.equal(res1.success, true)
  assert.equal(res1.cached, undefined)
  assert.equal(res1.newExpectedCashCents, 18000)

  // Segunda llamada idéntica (simulando doble clic o reintento de red)
  const res2 = await registerCashExpense.run({
    auth: { uid: 'sec-idem-exp', token: { email: 'sec-idem-exp@expresopunata.com' } },
    data: {
      branchId: 'punata',
      amountCents: 2000,
      concept: 'Compra de cinta de embalaje',
      category: 'insumos',
      idempotencyKey,
    },
  })
  assert.equal(res2.success, true)
  assert.equal(res2.cached, true)
  assert.equal(res2.movementId, res1.movementId)

  // Verificar en base de datos que el turno solo fue descontado una vez
  const shiftDoc = await db.collection('cash_shifts').doc(openRes.shift.id).get()
  assert.equal(shiftDoc.data().expectedCashCents, 18000)
  assert.equal(shiftDoc.data().breakdown.expensesCents, 2000)
})

test('18. CONTROL DE PERMISOS EN EGRESOS: Secretaria no puede registrar gasto > Bs 150 sin approvedBy; con approvedBy es aceptado', async () => {
  await createTestUser('sec-limite-exp', 'secretaria', 'punata')

  await openCashShift.run({
    auth: { uid: 'sec-limite-exp', token: { email: 'sec-limite-exp@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 50000 }, // Bs 500
  })

  // Intento de registrar egreso de Bs 200 (20000 cts) sin aprobación -> debe fallar
  await assert.rejects(
    async () => {
      await registerCashExpense.run({
        auth: { uid: 'sec-limite-exp', token: { email: 'sec-limite-exp@expresopunata.com' } },
        data: {
          branchId: 'punata',
          amountCents: 20000,
          concept: 'Mantenimiento urgente de fotocopiadora',
          category: 'mantenimiento',
        },
      })
    },
    (err) => {
      assert.equal(err.code, 'permission-denied')
      assert.match(err.message, /requieren el nombre o comprobante de autorización/i)
      return true
    }
  )

  // Con approvedBy -> debe procesarse exitosamente
  const resOk = await registerCashExpense.run({
    auth: { uid: 'sec-limite-exp', token: { email: 'sec-limite-exp@expresopunata.com' } },
    data: {
      branchId: 'punata',
      amountCents: 20000,
      concept: 'Mantenimiento urgente de fotocopiadora',
      category: 'mantenimiento',
      approvedBy: 'Nelson Arispe (Administrador)',
      voucherNumber: 'FAC-8812',
    },
  })
  assert.equal(resOk.success, true)
  assert.equal(resOk.amountCents, 20000)
})

test('19. VALIDACIÓN AUTORITATIVA DEL DESGLOSE EN ARQUEO: Falla si desglose de billetes y monedas no coincide con actualCashCents', async () => {
  await createTestUser('sec-arqueo-val', 'secretaria', 'punata')

  const openRes = await openCashShift.run({
    auth: { uid: 'sec-arqueo-val', token: { email: 'sec-arqueo-val@expresopunata.com' } },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = openRes.shift.id

  // Desglose dice: 1 billete de Bs 100 = Bs 100 (10000 cts), pero se declara actualCashCents = 15000 (Bs 150) -> discrepancia interna -> debe fallar
  await assert.rejects(
    async () => {
      await closeCashShift.run({
        auth: { uid: 'sec-arqueo-val', token: { email: 'sec-arqueo-val@expresopunata.com' } },
        data: {
          shiftId,
          actualCashCents: 15000,
          actualCashBreakdown: { '100': 1 }, // Solo suma 10000
        },
      })
    },
    (err) => {
      assert.equal(err.code, 'invalid-argument')
      assert.match(err.message, /no coincide con el efectivo físico declarado/i)
      return true
    }
  )

  // Con desglose coincidente (1 billete de Bs 100 + 1 de Bs 50 = Bs 150 = 15000 cts) -> éxito
  const closeRes = await closeCashShift.run({
    auth: { uid: 'sec-arqueo-val', token: { email: 'sec-arqueo-val@expresopunata.com' } },
    data: {
      shiftId,
      actualCashCents: 15000,
      actualCashBreakdown: { '100': 1, '50': 1 },
      notes: 'Arqueo con desglose correcto verificado',
    },
  })
  assert.equal(closeRes.success, true)
  assert.equal(closeRes.shift.status, 'closed')
  assert.equal(closeRes.shift.actualCashCents, 15000)
  assert.equal(closeRes.shift.differenceCents, 5000) // Sobrante de Bs 50
  assert.equal(closeRes.shift.differenceStatus, 'sobrante')
})
