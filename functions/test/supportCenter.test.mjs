import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { createSupportFunctions } from '../supportCenter.js'
import { getSupportOverview, getSupportConfiguration, updateSupportConfiguration, listSupportDiagnostics, recordSupportDiagnostic, reportClientDiagnostic, updateSupportDiagnostic, getSupportCleanupInventory, simulateSupportCleanup, getSupportCleanupPlan, listSupportCleanupOperations, executeSupportCleanup, restoreSupportCleanup } from '../index.js'
import { registerSyntheticTestRecord } from '../../tests/helpers/supportCleanupProvenance.mjs'

const db = getFirestore()
const uid = 'support-test'
const auth = { uid, token: { auth_time: Math.floor(Date.now() / 1000) } }
const request = data => ({ auth, data })
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
beforeEach(async () => {
  for (const name of ['users', 'support_cleanup_provenance', 'support_cleanup_plans', 'support_cleanup_backups', 'support_cleanup_operations', 'support_cleanup_restores', 'support_config_history', 'support_diagnostics', 'support_diagnostic_limits', 'audit_logs', 'system_config']) {
    const docs = await db.collection(name).get()
    for (const doc of docs.docs) await db.recursiveDelete(doc.ref)
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

test('incidente automático conserva correlación, safe fields, límites y revisión auditada', async () => {
  const actorUid = `operator-${suffix()}`
  const actorAuth = { uid: actorUid, token: { auth_time: Math.floor(Date.now() / 1000) } }
  await db.collection('users').doc(actorUid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata' })
  const id = `incident-${Math.random().toString(36).slice(2, 12)}`
  const data = { module: 'cash', operation: 'registerExpense', code: 'internal', category: 'cloud_function', correlationId: id, frontendVersion: '1.4.96', password: 'never-store-this', requestBody: { amount: 900 } }
  await assert.rejects(() => reportClientDiagnostic.run({ auth: actorAuth, data: { ...data, category: 'invalid', correlationId: 'bad' } }), { code: 'invalid-argument' })
  const saved = await reportClientDiagnostic.run({ auth: actorAuth, data })
  assert.equal(saved.correlationId, id)
  const stored = (await db.collection('support_diagnostics').doc(id).get()).data()
  assert.equal(stored.messageSafe, 'Falló una operación del servidor.')
  assert.equal(stored.branchId, 'punata')
  assert.equal(stored.password, undefined)
  assert.equal(stored.requestBody, undefined)
  assert.equal(stored.actorUid, actorUid)
  const filtered = await listSupportDiagnostics.run({ auth, data: { module: 'cash', correlationId: id } })
  assert.equal(filtered.entries.length, 1)
  assert.equal(filtered.entries[0].correlationId, id)
  assert.equal(filtered.entries[0].actorUid, undefined)
  assert.equal(filtered.summary.open, 1)
  for (let i = 1; i < 20; i++) await reportClientDiagnostic.run({ auth: actorAuth, data: { ...data, correlationId: `${id}-${i}` } })
  await assert.rejects(() => reportClientDiagnostic.run({ auth: actorAuth, data: { ...data, correlationId: `${id}-limit` } }), { code: 'resource-exhausted' })
  await assert.rejects(() => updateSupportDiagnostic.run({ auth, data: { id, status: 'investigando', observation: 'correo operador@ejemplo.com' } }), { code: 'invalid-argument' })
  await updateSupportDiagnostic.run({ auth, data: { id, status: 'investigando', observation: 'Revisar en la siguiente ventana de operación.' } })
  assert.equal((await db.collection('support_diagnostics').doc(id).get()).data().status, 'investigando')
  assert.equal((await db.collection('audit_logs').get()).docs.some(doc => doc.data().action === 'SUPPORT_DIAGNOSTIC_REVIEWED'), true)
  await db.collection('users').doc(actorUid).delete()
})

test('acceso de soporte en produccion exige MFA, token vigente, usuario habilitado y auth_time reciente', async () => {
  const productionEnv = { GCLOUD_PROJECT: 'expreso-punata-production-test' }
  const identityCalls = []
  let verificationError = null
  let disabled = false
  const authAdmin = {
    verifyIdToken: async (token, checkRevoked) => { identityCalls.push({ token, checkRevoked }); if (verificationError) throw verificationError; return { uid, firebase: { sign_in_second_factor: 'phone' } } },
    getUser: async () => ({ disabled }),
  }
  const { getSupportOverview, recordSupportDiagnostic } = createSupportFunctions(db, authAdmin, productionEnv)
  const token = { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_second_factor: 'phone' } }
  const prodRequest = (claims = token) => ({ auth: { uid, token: claims }, rawRequest: { headers: { authorization: 'Bearer signed-token' } }, data: {} })
  await assert.rejects(() => getSupportOverview.run(prodRequest({ ...token, firebase: {} })), { code: 'permission-denied' })
  await assert.rejects(() => recordSupportDiagnostic.run({ ...prodRequest({ ...token, auth_time: 1 }), data: { module: 'support', operation: 'authCheck', code: 'ok', correlationId: `auth-test-${Math.random().toString(36).slice(2, 10)}`, status: 'pendiente' } }), { code: 'failed-precondition' })
  verificationError = new Error('revoked')
  await assert.rejects(() => getSupportOverview.run(prodRequest()), { code: 'unauthenticated' })
  verificationError = null; disabled = true
  await assert.rejects(() => getSupportOverview.run(prodRequest()), { code: 'permission-denied' })
  disabled = false
  await recordSupportDiagnostic.run({ ...prodRequest(), data: { module: 'support', operation: 'authCheck', code: 'ok', correlationId: `auth-test-${Math.random().toString(36).slice(2, 10)}`, status: 'pendiente' } })
  assert.equal(identityCalls.at(-1).checkRevoked, true)
  assert.equal(identityCalls.at(-1).token, 'signed-token')
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
  await update({ field: 'tradeName', restoreHistoryId: snapshot.history[0].id, expectedValue: 'Nuevo nombre', expectedVersion: 1 })
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

test('fuera de emuladores una bandera MFA sola no sustituye un token verificable', async () => {
  const prev = process.env.FUNCTIONS_EMULATOR
  try {
    process.env.FUNCTIONS_EMULATOR = 'false'
    await assert.rejects(() => getSupportOverview.run({ auth, data: {} }), { code: 'permission-denied' })
    const secureAuth = { uid, token: { firebase: { sign_in_second_factor: 'phone' } } }
    await assert.rejects(() => getSupportOverview.run({ auth: secureAuth, data: {} }), { code: 'unauthenticated' })
  } finally { process.env.FUNCTIONS_EMULATOR = prev }
})

test('inventario muestra colecciones operativas y clasifica libros protegidos', async () => {
  const result = await getSupportCleanupInventory.run(request({}))
  const byCollection = Object.fromEntries(result.categories.map(item => [item.collection, item]))
  assert.equal(byCollection.shipments.deletable, true)
  assert.equal(byCollection.manifests.deletable, true)
  for (const name of ['financial_movements', 'cash_shifts', 'passenger_ticket_operations', 'union_dues', 'union_loans', 'union_fines', 'users', 'audit_logs']) assert.equal(byCollection[name].deletable, false, `${name} protegida`)
  assert.ok(result.relations.manifestShipments.fields.includes('shipmentIds[]'))
  await assert.rejects(() => simulateSupportCleanup.run(request({ categories: ['inventado'] })), { code: 'invalid-argument' })
})

test('procedencia faltante aparece como desconocida y no se vuelve elegible', async () => {
  const id = `PUN-UNKNOWN-${suffix()}`
  await db.collection('shipments').doc(id).set({ trackingCode: id, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', createdAtIso: '2026-01-01T10:00:00.000Z' })
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [id] }))
  assert.equal(plan.state, 'bloqueado')
  assert.equal(plan.records.length, 0)
  assert.equal(plan.exclusions[0].origin, 'Origen no verificado')
  assert.match(plan.exclusions[0].reason, /procedencia registrada/)
  assert.equal((await db.collection('shipments').doc(id).get()).exists, true)
})

test('auditoría global vinculada a una guía se muestra y bloquea el borrado', async () => {
  const id = `PUN-AUDIT-${suffix()}`
  const data = { id, trackingCode: id, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending' }
  await db.collection('shipments').doc(id).set(data)
  await registerSyntheticTestRecord(db, 'shipments', id, data, `audit-${suffix()}`)
  const auditId = `audit-shipment-${id}`
  await db.collection('audit_logs').doc(auditId).set({ entityType: 'shipment', entityId: id, action: 'shipment_created' })
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [id] }))
  assert.equal(plan.state, 'bloqueado')
  assert.ok(plan.exclusions.some(item => item.path === `audit_logs/${auditId}` && item.protected))
  assert.ok(plan.conflicts.some(item => item.path === `audit_logs/${auditId}` && /inmutable/.test(item.reason)))
})

test('referencia de manifiesto huérfana bloquea la guía sintética', async () => {
  const id = `PUN-ORPHAN-${suffix()}`
  const data = { id, trackingCode: id, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', manifestId: `missing-manifest-${id}` }
  await db.collection('shipments').doc(id).set(data)
  await registerSyntheticTestRecord(db, 'shipments', id, data, `orphan-${suffix()}`)
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [id] }))
  assert.equal(plan.state, 'bloqueado')
  assert.ok(plan.conflicts.some(conflict => conflict.path === `manifests/${data.manifestId}` && /huérfana/.test(conflict.reason)))
})

