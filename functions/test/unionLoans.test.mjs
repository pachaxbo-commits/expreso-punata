import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { manageUnionMember, createUnionLoan, collectUnionLoanPayment, listUnionLoans, openCashShift, getSystemReport } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-union-test' })
const db = getFirestore()

function addLoanMonth(dateString, monthOffset) {
  const [year, month, day] = dateString.split('-').map(Number)
  const targetMonth = month - 1 + monthOffset
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

async function user(uid, role, primaryBranchId = 'punata') {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId, allowedBranchIds: ['punata'], fullName: `Test ${role}`, isActive: true })
}

test('Préstamos internos: cronograma exacto, caja, idempotencia, pagos parciales/concurrentes, saldo y seguridad', async () => {
  const suffix = Date.now().toString(36)
  const managerUid = `manager-loan-${suffix}`
  const cashierUid = `cashier-loan-${suffix}`
  const deniedUid = `denied-loan-${suffix}`
  await user(managerUid, 'tesoreria')
  await user(cashierUid, 'secretaria')
  await user(deniedUid, 'conductor')
  const memberId = `member-loan-${suffix}`
  await manageUnionMember.run({ auth: { uid: managerUid }, data: { id: memberId, memberNumber: `LOAN-${suffix}`, fullName: 'Afiliado de Prueba', joinedAt: '2020-01-01', status: 'active', monthlyFeeBob: 50 } })
  const dueId = `legacy-due-${suffix}`
  const dueRef = db.collection('union_dues').doc(dueId)
  const dueData = { memberId, period: '2026-11', amountCents: 5000, paidAmountCents: 1000, balanceCents: 4000, status: 'partial' }
  await dueRef.set(dueData)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
  const firstDueDateDate = new Date(`${today}T00:00:00Z`)
  firstDueDateDate.setUTCDate(firstDueDateDate.getUTCDate() - 1)
  const firstDueDate = firstDueDateDate.toISOString().slice(0, 10)
  const reportInput = { reportType: 'cash_financial', startDate: '2026-01-01', endDate: '2027-01-01', branchId: 'punata' }
  const reportBefore = await getSystemReport.run({ auth: { uid: managerUid }, data: reportInput })

  await assert.rejects(() => createUnionLoan.run({ auth: { uid: deniedUid }, data: { memberId, principalCents: 10000, installmentCount: 2, firstDueDate: '2026-01-01' } }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => createUnionLoan.run({ auth: { uid: managerUid }, data: { memberId: 'missing-member', principalCents: 10000, installmentCount: 2, firstDueDate: '2026-01-01' } }), (error) => error.code === 'not-found')
  const created = await createUnionLoan.run({
    auth: { uid: managerUid },
    data: { memberId, principalCents: 10001, installmentCount: 3, grantDate: today, firstDueDate, notes: 'Prueba sin interés' },
  })
  assert.equal(created.success, true)
  assert.deepEqual(created.installments.map((item) => item.amountCents), [3334, 3334, 3333])
  assert.equal(created.installments.reduce((sum, item) => sum + item.amountCents, 0), 10001)
  assert.deepEqual(created.installments.map((item) => item.dueDate), [0, 1, 2].map((offset) => addLoanMonth(firstDueDate, offset)))
  const loanRef = db.collection('union_loans').doc(created.loan.id)
  assert.equal((await loanRef.get()).data().balanceCents, 10001)
  assert.equal((await db.collection('financial_movements').where('loanId', '==', created.loan.id).get()).size, 0, 'otorgar no crea ingreso')
  await assert.rejects(() => collectUnionLoanPayment.run({ auth: { uid: deniedUid }, data: {
    loanId: created.loan.id, amountCents: 100, paymentMethod: 'transfer', idempotencyKey: `loan-denied-${suffix}`,
  } }), (error) => error.code === 'permission-denied')

  const listed = await listUnionLoans.run({ auth: { uid: managerUid }, data: { memberId } })
  assert.equal(listed.loans.length, 1)
  assert.equal(listed.loans[0].status, 'overdue')
  assert.equal(listed.loans[0].overdueBalanceCents, 3334)
  assert.equal(listed.loans[0].installments[0].status, 'overdue')
  await assert.rejects(() => listUnionLoans.run({ auth: { uid: deniedUid }, data: { memberId } }), (error) => error.code === 'permission-denied')

  const shift = await openCashShift.run({ auth: { uid: cashierUid }, data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: `loan-shift-${suffix}` } })
  const shiftId = shift.shift.id
  const firstPaymentInput = { loanId: created.loan.id, amountCents: 3000, paymentMethod: 'cash', shiftId, idempotencyKey: `loan-payment-${suffix}-1` }
  const firstPayment = await collectUnionLoanPayment.run({ auth: { uid: cashierUid }, data: firstPaymentInput })
  assert.equal(firstPayment.balanceCents, 7001)
  const afterPartial = await loanRef.collection('installments').orderBy('sequence').get()
  assert.equal(afterPartial.docs[0].data().status, 'partial')
  assert.equal(afterPartial.docs[0].data().paidAmountCents, 3000)
  const firstMovementCount = (await db.collection('financial_movements').where('loanId', '==', created.loan.id).get()).size
  const duplicate = await collectUnionLoanPayment.run({ auth: { uid: cashierUid }, data: firstPaymentInput })
  assert.equal(duplicate.payment.id, firstPayment.payment.id)
  assert.equal((await db.collection('financial_movements').where('loanId', '==', created.loan.id).get()).size, firstMovementCount)
  await assert.rejects(() => collectUnionLoanPayment.run({ auth: { uid: cashierUid }, data: { ...firstPaymentInput, idempotencyKey: `loan-overpay-${suffix}`, amountCents: 7002 } }), (error) => error.code === 'invalid-argument')

  const simultaneous = await Promise.allSettled([4000, 4000].map((amountCents, index) => collectUnionLoanPayment.run({
    auth: { uid: cashierUid },
    data: { loanId: created.loan.id, amountCents, paymentMethod: 'cash', shiftId, idempotencyKey: `loan-race-${suffix}-${index}` },
  })))
  assert.equal(simultaneous.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(simultaneous.filter((item) => item.status === 'rejected').length, 1)
  const balanceAfterRace = (await loanRef.get()).data().balanceCents
  assert.equal(balanceAfterRace, 3001)
  const finalPayment = await collectUnionLoanPayment.run({ auth: { uid: managerUid }, data: {
    loanId: created.loan.id, amountCents: balanceAfterRace, paymentMethod: 'transfer', idempotencyKey: `loan-final-${suffix}`,
  } })
  assert.equal(finalPayment.balanceCents, 0)
  assert.equal(finalPayment.status, 'paid')

  const finalLoan = (await loanRef.get()).data()
  assert.equal(finalLoan.status, 'paid')
  assert.equal(finalLoan.paidCents, 10001)
  assert.equal(finalLoan.balanceCents, 0)
  const finalInstallments = await loanRef.collection('installments').orderBy('sequence').get()
  assert.equal(finalInstallments.docs.every((item) => item.data().status === 'paid' && item.data().balanceCents === 0), true)
  const payments = await loanRef.collection('payments').get()
  assert.equal(payments.size, 3)
  assert.equal(payments.docs.reduce((sum, item) => sum + item.data().amountCents, 0), 10001)
  const loanMovements = await db.collection('financial_movements').where('loanId', '==', created.loan.id).get()
  assert.equal(loanMovements.size, 3)
  assert.equal(loanMovements.docs.every((item) => item.data().type === 'loan_repayment'), true)
  const cashShift = (await db.collection('cash_shifts').doc(shiftId).get()).data()
  assert.equal(cashShift.expectedCashCents, 17000)
  assert.equal(cashShift.breakdown.totalIncomeCents, 0)
  assert.equal(cashShift.breakdown.contributionsIncomeCents || 0, 0)
  assert.equal(cashShift.breakdown.loanRepaymentsCents, 7000)
  const reportAfter = await getSystemReport.run({ auth: { uid: managerUid }, data: reportInput })
  assert.equal(reportAfter.summary.contributionsIncomeCents, reportBefore.summary.contributionsIncomeCents)
  assert.equal(reportAfter.summary.commercialIncomeCents, reportBefore.summary.commercialIncomeCents)
  assert.equal(reportAfter.summary.loanRepaymentsCents - reportBefore.summary.loanRepaymentsCents, 10001, 'la recuperación de capital se informa por separado como efectivo, no como ingreso operativo')
  assert.equal(reportAfter.summary.netOperatingCents, reportBefore.summary.netOperatingCents)
  assert.equal(reportAfter.records.filter((item) => item.type === 'loan_repayment' && item.loanId === created.loan.id).length, 3)
  assert.deepEqual((await dueRef.get()).data(), dueData)
  const finalHistory = await listUnionLoans.run({ auth: { uid: managerUid }, data: { memberId } })
  assert.equal(finalHistory.loans[0].payments.length, 3)
  assert.equal(finalHistory.loans[0].installments.length, 3)
  assert.deepEqual(finalHistory.loans[0].payments.map((item) => item.receiptNumber).sort(), [...finalHistory.loans[0].payments.map((item) => item.receiptNumber)].sort())
})
