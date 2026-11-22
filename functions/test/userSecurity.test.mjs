import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { adminRevokeUserSessions } from '../index.js'

test('revocar sesiones exige administración, autenticación reciente, motivo y auditoría', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admin = await auth.createUser({ email: `admin-${suffix}@example.test` })
  const target = await auth.createUser({ email: `target-${suffix}@example.test` })
  await db.collection('users').doc(admin.uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  await db.collection('users').doc(target.uid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata' })
  const call = (uid, authTime, overrides = {}) => adminRevokeUserSessions.run({ auth: { uid, token: { auth_time: authTime } }, data: { targetUid: target.uid, reason: 'Recuperación de acceso autorizada', confirmation: true, ...overrides } })
  const now = Math.floor(Date.now() / 1000)
  await assert.rejects(() => call(target.uid, now), { code: 'permission-denied' })
  await assert.rejects(() => call(admin.uid, now - 1000), { code: 'failed-precondition' })
  await assert.rejects(() => call(admin.uid, now, { reason: 'corto' }), { code: 'invalid-argument' })
  await assert.rejects(() => call(admin.uid, now, { confirmation: false }), { code: 'invalid-argument' })
  const result = await call(admin.uid, now)
  assert.equal(result.success, true)
  assert.equal((await db.collection('audit_logs').doc(result.auditId).get()).data().result, 'success')
  assert.equal((await auth.getUser(target.uid)).disabled, false)
  await db.collection('users').doc(target.uid).update({ role: 'soporte_pachax' })
  await assert.rejects(() => call(admin.uid, now), { code: 'permission-denied' })
})