test('grafo incluye guía y manifiesto sintéticos relacionados sin modificar en simulación', async () => {
  const tag = suffix(); const shipmentId = `PUN-CLEAN-${tag}`; const manifestId = `MAN-CLEAN-${tag}`
  const shipment = { id: shipmentId, trackingCode: shipmentId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', finalAmountCents: 1200, createdAtIso: '2026-02-03T10:00:00.000Z', manifestId }
  const manifest = { id: manifestId, manifestNumber: manifestId, originBranchId: 'punata', destinationBranchId: 'cochabamba', shipmentIds: [shipmentId], shipmentSummaries: [{ shipmentId }], status: 'dispatched', totalCodAmountCents: 1200, createdAtIso: '2026-02-03T10:00:00.000Z' }
  await db.collection('shipments').doc(shipmentId).set(shipment); await registerSyntheticTestRecord(db, 'shipments', shipmentId, shipment, `suite-${tag}`)
  await db.collection('manifests').doc(manifestId).set(manifest); await registerSyntheticTestRecord(db, 'manifests', manifestId, manifest, `suite-${tag}`)
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [shipmentId], branchId: 'punata', from: '2026-02-01', to: '2026-02-28', origin: 'verified' }))
  assert.equal(plan.state, 'simulado')
  assert.deepEqual(plan.records.map(record => record.path).sort(), [`manifests/${manifestId}`, `shipments/${shipmentId}`].sort())
  assert.equal(plan.autoIncludedCount, 1)
  assert.equal(plan.amountCents, 2400)
  assert.equal((await db.collection('shipments').doc(shipmentId).get()).exists, true)
  const saved = await getSupportCleanupPlan.run(request({ planId: plan.planId }))
  assert.equal(saved.digest, plan.digest)
  assert.equal(saved.records.length, 2)
})

