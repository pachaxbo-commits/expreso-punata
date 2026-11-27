import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  createPassengerTicket,
  cancelPassengerTicketOperation,
  verifyPassengerTicketPayment,
  validatePassengerTicket,
  deliverPassengerTicketToDriver,
  openCashShift,
  getSystemReport,
  getDailyOperationsReport,
} from '../index.js'

if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const officeUid = `tickets-office-${suffix}`
const driverUid = `tickets-driver-${suffix}`
const otherDriverUid = `tickets-other-driver-${suffix}`
const deniedUid = `tickets-denied-${suffix}`

const makeUser = (uid, role) => db.collection('users').doc(uid).set({
  uid, role, fullName: `Prueba ${role}`, primaryBranchId: 'punata', allowedBranchIds: role === 'afiliado_admin' ? ['punata', 'cochabamba'] : ['punata'], isActive: true,
})

test('Pasajes: crea/verifica QR, uso de cantidad, entrega de efectivo, permisos, reportes e idempotencia', async () => {
  process.env.FUNCTIONS_EMULATOR = 'true'
  await Promise.all([
    makeUser(officeUid, 'afiliado_admin'),
    makeUser(driverUid, 'conductor'),
    makeUser(otherDriverUid, 'conductor'),
    makeUser(deniedUid, 'tesoreria'),
  ])

  const auth = { uid: officeUid }
  const createPayload = {
    idempotencyKey: `ticket-create-${suffix}`,
    branchId: 'punata', originBranchId: 'punata', destinationBranchId: 'cochabamba',
    travelDate: '2026-12-15', driverUid, quantity: 2, unitAmountCents: 1250,
    passengerName: 'Pasajero ficticio',
  }
  await assert.rejects(
    () => createPassengerTicket.run({ auth, data: { ...createPayload, idempotencyKey: `ticket-invalid-${suffix}`, unitAmountCents: 0 } }),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    () => createPassengerTicket.run({ auth: { uid: deniedUid }, data: { ...createPayload, idempotencyKey: `ticket-denied-${suffix}` } }),
    (error) => error.code === 'permission-denied',
  )

  const dayBefore = await getDailyOperationsReport.run({ auth, data: { branchId: 'punata' } })
  const created = await createPassengerTicket.run({ auth, data: createPayload })
  const replay = await createPassengerTicket.run({ auth, data: createPayload })
  assert.equal(created.operation.totalAmountCents, 2500)
  assert.equal(created.operation.paymentStatus, 'pending_verification')
  assert.equal(replay.cached, true)
  assert.equal(replay.operation.ticketCode, created.operation.ticketCode)
  const code = created.operation.ticketCode
  const operationRef = db.collection('passenger_ticket_operations').doc(code)
  assert.equal((await operationRef.get()).data().quantity, 2)
  assert.equal((await db.collection('financial_movements').where('ticketOperationId', '==', code).get()).size, 0)

  const cancelled = await createPassengerTicket.run({ auth, data: {
    ...createPayload, passengerName: 'Pasajero a anular', idempotencyKey: `ticket-cancel-create-${suffix}`,
  } })
  await cancelPassengerTicketOperation.run({ auth, data: {
    operationId: cancelled.operation.id, reason: 'Solicitud ficticia', idempotencyKey: `ticket-cancel-${suffix}`,
  } })
  await assert.rejects(
    () => validatePassengerTicket.run({ auth: { uid: driverUid }, data: {
      ticketCode: cancelled.operation.ticketCode, idempotencyKey: `ticket-cancel-use-${suffix}`,
    } }),
    (error) => error.code === 'failed-precondition',
  )
  assert.equal((await db.collection('financial_movements').where('ticketOperationId', '==', cancelled.operation.id).get()).size, 0)

  const shift = await openCashShift.run({ auth, data: { branchId: 'punata', initialCashCents: 50000 } })
  const cashBeforeQr = (await db.collection('cash_shifts').doc(shift.shift.id).get()).data().expectedCashCents
  await assert.rejects(
    () => verifyPassengerTicketPayment.run({ auth, data: {
      operationId: code, confirmedAmountCents: 2499, idempotencyKey: `ticket-verify-bad-${suffix}`,
    } }),
    (error) => error.code === 'failed-precondition',
  )
  await verifyPassengerTicketPayment.run({ auth, data: {
    operationId: code, confirmedAmountCents: 2500, paymentReference: 'REF-FICTICIA', idempotencyKey: `ticket-verify-${suffix}`,
  } })
  const afterQr = (await db.collection('cash_shifts').doc(shift.shift.id).get()).data()
  assert.equal(afterQr.expectedCashCents, cashBeforeQr, 'QR no debe alterar el efectivo físico')
  assert.equal(afterQr.breakdown.passengerTicketIncomeCents, 2500)
  assert.equal((await db.collection('financial_movements').where('ticketOperationId', '==', code).get()).size, 1)

  await assert.rejects(
    () => validatePassengerTicket.run({ auth: { uid: otherDriverUid }, data: { ticketCode: code, idempotencyKey: `ticket-wrong-driver-${suffix}` } }),
    (error) => error.code === 'permission-denied',
  )
  const firstUse = await validatePassengerTicket.run({ auth, data: { ticketCode: code, idempotencyKey: `ticket-use-1-${suffix}` } })
  const duplicateUse = await validatePassengerTicket.run({ auth, data: { ticketCode: code, idempotencyKey: `ticket-use-1-${suffix}` } })
  const secondUse = await validatePassengerTicket.run({ auth: { uid: driverUid }, data: { ticketCode: code, idempotencyKey: `ticket-use-2-${suffix}` } })
  assert.equal(firstUse.remainingCount, 1)
  assert.equal(duplicateUse.duplicate, true)
  assert.equal(secondUse.remainingCount, 0)
  await assert.rejects(
    () => validatePassengerTicket.run({ auth: { uid: driverUid }, data: { ticketCode: code, idempotencyKey: `ticket-use-3-${suffix}` } }),
    (error) => error.code === 'failed-precondition',
  )
  assert.equal((await db.collection('passenger_ticket_validations').where('operationId', '==', code).get()).size, 2)

  const today = await getDailyOperationsReport.run({ auth, data: { branchId: 'punata' } })
  assert.equal(today.tickets - dayBefore.tickets, 2)
  assert.equal(today.income.tickets - dayBefore.income.tickets, 2500)
  assert.equal(today.collections - dayBefore.collections, 1)
  const firstValidation = (await db.collection('passenger_ticket_validations').doc(firstUse.validationId).get()).data()
  assert.equal(firstValidation.validatedByUid, officeUid)
  assert.equal(firstValidation.validatedByRole, 'afiliado_admin')
  assert.equal(firstValidation.driverUid, driverUid)

  const beforeDelivery = (await db.collection('cash_shifts').doc(shift.shift.id).get()).data().expectedCashCents
  await assert.rejects(
    () => deliverPassengerTicketToDriver.run({ auth: { uid: driverUid }, data: {
      operationId: code, idempotencyKey: `ticket-driver-deliver-${suffix}`,
    } }),
    (error) => error.code === 'permission-denied',
  )
  const delivery = await deliverPassengerTicketToDriver.run({ auth, data: {
    operationId: code, idempotencyKey: `ticket-deliver-${suffix}`,
  } })
  const deliveryReplay = await deliverPassengerTicketToDriver.run({ auth, data: {
    operationId: code, idempotencyKey: `ticket-deliver-${suffix}`,
  } })
  const afterDelivery = (await db.collection('cash_shifts').doc(shift.shift.id).get()).data()
  assert.equal(delivery.newExpectedCashCents, beforeDelivery - 2500)
  assert.equal(afterDelivery.expectedCashCents, beforeDelivery - 2500)
  assert.equal(deliveryReplay.cached, true)
  const finalOperation = (await operationRef.get()).data()
  assert.equal(finalOperation.settlementStatus, 'delivered')
  assert.equal(finalOperation.pendingSettlementCents, 0)
  const movementSnapshot = await db.collection('financial_movements').where('ticketOperationId', '==', code).get()
  assert.equal(movementSnapshot.size, 2)
  assert.deepEqual(new Set(movementSnapshot.docs.map((doc) => doc.data().type)), new Set(['passenger_ticket_income', 'passenger_ticket_payout']))
  assert.equal((await db.collection('audit_logs').where('entityId', '==', code).get()).size >= 4, true)

  const adminUid = 'ticket-admin-' + suffix
  await makeUser(adminUid, 'afiliado_admin')
  const report = await getSystemReport.run({ auth: { uid: adminUid }, data: {
    reportType: 'cash_financial', branchId: 'punata', startDate: '2026-01-01', endDate: '2027-01-01',
    operatorUid: officeUid,
  } })
  assert.equal(report.summary.passengerTicketIncomeCents, 2500)
  assert.equal(report.summary.passengerTicketPayoutCents, 2500)
  assert.equal(report.summary.commercialIncomeCents, 0, 'pasajes no son ingreso operativo de encomiendas')
  assert.equal(report.summary.expensesCents, 0, 'entrega al chofer no es gasto operativo')
  const directoryUid = 'tickets-directory-' + suffix
  await db.collection('driver_directory').doc(directoryUid).set({ isActive: true, fullName: 'Conductor sin cuenta' })
  const accountless = await createPassengerTicket.run({ auth, data: {
    ...createPayload, driverUid: directoryUid, idempotencyKey: 'ticket-directory-create-' + suffix,
  } })
  assert.equal(accountless.operation.driverUid, directoryUid)
  assert.equal(accountless.operation.driverName, 'Conductor sin cuenta')
})
