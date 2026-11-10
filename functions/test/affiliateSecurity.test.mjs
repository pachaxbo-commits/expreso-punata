import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getMyUnionAccount, adminProvisionUser } from '../index.js'

const db = getFirestore()
const auth = getAuth()
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

beforeEach(async () => {
  const docs = await db.collection('users').get()
  const batch = db.batch()
  docs.docs.forEach((doc) => batch.delete(doc.ref))
  await batch.commit()
})

test('afiliado consulta únicamente su cuenta vinculada', async () => {
  const id = suffix()
  const uid = `affiliate-${id}`
  await db.collection('users').doc(uid).set({ uid, role: 'afiliado', fullName: 'Afiliado Prueba', primaryBranchId: 'punata', allowedBranchIds: ['punata'], unionMemberId: `member-${id}`, isActive: true })
  await db.collection('union_members').doc(`member-${id}`).set({ memberNumber: `PUN-${id}`, fullName: 'Afiliado Prueba', branchId: 'punata', status: 'active' })
  await db.collection('union_members').doc(`member-other-${id}`).set({ memberNumber: `CBB-${id}`, fullName: 'Otro Afiliado', branchId: 'cochabamba', status: 'active' })
  await db.collection('union_dues').doc(`due-${id}`).set({ memberId: `member-${id}`, amountCents: 1000, balanceCents: 1000, status: 'pending' })
  await db.collection('union_dues').doc(`due-other-${id}`).set({ memberId: `member-other-${id}`, amountCents: 2000, balanceCents: 2000, status: 'pending' })

  const result = await getMyUnionAccount.run({ auth: { uid }, data: {} })
  assert.equal(result.member.memberNumber, `PUN-${id}`)
  assert.equal(result.dues.length, 1)
  assert.equal(result.dues[0].memberId, `member-${id}`)
})

test('adminProvisionUser valida vínculo activo, sucursal y duplicación', async () => {
  const id = suffix()
  const adminUid = `admin-${id}`
  await db.collection('users').doc(adminUid).set({ uid: adminUid, role: 'directiva_admin', fullName: 'Admin Prueba', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true })
  const memberId = `member-${id}`
  const testPassword = `Local-${id}!A9`
  await db.collection('union_members').doc(memberId).set({ memberNumber: `PUN-${id}`, fullName: 'Afiliado Vinculable', branchId: 'punata', status: 'active' })
  const target = await auth.createUser({ email: `affiliate-${id}@example.test`, password: testPassword })
  const result = await adminProvisionUser.run({ auth: { uid: adminUid, token: { email: `admin-${id}@example.test` } }, data: { targetUid: target.uid, fullName: 'Afiliado Vinculable', email: target.email, phone: '70000000', role: 'afiliado', primaryBranchId: 'punata', unionMemberId: memberId } })
  assert.equal(result.profile.role, 'afiliado')
  assert.equal(result.profile.unionMemberId, memberId)
  const duplicate = await auth.createUser({ email: `duplicate-${id}@example.test`, password: testPassword })
  await assert.rejects(() => adminProvisionUser.run({ auth: { uid: adminUid, token: { email: `admin-${id}@example.test` } }, data: { targetUid: duplicate.uid, fullName: 'Duplicado', email: duplicate.email, phone: '70000002', role: 'afiliado', primaryBranchId: 'punata', unionMemberId: memberId } }), (error) => error.code === 'already-exists')
  await assert.rejects(() => adminProvisionUser.run({ auth: { uid: adminUid, token: { email: `admin-${id}@example.test` } }, data: { fullName: 'Sin vínculo', email: `missing-${id}@example.test`, phone: '70000001', role: 'afiliado', primaryBranchId: 'punata' } }), (error) => error.code === 'invalid-argument')
  await auth.deleteUser(target.uid)
  await auth.deleteUser(duplicate.uid)
})