test('manifiesto compartido con guía de origen desconocido bloquea toda la componente', async () => {
  const tag = suffix(); const firstId = `PUN-MIX-A-${tag}`; const secondId = `PUN-MIX-B-${tag}`; const manifestId = `MAN-MIX-${tag}`
  const first = { id: firstId, trackingCode: firstId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', manifestId }
  const second = { id: secondId, trackingCode: secondId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'in_transit', manifestId }
  const manifest = { id: manifestId, manifestNumber: manifestId, originBranchId: 'punata', destinationBranchId: 'cochabamba', shipmentIds: [firstId, secondId], status: 'dispatched' }
  await db.collection('shipments').doc(firstId).set(first); await registerSyntheticTestRecord(db, 'shipments', firstId, first, `suite-${tag}`)
  await db.collection('shipments').doc(secondId).set(second)
  await db.collection('manifests').doc(manifestId).set(manifest); await registerSyntheticTestRecord(db, 'manifests', manifestId, manifest, `suite-${tag}`)
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [firstId] }))
  assert.equal(plan.state, 'bloqueado')
  assert.equal(plan.ready, false)
  assert.ok(plan.records.some(record => record.path === `shipments/${firstId}`), 'muestra el conjunto sintético candidato')
  assert.ok(plan.records.some(record => record.path === `manifests/${manifestId}`), 'muestra el manifiesto compartido candidato')
  assert.ok(plan.conflicts.some(conflict => conflict.path === `shipments/${secondId}` && /procedencia/.test(conflict.reason)))
})

