import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  createShipment,
  openCashShift,
  getSystemConfig,
  updateSystemConfig,
  getSystemReport,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST ||= 'http://127.0.0.1:9199'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-price-test' })
}

const db = getFirestore()

async function clearCollections() {
  const collections = [
    'users',
    'shipments',
    'shipment_notifications',
    'cash_shifts',
    'cash_shift_active_locks',
    'financial_movements',
    'counters',
    'idempotency_keys',
    'system_config',
    'audit_logs',
  ]
  for (const coll of collections) {
    const snap = await db.collection(coll).get()
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

async function createTestUser(uid, role, primaryBranchId = 'punata') {
  await db.collection('users').doc(uid).set({
    uid,
    role,
    primaryBranchId,
    allowedBranchIds: ['punata', 'cochabamba'],
    fullName: `Operador ${role}`,
    isActive: true,
    email: `${uid}@expresopunata.com`,
  })
}

before(async () => {
  await clearCollections()
})

beforeEach(async () => {
  await clearCollections()
  await createTestUser('admin-1', 'directiva_admin')
  await createTestUser('secretaria-punata', 'secretaria', 'punata')
  await createTestUser('secretaria-cbb', 'secretaria', 'cochabamba')
})

test('1. PRECIO MODIFICADO HACIA ARRIBA: Bs 15 sugerido vs Bs 20 acordado con motivo', async () => {
  // A. Abrir turno de caja para secretaria en Punata
  const shiftRes = await openCashShift.run({
    auth: { uid: 'secretaria-punata' },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  assert.strictEqual(shiftRes.success, true)
  const shiftId = shiftRes.shift?.id || shiftRes.shiftId

  // B. Registrar encomienda con precio acordado superior
  const req = {
    auth: { uid: 'secretaria-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Juan Remitente', phone: '70712345' },
      recipient: { name: 'María Destinatario', phone: '70754321' },
      items: [{ description: 'Caja frágil de vidrio', quantity: 1, weightKg: 1, isFragile: true }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: 'idemp-test-price-up-001',
      cashShiftId: shiftId,
      suggestedAmountCents: 1500,
      agreedAmountCents: 2000, // Bs 20.00
      priceAdjustmentReason: 'Embalaje especial y manejo cuidadoso',
    },
  }

  const result = await createShipment.run(req)
  assert.strictEqual(result.success, true)
  const trackingCode = result.trackingCode
  assert.ok(trackingCode.startsWith('PUN2026'))

  // C. Verificar documento en Firestore
  const shipDoc = await db.collection('shipments').doc(trackingCode).get()
  assert.strictEqual(shipDoc.exists, true)
  const shipData = shipDoc.data()
  assert.strictEqual(shipData.suggestedAmountCents, 1500)
  assert.strictEqual(shipData.agreedAmountCents, 2000)
  assert.strictEqual(shipData.finalAmountCents, 2000)
  assert.strictEqual(shipData.isPriceAdjusted, true)
  assert.strictEqual(shipData.priceAdjustmentReason, 'Embalaje especial y manejo cuidadoso')
  assert.strictEqual(shipData.priceAdjustedByUid, 'secretaria-punata')
  assert.strictEqual(shipData.paymentStatus, 'paid')

  // D. Verificar movimiento financiero
  const movDoc = await db.collection('financial_movements').doc(`MOV-${trackingCode}`).get()
  assert.strictEqual(movDoc.exists, true)
  assert.strictEqual(movDoc.data().amountCents, 2000)
  assert.strictEqual(movDoc.data().shiftId, shiftId)

  // E. Verificar actualización de caja
  const shiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  const shiftData = shiftDoc.data()
  assert.strictEqual(shiftData.expectedCashCents, 10000 + 2000)
  assert.strictEqual(shiftData.breakdown.totalIncomeCents, 2000)
  assert.strictEqual(shiftData.breakdown.shipmentsIncomeCents, 2000)
  assert.strictEqual(shiftData.breakdown.cashIncomeCents, 2000)
})

test('2. PRECIO MODIFICADO HACIA ABAJO: Bs 15 sugerido vs Bs 10 acordado (rebaja de ventanilla)', async () => {
  const shiftRes = await openCashShift.run({
    auth: { uid: 'secretaria-punata' },
    data: { branchId: 'punata', initialCashCents: 5000 },
  })
  const shiftId = shiftRes.shift?.id || shiftRes.shiftId

  const req = {
    auth: { uid: 'secretaria-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Rosa Flores', phone: '70799881' },
      recipient: { name: 'Carlos Mendez', phone: '70799882' },
      items: [{ description: 'Sobre de documentos', quantity: 1, weightKg: 0.2 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: 'idemp-test-price-down-002',
      cashShiftId: shiftId,
      suggestedAmountCents: 1500,
      agreedAmountCents: 1000, // Bs 10.00
      priceAdjustmentReason: 'Acuerdo comercial por envío liviano',
    },
  }

  const result = await createShipment.run(req)
  assert.strictEqual(result.success, true)
  const trackingCode = result.trackingCode

  const shipDoc = await db.collection('shipments').doc(trackingCode).get()
  const shipData = shipDoc.data()
  assert.strictEqual(shipData.suggestedAmountCents, 1500)
  assert.strictEqual(shipData.agreedAmountCents, 1000)
  assert.strictEqual(shipData.finalAmountCents, 1000)
  assert.strictEqual(shipData.isPriceAdjusted, true)
  assert.strictEqual(shipData.priceAdjustmentReason, 'Acuerdo comercial por envío liviano')

  const movDoc = await db.collection('financial_movements').doc(`MOV-${trackingCode}`).get()
  assert.strictEqual(movDoc.data().amountCents, 1000)

  const shiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  assert.strictEqual(shiftDoc.data().expectedCashCents, 5000 + 1000)
})

test('3. PRECIO PREDETERMINADO: si no se especifica agreedAmountCents, utiliza la tarifa calculada', async () => {
  const shiftRes = await openCashShift.run({
    auth: { uid: 'secretaria-punata' },
    data: { branchId: 'punata', initialCashCents: 5000 },
  })
  const shiftId = shiftRes.shift?.id || shiftRes.shiftId

  const req = {
    auth: { uid: 'secretaria-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Cliente Normal', phone: '70711111' },
      recipient: { name: 'Destinatario Normal', phone: '70722222' },
      items: [{ description: 'Paquete estándar', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: 'idemp-test-default-price-003',
      cashShiftId: shiftId,
    },
  }

  const result = await createShipment.run(req)
  assert.strictEqual(result.success, true)
  const trackingCode = result.trackingCode

  const shipDoc = await db.collection('shipments').doc(trackingCode).get()
  const shipData = shipDoc.data()
  assert.strictEqual(shipData.suggestedAmountCents, 1500)
  assert.strictEqual(shipData.agreedAmountCents, 1500)
  assert.strictEqual(shipData.finalAmountCents, 1500)
  assert.strictEqual(shipData.isPriceAdjusted, false)
  assert.strictEqual(shipData.priceAdjustmentReason, null)
})

test('4. VALIDACIÓN DE PRECIO CERO: Bs 0.00 requiere obligatoriamente motivo justificado', async () => {
  const shiftRes = await openCashShift.run({
    auth: { uid: 'secretaria-punata' },
    data: { branchId: 'punata', initialCashCents: 5000 },
  })
  const shiftId = shiftRes.shift?.id || shiftRes.shiftId

  // Intento de precio 0 sin motivo debe fallar
  const reqNoReason = {
    auth: { uid: 'secretaria-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Cliente Cero', phone: '70733333' },
      recipient: { name: 'Destinatario Cero', phone: '70744444' },
      items: [{ description: 'Cortesía sin motivo', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: 'idemp-test-zero-invalid-004',
      cashShiftId: shiftId,
      agreedAmountCents: 0,
    },
  }

  await assert.rejects(
    async () => {
      await createShipment.run(reqNoReason)
    },
    (err) => {
      assert.ok(err.message.includes('obligatorio especificar el motivo'))
      return true
    }
  )

  // Con motivo válido debe proceder
  const reqWithReason = {
    auth: { uid: 'secretaria-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Cliente Cero', phone: '70733333' },
      recipient: { name: 'Destinatario Cero', phone: '70744444' },
      items: [{ description: 'Cortesía con motivo', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: 'idemp-test-zero-valid-005',
      cashShiftId: shiftId,
      agreedAmountCents: 0,
      priceAdjustmentReason: 'Exoneración autorizada por Presidencia',
    },
  }

  const resOk = await createShipment.run(reqWithReason)
  assert.strictEqual(resOk.success, true)
  const shipDoc = await db.collection('shipments').doc(resOk.trackingCode).get()
  assert.strictEqual(shipDoc.data().finalAmountCents, 0)
  assert.strictEqual(shipDoc.data().isPriceAdjusted, true)
  assert.strictEqual(shipDoc.data().priceAdjustmentReason, 'Exoneración autorizada por Presidencia')
})

test('5. ESTADO HONESTO DE CONFIGURACIÓN: getSystemConfig reporta unconfigured cuando no existe doc', async () => {
  // Asegurar que no existe documento de configuración
  await db.collection('system_config').doc('expreso_punata').delete()

  const res = await getSystemConfig.run({})
  assert.strictEqual(res.success, true)
  assert.strictEqual(res.status, 'unconfigured')
  assert.strictEqual(res.isOfficial, false)
  assert.strictEqual(res.isDefault, true)
  assert.strictEqual(res.config, null)
  assert.ok(res.message.includes('aún no cuenta con configuración oficial aprobada'))

  // Ahora configurar oficialmente
  await updateSystemConfig.run({
    auth: { uid: 'admin-1' },
    data: {
      company: {
        legalName: 'Expreso Punata S.R.L.',
        shortName: 'Expreso Punata',
        nit: '1029384756',
        phones: ['4571234', '70712345'],
      },
      tariffs: {
        baseFeeCents: 1800,
        freeWeightKg: 4,
        extraKgRateCents: 250,
        homeDeliveryFeeCents: 1500,
      },
    },
  })

  // Volver a consultar
  const resConfigured = await getSystemConfig.run({})
  assert.strictEqual(resConfigured.success, true)
  assert.strictEqual(resConfigured.status, 'configured')
  assert.strictEqual(resConfigured.isOfficial, true)
  assert.strictEqual(resConfigured.isDefault, false)
  assert.strictEqual(resConfigured.config.tariffs.baseFeeCents, 1800)
})

test('6. REPORTES SIN TRUNCAMIENTO SILENCIOSO: getSystemReport respeta filtros y no oculta datos', async () => {
  // Crear turno de caja
  const shiftRes = await openCashShift.run({
    auth: { uid: 'secretaria-punata' },
    data: { branchId: 'punata', initialCashCents: 10000 },
  })
  const shiftId = shiftRes.shift?.id || shiftRes.shiftId

  // Crear 3 encomiendas con diferentes montos acordados
  const dates = [
    { name: 'Remitente 1', price: 2000, key: 'idemp-rep-1' },
    { name: 'Remitente 2', price: 1500, key: 'idemp-rep-2' },
    { name: 'Remitente 3', price: 3000, key: 'idemp-rep-3' },
  ]

  for (const d of dates) {
    await createShipment.run({
      auth: { uid: 'secretaria-punata' },
      data: {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        deliveryType: 'agency',
        sender: { name: d.name, phone: '70712345' },
        recipient: { name: 'Destinatario Reportes', phone: '70765432' },
        items: [{ description: 'Mercadería', quantity: 1, weightKg: 2 }],
        paymentTiming: 'origin_paid',
        paymentMethod: 'cash',
        prohibitedGoodsNoticeAccepted: true,
        idempotencyKey: d.key,
        cashShiftId: shiftId,
        agreedAmountCents: d.price,
        priceAdjustmentReason: 'Ajuste test reportes',
      },
    })
  }

  // Generar reporte de encomiendas
  const reportRes = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: {
      reportType: 'shipments',
      branchId: 'all',
      status: 'all',
      paymentCondition: 'all',
    },
  })

  assert.strictEqual(reportRes.success, true)
  assert.strictEqual(reportRes.records.length, 3)
  assert.strictEqual(reportRes.summary.totalShipments, 3)
  assert.strictEqual(reportRes.summary.totalBilledCents, 2000 + 1500 + 3000)
  assert.strictEqual(reportRes.summary.totalBilledBob, 65.0)
})
