import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createUserSecurityFunctions } from '../userSecurity.js'
import { adminProvisionUser, adminRevokeUserSessions, adminRetireUser, adminDeleteRetiredUser, getUserDeletionStatus, createPassengerTicket } from '../index.js'

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

test('baja conserva historial, bloquea caja abierta y permite reintentos', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admin = await auth.createUser({ email: `retire-admin-${suffix}@example.test` })
  const target = await auth.createUser({ email: `retire-user-${suffix}@example.test` })
  await db.collection('users').doc(admin.uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  await db.collection('users').doc(target.uid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata' })
  const lock = db.collection('cash_shift_active_locks').doc(`lock-${suffix}`)
  await lock.set({ operatorUid: target.uid, status: 'open' })
  const history = db.collection('financial_movements').doc(`history-${suffix}`)
  await history.set({ operatorUid: target.uid, amountCents: 100 })
  const request = { auth: { uid: admin.uid, token: { auth_time: Math.floor(Date.now() / 1000) } }, data: { targetUid: target.uid, reason: 'Baja autorizada de prueba', confirmation: true, operationId: `retire-${suffix}` } }
  await assert.rejects(() => adminRetireUser.run(request), { code: 'failed-precondition' })
  await lock.delete()
  const manifest = db.collection('manifests').doc(`active-${suffix}`)
  await manifest.set({ driverUid: target.uid, status: 'dispatched' })
  await assert.rejects(() => adminRetireUser.run(request), { code: 'failed-precondition' })
  await manifest.update({ status: 'received' })
  const commission = db.collection('driver_commission_accounts').doc(target.uid)
  await commission.set({ pendingCents: 100 })
  await assert.rejects(() => adminRetireUser.run(request), { code: 'failed-precondition' })
  await commission.update({ pendingCents: 0 })
  const custody = db.collection('driver_custody_records').doc(suffix)
  await custody.set({ driverUid: target.uid, status: 'pending_remittance' })
  await assert.rejects(() => adminRetireUser.run(request), /bajo custodia/)
  await custody.update({ status: 'remitted' })
  const shipment = db.collection('shipments').doc(suffix)
  await shipment.set({ status: 'delivered', collectedByDriverUid: target.uid, driverCustody: { inCustody: true, reconciled: false } })
  await assert.rejects(() => adminRetireUser.run(request), /guías con cobros/)
  await shipment.update({ 'driverCustody.reconciled': true })
  const asset = db.collection('fixed_assets').doc(suffix)
  await asset.set({ responsiblePersonUid: target.uid, status: 'in_use' })
  await assert.rejects(() => adminRetireUser.run(request), /bien patrimonial/)
  await asset.update({ status: 'disposed' })
  const ticket = db.collection('passenger_ticket_operations').doc(suffix)
  await ticket.set({ driverUid: target.uid, useStatus: 'partially_used', paymentStatus: 'paid_verified' })
  await assert.rejects(() => adminRetireUser.run(request), /pasajes pendientes/)
  await ticket.update({ useStatus: 'used', pendingSettlementCents: 0 })
  const result = await adminRetireUser.run(request)
  assert.equal(result.disposition, 'disabled')
  assert.deepEqual(await adminRetireUser.run(request), result)
  assert.equal((await auth.getUser(target.uid)).disabled, true)
  assert.equal((await db.collection('users').doc(target.uid).get()).data().syncStatus, 'retired')
  assert.equal((await history.get()).exists, true)
  await assert.rejects(() => adminRetireUser.run({ ...request, data: { ...request.data, targetUid: admin.uid, operationId: `other-${suffix}` } }), { code: 'failed-precondition' })
})

test('baja interrumpida mantiene reserva y se completa con el mismo identificador', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admin = await auth.createUser({ email: `retry-admin-${suffix}@example.test` })
  const target = await auth.createUser({ email: `retry-user-${suffix}@example.test` })
  await db.collection('users').doc(admin.uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  await db.collection('users').doc(target.uid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata' })
  const req = { auth: { uid: admin.uid, token: { auth_time: Math.floor(Date.now() / 1000) } }, data: { targetUid: target.uid, reason: 'Baja autorizada de prueba', confirmation: true, operationId: `retry-${suffix}` } }
  const proto = Object.getPrototypeOf(auth), original = proto.updateUser
  try {
    proto.updateUser = async function (uid, ...args) { if (uid === target.uid) throw new Error('fallo sintético'); return original.call(this, uid, ...args) }
    await assert.rejects(() => adminRetireUser.run(req), { code: 'unavailable' })
  } finally { proto.updateUser = original }
  assert.equal((await db.collection('users').doc(target.uid).get()).data().syncStatus, 'retiring')
  const other = await auth.createUser({ email: `retry-other-${suffix}@example.test` })
  await db.collection('users').doc(other.uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  const otherAuth = { ...req.auth, uid: other.uid }
  const recovered = await getUserDeletionStatus.run({ auth: otherAuth, data: { targetUid: target.uid } })
  assert.equal(recovered.retirement.status, 'retry_required')
  assert.equal(recovered.retirement.operationId, req.data.operationId)
  await assert.rejects(() => getUserDeletionStatus.run({ auth: { ...req.auth, uid: target.uid }, data: { targetUid: target.uid } }), { code: 'permission-denied' })
  const changeProfile = changes => adminProvisionUser.run({ auth: otherAuth, data: {
    targetUid: target.uid, fullName: 'Operador sintético', phone: '70000000', role: 'secretaria',
    primaryBranchId: 'punata', allowedBranchIds: ['punata'], ...changes,
  } })
  const [retired, changedRole, changedAgency] = await Promise.allSettled([
    adminRetireUser.run({ ...req, auth: otherAuth }),
    changeProfile({ role: 'afiliado_admin', allowedBranchIds: ['punata', 'cochabamba'] }),
    changeProfile({ primaryBranchId: 'cochabamba', allowedBranchIds: ['cochabamba'] }),
  ])
  assert.equal(retired.value?.success, true)
  assert.equal(changedRole.reason?.code, 'failed-precondition')
  assert.equal(changedAgency.reason?.code, 'failed-precondition')
  assert.equal((await auth.getUser(target.uid)).disabled, true)
  assert.equal((await auth.getUser(target.uid)).customClaims.isActive, false)
  assert.equal((await db.collection('user_retirement_operations').doc(req.data.operationId).get()).data().status, 'completed')
})

test('elimina identidad sintética dada de baja y conserva historial, con reintento', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admin = await auth.createUser({ email: `delete-admin-${suffix}@example.test` })
  const target = await auth.createUser({ email: `delete-target-${suffix}@example.test` })
  await db.collection('users').doc(admin.uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  await db.collection('users').doc(target.uid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata', emulatorDeletionEligible: true })
  const history = db.collection('financial_movements').doc(`history-delete-${suffix}`)
  await history.set({ operatorUid: target.uid })
  const callAuth = { uid: admin.uid, token: { auth_time: Math.floor(Date.now() / 1000) } }
  const technical = db.collection('users').doc(`technical-${suffix}`)
  await technical.set({ role: 'soporte_pachax', isActive: false, syncStatus: 'retired', emulatorDeletionEligible: true })
  const technicalRequest = { auth: callAuth, data: { targetUid: technical.id, reason: 'Comprobación de cuenta técnica', confirmation: true, operationId: `technical-${suffix}` } }
  await assert.rejects(() => adminDeleteRetiredUser.run(technicalRequest), { code: 'permission-denied' })
  await technical.update({ isActive: true, syncStatus: 'synced' })
  await assert.rejects(() => adminRetireUser.run(technicalRequest), { code: 'permission-denied' })
  await adminRetireUser.run({ auth: callAuth, data: { targetUid: target.uid, reason: 'Baja sintética autorizada', confirmation: true, operationId: `retire-${suffix}` } })
  const req = { auth: callAuth, data: { targetUid: target.uid, reason: 'Eliminación sintética autorizada', confirmation: true, operationId: `delete-${suffix}` } }
  const demoFlag = process.env.FUNCTIONS_EMULATOR
  try {
    process.env.FUNCTIONS_EMULATOR = 'false'
    await assert.rejects(() => adminDeleteRetiredUser.run(req), /producción/)
  } finally {
    process.env.FUNCTIONS_EMULATOR = demoFlag
  }
  assert.equal((await auth.getUser(target.uid)).disabled, true)
  const proto = Object.getPrototypeOf(auth), original = proto.deleteUser
  try { proto.deleteUser = async () => { throw new Error('fallo sintético') }; await assert.rejects(() => adminDeleteRetiredUser.run(req), { code: 'unavailable' }) }
  finally { proto.deleteUser = original }
  assert.equal((await db.collection('user_deletion_operations').doc(req.data.operationId).get()).data().status, 'retry_required')
  assert.equal((await getUserDeletionStatus.run({ auth: callAuth, data: { operationId: req.data.operationId } })).status, 'retry_required')
  const getUser = proto.getUser
  let identityReads = 0
  try {
    proto.getUser = async function (uid, ...args) {
      if (uid === target.uid && ++identityReads === 2) throw new Error('No se pudo confirmar la ausencia')
      return getUser.call(this, uid, ...args)
    }
    await assert.rejects(() => adminDeleteRetiredUser.run(req), { code: 'unavailable' })
  } finally { proto.getUser = getUser }
  await assert.rejects(() => auth.getUser(target.uid), { code: 'auth/user-not-found' })
  assert.equal((await db.collection('users').doc(target.uid).get()).data().syncStatus, 'retired')
  const profile = (await db.collection('users').doc(target.uid).get()).data()
  const provision = changes => adminProvisionUser.run({ auth: callAuth, data: {
    targetUid: target.uid, fullName: 'Operador sintético', phone: '70000000', role: profile.role,
    primaryBranchId: 'punata', allowedBranchIds: ['punata'], ...changes,
  } })
  const [deleted, duplicate, ...mutations] = await Promise.allSettled([
    adminDeleteRetiredUser.run(req), adminDeleteRetiredUser.run(req),
    provision({ isActive: false }), provision({ role: 'afiliado_admin', allowedBranchIds: ['punata', 'cochabamba'] }),
    provision({ primaryBranchId: 'cochabamba', allowedBranchIds: ['cochabamba'] }),
  ])
  assert.ok(mutations.every(result => result.status === 'rejected'))
  const concurrent = [deleted.value, duplicate.value]
  assert.ok(concurrent.every(result => result.status === 'completed'))
  assert.equal((await adminDeleteRetiredUser.run(req)).status, 'completed')
  await assert.rejects(() => auth.getUser(target.uid), { code: 'auth/user-not-found' })
  assert.equal((await history.get()).data().operatorUid, target.uid)
  assert.equal((await db.collection('users').doc(target.uid).get()).data().syncStatus, 'auth_deleted')
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

test('dos administradores que se retiran entre sí solo pueden completar una baja', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admins = await Promise.all([1, 2].map(i => auth.createUser({ email: `mutual-${i}-${suffix}@example.test` })))
  for (const { uid } of admins) {
    await db.collection('users').doc(uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  }
  const outcomes = await Promise.allSettled(admins.map(({ uid }, index) => adminRetireUser.run({
    auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000) } },
    data: { targetUid: admins[1 - index].uid, reason: 'Validación concurrente sintética', confirmation: true, operationId: `race-${index}-${suffix}` },
  })))
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'permission-denied')
  const identities = await Promise.all(admins.map(({ uid }) => auth.getUser(uid)))
  assert.equal(identities.filter(identity => identity.disabled).length, 1)
})

test('eliminación reservada impide asignar pasajes a un UID compartido con el directorio', async () => {
  const db = getFirestore(), auth = getAuth(), suffix = randomUUID()
  const admin = await auth.createUser({ email: `assignment-admin-${suffix}@example.test` })
  const driver = await auth.createUser({ email: `assignment-driver-${suffix}@example.test` })
  await db.collection('users').doc(admin.uid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  await db.collection('users').doc(driver.uid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata', emulatorDeletionEligible: true })
  await db.collection('driver_directory').doc(driver.uid).set({ isActive: true, fullName: 'Conductor sintético' })
  const authContext = { uid: admin.uid, token: { auth_time: Math.floor(Date.now() / 1000) } }
  const data = { targetUid: driver.uid, reason: 'Retiro sintético autorizado', confirmation: true }
  await adminRetireUser.run({ auth: authContext, data: { ...data, operationId: `retire-assignment-${suffix}` } })
  const proto = Object.getPrototypeOf(auth), original = proto.deleteUser
  let enteredAuth
  const entered = new Promise(resolve => { enteredAuth = resolve })
  let releaseAuth
  const release = new Promise(resolve => { releaseAuth = resolve })
  proto.deleteUser = async function (uid, ...args) {
    if (uid === driver.uid) {
      enteredAuth()
      await release
    }
    return original.call(this, uid, ...args)
  }
  const request = { auth: authContext, data: { ...data, operationId: `delete-assignment-${suffix}` } }
  const deleting = adminDeleteRetiredUser.run(request)
  try {
    await Promise.race([entered, deleting])
    await assert.rejects(() => adminProvisionUser.run({ auth: authContext, data: {
      targetUid: driver.uid, fullName: 'Operador sintético', phone: '70000000', role: 'secretaria',
      primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: false,
    } }), { code: 'failed-precondition' })
    await assert.rejects(() => createPassengerTicket.run({ auth: authContext, data: {
      idempotencyKey: `ticket-assignment-${suffix}`, branchId: 'punata', originBranchId: 'punata',
      destinationBranchId: 'cochabamba', travelDate: '2026-12-15', driverUid: driver.uid,
      quantity: 1, unitAmountCents: 1000,
    } }), { code: 'failed-precondition' })
  } finally {
    releaseAuth()
    proto.deleteUser = original
    await deleting
  }
  await assert.rejects(() => auth.getUser(driver.uid), { code: 'auth/user-not-found' })
  assert.equal((await db.collection('driver_directory').doc(driver.uid).get()).exists, true)
})

test('un administrador legado no puede retirar al último afiliado administrador activo', async () => {
  const db = getFirestore('last-retirement-admin')
  const legacy = db.collection('users').doc('legacy-admin')
  const last = db.collection('users').doc('last-admin')
  await legacy.set({ role: 'directiva_admin', isActive: true })
  await last.set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  const { adminRetireUser: retire } = createUserSecurityFunctions(db, getAuth(), ({ role }) => ['afiliado_admin', 'directiva_admin'].includes(role))
  await assert.rejects(() => retire.run({
    auth: { uid: legacy.id, token: { auth_time: Math.floor(Date.now() / 1000) } },
    data: { targetUid: last.id, reason: 'Validación del último administrador', confirmation: true, operationId: `last-admin-${randomUUID()}` },
  }), /último administrador activo/)
  assert.equal((await last.get()).data().isActive, true)
})