test('dependencias de cobro enlazadas a movimientos y caja quedan protegidas', async () => {
  const tag = suffix(); const shipmentId = `PUN-CASH-${tag}`
  const shipment = { id: shipmentId, trackingCode: shipmentId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'paid', cashShiftId: `shift-${tag}`, financialMovementId: `movement-${tag}` }
  await db.collection('shipments').doc(shipmentId).set(shipment); await registerSyntheticTestRecord(db, 'shipments', shipmentId, shipment, `suite-${tag}`)
  await db.collection('cash_shifts').doc(`shift-${tag}`).set({ branchId: 'punata', status: 'closed', expectedCashCents: 1000 })
  await db.collection('financial_movements').doc(`movement-${tag}`).set({ shiftId: `shift-${tag}`, amountCents: 1000, type: 'shipment_income' })
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [shipmentId] }))
  assert.equal(plan.state, 'bloqueado')
  assert.equal(plan.ready, false)
  assert.ok(plan.conflicts.some(conflict => conflict.path === `financial_movements/movement-${tag}`))
  assert.ok(plan.exclusions.some(record => record.path === `cash_shifts/shift-${tag}`), 'también identifica el turno compartido, sin incluirlo')
})

test('afiliado, cuotas, pagos de préstamo, multa, saldos de caja y subdocumentos se muestran protegidos', async () => {
  const tag = suffix(); const memberId = `member-${tag}`; const loanId = `loan-${tag}`; const fineId = `fine-${tag}`; const dueId = `due-${tag}`; const userId = `member-user-${tag}`
  await Promise.all([
    db.collection('union_members').doc(memberId).set({ id: memberId, memberNumber: tag, fullName: 'Fixture', branchId: 'punata', status: 'active' }),
    db.collection('union_dues').doc(dueId).set({ memberId, amountCents: 1200, balanceCents: 400, status: 'partial' }),
    db.collection('union_loans').doc(loanId).set({ memberId, loanNumber: loanId, principalCents: 12000, balanceCents: 8000, status: 'active' }),
    db.collection('union_fines').doc(fineId).set({ memberId, fineNumber: fineId, amountCents: 900, balanceCents: 900, status: 'pending' }),
    db.collection('users').doc(userId).set({ role: 'afiliado', isActive: true, unionMemberId: memberId }),
    db.collection('financial_movements').doc(`movement-due-${tag}`).set({ dueId, memberId, shiftId: `shift-${tag}`, amountCents: 800 }),
    db.collection('financial_movements').doc(`movement-loan-${tag}`).set({ loanId, memberId, shiftId: `shift-${tag}`, amountCents: -12000 }),
    db.collection('financial_movements').doc(`movement-fine-${tag}`).set({ fineId, memberId, shiftId: `shift-${tag}`, amountCents: 900 }),
    db.collection('cash_shifts').doc(`shift-${tag}`).set({ branchId: 'punata', status: 'closed', expectedCashCents: 0 }),
  ])
  await db.collection('union_loans').doc(loanId).collection('installments').doc('001').set({ loanId, sequence: 1, amountCents: 4000, balanceCents: 4000, status: 'pending' })
  await db.collection('union_loans').doc(loanId).collection('payments').doc('payment-1').set({ loanId, receiptNumber: 'R-1', amountCents: 4000, paidAtIso: '2026-02-03' })
  await db.collection('union_fines').doc(fineId).collection('payments').doc('payment-1').set({ fineId, amountCents: 250, paidAtIso: '2026-02-04' })
  await db.collection('union_dues').doc(dueId).collection('payments').doc('payment-1').set({ dueId, memberId, amountCents: 800, paidAtIso: '2026-02-05' })
  const plan = await simulateSupportCleanup.run(request({ categories: ['afiliados'], ids: [memberId] }))
  assert.equal(plan.state, 'bloqueado')
  const paths = new Set(plan.exclusions.map(record => record.path))
  for (const path of [`users/${userId}`, `union_dues/${dueId}`, `union_dues/${dueId}/payments/payment-1`, `union_loans/${loanId}`, `union_loans/${loanId}/installments/001`, `union_loans/${loanId}/payments/payment-1`, `union_fines/${fineId}`, `union_fines/${fineId}/payments/payment-1`, `financial_movements/movement-loan-${tag}`, `cash_shifts/shift-${tag}`]) assert.ok(paths.has(path), `${path} visible in protected dependency preview`)
  assert.equal(plan.records.length, 0)
})

