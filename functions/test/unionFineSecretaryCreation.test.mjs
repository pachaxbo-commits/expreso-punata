import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { createUnionFine } from '../index.js'

const db = getFirestore()

test('Secretary creates all supported fine categories only for members of her branch', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const uid = `fine-secretary-${suffix}`
  const ownMemberId = `fine-member-own-${suffix}`
  const foreignMemberId = `fine-member-foreign-${suffix}`
  await Promise.all([
    db.collection('users').doc(uid).set({
      uid, role: 'secretaria', isActive: true, primaryBranchId: 'punata',
      allowedBranchIds: ['punata'], fullName: 'Secretaría ficticia Punata',
    }),
    db.collection('union_members').doc(ownMemberId).set({
      id: ownMemberId, branchId: 'punata', status: 'active', memberNumber: `F-${suffix}`, fullName: 'Afiliado ficticio propio',
    }),
    db.collection('union_members').doc(foreignMemberId).set({
      id: foreignMemberId, branchId: 'cochabamba', status: 'active', memberNumber: `FC-${suffix}`, fullName: 'Afiliado ficticio ajeno',
    }),
  ])

  const categories = ['transporte', 'conflictos', 'deportes', 'otros']
  const created = await Promise.all(categories.map((category) => createUnionFine.run({
    auth: { uid },
    data: {
      memberId: ownMemberId, category, reason: `Motivo ficticio ${category}`,
      date: '2026-11-26', amountCents: 2500,
    },
  })))
  assert.deepEqual(created.map(({ fine }) => fine.category), categories)
  assert.ok(created.every(({ fine }) => fine.branchId === 'punata' && fine.createdByUid === uid))

  await assert.rejects(() => createUnionFine.run({
    auth: { uid },
    data: { memberId: foreignMemberId, category: 'transporte', reason: 'Intento ajeno', date: '2026-11-26', amountCents: 1000 },
  }), (error) => error.code === 'permission-denied')

  const [allFines, movements, audits] = await Promise.all([
    db.collection('union_fines').where('memberId', 'in', [ownMemberId, foreignMemberId]).get(),
    db.collection('financial_movements').where('memberId', 'in', [ownMemberId, foreignMemberId]).get(),
    db.collection('audit_logs').where('action', '==', 'union_fine_created').where('memberId', '==', ownMemberId).get(),
  ])
  assert.equal(allFines.size, 4)
  assert.equal(movements.size, 0, 'crear multas no crea movimientos financieros')
  assert.equal(audits.size, 4, 'cada alta autorizada deja auditoría')
  assert.ok(audits.docs.every((doc) => doc.data().performedByUid === uid && doc.data().performedByRole === 'secretaria'))
})
