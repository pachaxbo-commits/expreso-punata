import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { manageUnionMember, createUnionFine, listUnionFines, collectUnionFinePayment, openCashShift, getSystemReport } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-union-test' })
const db = getFirestore()

async function user(uid, role, primaryBranchId = 'punata') {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId, allowedBranchIds: ['punata'], fullName: `Test ${role}`, isActive: true })
}

test('Multas: ciclo Bs 200, Caja, parcialidades, historial, idempotencia, concurrencia, autorización y reportes', async () => {
  const suffix = Date.now().toString(36)
  const managerUid = `fine-manager-${suffix}`
  const cashierUid = `fine-cashier-${suffix}`
  const deniedUid = `fine-denied-${suffix}`
  const memberId = `fine-member-${suffix}`
  await user(managerUid, 'tesoreria')
  await user(cashierUid, 'secretaria')
  await user(deniedUid, 'conductor')
  await manageUnionMember.run({ auth: { uid: managerUid }, data: { id: memberId, memberNumber: `MUL-${suffix}`, fullName: 'Afiliada Multa', joinedAt: '2020-01-01', status: 'active', monthlyFeeBob: 50, branchId: 'punata' } })
  const memberRef = db.collection('union_members').doc(memberId)
  const childRef = memberRef.collection('children').doc(`child-${suffix}`)
  const driverRef = db.collection('driver_directory').doc(`driver-${suffix}`)
  const dueRef = db.collection('union_dues').doc(`due-${suffix}`)
  const loanRef = db.collection('union_loans').doc(`loan-${suffix}`)
  await childRef.set({ id: childRef.id, fullName: 'Hija de prueba', memberId })
  await driverRef.set({ uid: driverRef.id, fullName: 'Conductor de prueba', isActive: true })
  await dueRef.set({ id: dueRef.id, memberId, amountCents: 5000, balanceCents: 5000, status: 'pending' })
  await loanRef.set({ id: loanRef.id, memberId, principalCents: 9000, balanceCents: 9000, status: 'active' })
  const protectedBefore = {
    member: (await memberRef.get()).data(), child: (await childRef.get()).data(), driver: (await driverRef.get()).data(),
    due: (await dueRef.get()).data(), loan: (await loanRef.get()).data(),
  }
  const opened = await openCashShift.run({ auth: { uid: cashierUid }, data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: `fine-shift-${suffix}` } })
  const shiftId = opened.shift.id
  const shiftRef = db.collection('cash_shifts').doc(shiftId)
  const movementsBeforeCreation = (await db.collection('financial_movements').where('shiftId', '==', shiftId).get()).size
  const createInput = { memberId, category: 'deportes', reason: 'Incumplimiento deportivo', description: 'Prueba integral', date: new Date().toISOString().slice(0, 10), amountCents: 20000, notes: 'Observación' }
  await assert.rejects(() => createUnionFine.run({ auth: { uid: managerUid }, data: { ...createInput, amountCents: 0 } }), (error) => error.code === 'invalid-argument')
  await assert.rejects(() => createUnionFine.run({ auth: { uid: deniedUid }, data: createInput }), (error) => error.code === 'permission-denied')
  const created = await createUnionFine.run({ auth: { uid: managerUid }, data: createInput })
  const fineId = created.fine.id
  const fineRef = db.collection('union_fines').doc(fineId)
  const transportFine = await createUnionFine.run({ auth: { uid: cashierUid }, data: { ...createInput, category: 'transporte', amountCents: 1000, reason: 'Prueba de categoría autorizada' } })
  assert.equal((await fineRef.get()).data().balanceCents, 20000)
  assert.equal((await db.collection('financial_movements').where('shiftId', '==', shiftId).get()).size, movementsBeforeCreation, 'crear la multa no genera movimientos de Caja')
  assert.equal((await shiftRef.get()).data().expectedCashCents, 10000, 'crear la multa no cambia el turno')
  const transportPayment = await collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: { fineId: transportFine.fine.id, amountCents: 1000, shiftId, branchId: 'punata', idempotencyKey: `fine-transport-${suffix}` } })
  assert.equal(transportPayment.balanceCents, 0, 'Secretaría puede cobrar multas de transporte de su sucursal')
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: { fineId, amountCents: 5000, shiftId: '', idempotencyKey: `fine-no-shift-${suffix}` } }), (error) => error.code === 'failed-precondition')
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: deniedUid }, data: { fineId, amountCents: 5000, shiftId, idempotencyKey: `fine-denied-${suffix}` } }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: { fineId, amountCents: -1, shiftId, idempotencyKey: `fine-invalid-${suffix}` } }), (error) => error.code === 'invalid-argument')
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: { fineId, amountCents: 20001, shiftId, idempotencyKey: `fine-over-${suffix}` } }), (error) => error.code === 'invalid-argument')

  const paymentInput = (amountCents, key) => ({ fineId, amountCents, paymentMethod: 'cash', shiftId, branchId: 'punata', idempotencyKey: key })
  const firstInput = paymentInput(5000, `fine-pay-1-${suffix}`)
  const first = await collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: firstInput })
  const repeated = await collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: firstInput })
  assert.equal(repeated.payment.id, first.payment.id, 'repetir la misma operación devuelve el pago original')
  assert.equal(first.payment.collectedByUid, cashierUid)
  assert.equal(first.payment.shiftId, shiftId)
  assert.ok(first.payment.paidAtIso)
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: { ...firstInput, amountCents: 4000 } }), (error) => error.code === 'already-exists')
  assert.equal((await fineRef.collection('payments').get()).size, 1, 'la repetición no duplica el historial')
  assert.equal((await db.collection('financial_movements').where('fineId', '==', fineId).get()).size, 1, 'la repetición no duplica el movimiento')
  assert.equal((await fineRef.get()).data().balanceCents, 15000)

  const second = await collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: paymentInput(10000, `fine-pay-2-${suffix}`) })
  assert.equal(second.balanceCents, 5000)
  const last = await collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: paymentInput(5000, `fine-pay-3-${suffix}`) })
  assert.equal(last.balanceCents, 0)
  assert.equal(last.status, 'paid')
  await assert.rejects(() => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: paymentInput(1, `fine-paid-${suffix}`) }), (error) => error.code === 'failed-precondition')

  const concurrentFine = await createUnionFine.run({ auth: { uid: managerUid }, data: { ...createInput, amountCents: 3000, reason: 'Prueba concurrente' } })
  const concurrentInput = { fineId: concurrentFine.fine.id, amountCents: 3000, paymentMethod: 'cash', shiftId, branchId: 'punata', idempotencyKey: `fine-race-${suffix}` }
  const duplicateRace = await Promise.all([
    collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: concurrentInput }),
    collectUnionFinePayment.run({ auth: { uid: cashierUid }, data: concurrentInput }),
  ])
  assert.equal(duplicateRace[0].payment.id, duplicateRace[1].payment.id)
  assert.equal((await db.collection('financial_movements').where('fineId', '==', concurrentFine.fine.id).get()).size, 1)
  const overpayRace = await createUnionFine.run({ auth: { uid: managerUid }, data: { ...createInput, amountCents: 5000, reason: 'Prueba de saldo concurrente' } })
  const overpayInputs = [3000, 3000].map((amountCents, index) => ({ fineId: overpayRace.fine.id, amountCents, paymentMethod: 'cash', shiftId, branchId: 'punata', idempotencyKey: `fine-overrace-${suffix}-${index}` }))
  const overpayResults = await Promise.allSettled(overpayInputs.map((data) => collectUnionFinePayment.run({ auth: { uid: cashierUid }, data })))
  assert.equal(overpayResults.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal((await db.collection('financial_movements').where('fineId', '==', overpayRace.fine.id).get()).size, 1, 'la carrera no supera el saldo ni duplica movimientos')

  const shifts = (await shiftRef.get()).data()
  assert.equal(shifts.expectedCashCents, 37000)
  assert.equal(shifts.breakdown.fineIncomeCents, 27000)
  assert.equal(shifts.breakdown.totalIncomeCents, 27000)
  const fineMovements = await db.collection('financial_movements').where('shiftId', '==', shiftId).where('type', '==', 'fine_income').get()
  assert.equal(fineMovements.size, 6)
  assert.equal(fineMovements.docs.reduce((sum, doc) => sum + doc.data().amountCents, 0), 27000)
  assert.ok(fineMovements.docs.every((doc) => doc.data().category === 'union_fine_payment'))
  const listed = await listUnionFines.run({ auth: { uid: managerUid }, data: { memberId, status: 'paid' } })
  const paidFine = listed.fines.find((item) => item.id === fineId)
  assert.equal(paidFine.balanceCents, 0)
  assert.equal(paidFine.paidCents, 20000)
  assert.equal(paidFine.payments.length, 3)
  assert.equal(paidFine.payments.reduce((sum, payment) => sum + payment.amountCents, 0), 20000)

  const report = await getSystemReport.run({ auth: { uid: managerUid }, data: { reportType: 'cash_financial', startDate: '2000-01-01', endDate: '2099-12-31', branchId: 'punata' } })
  const allFineIncome = await db.collection('financial_movements').where('type', '==', 'fine_income').get()
  assert.equal(report.summary.fineIncomeCents, allFineIncome.docs.filter((doc) => doc.data().branchId === 'punata').reduce((sum, doc) => sum + doc.data().amountCents, 0), 'el reporte agrega cada movimiento de multa una sola vez')
  const allContributionIncome = await db.collection('financial_movements').where('type', '==', 'contribution_income').get()
  assert.equal(report.summary.contributionsIncomeCents, allContributionIncome.docs.filter((doc) => doc.data().branchId === 'punata').reduce((sum, doc) => sum + doc.data().amountCents, 0), 'las multas no se mezclan con cuotas')
  assert.equal((await dueRef.get()).data().balanceCents, protectedBefore.due.balanceCents)
  assert.equal((await loanRef.get()).data().balanceCents, protectedBefore.loan.balanceCents)
  assert.deepEqual((await memberRef.get()).data(), protectedBefore.member)
  assert.deepEqual((await childRef.get()).data(), protectedBefore.child)
  assert.deepEqual((await driverRef.get()).data(), protectedBefore.driver)
})
