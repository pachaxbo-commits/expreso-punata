import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { accrueDriverCommission } from '../index.js'

if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-expreso-punata-101' })
const db = getFirestore()
const profile = (uid, role, extra = {}) => ({ uid, role, isActive: true, fullName: `Fixture ${role}`, primaryBranchId: 'punata', allowedBranchIds: ['punata'], ...extra })

async function reset() {
  for (const name of ['users', 'shipments', 'manifests', 'system_config', 'driver_commission_accounts', 'driver_commission_records', 'idempotency_keys', 'audit_logs']) {
    const snap = await db.collection(name).get()
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch()
      snap.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
    }
  }
  for (const [uid, role] of [
    ['board', 'directiva_admin'], ['treasury', 'tesoreria'], ['secretary', 'secretaria'],
    ['manager', 'encargado_agencia'], ['driver', 'conductor'], ['affiliate', 'afiliado'],
    ['other-driver', 'conductor'],
  ]) await db.collection('users').doc(uid).set(profile(uid, role))
  await db.collection('users').doc('inactive-board').set(profile('inactive-board', 'directiva_admin', { isActive: false }))
}

async function seedEvent({ shipmentId = 'shipment-1', manifestId = 'manifest-1', driverUid = 'driver', feeCents = 10_000, status = 'delivered', manifestStatus = 'received' } = {}) {
  await db.collection('system_config').doc('expreso_punata').set({ status: 'configured', isOfficial: true, commissions: { defaultType: 'percentage', defaultValue: 10 } })
  await db.collection('shipments').doc(shipmentId).set({ trackingCode: `T-${shipmentId}`, manifestId, status, shippingFeeCents: feeCents, originBranchId: 'punata' })
  await db.collection('manifests').doc(manifestId).set({ driverUid, shipmentIds: [shipmentId], status: manifestStatus, originBranchId: 'punata' })
}
const req = (uid, data = { shipmentId: 'shipment-1', manifestId: 'manifest-1' }) => ({ auth: uid ? { uid } : undefined, data })
const financeState = async () => ({
  accounts: (await db.collection('driver_commission_accounts').get()).docs.map((d) => [d.id, d.data()]),
  records: (await db.collection('driver_commission_records').get()).docs.map((d) => [d.id, d.data()]),
  audits: (await db.collection('audit_logs').where('action', '==', 'accrue_driver_commission').get()).docs.map((d) => [d.id, d.data()]),
})

beforeEach(reset)

test('accrual rejects unauthenticated, inactive, affiliate, driver and branch-scoped roles without writes', async () => {
  await seedEvent()
  for (const uid of [undefined, 'inactive-board', 'affiliate', 'driver', 'secretary', 'manager', 'treasury']) {
    await assert.rejects(accrueDriverCommission.run(req(uid)), (err) => ['unauthenticated', 'permission-denied'].includes(err.code), `role ${uid}`)
    assert.deepEqual(await financeState(), { accounts: [], records: [], audits: [] })
  }
})

test('accrual rejects missing, mismatched, unassigned and incomplete operation references', async () => {
  await seedEvent()
  for (const data of [
    { shipmentId: 'absent-shipment', manifestId: 'manifest-1' },
    { shipmentId: 'shipment-1', manifestId: 'absent-manifest' },
    { shipmentId: 'shipment-1', manifestId: 'manifest-1', driverUid: 'other-driver' },
  ]) await assert.rejects(accrueDriverCommission.run(req('board', data)))
  await db.collection('manifests').doc('manifest-1').update({ shipmentIds: [] })
  await assert.rejects(accrueDriverCommission.run(req('board')))
  await db.collection('manifests').doc('manifest-1').update({ shipmentIds: ['shipment-1'] })
  await db.collection('shipments').doc('shipment-1').update({ status: 'in_transit' })
  await assert.rejects(accrueDriverCommission.run(req('board')))
  await db.collection('shipments').doc('shipment-1').update({ status: 'delivered', originBranchId: 'cochabamba' })
  await assert.rejects(accrueDriverCommission.run(req('board')), (err) => err.code === 'failed-precondition')
  assert.deepEqual(await financeState(), { accounts: [], records: [], audits: [] })
})

test('accrual rejects client-controlled financial values and nonofficial or invalid rules', async () => {
  await seedEvent()
  await assert.rejects(accrueDriverCommission.run(req('board', { shipmentId: 'shipment-1', manifestId: 'manifest-1', shippingAmountCents: 2_500_000 })), (err) => err.code === 'invalid-argument')
  await assert.rejects(accrueDriverCommission.run(req('board', { shipmentId: 'shipment-1', manifestId: 'manifest-1', ruleValue: 1000 })), (err) => err.code === 'invalid-argument')
  await db.collection('system_config').doc('expreso_punata').delete()
  await assert.rejects(accrueDriverCommission.run(req('board')), (err) => err.code === 'failed-precondition')
  await seedEvent()
  await db.collection('system_config').doc('expreso_punata').update({ isOfficial: false })
  await assert.rejects(accrueDriverCommission.run(req('board')))
  await db.collection('system_config').doc('expreso_punata').set({ status: 'configured', isOfficial: true, commissions: { defaultType: 'percentage', defaultValue: 1000 } })
  await assert.rejects(accrueDriverCommission.run(req('board')))
  assert.deepEqual(await financeState(), { accounts: [], records: [], audits: [] })
})

