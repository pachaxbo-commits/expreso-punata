import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { collectMemberDue, openCashShift } from '../index.js'

const db = getFirestore()

test('collectMemberDue writes one central audit event for a payment and idempotent retry', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const uid = `due-audit-secretary-${suffix}`
  const memberId = `due-audit-member-${suffix}`
  const dueId = `due-audit-item-${suffix}`
  const idempotencyKey = `due-audit-idem-${suffix}`

  await Promise.all([
    db.collection('users').doc(uid).set({
      uid, role: 'secretaria', isActive: true, primaryBranchId: 'punata',
      allowedBranchIds: ['punata'], fullName: 'Fixture Secretaria Audit',
    }),
    db.collection('union_members').doc(memberId).set({
      id: memberId, branchId: 'punata', status: 'active',
      memberNumber: `DA-${suffix}`, fullName: 'Fixture Affiliate Audit',
    }),
    db.collection('union_dues').doc(dueId).set({
      id: dueId, memberId, memberNumber: `DA-${suffix}`, memberName: 'Fixture Affiliate Audit',
      branchId: 'punata', period: '2026-11', periodLabel: 'November 2026',
      amountCents: 5000, paidAmountCents: 0, balanceCents: 5000, status: 'pending',
    }),
  ])

  const opened = await openCashShift.run({
    auth: { uid },
    data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: `due-audit-shift-${suffix}` },
  })
  const payload = {
    dueId, amountCents: 1200, paymentMethod: 'cash', shiftId: opened.shift.id,
    branchId: 'punata', idempotencyKey,
  }
  const first = await collectMemberDue.run({ auth: { uid }, data: payload })
  const retry = await collectMemberDue.run({ auth: { uid }, data: payload })

  assert.deepEqual(retry, first)
  const [duePayments, movements, auditEvents] = await Promise.all([
    db.collection('union_dues').doc(dueId).collection('payments').get(),
    db.collection('financial_movements').where('dueId', '==', dueId).get(),
    db.collection('audit_logs').where('action', '==', 'union_due_payment_collected').where('targetId', '==', dueId).get(),
  ])
  assert.equal(duePayments.size, 1)
  assert.equal(movements.size, 1)
  assert.equal(auditEvents.size, 1)

  const payment = duePayments.docs[0].data()
  const movement = movements.docs[0].data()
  const audit = auditEvents.docs[0].data()
  assert.equal(audit.paymentId, payment.id)
  assert.equal(audit.targetId, dueId)
  assert.equal(audit.memberId, memberId)
  assert.equal(audit.amountCents, 1200)
  assert.equal(audit.receiptNumber, first.receiptNumber)
  assert.equal(audit.branchId, 'punata')
  assert.equal(audit.shiftId, opened.shift.id)
  assert.equal(audit.performedByUid, uid)
  assert.equal(audit.performedByRole, 'secretaria')
  assert.equal(typeof audit.timestampIso, 'string')
  assert.equal(movement.receiptNumber, audit.receiptNumber)
  assert.equal(payment.receiptNumber, audit.receiptNumber)
})
