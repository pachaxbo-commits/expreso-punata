import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { collectMemberDue, openCashShift } from '../index.js'

const db = getFirestore()

async function createSecretaryFixture(suffix) {
  const uid = `secretary-due-${suffix}`
  const dueId = `secretary-due-item-${suffix}`
  await Promise.all([
    db.collection('users').doc(uid).set({
      uid,
      role: 'secretaria',
      isActive: true,
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      fullName: 'Secretaría Ficticia Punata',
    }),
    db.collection('union_dues').doc(dueId).set({
      id: dueId,
      memberId: `member-${suffix}`,
      memberNumber: `TEST-${suffix}`,
      memberName: 'Afiliado Ficticio',
      branchId: 'punata',
      period: '2026-11',
      periodLabel: 'Noviembre 2026',
      amountCents: 5000,
      paidAmountCents: 0,
      balanceCents: 5000,
      paymentsCount: 0,
      status: 'pending',
    }),
  ])
  const shift = await openCashShift.run({
    auth: { uid },
    data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: `secretary-shift-${suffix}` },
  })
  return { uid, dueId, shiftId: shift.shift.id }
}

test('collectMemberDue permits Secretary in own branch and binds payment to own active shift', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uid, dueId, shiftId } = await createSecretaryFixture(suffix)
  const payload = {
    dueId,
    amountCents: 1200,
    paymentMethod: 'cash',
    shiftId,
    branchId: 'punata',
    idempotencyKey: `secretary-due-payment-${suffix}`,
  }

  const result = await collectMemberDue.run({ auth: { uid }, data: payload })
  assert.equal(result.success, true)
  assert.equal(result.amountCents, 1200)
  assert.equal(result.remainingBalanceCents, 3800)

  const [due, payments, movement, shift] = await Promise.all([
    db.collection('union_dues').doc(dueId).get(),
    db.collection('union_dues').doc(dueId).collection('payments').get(),
    db.collection('financial_movements').where('dueId', '==', dueId).get(),
    db.collection('cash_shifts').doc(shiftId).get(),
  ])
  assert.equal(due.data().balanceCents, 3800)
  assert.equal(payments.size, 1)
  assert.equal(movement.size, 1)
  assert.equal(movement.docs[0].data().branchId, 'punata')
  assert.equal(movement.docs[0].data().operatorUid, uid)
  assert.equal(shift.data().expectedCashCents, 11200)
})

test('collectMemberDue rejects Secretary branch overrides and another branch dues without writes', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uid, dueId, shiftId } = await createSecretaryFixture(suffix)
  const otherDueId = `secretary-due-cochabamba-${suffix}`
  await db.collection('union_dues').doc(otherDueId).set({
    id: otherDueId,
    memberId: `member-cbb-${suffix}`,
    memberNumber: `CBB-${suffix}`,
    memberName: 'Afiliado Ficticio Cochabamba',
    branchId: 'cochabamba',
    period: '2026-11',
    periodLabel: 'Noviembre 2026',
    amountCents: 5000,
    paidAmountCents: 0,
    balanceCents: 5000,
    paymentsCount: 0,
    status: 'pending',
  })

  await assert.rejects(() => collectMemberDue.run({
    auth: { uid },
    data: {
      dueId,
      amountCents: 1000,
      paymentMethod: 'cash',
      shiftId,
      branchId: 'cochabamba',
      idempotencyKey: `secretary-forged-branch-${suffix}`,
    },
  }), (error) => error.code === 'permission-denied')

  await assert.rejects(() => collectMemberDue.run({
    auth: { uid },
    data: {
      dueId: otherDueId,
      amountCents: 1000,
      paymentMethod: 'cash',
      shiftId,
      branchId: 'punata',
      idempotencyKey: `secretary-other-branch-${suffix}`,
    },
  }), (error) => error.code === 'permission-denied')

  const [ownDue, otherDue, ownPayments, ownMovements, foreignPayments, foreignMovements] = await Promise.all([
    db.collection('union_dues').doc(dueId).get(),
    db.collection('union_dues').doc(otherDueId).get(),
    db.collection('union_dues').doc(dueId).collection('payments').get(),
    db.collection('financial_movements').where('dueId', '==', dueId).get(),
    db.collection('union_dues').doc(otherDueId).collection('payments').get(),
    db.collection('financial_movements').where('dueId', '==', otherDueId).get(),
  ])
  assert.equal(ownDue.data().balanceCents, 5000)
  assert.equal(otherDue.data().balanceCents, 5000)
  assert.equal(ownPayments.size, 0)
  assert.equal(ownMovements.size, 0)
  assert.equal(foreignPayments.size, 0)
  assert.equal(foreignMovements.size, 0)
})

test('collectMemberDue requires Secretary QR and transfer payments to use the authorized active shift', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { uid, dueId, shiftId } = await createSecretaryFixture(suffix)
  for (const paymentMethod of ['qr', 'transfer']) {
    const input = {
      dueId,
      amountCents: 1000,
      paymentMethod,
      branchId: 'punata',
      idempotencyKey: `secretary-${paymentMethod}-without-shift-${suffix}`,
    }
    await assert.rejects(() => collectMemberDue.run({ auth: { uid }, data: input }), (error) => error.code === 'failed-precondition')

    const result = await collectMemberDue.run({
      auth: { uid },
      data: { ...input, shiftId, idempotencyKey: `secretary-${paymentMethod}-with-shift-${suffix}` },
    })
    assert.equal(result.success, true)
    assert.equal(result.paymentMethod, paymentMethod)
  }

  const [shift, movements] = await Promise.all([
    db.collection('cash_shifts').doc(shiftId).get(),
    db.collection('financial_movements').where('dueId', '==', dueId).get(),
  ])
  assert.equal(shift.data().expectedCashCents, 10000, 'QR no altera el efectivo físico esperado')
  assert.equal(shift.data().breakdown.qrIncomeCents, 1000)
  assert.equal(shift.data().breakdown.transferIncomeCents, 1000)
  assert.equal(movements.size, 2)
  assert.deepEqual(new Set(movements.docs.map((doc) => doc.data().paymentMethod)), new Set(['qr', 'transfer']))
  assert.ok(movements.docs.every((doc) => doc.data().branchId === 'punata'))
})
