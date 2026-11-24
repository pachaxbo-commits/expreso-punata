import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { generateMonthlyDues, getB4Settings, updateB4Settings, manageFixedAsset, manageConsumable, manageWorker } from '../index.js'

const auth = uid => ({ uid, token: { auth_time: Date.now() / 1000 } })
const policy = (amountCents, effectiveFrom) => ({
  concept: 'Aporte ordinario aprobado', amountCents, periodicity: 'monthly', effectiveFrom,
  branchIds: ['punata', 'cochabamba'], category: 'socio_general', enabled: true,
})
const update = (kind, action, value, expectedVersion, uid = 'b4-admin-1', extra = {}) => updateB4Settings.run({
  auth: auth(uid), data: { kind, action, value, expectedVersion, reason: 'Cambio operativo sintético B4', confirmation: true, ...extra },
})

test('B4 políticas de aportes versionan, requieren aprobación y solo afectan nuevas emisiones', async t => {
  const db = getFirestore()
  const settingsRef = db.collection('b4_settings').doc('contributions')
  const dueIds = ['b4-member-punata_2027-01', 'b4-member-cbb_2027-01', 'b4-member-punata_2028-01']
  t.after(async () => {
    await db.recursiveDelete(settingsRef)
    await Promise.all(dueIds.map(id => db.collection('union_dues').doc(id).delete().catch(() => {})))
    await Promise.all(['b4-member-punata', 'b4-member-cbb'].map(id => db.collection('union_members').doc(id).delete().catch(() => {})))
    await Promise.all(['b4-admin-1', 'b4-admin-2', 'b4-support', 'b4-secretary', 'b4-affiliate'].map(id => db.collection('users').doc(id).delete().catch(() => {})))
  })
  for (const [uid, role] of [['b4-admin-1', 'afiliado_admin'], ['b4-admin-2', 'afiliado_admin'], ['b4-support', 'soporte_pachax'], ['b4-secretary', 'secretaria'], ['b4-affiliate', 'afiliado']]) {
    await db.collection('users').doc(uid).set({ uid, role, isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  }
  const defaults = await getB4Settings.run({ auth: auth('b4-admin-1') })
  assert.equal(defaults.items.find(item => item.kind === 'contributions').effective, null)
  const draft = policy(4200, '2027-01-01')
  await assert.rejects(updateB4Settings.run({ auth: { uid: 'b4-admin-1', token: { auth_time: 1 } }, data: { kind: 'contributions', action: 'save', value: draft, expectedVersion: 0, reason: 'Cambio operativo sintético B4', confirmation: true } }), { code: 'failed-precondition' })
  await update('contributions', 'save', draft, 0)
  assert.equal((await settingsRef.get()).data().releases.length, 0, 'guardar borrador no habilita la política')
  for (const uid of ['b4-support', 'b4-secretary', 'b4-affiliate']) {
    await assert.rejects(update('contributions', 'publish', draft, 1, uid), { code: 'permission-denied' })
  }
  const concurrent = await Promise.allSettled([
    update('contributions', 'publish', draft, 1, 'b4-admin-1'),
    update('contributions', 'publish', draft, 1, 'b4-admin-2'),
  ])
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'aborted')
  const published = (await settingsRef.get()).data()
  const publishedVersion = published.version
  assert.equal(published.releases[0].amountCents, 4200)

  await db.collection('union_members').doc('b4-member-punata').set({ memberNumber: 'B4-01', fullName: 'Socio B4 Punata', status: 'active', branchId: 'punata', category: 'socio_general', monthlyFeeCents: 3000 })
  await db.collection('union_members').doc('b4-member-cbb').set({ memberNumber: 'B4-02', fullName: 'Socio B4 CBB', status: 'active', branchId: 'cochabamba', category: 'socio_general', monthlyFeeCents: 3100 })
  await generateMonthlyDues.run({ auth: auth('b4-admin-1'), data: { period: '2027-01' } })
  const historicalRef = db.collection('union_dues').doc('b4-member-punata_2027-01')
  const historicalBefore = (await historicalRef.get()).data()
  assert.equal(historicalBefore.amountCents, 4200)
  assert.equal(historicalBefore.contributionPolicyVersion, publishedVersion)

  const revised = policy(5100, '2028-01-01')
  await update('contributions', 'publish', revised, publishedVersion)
  await generateMonthlyDues.run({ auth: auth('b4-admin-1'), data: { period: '2028-01' } })
  assert.equal((await db.collection('union_dues').doc('b4-member-punata_2028-01').get()).data().amountCents, 5100)
  assert.equal((await historicalRef.get()).data().amountCents, historicalBefore.amountCents, 'la política posterior conserva los importes históricos')
  const retried = await generateMonthlyDues.run({ auth: auth('b4-admin-1'), data: { period: '2027-01' } })
  assert.equal(retried.generatedCount, 0)
  assert.ok(retried.skippedCount >= 2, 'reintentar no duplica ni recalcula cuotas existentes')
  assert.equal((await historicalRef.get()).data().amountCents, historicalBefore.amountCents)

  const view = await getB4Settings.run({ auth: auth('b4-admin-1') })
  const contributionHistory = view.items.find(item => item.kind === 'contributions').history
  await update('contributions', 'restore', null, 3, 'b4-admin-1', { restoreVersion: 2 })
  const restored = (await settingsRef.get()).data()
  assert.equal(restored.draft.amountCents, 4200)
  assert.equal(restored.effective.amountCents, 5100, 'restaurar crea borrador sin revertir lo publicado')
  assert.ok(contributionHistory.length >= 3)
})

test('B4 catálogos, reportes y avisos versionan, restauran y bloquean escrituras sin permiso', async t => {
  const db = getFirestore()
  const ids = ['catalogs', 'reports', 'notifications']
  t.after(async () => {
    await Promise.all(ids.map(id => db.recursiveDelete(db.collection('b4_settings').doc(id))))
    await Promise.all(['b4-config-admin', 'b4-config-support', 'b4-config-secretary', 'b4-config-affiliate'].map(id => db.collection('users').doc(id).delete().catch(() => {})))
  })
  for (const [uid, role] of [['b4-config-admin', 'afiliado_admin'], ['b4-config-support', 'soporte_pachax'], ['b4-config-secretary', 'secretaria'], ['b4-config-affiliate', 'afiliado']]) {
    await db.collection('users').doc(uid).set({ uid, role, isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
  }
  const secretaryView = await getB4Settings.run({ auth: auth('b4-config-secretary') })
  assert.equal(secretaryView.items.find(item => item.kind === 'catalogs').canEdit, false)
  await assert.rejects(getB4Settings.run({ auth: auth('b4-config-affiliate') }), { code: 'permission-denied' })
  const adminSettings = (await getB4Settings.run({ auth: auth('b4-config-admin') })).items
  const catalogs = structuredClone(adminSettings.find(item => item.kind === 'catalogs').value)
  const office = catalogs.fixedAssetCategories.find(option => option.id === 'oficina')
  office.label = 'Material administrativo'
  office.active = false
  await assert.rejects(update('catalogs', 'save', catalogs, 0, 'b4-config-secretary'), { code: 'permission-denied' })
  await update('catalogs', 'save', catalogs, 0, 'b4-config-admin')
  await assert.rejects(update('catalogs', 'save', catalogs, 0, 'b4-config-admin'), { code: 'aborted' })
  const updatedCatalog = (await db.collection('b4_settings').doc('catalogs').get()).data().value.fixedAssetCategories.find(option => option.id === 'oficina')
  assert.deepEqual(updatedCatalog, { id: 'oficina', label: 'Material administrativo', active: false })
  await assert.rejects(manageFixedAsset.run({ auth: auth('b4-config-admin'), data: { name: 'Activo sintético desactivado', category: 'oficina', physicalLocation: 'Oficina Punata', responsiblePersonName: 'Persona sintética' } }), { code: 'failed-precondition' })
  const initialCatalog = (await db.collection('b4_settings').doc('catalogs').get()).data().value
  const disabledConsumable = structuredClone(initialCatalog)
  disabledConsumable.consumableCategories.find(option => option.id === 'other').active = false
  await update('catalogs', 'save', disabledConsumable, 1, 'b4-config-admin')
  await assert.rejects(manageConsumable.run({ auth: auth('b4-config-admin'), data: { action: 'create_item', code: 'B4-TEST', name: 'Insumo sintético', category: 'other', branchId: 'punata' } }), { code: 'failed-precondition' })
  const disabledWorker = structuredClone(disabledConsumable)
  disabledWorker.workerRoles.find(option => option.id === 'limpieza').active = false
  await update('catalogs', 'save', disabledWorker, 2, 'b4-config-admin')
  await assert.rejects(manageWorker.run({ auth: auth('b4-config-admin'), data: { fullName: 'Personal sintético', ci: 'B4-CI-001', phone: '70000001', role: 'limpieza', branchId: 'punata', salaryType: 'monthly', baseSalaryCents: 100 } }), { code: 'failed-precondition' })
  const missing = { ...catalogs, fixedAssetCategories: catalogs.fixedAssetCategories.filter(option => option.id !== 'oficina') }
  await assert.rejects(update('catalogs', 'save', missing, 3, 'b4-config-admin'), { code: 'invalid-argument' })
  const secondCatalog = structuredClone(catalogs)
  secondCatalog.fixedAssetCategories.find(option => option.id === 'oficina').label = 'Nueva categoría de oficina'
  secondCatalog.fixedAssetCategories.find(option => option.id === 'oficina').active = true
  await update('catalogs', 'save', secondCatalog, 3, 'b4-config-admin')
  await update('catalogs', 'restore', null, 4, 'b4-config-admin', { restoreVersion: 1 })
  const restoredOption = (await db.collection('b4_settings').doc('catalogs').get()).data().value.fixedAssetCategories.find(option => option.id === 'oficina')
  assert.equal(restoredOption.active, false)
  assert.equal(restoredOption.label, 'Material administrativo')

  const reports = structuredClone(adminSettings.find(item => item.kind === 'reports').value)
  reports.optionalColumns.members = ['memberNumber']
  reports.order = 'alphabetical'
  await update('reports', 'save', reports, 0, 'b4-config-support')
  let readback = await getB4Settings.run({ auth: auth('b4-config-support') })
  assert.deepEqual(readback.items.find(item => item.kind === 'reports').value.optionalColumns.members, ['memberNumber'])
  const laterReports = structuredClone(reports)
  laterReports.order = 'source'
  laterReports.optionalColumns.members = ['fullName']
  await update('reports', 'save', laterReports, 1, 'b4-config-support')
  await update('reports', 'restore', null, 2, 'b4-config-support', { restoreVersion: 1 })
  readback = await getB4Settings.run({ auth: auth('b4-config-admin') })
  assert.equal(readback.items.find(item => item.kind === 'reports').value.order, 'alphabetical')
  assert.deepEqual(readback.items.find(item => item.kind === 'reports').value.optionalColumns.members, ['memberNumber'])

  const notifications = { shipmentRegisteredVisible: false, unreadShipmentAlertsVisible: false }
  await update('notifications', 'save', notifications, 0, 'b4-config-support')
  await update('notifications', 'save', { shipmentRegisteredVisible: true, unreadShipmentAlertsVisible: false }, 1, 'b4-config-support')
  await update('notifications', 'restore', null, 2, 'b4-config-support', { restoreVersion: 1 })
  readback = await getB4Settings.run({ auth: auth('b4-config-support') })
  assert.deepEqual(readback.items.find(item => item.kind === 'notifications').value, notifications)
})