test('pasaje detecta validaciones, cobro y turno; no ofrece una eliminación financiera', async () => {
  const tag = suffix(); const ticketId = `PJE-${tag.replace(/[^A-F0-9]/gi, '').toUpperCase().padEnd(20, 'A').slice(0, 20)}`; const opNumber = `PAS-${tag}`
  await db.collection('passenger_ticket_operations').doc(ticketId).set({ id: ticketId, ticketCode: ticketId, operationNumber: opNumber, paymentStatus: 'paid_verified', paymentShiftId: `ticket-shift-${tag}`, paymentMovementId: `ticket-move-${tag}`, branchId: 'punata' })
  await db.collection('passenger_ticket_validations').doc(`validation-${tag}`).set({ id: `validation-${tag}`, operationId: ticketId, ticketCode: ticketId })
  await db.collection('financial_movements').doc(`ticket-move-${tag}`).set({ shiftId: `ticket-shift-${tag}`, amountCents: 2400 })
  await db.collection('cash_shifts').doc(`ticket-shift-${tag}`).set({ branchId: 'punata', status: 'closed', expectedCashCents: 2400 })
  const plan = await simulateSupportCleanup.run(request({ categories: ['pasajes'], ids: [ticketId], dependencyType: 'financiera' }))
  assert.equal(plan.state, 'bloqueado')
  const paths = new Set([...plan.exclusions.map(record => record.path), ...plan.conflicts.map(conflict => conflict.path)])
  for (const path of [`passenger_ticket_validations/validation-${tag}`, `financial_movements/ticket-move-${tag}`, `cash_shifts/ticket-shift-${tag}`]) assert.ok(paths.has(path), `${path} detected`)
})