test('only Directiva Admin can accrue; concurrent retries create one ledger event and audit', async () => {
  await seedEvent({ feeCents: 25_000 })
  const call = () => accrueDriverCommission.run(req('board', { shipmentId: 'shipment-1', manifestId: 'manifest-1', driverUid: 'driver' }))
  const results = await Promise.all([call(), call(), call(), call()])
  assert.ok(results.every((result) => result.recordId === results[0].recordId))
  assert.ok(results.every((result) => result.commissionAmountCents === 2_500))
  const state = await financeState()
  assert.equal(state.records.length, 1)
  assert.equal(state.audits.length, 1)
  assert.equal(state.accounts[0][1].accruedCents, 2_500)
  assert.equal(state.accounts[0][1].pendingCents, 2_500)
  assert.equal(state.records[0][1].baseShippingAmountCents, 25_000)
  assert.equal(state.records[0][1].branchId, undefined, 'no unapproved branch attribution is invented')
  assert.equal(state.audits[0][1].performedByUid, 'board')
  assert.equal(state.audits[0][1].details.shipmentId, 'shipment-1')
  assert.ok(state.audits[0][1].timestamp)

  await seedEvent({ shipmentId: 'shipment-2', manifestId: 'manifest-2' })
  const boardResult = await accrueDriverCommission.run(req('board', { shipmentId: 'shipment-2', manifestId: 'manifest-2' }))
  assert.equal(boardResult.commissionAmountCents, 1_000)
  assert.equal((await db.collection('driver_commission_records').get()).size, 2)
  assert.equal((await db.collection('audit_logs').where('action', '==', 'accrue_driver_commission').get()).size, 2)
})

test('a completed route delivery by the assigned driver remains eligible before manifest reception', async () => {
  await seedEvent({ status: 'delivered', manifestStatus: 'in_transit' })
  await db.collection('shipments').doc('shipment-1').update({
    deliveryRecord: { deliveryChannel: 'route_delivery', deliveredByUid: 'driver' },
  })
  const result = await accrueDriverCommission.run(req('board'))
  assert.equal(result.commissionAmountCents, 1_000)
  const record = (await db.collection('driver_commission_records').doc(result.recordId).get()).data()
  assert.equal(record.driverUid, 'driver')
  assert.equal(record.shipmentId, 'shipment-1')
  assert.equal((await db.collection('audit_logs').where('action', '==', 'accrue_driver_commission').get()).size, 1)
})

test('a prior commission for the same shipment under another manifest is blocked as ambiguous', async () => {
  await seedEvent()
  const first = await accrueDriverCommission.run(req('board'))
  await db.collection('manifests').doc('manifest-2').set({ driverUid: 'driver', shipmentIds: ['shipment-1'], status: 'received' })
  await db.collection('shipments').doc('shipment-1').update({ manifestId: 'manifest-2' })
  await assert.rejects(accrueDriverCommission.run(req('board', { shipmentId: 'shipment-1', manifestId: 'manifest-2' })), (err) => err.code === 'failed-precondition')
  assert.equal((await db.collection('driver_commission_records').get()).size, 1)
  assert.equal((await db.collection('driver_commission_accounts').doc('driver').get()).data().accruedCents, 1_000)
  assert.equal((await db.collection('audit_logs').where('action', '==', 'accrue_driver_commission').get()).size, 1)
  assert.ok(first.recordId)
})

test('fixed commission on manual freight is independent of price and idempotent under retries', async () => {
  await seedEvent({ feeCents: null })
  await db.collection('shipments').doc('shipment-1').update({ finalAmountCents: 0 })
  await assert.rejects(accrueDriverCommission.run(req('board')), { code: 'failed-precondition' })
  assert.deepEqual(await financeState(), { accounts: [], records: [], audits: [] })

  await db.collection('system_config').doc('expreso_punata').update({
    commissions: { defaultType: 'fixed_per_shipment', defaultValue: 2 },
  })
  const results = await Promise.all([accrueDriverCommission.run(req('board')), accrueDriverCommission.run(req('board'))])
  assert.deepEqual(results[0], results[1])
  assert.equal(results[0].commissionAmountCents, 200)
  const state = await financeState()
  assert.equal(state.accounts[0][1].pendingCents, 200)
  assert.equal(state.records.length, 1)
  assert.equal(state.records[0][1].baseShippingAmountCents, null)
  assert.equal(state.audits.length, 1)
})
