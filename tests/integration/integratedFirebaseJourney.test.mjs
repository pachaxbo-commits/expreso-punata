import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { exportReportToPdf, exportToXlsx } from '../../src/services/reportService.ts'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST ||= 'http://127.0.0.1:9199'

const projectId = process.env.GCLOUD_PROJECT || 'demo-expreso-punata-integracion'
if (getApps().length === 0) initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore()
const authAdmin = getAuth()
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const tokens = new Map()
const nodeRequire = createRequire(import.meta.url)
const XLSX = nodeRequire('xlsx')
const signatureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzUAAIpCA/54h55cAAAAAElFTkSuQmCC'

function todayLaPaz() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function nextMonth(date) {
  const [year, month, day] = date.split('-').map(Number)
  const target = month === 12 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function normalizeCallableCode(status) {
  return String(status || 'internal').toLowerCase().replaceAll('_', '-')
}

async function signIn(uid) {
  if (tokens.has(uid)) return tokens.get(uid)
  const user = await authAdmin.getUser(uid)
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'Demo-only-2026!', returnSecureToken: true }),
  })
  const body = await response.json()
  assert.equal(response.ok, true, `Auth Emulator rechazó el inicio de sesión ficticio: ${JSON.stringify(body)}`)
  tokens.set(uid, body.idToken)
  return body.idToken
}

async function call(uid, functionName, data = {}) {
  const idToken = await signIn(uid)
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  })
  const body = await response.json()
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || `Callable ${functionName} respondió ${response.status}`)
    error.code = normalizeCallableCode(body.error?.status)
    throw error
  }
  return body.result
}

async function createOperator(label, role, branchId, allowedBranchIds = [branchId]) {
  const uid = `${label}-${suffix}`
  const email = `${uid}@demo.expresopunata.invalid`
  await authAdmin.createUser({ uid, email, password: 'Demo-only-2026!', displayName: label })
  await db.collection('users').doc(uid).set({
    uid, email, fullName: `Demo ${label}`, role, primaryBranchId: branchId,
    allowedBranchIds, isActive: true, createdAtIso: new Date().toISOString(),
  })
  return uid
}

async function createMember(uid, index) {
  const memberId = `integrated-member-${suffix}-${index}`
  await call(uid, 'manageUnionMember', {
    id: memberId, memberNumber: `INT-${suffix.slice(-6)}-${index}`,
    fullName: `Afiliado Integración ${index}`, ci: `ID${suffix.slice(-5)}${index}`,
    category: 'socio_general', joinedAt: todayLaPaz(), status: 'active', monthlyFeeBob: 50,
  })
  return memberId
}

function shipmentInput(originBranchId, paymentTiming, key) {
  return {
    originBranchId, destinationBranchId: originBranchId === 'punata' ? 'cochabamba' : 'punata',
    deliveryType: 'agency',
    sender: { name: 'Remitente Ficticio', phone: '71230001', docNumber: `S${suffix.slice(-6)}` },
    recipient: { name: 'Destinatario Ficticio', phone: '71230002', docNumber: `R${suffix.slice(-6)}` },
    items: [{ description: 'Caja de prueba sin valor comercial', quantity: 1, weightKg: 1, packaging: 'caja' }],
    paymentTiming, paymentMethod: 'cash', prohibitedGoodsNoticeAccepted: true, idempotencyKey: key,
  }
}