test('mutación posterior al plan invalida la ejecución; exige ID, huella y segundo factor reciente', async () => {
  const tag = suffix(); const shipmentId = `PUN-STALE-${tag}`
  const record = { id: shipmentId, trackingCode: shipmentId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending' }
  const ref = db.collection('shipments').doc(shipmentId)
  await ref.set(record); await registerSyntheticTestRecord(db, 'shipments', shipmentId, record, `suite-${tag}`)
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: [shipmentId] }))
  const operationId = `cleanup-${tag}`
  const data = { planId: plan.planId, digest: plan.digest, operationId, confirmation: `LIMPIAR ${plan.planId}` }
  await assert.rejects(() => executeSupportCleanup.run({ auth: { uid, token: { auth_time: 1 } }, data }), { code: 'failed-precondition' })
  await ref.update({ destinationBranchId: 'punata' })
  await assert.rejects(() => executeSupportCleanup.run({ auth, data }), { code: 'aborted' })
  assert.equal((await ref.get()).exists, true)
  const saved = await db.collection('support_cleanup_plans').doc(plan.planId).get()
  assert.equal(saved.data().state, 'invalidado')
  const prev = process.env.FUNCTIONS_EMULATOR
  try { process.env.FUNCTIONS_EMULATOR = 'false'; await assert.rejects(() => executeSupportCleanup.run({ auth: { uid, token: { ...auth.token, firebase: { sign_in_second_factor: 'phone' } } }, data }), { code: 'unauthenticated' }) }
  finally { process.env.FUNCTIONS_EMULATOR = prev }
})

test('respaldo íntegro, limpieza idempotente por lotes y restauración sin sobrescritura', async () => {
  const tag = suffix(); const docs = []
  for (let index = 0; index < 151; index++) {
    const id = `PUN-BATCH-${tag}-${String(index).padStart(3, '0')}`
    const data = { id, trackingCode: id, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', createdAtIso: '2026-02-03T10:00:00.000Z' }
    const ref = db.collection('shipments').doc(id); await ref.set(data); await registerSyntheticTestRecord(db, 'shipments', id, data, `batch-${tag}`); docs.push({ id, ref, data })
  }
  const plan = await simulateSupportCleanup.run(request({ categories: ['encomiendas'], ids: docs.map(doc => doc.id) }))
  assert.equal(plan.records.length, 151)
  const operationId = `batch-${tag}`
  const data = { planId: plan.planId, digest: plan.digest, operationId, confirmation: `LIMPIAR ${plan.planId}` }
  const result = await executeSupportCleanup.run({ auth, data })
  assert.equal(result.state, 'completada'); assert.equal(result.count, 151)
  assert.equal((await Promise.all(docs.map(doc => doc.ref.get()))).filter(doc => doc.exists).length, 0)
  const backup = await db.collection('support_cleanup_backups').doc(operationId).collection('records').get()
  assert.equal(backup.size, 151)
  const operation = await db.collection('support_cleanup_operations').doc(operationId).get()
  assert.equal(operation.data().processed, 151)
  assert.deepEqual(await executeSupportCleanup.run({ auth, data }), result)
  await db.collection('shipments').doc(docs[0].id).set({ colliding: true })
  await assert.rejects(() => restoreSupportCleanup.run({ auth, data: { operationId, confirmation: `RESTAURAR ${operationId}` } }), { code: 'already-exists' })
  assert.deepEqual((await db.collection('shipments').doc(docs[0].id).get()).data(), { colliding: true })
  await db.collection('shipments').doc(docs[0].id).delete()
  const restoreRequest = { auth, data: { operationId, confirmation: `RESTAURAR ${operationId}` } }
  const concurrentRestores = await Promise.all([restoreSupportCleanup.run(restoreRequest), restoreSupportCleanup.run(restoreRequest)])
  const restored = concurrentRestores.find(result => result.state === 'restaurada') || concurrentRestores[0]
  assert.equal(restored.count, 151)
  assert.ok(concurrentRestores.every(result => ['en_ejecucion', 'restaurada'].includes(result.state)))
  assert.deepEqual((await db.collection('shipments').doc(docs[0].id).get()).data(), docs[0].data)
  assert.deepEqual(await restoreSupportCleanup.run({ auth, data: { operationId, confirmation: `RESTAURAR ${operationId}` } }), restored)
  assert.equal((await listSupportCleanupOperations.run(request({}))).operations[0].operationId, operationId)
})
