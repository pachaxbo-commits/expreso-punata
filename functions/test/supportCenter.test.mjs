import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { getSupportOverview, getSupportConfiguration, updateSupportConfiguration, listSupportDiagnostics, recordSupportDiagnostic, simulateSupportCleanup, executeSupportCleanup, restoreSupportCleanup } from '../index.js'

const db = getFirestore()
const uid = 'support-test'
const auth = { uid, token: { auth_time: Math.floor(Date.now() / 1000) } }
const marker = 'pachax-emulator-fixture-v1'
const request = categories => ({ auth, data: { categories } })
beforeEach(async () => {
  for (const name of ['users', 'support_cleanup_fixtures', 'support_cleanup_backups', 'support_cleanup_operations', 'support_cleanup_restores', 'support_config_history', 'support_diagnostics', 'audit_logs', 'system_config']) {
    const docs = await db.collection(name).get()
    if (!docs.empty) { const batch = db.batch(); docs.forEach(doc => batch.delete(doc.ref)); await batch.commit() }
  }
  await db.collection('users').doc(uid).set({ role: 'soporte_pachax', isActive: true })
})

test('diagnósticos validan identificadores y descartan campos adicionales', async () => {
  const data = { module: 'cuenta', operation: 'getAccount', code: 'internal_0', branchId: 'punata', correlationId: 'case-123', status: 'investigando' }
  await assert.rejects(() => recordSupportDiagnostic.run({ auth, data: { ...data, code: 'password: secreto' } }), { code: 'invalid-argument' })
  await assert.rejects(() => recordSupportDiagnostic.run({ auth: { uid, token: { auth_time: 1 } }, data }), { code: 'failed-precondition' })
  await recordSupportDiagnostic.run({ auth, data: { ...data, password: 'ignored' } })
  const result = await listSupportDiagnostics.run({ auth, data: {} })
  assert.equal(result.entries[0].code, 'internal_0')
  assert.equal(result.entries[0].password, undefined)
  assert.equal((await db.collection('audit_logs').get()).size, 1)
  await db.collection('users').doc(uid).update({ role: 'secretaria' })
  await assert.rejects(() => listSupportDiagnostics.run({ auth, data: {} }), { code: 'permission-denied' })
})

test('configuración institucional valida, audita y restaura sin modificar finanzas', async () => {
  const ref = db.collection('system_config').doc('expreso_punata')
  await ref.set({ status: 'configured', isOfficial: true, company: { tradeName: 'Expreso anterior' }, branches: { punata: { phone: '111' } }, commissions: { defaultType: 'percentage', defaultValue: 0 } })
  const update = (data, user = auth) => updateSupportConfiguration.run({ auth: user, data: { reason: 'Cambio solicitado por cliente', confirmation: true, ...data } })
  await assert.rejects(() => update({ field: 'commissions.defaultValue', value: '2', expectedValue: '0' }), { code: 'invalid-argument' })
  await assert.rejects(() => update({ field: 'punataPhone', value: 'texto', expectedValue: '111' }), { code: 'invalid-argument' })
  await assert.rejects(() => update({ field: 'tradeName', value: 'Nuevo nombre', expectedValue: 'otro' }), { code: 'aborted' })
  await assert.rejects(() => update({ field: 'tradeName', value: 'Nuevo nombre', expectedValue: 'Expreso anterior' }, { uid, token: { auth_time: 1 } }), { code: 'failed-precondition' })
  await update({ field: 'tradeName', value: 'Nuevo nombre', expectedValue: 'Expreso anterior' })
  const snapshot = await getSupportConfiguration.run({ auth, data: {} })
  assert.equal(snapshot.values.tradeName, 'Nuevo nombre')
  assert.equal(snapshot.history[0].previous, 'Expreso anterior')
  await update({ field: 'tradeName', value: snapshot.history[0].previous, expectedValue: 'Nuevo nombre' })
  assert.equal((await ref.get()).data().company.tradeName, 'Expreso anterior')
  assert.equal((await ref.get()).data().commissions.defaultValue, 0)
  assert.equal((await db.collection('audit_logs').get()).size, 2)
})

test('overview requiere soporte activo y no revela datos de configuración', async () => {
  await db.collection('system_config').doc('expreso_punata').set({ status: 'configured', isOfficial: true, commissions: { defaultType: 'percentage', defaultValue: 0 }, privateField: 'private' })
  const result = await getSupportOverview.run({ auth, data: {} })
  assert.equal(result.commissionsConfigured, false)
  assert.equal(result.privateField, undefined)
  for (const role of ['secretaria', 'afiliado', 'afiliado_admin', 'directiva_admin']) {
    await db.collection('users').doc(uid).set({ role, isActive: true })
    await assert.rejects(() => getSupportOverview.run({ auth, data: {} }), { code: 'permission-denied' })
  }
})