test('Simulación operativa integrada por Functions Emulator: Afiliados, Caja, préstamos, multas, rutas, patrimonio y reportes', { timeout: 180_000 }, async (t) => {
  assert.match(projectId, /^demo-/i, 'el proyecto de prueba debe ser demo y estar aislado')
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore Emulator debe estar configurado')
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Auth Emulator debe estar configurado')
  assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage Emulator debe estar configurado')
  console.log(`[integración] proyecto aislado=${projectId}; Callable Functions Emulator=http://127.0.0.1:5001/${projectId}/us-central1; Firestore=${process.env.FIRESTORE_EMULATOR_HOST}; Auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST}; Storage=${process.env.FIREBASE_STORAGE_EMULATOR_HOST}; Node=${process.version}`)

  const board = await createOperator('directorio', 'directiva_admin', 'punata', ['punata', 'cochabamba'])
  const treasurer = await createOperator('tesoreria', 'tesoreria', 'punata', ['punata', 'cochabamba'])
  const punataCashier = await createOperator('caja-punata', 'secretaria', 'punata')
  const cbbaCashier = await createOperator('caja-cochabamba', 'secretaria', 'cochabamba')
  const punataManager = await createOperator('encargado-punata', 'encargado_agencia', 'punata')
  const driver = await createOperator('conductor-demo', 'conductor', 'punata', ['punata', 'cochabamba'])
  await db.collection('driver_directory').doc(driver).set({ uid: driver, fullName: 'Demo conductor-demo', phone: '71230003', isActive: true })
  const memberIds = await Promise.all([1, 2, 3, 4].map((index) => createMember(treasurer, index)))
  const childResult = await call(treasurer, 'manageUnionMember', { action: 'addChild', memberId: memberIds[0], child: { fullName: 'Hija ficticia Integración', ci: `CH${suffix.slice(-6)}`, phone: '71230004' } })
  await call(treasurer, 'manageUnionMember', { action: 'setDriverLink', memberId: memberIds[0], driverUid: driver })
  await call(treasurer, 'manageUnionMember', { action: 'setDriverLink', memberId: memberIds[0], childId: childResult.child.id, driverUid: driver })
  const statement = await call(treasurer, 'getMemberAccountStatement', { memberId: memberIds[0] })
  assert.equal(statement.member.primaryDriverUid, driver)
  assert.equal(statement.children.find((child) => child.id === childResult.child.id).driverUid, driver)
  console.log(`[integración] A: 4 afiliados, 1 hijo y 2 vínculos de conductor; lectura verificada.`)

  const month = todayLaPaz().slice(0, 7)
  const dueRun = await call(treasurer, 'generateMonthlyDues', { period: month })
  assert.equal(dueRun.generatedCount, 4)
  const punataShift = await call(punataCashier, 'openCashShift', { branchId: 'punata', initialCashCents: 500_000, idempotencyKey: `int-pun-shift-${suffix}` })
  const punataShiftId = punataShift.shift.id
  const dueId = `${memberIds[0]}_${month}`
  const duePayment = await call(punataCashier, 'collectMemberDue', {
    dueId, amountCents: 5_000, paymentMethod: 'cash', shiftId: punataShiftId,
    branchId: 'punata', idempotencyKey: `int-due-payment-${suffix}`,
  })
  const dueReplay = await call(punataCashier, 'collectMemberDue', {
    dueId, amountCents: 5_000, paymentMethod: 'cash', shiftId: punataShiftId,
    branchId: 'punata', idempotencyKey: `int-due-payment-${suffix}`,
  })
  assert.equal(duePayment.remainingBalanceCents, 0)
  assert.deepEqual(dueReplay, duePayment)
  assert.equal((await db.collection('union_dues').doc(dueId).collection('payments').get()).size, 1)
  console.log(`[integración] A: emisión ${dueRun.generatedCount} cuotas; cobro ${duePayment.amountCents}¢; saldo afiliado=0¢.`)

  const today = todayLaPaz()
  const loan = await call(treasurer, 'createUnionLoan', {
    memberId: memberIds[0], principalCents: 120_000, installmentCount: 4,
    grantDate: today, firstDueDate: nextMonth(today), notes: 'Prueba ficticia sin desembolso de Caja',
  })
  const loanId = loan.loan.id
  assert.equal((await db.collection('financial_movements').where('loanId', '==', loanId).get()).size, 0, 'otorgar el préstamo no simula un egreso inexistente')
  const loanPaymentInput = { loanId, amountCents: 30_000, paymentMethod: 'cash', shiftId: punataShiftId, idempotencyKey: `int-loan-pay-${suffix}` }
  const loanPayment = await call(punataCashier, 'collectUnionLoanPayment', loanPaymentInput)
  const loanReplay = await call(punataCashier, 'collectUnionLoanPayment', loanPaymentInput)
  assert.equal(loanPayment.balanceCents, 90_000)
  assert.deepEqual(loanReplay, loanPayment)
  await assert.rejects(() => call(punataCashier, 'collectUnionLoanPayment', { ...loanPaymentInput, amountCents: 90_001, idempotencyKey: `int-loan-over-${suffix}` }), { code: 'invalid-argument' })
  assert.equal((await db.collection('financial_movements').where('loanId', '==', loanId).get()).size, 1)
  console.log(`[integración] B: préstamo 120000¢; pago 30000¢; saldo 90000¢; un movimiento; repetición idempotente; sobrepago rechazado.`)

  const event = await call(board, 'createUnionSportsEvent', {
    date: today, scheduledTime: '09:00', activityName: `Jornada demo ${suffix.slice(-5)}`,
    place: 'Cancha ficticia', memberIds, idempotencyKey: `int-sports-event-${suffix}`,
  })
  const eventId = event.eventId
  const attend = (memberId, attendance, key) => call(treasurer, 'setUnionSportsAttendance', { eventId, memberId, attendance, reason: 'Control de asistencia simulado', idempotencyKey: key })
  const present = await attend(memberIds[0], 'present', `int-present-${suffix}`)
  assert.equal(present.fineId, null)
  const tardyInput = { eventId, memberId: memberIds[1], attendance: 'late', reason: 'Registro de tardanza', idempotencyKey: `int-late-${suffix}` }
  const tardy = await call(treasurer, 'setUnionSportsAttendance', tardyInput)
  const tardyReplay = await call(treasurer, 'setUnionSportsAttendance', tardyInput)
  assert.equal(tardyReplay.fineId, tardy.fineId)
  assert.equal((await db.collection('union_fines').doc(tardy.fineId).get()).data().amountCents, 5_000)
  const absent = await attend(memberIds[2], 'absent', `int-absent-${suffix}`)
  assert.equal((await db.collection('union_fines').doc(absent.fineId).get()).data().amountCents, 10_000)
  await db.collection('work_absence_requests').doc(`int-work-leave-${suffix}`).set({ memberId: memberIds[3], status: 'approved', fixtureOnly: true })
  const leaveFixtureAbsence = await attend(memberIds[3], 'absent', `int-leave-does-not-exempt-${suffix}`)
  assert.ok(leaveFixtureAbsence.fineId, 'un permiso laboral no convierte automáticamente la asistencia deportiva en exenta')
  const justification = await call(treasurer, 'requestUnionSportsJustification', {
    eventId, memberId: memberIds[3], reason: 'Justificación ficticia sometida a decisión', requestDate: today,
    idempotencyKey: `int-justification-${suffix}`,
  })
  const decision = await call(board, 'decideUnionSportsJustification', {
    eventId, memberId: memberIds[3], justificationId: justification.justificationId,
    decision: 'approved', decisionNotes: 'Aprobación de directorio ficticia', idempotencyKey: `int-justification-decision-${suffix}`,
  })
  assert.equal(decision.attendance, 'exempt')
  assert.equal((await db.collection('union_fines').doc(leaveFixtureAbsence.fineId).get()).data().status, 'voided')

  const partialFinePaymentInput = { fineId: tardy.fineId, amountCents: 2_000, paymentMethod: 'cash', shiftId: punataShiftId, branchId: 'punata', idempotencyKey: `int-fine-partial-${suffix}` }
  const partialFinePayment = await call(punataCashier, 'collectUnionFinePayment', partialFinePaymentInput)
  const partialFineReplay = await call(punataCashier, 'collectUnionFinePayment', partialFinePaymentInput)
  assert.deepEqual(partialFineReplay, partialFinePayment)
  assert.equal(partialFinePayment.balanceCents, 3_000)
  const finalFinePayment = await call(punataCashier, 'collectUnionFinePayment', { ...partialFinePaymentInput, amountCents: 3_000, idempotencyKey: `int-fine-final-${suffix}` })
  assert.equal(finalFinePayment.balanceCents, 0)

  const generalFine = await call(treasurer, 'createUnionFine', {
    memberId: memberIds[0], category: 'conflictos', reason: 'Multa general de simulación',
    description: 'Registro para concurrencia y saldo pendiente', date: today, amountCents: 3_000, notes: 'Fixture ficticio',
  })
  const raceInput = (index) => ({ fineId: generalFine.fine.id, amountCents: 2_000, paymentMethod: 'cash', shiftId: punataShiftId, branchId: 'punata', idempotencyKey: `int-fine-race-${suffix}-${index}` })
  const race = await Promise.allSettled([call(punataCashier, 'collectUnionFinePayment', raceInput(1)), call(punataCashier, 'collectUnionFinePayment', raceInput(2))])
  assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(race.filter((item) => item.status === 'rejected').length, 1)
  assert.equal((await db.collection('union_fines').doc(generalFine.fine.id).get()).data().balanceCents, 1_000)
  await assert.rejects(() => call(driver, 'createUnionFine', { memberId: memberIds[0], category: 'otros', reason: 'No autorizado', date: today, amountCents: 100 }), { code: 'permission-denied' })
  console.log(`[integración] C: asistencia puntual, tardanza 5000¢, inasistencia 10000¢, justificación aprobada; multa deportiva pagada en dos partes; carrera de cobro 1/2; permiso laboral no exime.`)

  const cbbaShift = await call(cbbaCashier, 'openCashShift', { branchId: 'cochabamba', initialCashCents: 250_000, idempotencyKey: `int-cbb-shift-${suffix}` })
  const cbbaShiftId = cbbaShift.shift.id
  const beforeInvalidShipments = await db.collection('shipment_notifications').get()
  await assert.rejects(() => call(punataCashier, 'createShipment', { ...shipmentInput('punata', 'origin_paid', `int-invalid-shipment-${suffix}`), prohibitedGoodsNoticeAccepted: false, cashShiftId: punataShiftId }), { code: 'invalid-argument' })
  assert.equal((await db.collection('shipment_notifications').get()).size, beforeInvalidShipments.size, 'alta inválida no deja notificación huérfana')

  const paidOriginResult = await call(punataCashier, 'createShipment', { ...shipmentInput('punata', 'origin_paid', `int-shipment-origin-${suffix}`), cashShiftId: punataShiftId })
  const codCounterResult = await call(punataCashier, 'createShipment', shipmentInput('punata', 'destination_cod', `int-shipment-cod-counter-${suffix}`))
  const codRouteResult = await call(punataCashier, 'createShipment', shipmentInput('punata', 'destination_cod', `int-shipment-cod-route-${suffix}`))
  const tracking = [paidOriginResult, codCounterResult, codRouteResult].map((result) => result.shipment.trackingCode)
  assert.equal((await db.collection('financial_movements').where('trackingCode', '==', tracking[0]).get()).size, 1)
  assert.equal((await db.collection('financial_movements').where('trackingCode', '==', tracking[1]).get()).size, 0, 'COD no cobrado no crea un movimiento anticipado')

  const destinationNotices = await call(cbbaCashier, 'listShipmentNotifications', { branchId: 'cochabamba' })
  assert.ok(destinationNotices.notifications.some((notice) => notice.trackingCode === tracking[0]))
  assert.ok(destinationNotices.notifications.some((notice) => notice.trackingCode === tracking[1]))
  await assert.rejects(() => call(punataCashier, 'listShipmentNotifications', { branchId: 'cochabamba' }), { code: 'permission-denied' })
  const beforeDispatch = await db.collection('shipments').doc(tracking[0]).get()
  assert.equal(beforeDispatch.data().status, 'received')
  assert.equal(beforeDispatch.data().manifestId ?? null, null)

  const vehicle = await call(punataManager, 'manageVehicle', {
    action: 'create', vehicleData: { plate: `INT-${suffix.slice(-6)}`, mobileNumber: `I${suffix.slice(-4)}`,
      brand: 'Vehículo de prueba', capacityKg: 5_000, assignedDriverUid: driver, assignedDriverName: 'Demo conductor-demo' },
  })
  const manifest = await call(punataCashier, 'createDispatchManifest', {
    originBranchId: 'punata', destinationBranchId: 'cochabamba', vehicleId: vehicle.vehicleId,
    driverUid: driver, shipmentIds: [tracking[0], tracking[1]], departureNotes: 'Salida ficticia integrada',
  })
  await call(driver, 'driverConfirmCustody', { manifestId: manifest.manifestId, notes: 'Carga ficticia revisada' })
  const received = await call(cbbaCashier, 'receiveDispatchManifest', {
    manifestId: manifest.manifestId, receptionNotes: 'Recepción ficticia conforme',
    receivedShipments: [tracking[0], tracking[1]].map((shipmentId) => ({ shipmentId, receivedPackages: 1, condition: 'good' })),
  })
  assert.equal(received.success, true)
  const seededStorage = await call(cbbaCashier, 'manageShelf', { branchId: 'cochabamba', action: 'get_or_seed' })
  assert.equal(seededStorage.shelves.length, 3)
  await Promise.all([tracking[0], tracking[1]].map((shipmentId, index) => call(cbbaCashier, 'assignShipmentStorage', {
    shipmentId, shelfId: 'ESTANTE-A', shelfName: 'Estante A - General', moduleId: `MOD-${index + 1}`, moduleNumber: index + 1,
  })))
  await call(cbbaCashier, 'collectShipmentPayment', { trackingCode: tracking[1], paymentMethod: 'cash', branchId: 'cochabamba' })
  const codMovementCount = (await db.collection('financial_movements').where('trackingCode', '==', tracking[1]).get()).size
  await assert.rejects(() => call(cbbaCashier, 'collectShipmentPayment', { trackingCode: tracking[1], paymentMethod: 'cash', branchId: 'cochabamba' }), { code: 'failed-precondition' })
  assert.equal((await db.collection('financial_movements').where('trackingCode', '==', tracking[1]).get()).size, codMovementCount)
  for (const shipmentId of tracking.slice(0, 2)) {
    await call(cbbaCashier, 'deliverShipment', {
      shipmentId, receivedByName: 'Receptor ficticio', receivedByDocType: 'CI',
      receivedByDocNumber: `DOC${suffix.slice(-5)}`, recipientRelationship: 'titular', signatureDataUrl,
    })
    const shipment = (await db.collection('shipments').doc(shipmentId).get()).data()
    assert.equal(shipment.status, 'delivered')
    assert.ok(shipment.deliveryRecord?.signature?.storagePath, 'la firma de entrega queda guardada en Storage')
    const deliveryLogs = await db.collection('shipments').doc(shipmentId).collection('status_logs').where('status', '==', 'delivered').get()
    assert.equal(deliveryLogs.size, 1)
  }

  const routeManifest = await call(punataCashier, 'createDispatchManifest', {
    originBranchId: 'punata', destinationBranchId: 'cochabamba', vehicleId: vehicle.vehicleId,
    driverUid: driver, shipmentIds: [tracking[2]], departureNotes: 'Ruta ficticia con cobro en custodia',
  })
  await call(driver, 'driverConfirmCustody', { manifestId: routeManifest.manifestId, notes: 'Custodia de ruta ficticia' })
  const routeDelivery = await call(driver, 'deliverShipment', {
    shipmentId: tracking[2], receivedByName: 'Receptor en ruta', receivedByDocType: 'CI',
    receivedByDocNumber: `RTE${suffix.slice(-5)}`, recipientRelationship: 'titular', signatureDataUrl,
    paymentMethod: 'cash',
  })
  assert.equal(routeDelivery.deliveryChannel, 'route_delivery')
  assert.equal((await db.collection('driver_custody_accounts').doc(driver).get()).data().pendingRemittanceCents, 1_500)
  const remittance = await call(cbbaCashier, 'settleDriverCash', {
    driverUid: driver, amountCents: 1_500, shipmentIds: [tracking[2]],
    paymentMethod: 'cash', idempotencyKey: `int-route-remit-${suffix}`, notes: 'Rendición ficticia de destino',
  })
  assert.equal(remittance.remainingDriverBalanceCents, 0)
  assert.equal((await db.collection('driver_custody_accounts').doc(driver).get()).data().pendingRemittanceCents, 0)

  const commission = await call(treasurer, 'accrueDriverCommission', {
    driverUid: driver, shipmentId: tracking[2], trackingCode: tracking[2], manifestId: routeManifest.manifestId,
    shippingAmountCents: 1_500, ruleType: 'percentage', ruleValue: 10,
  })
  assert.equal(commission.commissionAmountCents, 150)
  const commissionVoucher = await call(punataCashier, 'settleDriverCommission', {
    driverUid: driver, amountCents: 150, branchId: 'punata', notes: 'Liquidación ficticia de comisión',
  })
  assert.equal(commissionVoucher.voucher.settledAmountCents, 150)
  for (const shipmentId of tracking) {
    assert.equal((await db.collection('shipment_notifications').doc(shipmentId).get()).exists, true, 'edición/traslado no duplica ni pierde notificaciones')
  }
  console.log(`[integración] D: 3 guías; notificación inmediata; rechazo cruzado; manifiestos/custodia/recepción/almacén/entrega; COD de ruta rendido; comisión 150¢.`)

  const warehouseBeforeInventory = await db.collection('branches').doc('punata').collection('shelves').get()
  const shiftsBeforeInventory = await db.collection('cash_shifts').get()
  const movementsBeforeInventory = await db.collection('financial_movements').get()
  const batchRequestId = `integrated-chair-batch-${suffix}`
  const assets = await call(treasurer, 'manageFixedAsset', {
    action: 'create_batch', name: 'Silla ficticia de sala', category: 'muebles',
    patrimonialLocationId: 'sede_punata', quantity: 50, acquisitionCostCents: 250_000,
    acquisitionDate: today, batchRequestId,
  })
  const retryAssets = await call(treasurer, 'manageFixedAsset', {
    action: 'create_batch', name: 'Silla ficticia de sala', category: 'muebles',
    patrimonialLocationId: 'sede_punata', quantity: 50, acquisitionCostCents: 250_000,
    acquisitionDate: today, batchRequestId,
  })
  assert.equal(assets.assets.length, 50)
  assert.deepEqual(retryAssets.assets.map((asset) => asset.id).sort(), assets.assets.map((asset) => asset.id).sort())
  assert.equal(new Set(assets.assets.map((asset) => asset.assetCode)).size, 50)
  assert.equal(new Set(assets.assets.map((asset) => asset.qrPayload)).size, 50)
  const movedAsset = assets.assets[0]
  await call(treasurer, 'manageFixedAsset', { action: 'update', id: movedAsset.id, patrimonialLocationId: 'oficina_cochabamba' })
  const movedAssetAfter = (await db.collection('fixed_assets').doc(movedAsset.id).get()).data()
  assert.equal(movedAssetAfter.id, movedAsset.id)
  assert.equal(movedAssetAfter.qrPayload, movedAsset.qrPayload)
  assert.equal(movedAssetAfter.patrimonialLocationId, 'oficina_cochabamba')
  const property = await call(treasurer, 'manageFixedAsset', {
    action: 'create_batch', name: 'Inmueble demo Sede Punata', category: 'inmuebles', propertyType: 'Sede',
    address: 'Dirección ficticia de prueba', patrimonialLocationId: 'sede_punata', quantity: 1,
    batchRequestId: `integrated-property-${suffix}`,
  })
  const document = await call(treasurer, 'managePhysicalInventoryDocument', {
    action: 'create', title: `Libro de actas ${suffix}`, documentType: 'Libro',
    patrimonialLocationId: 'sede_punata', sheetCount: 120, documentDate: today,
  })
  await call(treasurer, 'managePhysicalInventoryDocument', {
    action: 'update', id: document.id, title: `Libro de actas ${suffix}`, documentType: 'Libro',
    patrimonialLocationId: 'sede_punata', sheetCount: 121, documentDate: today,
  })
  assert.equal((await db.collection('physical_inventory_documents').doc(document.id).get()).data().sheetCount, 121)
  assert.equal((await db.collection('branches').doc('punata').collection('shelves').get()).size, warehouseBeforeInventory.size)
  assert.equal((await db.collection('financial_movements').get()).size, movementsBeforeInventory.size)
  assert.deepEqual((await db.collection('cash_shifts').get()).docs.map((doc) => [doc.id, doc.data().expectedCashCents]), shiftsBeforeInventory.docs.map((doc) => [doc.id, doc.data().expectedCashCents]))
  console.log(`[integración] E: lote ${assets.assets.length} QR; reintento sin duplicado; inmueble ${property.assets[0].id}; documento 120→121 hojas; Caja/almacén sin cambios.`)

  const reportRange = { startDate: '2026-01-01', endDate: '2027-01-01', pageSize: 500 }
  const reports = {}
  for (const reportType of ['consolidated_dashboard', 'cash_financial', 'members', 'loans', 'fines', 'sports', 'shipments', 'physical_inventory']) {
    reports[reportType] = await call(board, 'getSystemReport', {
      ...reportRange, reportType,
      ...(reportType === 'members' || reportType === 'loans' ? { memberId: memberIds[0] } : {}),
      ...(reportType === 'sports' ? { status: 'all' } : {}),
      ...(reportType === 'physical_inventory' ? { patrimonialLocationId: 'sede_punata' } : {}),
    })
  }
  const cash = reports.cash_financial.summary
  const cashMovements = await db.collection('financial_movements').get()
  const movementByType = new Map()
  for (const doc of cashMovements.docs) movementByType.set(doc.data().type, (movementByType.get(doc.data().type) || 0) + doc.data().amountCents)
  assert.equal(cash.contributionsIncomeCents, 5_000)
  assert.equal(cash.loanRepaymentsCents, 30_000)
  assert.equal(cash.driverRemittancesCents, 1_500)
  assert.equal(cash.fineIncomeCents, 7_000)
  assert.equal(cash.expensesCents, 150)
  assert.equal(cash.commercialIncomeCents, 4_500, 'incluye los tres fletes cobrados, incluido el COD cobrado bajo custodia')
  assert.equal(cash.netOperatingCents, 16_350, 'cuotas, multas y fletes menos comisión; capital y remesa quedan separados')
  assert.equal(movementByType.get('shipment_income'), 1_500)
  assert.equal(movementByType.get('cod_income'), 1_500)
  assert.equal(movementByType.get('driver_route_cod_collected'), 1_500)
  assert.equal(movementByType.get('driver_remittance'), 1_500)
  assert.equal(movementByType.get('loan_repayment'), 30_000)
  assert.equal(movementByType.get('contribution_income'), 5_000)
  assert.equal(movementByType.get('fine_income'), 7_000)
  assert.equal(movementByType.get('expense'), 150)
  assert.equal(reports.members.summary.totalMembers, 1)
  assert.equal(reports.loans.records.find((record) => record.id === loanId).balanceCents, 90_000)
  assert.equal(reports.fines.records.find((record) => record.id === tardy.fineId).balanceCents, 0)
  assert.equal(reports.fines.records.find((record) => record.id === absent.fineId).balanceCents, 10_000)
  assert.equal(reports.sports.summary.events, 1)
  assert.equal(reports.sports.summary.present, 1)
  assert.equal(reports.sports.summary.late, 1)
  assert.equal(reports.sports.summary.absent, 1)
  assert.equal(reports.sports.summary.exempt, 1)
  assert.equal(reports.sports.summary.authorizedExemptions, 1)
  assert.equal(reports.shipments.records.length, 3)
  assert.equal(reports.shipments.records.filter((record) => record.status === 'delivered').length, 3)
  assert.equal(reports.physical_inventory.summary.assetCount, 50)
  assert.equal(reports.physical_inventory.summary.documentCount, 1)
  assert.equal(reports.physical_inventory.summary.documentSheets, 121)
  assert.equal(reports.consolidated_dashboard.dashboard.loans.capitalRecoveredCents, 30_000)
  assert.equal(reports.consolidated_dashboard.dashboard.loans.operatingIncomeCents, 0)
  assert.equal(reports.consolidated_dashboard.dashboard.finances.driverRemittancesCents, 1_500)
  assert.equal(reports.consolidated_dashboard.dashboard.finances.netOperatingCents, 16_350)
  await assert.rejects(() => call(punataCashier, 'getSystemReport', { reportType: 'fines' }), { code: 'permission-denied' })
  console.log(`[integración] F: 8 reportes consultados sin reiniciar; comerciales=${cash.commercialIncomeCents}¢; cuotas=${cash.contributionsIncomeCents}¢; multas cobradas=${cash.fineIncomeCents}¢; capital=${cash.loanRepaymentsCents}¢; remesas=${cash.driverRemittancesCents}¢; neto=${cash.netOperatingCents}¢.`)

  const fileBase = join(tmpdir(), `expreso-integrated-report-${suffix}`)
  const xlsxPath = `${fileBase}.xlsx`
  const pdfPath = `${fileBase}.pdf`
  try {
    const movementRows = cashMovements.docs.map((doc) => [doc.data().type || '', doc.data().amountCents || 0, doc.data().branchId || '', doc.data().trackingCode || doc.data().loanId || doc.data().fineId || ''])
    exportToXlsx(fileBase, ['Tipo', 'Centavos', 'Agencia', 'Referencia'], movementRows,
      [['Proyecto', projectId], ['Simulación', suffix], ['Neto operativo centavos', cash.netOperatingCents]],
      [{ name: 'Saldos', headers: ['Concepto', 'Centavos'], rows: [
        ['Fletes cobrados', cash.commercialIncomeCents], ['Cuotas', cash.contributionsIncomeCents],
        ['Multas cobradas', cash.fineIncomeCents], ['Capital recuperado', cash.loanRepaymentsCents],
        ['Remesas de conductor', cash.driverRemittancesCents], ['Egresos operativos', cash.expensesCents],
        ['Neto operativo', cash.netOperatingCents],
      ] }])
    assert.equal(existsSync(xlsxPath), true)
    const workbook = XLSX.readFile(xlsxPath)
    assert.deepEqual(workbook.SheetNames, ['Registros', 'Filtros', 'Saldos'])
    const exportedBalances = XLSX.utils.sheet_to_json(workbook.Sheets.Saldos, { header: 1 })
    assert.deepEqual(exportedBalances.find((row) => row[0] === 'Neto operativo'), ['Neto operativo', 16_350])
    exportReportToPdf({
      title: 'Simulación financiera integrada', subtitle: `Proyecto demo ${projectId}`,
      dateRangeStr: `${reportRange.startDate} a ${reportRange.endDate}`, branchLabel: 'Punata y Cochabamba',
      generatedByName: 'Auditoría automática',
      kpiCards: [
        { label: 'Ingresos comerciales', value: `${cash.commercialIncomeCents}¢` },
        { label: 'Cuotas', value: `${cash.contributionsIncomeCents}¢` },
        { label: 'Multas cobradas', value: `${cash.fineIncomeCents}¢` },
        { label: 'Capital recuperado', value: `${cash.loanRepaymentsCents}¢` },
        { label: 'Remesas', value: `${cash.driverRemittancesCents}¢` },
        { label: 'Neto operativo', value: `${cash.netOperatingCents}¢` },
      ],
      tableHeaders: ['Tipo de movimiento', 'Centavos', 'Agencia'],
      tableRows: cashMovements.docs.map((doc) => [doc.data().type || '', doc.data().amountCents || 0, doc.data().branchId || 'custodia']),
      filename: fileBase,
    })
    assert.equal(existsSync(pdfPath), true)
    const pdf = readFileSync(pdfPath, 'latin1')
    assert.ok(pdf.includes('EXPRESO PUNATA'))
    assert.ok(pdf.startsWith('%PDF-'))
    assert.ok(pdf.includes('/Type /Page'))
    assert.ok(pdf.length > 2_000, 'el PDF exportado contiene una página de reporte completa')
  } finally {
    for (const file of [xlsxPath, pdfPath]) {
      try { unlinkSync(file) } catch { /* solo se retiran los archivos únicos creados por esta prueba */ }
    }
  }
  console.log(`[integración] Exportaciones PDF/Excel generadas desde movimientos finales y verificadas; operaciones=${memberIds.length + 2 + dueRun.generatedCount + 1 + 1 + 4 + 4 + 4 + 3 + 2 + 4 + 4 + 4 + 50 + 1 + 1 + 8}.`)

  const finalPunataShift = (await db.collection('cash_shifts').doc(punataShiftId).get()).data()
  const finalCbbaShift = (await db.collection('cash_shifts').doc(cbbaShiftId).get()).data()
  assert.equal(finalPunataShift.expectedCashCents, 543_350)
  assert.equal(finalCbbaShift.expectedCashCents, 253_000)
  assert.equal((await db.collection('union_loans').doc(loanId).get()).data().balanceCents, 90_000)
  assert.equal((await db.collection('union_fines').doc(tardy.fineId).get()).data().balanceCents, 0)
  assert.equal((await db.collection('union_fines').doc(absent.fineId).get()).data().balanceCents, 10_000)
  assert.equal((await db.collection('union_fines').doc(generalFine.fine.id).get()).data().balanceCents, 1_000)
  assert.equal((await db.collection('driver_custody_accounts').doc(driver).get()).data().pendingRemittanceCents, 0)
  console.log(`[integración] Saldos finales: Caja Punata=${finalPunataShift.expectedCashCents}¢, Cochabamba=${finalCbbaShift.expectedCashCents}¢, préstamo=90000¢, multas cobradas=7000¢ con 11000¢ pendientes, custodia=0¢.`)
  t.diagnostic(`fixtures ficticios: ${suffix}; proyecto: ${projectId}; movimientos verificados: ${cashMovements.size}`)
})
