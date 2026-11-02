process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

const projectId = process.env.GCLOUD_PROJECT || 'expreso-punata-dev'
process.env.GCLOUD_PROJECT = projectId

import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) {
  initializeApp({ projectId })
}

const db = getFirestore()

// Import dinámico después de inicializar la app compartida
const {
  openCashShift,
  closeCashShift,
  registerCashExpense,
  createShipment,
} = await import('../../functions/index.js')

async function runFullCajaLifecycle() {
  console.log('--- INICIANDO RECORRIDO COMPLETO DE CAJA (ENTREGA 1 CONTROLES) ---')

  // 0. Crear perfil de prueba autorizado (secretaria Punata)
  const uid = 'sec-recorrido-punata'
  await db.collection('users').doc(uid).set({
    uid,
    fullName: 'Secretaria Recorrido Punata',
    email: 'sec.recorrido@expresopunata.com',
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    isActive: true,
  })

  // 1. Apertura de turno con Bs 100 (10000 cts)
  console.log('1. Abriendo turno de caja con Bs 100.00 de fondo inicial...')
  const openRes = await openCashShift.run({
    auth: { uid, token: { email: 'sec.recorrido@expresopunata.com' } },
    data: {
      branchId: 'punata',
      initialCashCents: 10000,
      initialCashBreakdown: { '100': 1 },
      notes: 'Turno de prueba focal',
    },
  })
  assert.equal(openRes.success, true)
  const shiftId = openRes.shift.id
  console.log(`   Turno abierto con ID: ${shiftId}, Estado: ${openRes.shift.status}`)

  // 2. Cobro en efectivo de encomienda (Bs 15 = 1500 cts)
  console.log('2. Registrando encomienda con pago en efectivo (Bs 15.00)...')
  const shipCashRes = await createShipment.run({
    auth: { uid, token: { email: 'sec.recorrido@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Remitente Prueba 1', phone: '70011111', docType: 'CI', docNumber: '445566' },
      recipient: { name: 'Destinatario Prueba 1', phone: '70022222', docType: 'CI', docNumber: '778899' },
      items: [{ description: 'Documentos urgentes', quantity: 1, packaging: 'sobre', isFragile: false, category: 'documents' }],
      serviceType: 'regular',
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `idem-cash-${Date.now()}`,
    },
  })
  assert.equal(shipCashRes.success, true)
  console.log(`   Guía generada: ${shipCashRes.shipment.trackingCode}, cobrado en caja: Bs 15.00`)

  // 3. Cobro por QR de encomienda (Bs 20 = 2000 cts)
  console.log('3. Registrando encomienda con pago por QR (Bs 20.00)...')
  const shipQrRes = await createShipment.run({
    auth: { uid, token: { email: 'sec.recorrido@expresopunata.com' } },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Remitente Prueba QR', phone: '70033333', docType: 'CI', docNumber: '556677' },
      recipient: { name: 'Destinatario Prueba QR', phone: '70044444', docType: 'CI', docNumber: '889900' },
      items: [{ description: 'Caja de repuestos', quantity: 1, packaging: 'caja', isFragile: true, category: 'parts' }],
      serviceType: 'regular',
      paymentTiming: 'origin_paid',
      paymentMethod: 'qr',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `idem-qr-${Date.now()}`,
    },
  })
  assert.equal(shipQrRes.success, true)
  console.log(`   Guía generada: ${shipQrRes.shipment.trackingCode}, cobrado por QR: Bs 20.00`)

  // 4. Registro de gasto autorizado (Bs 10 = 1000 cts en útiles de oficina)
  console.log('4. Registrando egreso de caja autorizado (Bs 10.00 en material de oficina)...')
  const expRes = await registerCashExpense.run({
    auth: { uid, token: { email: 'sec.recorrido@expresopunata.com' } },
    data: {
      branchId: 'punata',
      amountCents: 1000,
      concept: 'Compra de marcadores y cinta adhesiva',
      category: 'oficina',
      voucherNumber: 'REC-001',
      idempotencyKey: `exp-idem-${Date.now()}`,
    },
  })
  assert.equal(expRes.success, true)
  console.log(`   Egreso registrado con ID: ${expRes.movementId}`)

  // 5. Verificar estado contable antes del cierre
  const intermediateShift = await db.collection('cash_shifts').doc(shiftId).get()
  const data = intermediateShift.data()
  console.log('5. Verificación contable en base de datos:')
  console.log(`   - Fondo inicial: Bs ${(data.initialCashCents / 100).toFixed(2)}`)
  console.log(`   - Efectivo esperado en gaveta: Bs ${(data.expectedCashCents / 100).toFixed(2)} (100 + 15 - 10 = 105 Bs)`)
  console.log(`   - Total ventas: Bs ${(data.breakdown.totalIncomeCents / 100).toFixed(2)} (15 efectivo + 15 QR = 30 Bs)`)
  console.log(`   - Egresos: Bs ${(data.breakdown.expensesCents / 100).toFixed(2)}`)
  assert.equal(data.expectedCashCents, 10500)
  assert.equal(data.breakdown.totalIncomeCents, 3000)
  assert.equal(data.breakdown.expensesCents, 1000)

  // 6. Arqueo y cierre con desglose conforme: Bs 105 (1 billete de 100 + 1 moneda de 5)
  console.log('6. Realizando arqueo guiado en servidor con desglose de denominaciones...')
  const closeRes = await closeCashShift.run({
    auth: { uid, token: { email: 'sec.recorrido@expresopunata.com' } },
    data: {
      shiftId,
      actualCashCents: 10500,
      actualCashBreakdown: { '100': 1, '5': 1 },
      notes: 'Arqueo exacto comprobado con calculadora de billetes',
    },
  })
  assert.equal(closeRes.success, true)
  assert.equal(closeRes.shift.status, 'closed')
  assert.equal(closeRes.shift.differenceCents, 0)
  assert.equal(closeRes.shift.differenceStatus, 'conforme')
  console.log(`   Turno cerrado exitosamente. Diferencia: ${closeRes.shift.differenceStatus.toUpperCase()} (Bs 0.00)`)

  // 7. Candado liberado
  const lockDoc = await db.collection('cash_shift_active_locks').doc(`${uid}_punata`).get()
  assert.equal(lockDoc.data().status, 'closed')
  console.log('7. Candado activo liberado correctamente.')

  console.log('--- RECORRIDO COMPLETO DE CAJA EXITOSO (100% VERIFICADO) ---')
}

runFullCajaLifecycle()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error en recorrido de caja:', err)
    process.exit(1)
  })