test('fuera de emuladores soporte exige segundo factor', async () => {
  const prev = process.env.FUNCTIONS_EMULATOR
  try {
    process.env.FUNCTIONS_EMULATOR = 'false'
    await assert.rejects(() => getSupportOverview.run({ auth, data: {} }), { code: 'permission-denied' })
    const secureAuth = { uid, token: { firebase: { sign_in_second_factor: 'phone' } } }
    assert.equal((await getSupportOverview.run({ auth: secureAuth, data: {} })).cleanupEnvironment, 'no disponible en producción')
  } finally { process.env.FUNCTIONS_EMULATOR = prev }
})

test('simulación incluye padres y dependientes sin modificar documentos', async () => {
  await db.collection('support_cleanup_fixtures').doc('guide').set({ category: 'encomiendas', testMarker: marker, dependsOn: [], amountCents: 100, branchId: 'punata' })
  await db.collection('support_cleanup_fixtures').doc('payment').set({ category: 'cobros', testMarker: marker, dependsOn: ['guide'], amountCents: 200, branchId: 'punata' })
  const plan = await simulateSupportCleanup.run(request(['encomiendas']))
  assert.deepEqual(plan.records.map(x => x.id), ['guide', 'payment'])
  assert.equal(plan.amountCents, 300)
  assert.equal((await db.collection('support_cleanup_fixtures').get()).size, 2)
})

test('bloquea vínculos sin marca verificable y categorías arbitrarias', async () => {
  await db.collection('support_cleanup_fixtures').doc('guide').set({ category: 'encomiendas', testMarker: marker, dependsOn: ['real'] })
  await db.collection('support_cleanup_fixtures').doc('real').set({ category: 'cobros', dependsOn: [] })
  await assert.rejects(() => simulateSupportCleanup.run(request(['encomiendas'])), { code: 'failed-precondition' })
  await assert.rejects(() => simulateSupportCleanup.run(request(['users'])), { code: 'invalid-argument' })
})

test('limpieza transaccional requiere reautenticación, respaldo, auditoría e idempotencia', async () => {
  const ref = db.collection('support_cleanup_fixtures').doc('guide')
  await ref.set({ category: 'encomiendas', testMarker: marker, dependsOn: [] })
  const plan = await simulateSupportCleanup.run(request(['encomiendas']))
  const data = { categories: ['encomiendas'], digest: plan.digest, operationId: 'operation-test-1234', confirmation: 'LIMPIAR' }
  await assert.rejects(() => executeSupportCleanup.run({ auth: { uid, token: { auth_time: 1 } }, data }), { code: 'failed-precondition' })
  const results = await Promise.all([executeSupportCleanup.run({ auth, data }), executeSupportCleanup.run({ auth, data })])
  assert.deepEqual(results[0], results[1])
  assert.equal((await ref.get()).exists, false)
  assert.equal((await db.collection('support_cleanup_backups').doc(data.operationId).get()).data().records.length, 1)
  assert.equal((await db.collection('audit_logs').get()).size, 1)
  const restore = { auth, data: { operationId: data.operationId, confirmation: 'RESTAURAR' } }
  await ref.set({ category: 'encomiendas', testMarker: marker, dependsOn: [], existing: true })
  await assert.rejects(() => restoreSupportCleanup.run(restore), { code: 'already-exists' })
  assert.equal((await ref.get()).data().existing, true)
  await ref.delete()
  const restored = await Promise.all([restoreSupportCleanup.run(restore), restoreSupportCleanup.run(restore)])
  assert.deepEqual(restored[0], restored[1])
  assert.equal((await ref.get()).exists, true)
  assert.equal((await db.collection('audit_logs').get()).size, 2)
})

test('cambio después de simular invalida ejecución y producción queda bloqueada', async () => {
  const ref = db.collection('support_cleanup_fixtures').doc('guide')
  await ref.set({ category: 'encomiendas', testMarker: marker, dependsOn: [] })
  const plan = await simulateSupportCleanup.run(request(['encomiendas']))
  await ref.update({ branchId: 'punata' })
  const data = { categories: ['encomiendas'], digest: plan.digest, operationId: 'operation-test-1234', confirmation: 'LIMPIAR' }
  await assert.rejects(() => executeSupportCleanup.run({ auth, data }), { code: 'aborted' })
  const prev = process.env.FUNCTIONS_EMULATOR
  try { process.env.FUNCTIONS_EMULATOR = 'false'; await assert.rejects(() => executeSupportCleanup.run({ auth: { uid, token: { ...auth.token, firebase: { sign_in_second_factor: 'phone' } } }, data }), { code: 'failed-precondition' }) }
  finally { process.env.FUNCTIONS_EMULATOR = prev }
  assert.equal((await ref.get()).exists, true)
})
