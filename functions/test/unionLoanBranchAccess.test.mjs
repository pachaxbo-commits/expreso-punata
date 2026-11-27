import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { collectUnionLoanPayment, createUnionLoan, disburseUnionLoan, listUnionLoans, getMemberAccountStatement, openCashShift } from '../index.js'

const db = getFirestore()
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(uid, role, branchId, allowedBranchIds = [branchId]) {
  await db.collection('users').doc(uid).set({
    uid, role, isActive: true, primaryBranchId: branchId, allowedBranchIds,
    fullName: `Operador ficticio ${role}`,
  })
}

async function seedMember(memberId, branchId) {
  await db.collection('union_members').doc(memberId).set({
    id: memberId, branchId, status: 'active', memberNumber: `M-${memberId}`,
    fullName: `Afiliado ficticio ${memberId}`, monthlyFeeCents: 5000,
  })
}

async function makeLoan(uid, memberId, firstDueDate = '2026-12-26') {
  return createUnionLoan.run({
    auth: { uid },
    data: { memberId, principalCents: 10000, installmentCount: 2, grantDate: new Date().toISOString().slice(0, 10), firstDueDate },
  })
}

test('loan creation is available to Secretary and Treasury only within authorized member branches', async () => {
  const secretary = `loan-sec-${suffix}`
  const treasurer = `loan-treasurer-${suffix}`
  await Promise.all([
    seedUser(secretary, 'secretaria', 'punata'),
    seedUser(treasurer, 'tesoreria', 'punata', ['punata', 'cochabamba']),
    seedMember(`loan-member-pun-${suffix}`, 'punata'),
    seedMember(`loan-member-cbb-${suffix}`, 'cochabamba'),
  ])

  const secretaryLoan = await makeLoan(secretary, `loan-member-pun-${suffix}`)
  const treasurerLoan = await makeLoan(treasurer, `loan-member-cbb-${suffix}`)
  assert.equal(secretaryLoan.success, true)
  assert.equal(treasurerLoan.success, true)

  await assert.rejects(() => makeLoan(secretary, `loan-member-cbb-${suffix}`), (error) => error.code === 'permission-denied')
  const foreignLoans = await db.collection('union_loans').where('memberId', '==', `loan-member-cbb-${suffix}`).get()
  assert.equal(foreignLoans.size, 1, 'rechazar no crea un préstamo duplicado para el afiliado ajeno')
})

test('loan list and statement enforce the authoritative branch scope for Secretary and agency managers', async () => {
  const secretary = `loan-read-sec-${suffix}`
  const punataManager = `loan-read-manager-${suffix}`
  const directiva = `loan-read-board-${suffix}`
  await Promise.all([
    seedUser(secretary, 'secretaria', 'punata'),
    seedUser(punataManager, 'encargado_agencia', 'punata'),
    seedUser(directiva, 'directiva_admin', 'punata', ['punata', 'cochabamba']),
    seedMember(`loan-read-member-pun-${suffix}`, 'punata'),
    seedMember(`loan-read-member-cbb-${suffix}`, 'cochabamba'),
  ])
  const ownLoan = await makeLoan(directiva, `loan-read-member-pun-${suffix}`)
  const foreignLoan = await makeLoan(directiva, `loan-read-member-cbb-${suffix}`)

  for (const uid of [secretary, punataManager]) {
    const list = await listUnionLoans.run({ auth: { uid }, data: {} })
    assert.ok(list.loans.some((loan) => loan.id === ownLoan.loan.id))
    assert.ok(!list.loans.some((loan) => loan.id === foreignLoan.loan.id))
    await getMemberAccountStatement.run({ auth: { uid }, data: { memberId: `loan-read-member-pun-${suffix}` } })
    await assert.rejects(() => getMemberAccountStatement.run({ auth: { uid }, data: { memberId: `loan-read-member-cbb-${suffix}` } }), (error) => error.code === 'permission-denied')
  }
  const globalList = await listUnionLoans.run({ auth: { uid: directiva }, data: {} })
  assert.ok(globalList.loans.some((loan) => loan.id === ownLoan.loan.id))
  assert.ok(globalList.loans.some((loan) => loan.id === foreignLoan.loan.id))
})

test('Secretary can collect and disburse own-branch loans; forged branch and other-branch loans remain blocked', async () => {
  const secretary = `loan-operate-sec-${suffix}`
  const directiva = `loan-operate-board-${suffix}`
  const ownMemberId = `loan-operate-member-pun-${suffix}`
  const foreignMemberId = `loan-operate-member-cbb-${suffix}`
  await Promise.all([
    seedUser(secretary, 'secretaria', 'punata'),
    seedUser(directiva, 'directiva_admin', 'punata', ['punata', 'cochabamba']),
    seedMember(ownMemberId, 'punata'),
    seedMember(foreignMemberId, 'cochabamba'),
  ])
  const ownLoan = await makeLoan(directiva, ownMemberId)
  const foreignLoan = await makeLoan(directiva, foreignMemberId)
  const shift = await openCashShift.run({
    auth: { uid: secretary },
    data: { branchId: 'punata', initialCashCents: 20000, idempotencyKey: `loan-operate-shift-${suffix}` },
  })

  const disbursement = await disburseUnionLoan.run({
    auth: { uid: secretary },
    data: { loanId: ownLoan.loan.id, paymentMethod: 'cash', shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `loan-operate-disburse-${suffix}` },
  })
  assert.equal(disbursement.success, true)
  await assert.rejects(() => disburseUnionLoan.run({
    auth: { uid: secretary },
    data: { loanId: foreignLoan.loan.id, paymentMethod: 'transfer', branchId: 'punata', idempotencyKey: `loan-operate-foreign-${suffix}` },
  }), (error) => error.code === 'permission-denied')

  const payment = await collectUnionLoanPayment.run({
    auth: { uid: secretary },
    data: { loanId: ownLoan.loan.id, amountCents: 1000, paymentMethod: 'cash', shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `loan-operate-payment-${suffix}` },
  })
  assert.equal(payment.balanceCents, 9000)
  await assert.rejects(() => collectUnionLoanPayment.run({
    auth: { uid: secretary },
    data: { loanId: foreignLoan.loan.id, amountCents: 1000, paymentMethod: 'cash', shiftId: shift.shift.id, branchId: 'cochabamba', idempotencyKey: `loan-operate-foreign-pay-${suffix}` },
  }), (error) => error.code === 'permission-denied')

  const [foreignStored, foreignPayments, foreignMovements] = await Promise.all([
    db.collection('union_loans').doc(foreignLoan.loan.id).get(),
    db.collection('union_loans').doc(foreignLoan.loan.id).collection('payments').get(),
    db.collection('financial_movements').where('loanId', '==', foreignLoan.loan.id).get(),
  ])
  assert.equal(foreignStored.data().disbursementStatus, 'pending')
  assert.equal(foreignPayments.size, 0)
  assert.equal(foreignMovements.size, 0)
})
