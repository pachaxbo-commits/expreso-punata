import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  manageUnionMember, createUnionSportsEvent, listUnionSportsEvents,
  setUnionSportsAttendance, requestUnionSportsJustification,
  decideUnionSportsJustification, completeUnionSportsEvent,
  listUnionFines, openCashShift, collectUnionFinePayment,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-union-test' })
const db = getFirestore()

async function user(uid, role, primaryBranchId = 'punata') {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId, allowedBranchIds: ['punata'], fullName: `Test ${role}`, isActive: true })
}

test('Deportes: convocatoria, asistencia, multas idempotentes, justificaciones, exención y Caja', async () => {
  const suffix = Date.now().toString(36)
  const directorUid = `sports-director-${suffix}`
  const treasurerUid = `sports-treasury-${suffix}`
  const cashierUid = `sports-cashier-${suffix}`
  const deniedUid = `sports-driver-${suffix}`
  await user(directorUid, 'directiva_admin')
  await user(treasurerUid, 'tesoreria')
  await user(cashierUid, 'secretaria')
  await user(deniedUid, 'conductor')

  const memberIds = Array.from({ length: 5 }, (_, index) => `sports-member-${suffix}-${index + 1}`)
  for (const [index, memberId] of memberIds.entries()) {
    await manageUnionMember.run({ auth: { uid: directorUid }, data: { id: memberId, memberNumber: `DEP-${suffix}-${index + 1}`, fullName: `Afiliado Deportes ${index + 1}`, joinedAt: '2020-01-01', status: 'active', monthlyFeeBob: 50 } })
  }
  const outsiderId = `sports-outsider-${suffix}`
  await manageUnionMember.run({ auth: { uid: directorUid }, data: { id: outsiderId, memberNumber: `OUT-${suffix}`, fullName: 'Afiliado No Convocado', joinedAt: '2020-01-01', status: 'active', monthlyFeeBob: 50 } })
  const protectedDueRef = db.collection('union_dues').doc(`sports-protected-due-${suffix}`)
  const protectedLoanRef = db.collection('union_loans').doc(`sports-protected-loan-${suffix}`)
  await protectedDueRef.set({ id: protectedDueRef.id, memberId: memberIds[0], amountCents: 7000, balanceCents: 3000, status: 'partial' })
  await protectedLoanRef.set({ id: protectedLoanRef.id, memberId: memberIds[0], principalCents: 9000, balanceCents: 6000, status: 'active' })
  const protectedDue = (await protectedDueRef.get()).data()
  const protectedLoan = (await protectedLoanRef.get()).data()
  const eventInput = {
    date: '2026-11-14', scheduledTime: '09:30', activityName: 'Jornada de fútbol',
    place: 'Cancha municipal', notes: 'Jornada de prueba', memberIds, idempotencyKey: `sports-event-${suffix}`,
  }
  const created = await createUnionSportsEvent.run({ auth: { uid: directorUid }, data: eventInput })
  const duplicateCreate = await createUnionSportsEvent.run({ auth: { uid: directorUid }, data: eventInput })
  assert.equal(duplicateCreate.eventId, created.eventId)
  assert.equal((await db.collection('union_sports_events').get()).docs.filter((doc) => doc.id === created.eventId).length, 1)
  const eventRef = db.collection('union_sports_events').doc(created.eventId)
  assert.equal((await eventRef.get()).data().status, 'scheduled')
  assert.equal((await eventRef.collection('participants').get()).size, memberIds.length)

  const noAbsentForOutsider = await setUnionSportsAttendance.run({
    auth: { uid: treasurerUid },
    data: { eventId: created.eventId, memberId: outsiderId, attendance: 'absent', idempotencyKey: `sports-outsider-${suffix}` },
  }).then(() => false, (error) => error.code === 'failed-precondition')
  assert.equal(noAbsentForOutsider, true)
  await assert.rejects(() => setUnionSportsAttendance.run({ auth: { uid: treasurerUid }, data: { eventId: created.eventId, memberId: memberIds[0], attendance: 'exempt', idempotencyKey: `sports-no-exempt-${suffix}` } }), (error) => error.code === 'invalid-argument')
  await assert.rejects(() => createUnionSportsEvent.run({ auth: { uid: deniedUid }, data: eventInput }), (error) => error.code === 'permission-denied')

  const attendance = async (index, value, key) => setUnionSportsAttendance.run({
    auth: { uid: treasurerUid },
    data: { eventId: created.eventId, memberId: memberIds[index], attendance: value, reason: 'Control de cancha', idempotencyKey: key },
  })
  const present = await attendance(0, 'present', `sports-present-${suffix}`)
  assert.equal(present.fineId, null, 'la asistencia puntual no genera multa')
  const lateInput = { eventId: created.eventId, memberId: memberIds[1], attendance: 'late', reason: 'Control de cancha', idempotencyKey: `sports-late-${suffix}` }
  const late = await setUnionSportsAttendance.run({ auth: { uid: treasurerUid }, data: lateInput })
  const repeatedLate = await setUnionSportsAttendance.run({ auth: { uid: treasurerUid }, data: lateInput })
  assert.equal(repeatedLate.fineId, late.fineId)
  const fineRef = db.collection('union_fines').doc(late.fineId)
  assert.equal((await fineRef.get()).data().amountCents, 5000)
  assert.equal((await fineRef.get()).data().category, 'deportes')
  assert.equal((await fineRef.get()).data().source, 'sports_attendance')
  assert.equal((await db.collection('financial_movements').where('fineId', '==', late.fineId).get()).size, 0, 'la infracción no registra efectivo')
  await attendance(1, 'absent', `sports-late-to-absent-${suffix}`)
  assert.equal((await fineRef.get()).data().amountCents, 10000, 'la corrección actualiza la multa existente, no crea otra')
  assert.equal((await db.collection('union_fines').where('eventId', '==', created.eventId).where('memberId', '==', memberIds[1]).get()).size, 1)
  assert.equal((await eventRef.collection('participants').doc(memberIds[1]).get()).data().attendanceHistory.length, 2)

  const absent = await attendance(2, 'absent', `sports-absent-${suffix}`)
  const absentFineRef = db.collection('union_fines').doc(absent.fineId)
  assert.equal((await absentFineRef.get()).data().amountCents, 10000)
  assert.equal((await db.collection('financial_movements').where('fineId', '==', absentFineRef.id).get()).size, 0, 'la inasistencia crea deuda, no ingreso')
  await db.collection('work_absence_requests').doc(`work-leave-${suffix}`).set({ memberId: memberIds[2], status: 'approved' })
  assert.equal((await eventRef.collection('participants').doc(memberIds[2]).get()).data().attendance, 'absent', 'el permiso laboral no concede exención deportiva')

  const deniedJustification = await requestUnionSportsJustification.run({ auth: { uid: treasurerUid }, data: {
    eventId: created.eventId, memberId: memberIds[2], reason: 'Imprevisto familiar justificado', requestDate: '2026-11-10', idempotencyKey: `sports-just-denied-${suffix}`,
  } })
  await assert.rejects(() => decideUnionSportsJustification.run({ auth: { uid: treasurerUid }, data: {
    eventId: created.eventId, memberId: memberIds[2], justificationId: deniedJustification.justificationId, decision: 'approved', idempotencyKey: `sports-wrong-decider-${suffix}`,
  } }), (error) => error.code === 'permission-denied')
  await decideUnionSportsJustification.run({ auth: { uid: directorUid }, data: {
    eventId: created.eventId, memberId: memberIds[2], justificationId: deniedJustification.justificationId, decision: 'rejected', decisionNotes: 'Motivo no admitido', idempotencyKey: `sports-reject-${suffix}`,
  } })
  assert.equal((await eventRef.collection('participants').doc(memberIds[2]).get()).data().attendance, 'absent')
  assert.equal((await absentFineRef.get()).data().status, 'pending')

  const exemptAbsence = await attendance(3, 'absent', `sports-exempt-absent-${suffix}`)
  const exemptFineRef = db.collection('union_fines').doc(exemptAbsence.fineId)
  const approvedJustification = await requestUnionSportsJustification.run({ auth: { uid: treasurerUid }, data: {
    eventId: created.eventId, memberId: memberIds[3], reason: 'Cuidado médico de familiar', requestDate: '2026-11-10', idempotencyKey: `sports-just-approved-${suffix}`,
  } })
  assert.equal((await eventRef.collection('participants').doc(memberIds[3]).get()).data().attendance, 'absent', 'la solicitud pendiente no es una exención automática')
  const approved = await decideUnionSportsJustification.run({ auth: { uid: directorUid }, data: {
    eventId: created.eventId, memberId: memberIds[3], justificationId: approvedJustification.justificationId, decision: 'approved', decisionNotes: 'Autorizada por Directorio', idempotencyKey: `sports-approve-${suffix}`,
  } })
  assert.equal(approved.attendance, 'exempt')
  assert.equal((await exemptFineRef.get()).data().status, 'voided')
  assert.equal((await exemptFineRef.get()).data().balanceCents, 0)
  assert.equal((await db.collection('financial_movements').where('fineId', '==', exemptFineRef.id).get()).size, 0)
  await assert.rejects(() => setUnionSportsAttendance.run({ auth: { uid: treasurerUid }, data: {
    eventId: created.eventId, memberId: memberIds[3], attendance: 'absent', idempotencyKey: `sports-remove-exemption-${suffix}`,
  } }), (error) => error.code === 'permission-denied')

  const paidCase = await attendance(4, 'late', `sports-paid-late-${suffix}`)
  const paidFineRef = db.collection('union_fines').doc(paidCase.fineId)
  const shift = await openCashShift.run({ auth: { uid: cashierUid }, data: { branchId: 'punata', initialCashCents: 0, idempotencyKey: `sports-cash-${suffix}` } })
  const payment = await collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: {
    fineId: paidFineRef.id, amountCents: 2000, paymentMethod: 'cash', shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `sports-payment-${suffix}`,
  } })
  assert.equal(payment.balanceCents, 3000)
  const movementId = (await db.collection('financial_movements').where('fineId', '==', paidFineRef.id).get()).docs[0].id
  const movement = (await db.collection('financial_movements').doc(movementId).get()).data()
  assert.equal(movement.type, 'fine_income')
  assert.equal(movement.category, 'union_fine_payment')
  assert.equal(movement.amountCents, 2000)
  assert.equal((await db.collection('cash_shifts').doc(shift.shift.id).get()).data().breakdown.fineIncomeCents, 2000)
  const financialReview = await attendance(4, 'present', `sports-paid-correction-${suffix}`)
  assert.equal(financialReview.financialReviewRequired, true)
  const paidFine = (await paidFineRef.get()).data()
  assert.equal(paidFine.status, 'partial')
  assert.equal(paidFine.paidCents, 2000)
  assert.equal(paidFine.balanceCents, 3000)
  assert.equal(paidFine.financialReviewRequired, true)
  assert.equal((await db.collection('financial_movements').doc(movementId).get()).exists, true, 'la corrección no elimina el movimiento de caja')
  assert.equal((await paidFineRef.collection('payments').get()).size, 1, 'la corrección no elimina pagos')
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: {
    fineId: paidFineRef.id, amountCents: 1000, paymentMethod: 'cash', shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `sports-review-block-${suffix}`,
  } }), (error) => error.code === 'failed-precondition')

  const fineList = await listUnionFines.run({ auth: { uid: treasurerUid }, data: { memberId: memberIds[1], category: 'deportes' } })
  assert.equal(fineList.fines.some((fine) => fine.id === fineRef.id && fine.eventId === created.eventId), true, 'la multa deportiva aparece en el sistema de multas')
  const eventList = await listUnionSportsEvents.run({ auth: { uid: treasurerUid }, data: { memberId: memberIds[2], startDate: '2026-11-14', endDate: '2026-11-14' } })
  assert.equal(eventList.events.length, 1)
  assert.equal(eventList.events[0].participants.find((participant) => participant.memberId === memberIds[2]).justifications.length, 1)
  assert.equal((await eventRef.collection('participants').doc(outsiderId).get()).exists, false)
  assert.deepEqual((await protectedDueRef.get()).data(), protectedDue, 'las cuotas no se modifican')
  assert.deepEqual((await protectedLoanRef.get()).data(), protectedLoan, 'los préstamos no se modifican')
  await completeUnionSportsEvent.run({ auth: { uid: treasurerUid }, data: { eventId: created.eventId, idempotencyKey: `sports-complete-${suffix}` } })
  assert.equal((await eventRef.get()).data().status, 'completed')
})
