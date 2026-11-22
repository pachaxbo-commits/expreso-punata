import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { adminProvisionUser, adminRevokeUserSessions } from '../index.js'

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

test('suspender a otro administrador exige sesión reciente, confirmación y motivo', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admin = await auth.createUser({ email: `guard-${suffix}@example.test` })
  const target = await auth.createUser({ email: `second-${suffix}@example.test` })
  for (const u of [admin, target]) await db.collection('users').doc(u.uid).set({ uid: u.uid, email: u.email, fullName: 'Administrador', role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  const data = { targetUid: target.uid, fullName: 'Administrador', phone: '70000000', role: 'afiliado_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: false }
  const call = (token, extra = {}) => adminProvisionUser.run({ auth: { uid: admin.uid, token }, data: { ...data, ...extra } })
  const now = Math.floor(Date.now() / 1000)
  await assert.rejects(() => call({ auth_time: 1 }, { sensitiveReason: 'Cambio autorizado de prueba', confirmSensitive: true }), { code: 'failed-precondition' })
  await assert.rejects(() => call({ auth_time: now }), { code: 'invalid-argument' })
  assert.equal((await db.collection('users').doc(target.uid).get()).data().isActive, true)
  await call({ auth_time: now }, { sensitiveReason: 'Cambio autorizado de prueba', confirmSensitive: true })
  assert.equal((await auth.getUser(target.uid)).disabled, true)
  const audits = await db.collection('audit_logs').where('entityId', '==', target.uid).get()
  assert.ok(audits.docs.some(doc => doc.data().details?.reason === 'Cambio autorizado de prueba'))
})
