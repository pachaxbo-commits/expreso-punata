import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { createUnionLoan, disburseUnionLoan, collectUnionLoanPayment, manageUnionMember, openCashShift } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
const db = getFirestore()

async function user(uid, role, branchId = 'punata') {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId: branchId, allowedBranchIds: [branchId], fullName: `Prueba ${role}`, isActive: true })
}

async function loan(prefix, managerUid, memberId, grantDate = new Date().toISOString().slice(0, 10)) {
  await manageUnionMember.run({ auth: { uid: managerUid }, data: { id: memberId, memberNumber: `L-${prefix}`, fullName: 'Afiliado de prueba', joinedAt: '2020-01-01', status: 'active' } })
  const result = await createUnionLoan.run({ auth: { uid: managerUid }, data: { memberId, principalCents: 4000, installmentCount: 2, grantDate, firstDueDate: '2027-01-01' } })
  return { result, ref: db.collection('union_loans').doc(result.loan.id) }
}

test('disburseUnionLoan: efectivo, Caja, idempotencia y concurrencia', async () => {
  const suffix = Date.now().toString(36)
  const manager = `loan-manager-${suffix}`; const cashier = `loan-cashier-${suffix}`
  await user(manager, 'tesoreria'); await user(cashier, 'secretaria')
  const { result, ref } = await loan(suffix, manager, `member-${suffix}`)
  const shift = await openCashShift.run({ auth: { uid: cashier }, data: { branchId: 'punata', initialCashCents: 5000, idempotencyKey: `shift-${suffix}` } })
  const input = { loanId: result.loan.id, paymentMethod: 'cash', shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `disburse-${suffix}` }
  const first = await disburseUnionLoan.run({ auth: { uid: cashier }, data: input })
  const retry = await disburseUnionLoan.run({ auth: { uid: cashier }, data: input })
  assert.equal(retry.receiptNumber, first.receiptNumber)
  const concurrent = await Promise.allSettled([1, 2].map((n) => disburseUnionLoan.run({ auth: { uid: cashier }, data: { ...input, idempotencyKey: `race-${suffix}-${n}` } })))
  assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 0)
  const stored = (await ref.get()).data(); assert.equal(stored.disbursementStatus, 'disbursed'); assert.equal(stored.disbursedCents, 4000)
  const movements = await db.collection('financial_movements').where('loanId', '==', result.loan.id).get(); assert.equal(movements.size, 1); assert.equal(movements.docs[0].data().amountCents, -4000)
  assert.equal((await db.collection('cash_shifts').doc(shift.shift.id).get()).data().expectedCashCents, 1000)
  assert.equal((await db.collection('audit_logs').where('targetId', '==', result.loan.id).where('action', '==', 'union_loan_disbursed').get()).size, 1)
})

test('disburseUnionLoan: QR y transferencia no reducen efectivo; roles y legacy_unknown se bloquean', async () => {
  const suffix = `${Date.now().toString(36)}-noncash`; const manager = `manager-${suffix}`; const cashier = `secretary-${suffix}`; const denied = `denied-${suffix}`
  await user(manager, 'tesoreria'); await user(cashier, 'secretaria'); await user(denied, 'conductor')
  const qr = await loan(`${suffix}-qr`, manager, `member-${suffix}-qr`); const transfer = await loan(`${suffix}-tr`, manager, `member-${suffix}-tr`); const deniedLoan = await loan(`${suffix}-deny`, manager, `member-${suffix}-deny`)
  const qrResult = await disburseUnionLoan.run({ auth: { uid: cashier }, data: { loanId: qr.result.loan.id, paymentMethod: 'qr', branchId: 'punata', idempotencyKey: `qr-${suffix}` } })
  const transferResult = await disburseUnionLoan.run({ auth: { uid: manager }, data: { loanId: transfer.result.loan.id, paymentMethod: 'transfer', branchId: 'punata', idempotencyKey: `tr-${suffix}` } })
  assert.equal(qrResult.success, true); assert.equal(transferResult.success, true)
  await assert.rejects(() => disburseUnionLoan.run({ auth: { uid: denied }, data: { loanId: deniedLoan.result.loan.id, paymentMethod: 'transfer', branchId: 'punata', idempotencyKey: `deny-${suffix}` } }), (error) => error.code === 'permission-denied')
  const old = await loan(`${suffix}-old`, manager, `member-${suffix}-old`, '2025-01-01')
  assert.equal((await old.ref.get()).data().disbursementStatus, 'legacy_unknown')
  await assert.rejects(() => disburseUnionLoan.run({ auth: { uid: manager }, data: { loanId: old.result.loan.id, paymentMethod: 'transfer', branchId: 'punata', idempotencyKey: `old-${suffix}` } }), (error) => error.code === 'failed-precondition')
})

test('disburseUnionLoan: cobro de cuota posterior conserva la operación', async () => {
  const suffix = `${Date.now().toString(36)}-collect`; const manager = `manager-${suffix}`; const cashier = `cashier-${suffix}`
  await user(manager, 'tesoreria'); await user(cashier, 'secretaria')
  const created = await loan(suffix, manager, `member-${suffix}`)
  const disbursed = await disburseUnionLoan.run({ auth: { uid: manager }, data: { loanId: created.result.loan.id, paymentMethod: 'transfer', branchId: 'punata', idempotencyKey: `disburse-${suffix}` } })
  assert.equal(disbursed.success, true)
  const shift = await openCashShift.run({ auth: { uid: cashier }, data: { branchId: 'punata', initialCashCents: 1000, idempotencyKey: `shift-${suffix}` } })
  const payment = await collectUnionLoanPayment.run({ auth: { uid: cashier }, data: { loanId: created.result.loan.id, amountCents: 1000, paymentMethod: 'transfer', shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `payment-${suffix}` } })
  assert.equal(payment.balanceCents, 3000)
  assert.equal((await created.ref.get()).data().disbursementStatus, 'disbursed')
})
