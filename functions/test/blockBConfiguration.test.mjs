import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { localBusinessDay } from '../commercialSettings.js'
import {
  accrueDriverCommission, createShipment, getSystemConfig, openCashShift, createUnionLoan, createUnionSportsEvent, setUnionSportsAttendance,
  getCommercialSettings, updateCommercialSettings, getSupportConfiguration, updateSupportConfiguration,
} from '../index.js'

test('configuración institucional versiona, resuelve concurrencia y restaura datos visibles en operación', async () => {
  const db = getFirestore()
  const config = db.collection('system_config').doc('expreso_punata')
  const support = { uid: 'block-b-technical', token: { auth_time: Date.now() / 1000 } }
  await Promise.all([
    config.set({ isOfficial: true, status: 'configured', branches: { punata: { code: 'PUN', name: 'Punata inicial' } } }),
    db.collection('users').doc(support.uid).set({ role: 'soporte_pachax', isActive: true }),
    db.collection('users').doc('block-b-operator').set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] }),
  ])
  const data = { field: 'punataName', expectedVersion: 0, expectedValue: 'Punata inicial', value: 'Punata actualizada', reason: 'Solicitud institucional sintética', confirmation: true }
  const updates = await Promise.allSettled([updateSupportConfiguration.run({ auth: support, data }), updateSupportConfiguration.run({ auth: support, data })])
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(updates.find(result => result.status === 'rejected').reason.code, 'aborted')
  const visible = () => getSystemConfig.run({ auth: { uid: 'block-b-operator' }, data: {} })
  assert.equal((await visible()).config.branches.punata.name, 'Punata actualizada')
  const settings = await getSupportConfiguration.run({ auth: support })
  const saved = settings.history.find(entry => entry.field === 'punataName')
  assert.equal(saved.previous, 'Punata inicial')
  await updateSupportConfiguration.run({ auth: support, data: { ...data, expectedValue: data.value, expectedVersion: 1, restoreHistoryId: saved.id } })
  assert.equal((await visible()).config.branches.punata.name, 'Punata inicial')
  assert.equal((await config.get()).data().branches.punata.code, 'PUN')
  await updateSupportConfiguration.run({ auth: support, data: { ...data, field: 'reportDatePreset', expectedVersion: 0, expectedValue: '', value: 'today' } })
  assert.equal((await visible()).config.reportPreferences.datePreset, 'today')

})

test('tarifas y comisiones publicadas operan con vigencia, autorización y preservación histórica', async t => {
  const db = getFirestore()
  const config = db.collection('system_config').doc('expreso_punata')
  const suffix = randomUUID()
  const now = Date.now()
  const today = localBusinessDay(now)
  const tomorrow = localBusinessDay(now + 86400000)
  const first = 'block-b-admin-first'
  const second = 'block-b-admin-second'
  const driver = 'block-b-driver'
  const support = 'block-b-technical'
  const pricingFlag = process.env.ENABLE_AUTOMATIC_PARCEL_PRICING
  process.env.ENABLE_AUTOMATIC_PARCEL_PRICING = 'true'
  t.after(async () => {
    if (pricingFlag === undefined) delete process.env.ENABLE_AUTOMATIC_PARCEL_PRICING
    else process.env.ENABLE_AUTOMATIC_PARCEL_PRICING = pricingFlag
    for (const key of ['commission', 'punata-cochabamba', 'loan', 'sports']) await db.recursiveDelete(db.collection('commercial_settings').doc(key))
  })
  await config.set({ isOfficial: true, status: 'configured', tariffs: { baseFeeCents: 1000, freeWeightKg: 2, extraKgRateCents: 0, homeDeliveryFeeCents: 0 } })
  for (const [uid, role] of [[first, 'afiliado_admin'], [second, 'afiliado_admin'], [support, 'soporte_pachax'], [driver, 'conductor'], ['block-b-operator', 'secretaria'], ['block-b-affiliate', 'afiliado']]) {
    await db.collection('users').doc(uid).set({ uid, role, isActive: true, fullName: uid, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], commissionAdministrationApproved: true })
  }
  const auth = uid => ({ uid, token: { auth_time: Date.now() / 1000 } })
  const route = 'punata-cochabamba'
  const write = (key, rule, expectedVersion, uid = first, action = 'publish', extra = {}) => updateCommercialSettings.run({
    auth: auth(uid), data: { key, rule, expectedVersion, action, reason: 'Aprobación comercial sintética', confirmation: true, ...extra },
  })
  const tariff = { effectiveFrom: today, enabled: true, baseFeeCents: 2500, freeWeightKg: 2, extraKgRateCents: 0, homeDeliveryFeeCents: 0 }
  for (const uid of [support, 'block-b-operator', 'block-b-affiliate']) await assert.rejects(write(route, tariff, 0, uid), { code: 'permission-denied' })
  const race = await Promise.allSettled([write(route, tariff, 0), write(route, tariff, 0, second)])
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(race.find(result => result.status === 'rejected').reason.code, 'aborted')
  const shift = await openCashShift.run({ auth: auth(first), data: { branchId: 'punata', initialCashCents: 1000 } })
  const makeShipment = id => createShipment.run({ auth: auth(first), data: {
    originBranchId: 'punata', destinationBranchId: 'cochabamba', deliveryType: 'agency',
    sender: { name: 'Remitente de prueba', phone: '70000000' }, recipient: { name: 'Destino de prueba', phone: '70000001' },
    items: [{ description: 'Encomienda sintética', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid', paymentMethod: 'cash', cashShiftId: shift.shift.id,
    prohibitedGoodsNoticeAccepted: true, pricingMode: 'automatic', idempotencyKey: `block-b-${suffix}-${id}`,
  } })
  const shipment = await makeShipment('initial')
  assert.equal(shipment.shipment.finalAmountCents, 2500)
  await write(route, { ...tariff, baseFeeCents: 3000, effectiveFrom: tomorrow }, 1)
  assert.equal((await makeShipment('future')).shipment.finalAmountCents, 2500)
  const stored = db.collection('shipments').doc(shipment.shipment.id || shipment.shipment.trackingCode)
  assert.equal((await stored.get()).data().finalAmountCents, 2500)
  await write(route, { effectiveFrom: today }, 2, first, 'restore', { restoreVersion: 1 })
  const settings = await getCommercialSettings.run({ auth: auth(first) })
  assert.equal(settings.items.find(item => item.key === route).history[0].restoredFrom, 1)

  const fixed = { effectiveFrom: today, enabled: true, type: 'fixed_per_shipment', value: 3 }
  const percentage = { effectiveFrom: today, enabled: true, type: 'percentage', value: 12 }
  await assert.rejects(write('commission', percentage, 0), /Base/)
  await write('commission', fixed, 0)
  async function prepare(id, freight) {
    const shipmentId = `block-b-commission-${suffix}-${id}`
    const manifestId = `block-b-manifest-${suffix}-${id}`
    await db.collection('shipments').doc(shipmentId).set({ status: 'delivered', manifestId, originBranchId: 'punata', shippingFeeCents: freight, createdAtIso: new Date(now).toISOString() })
    await db.collection('manifests').doc(manifestId).set({ status: 'received', driverUid: driver, shipmentIds: [shipmentId], originBranchId: 'punata' })
    return () => accrueDriverCommission.run({ auth: auth(first), data: { shipmentId, manifestId } })
  }
  const accrueFixed = await prepare('fixed', null)
  const fixedRecord = await accrueFixed()
  assert.equal(fixedRecord.commissionAmountCents, 300)
  await write('commission', { ...percentage, base: 'shippingFeeCents' }, 1)
  const accruePercentage = await prepare('percentage', 2500)
  assert.equal((await accruePercentage()).commissionAmountCents, 300)
  const accrueManual = await prepare('manual', null)
  await assert.rejects(accrueManual, /flete autorizada/)
  assert.equal((await accrueFixed()).recordId, fixedRecord.recordId)
  assert.equal((await db.collection('driver_commission_records').doc(fixedRecord.recordId).get()).data().commercialVersion, 1)
  const memberId = `block-b-member-${suffix}`
  await db.collection('union_members').doc(memberId).set({ fullName: 'Afiliado sintético', branchId: 'punata', status: 'active' })
  await write('loan', { effectiveFrom: today, enabled: true, maxInstallments: 6, maxPrincipalCents: 10000 }, 0)
  const loanRequest = { auth: auth(first), data: { memberId, principalCents: 5000, installmentCount: 7, firstDueDate: tomorrow } }
  await assert.rejects(createUnionLoan.run(loanRequest), /máximo autorizado es 6/)
  const loan = await createUnionLoan.run({ ...loanRequest, data: { ...loanRequest.data, installmentCount: 5 } })
  assert.equal(loan.loan.commercialVersion, 1)
  await write('sports', { effectiveFrom: today, enabled: true, lateFineCents: 1111, absentFineCents: 2222 }, 0)
  const { eventId } = await createUnionSportsEvent.run({ auth: auth(first), data: {
    date: today, scheduledTime: '10:30', activityName: 'Jornada sintética', memberIds: [memberId], idempotencyKey: `sports-${suffix}`,
  } })
  await write('sports', { effectiveFrom: today, enabled: true, lateFineCents: 3333, absentFineCents: 4444 }, 1)
  const { fineId } = await setUnionSportsAttendance.run({ auth: auth(first), data: {
    eventId, memberId, attendance: 'late', reason: 'Prueba dirigida', idempotencyKey: `attendance-${suffix}`,
  } })
  assert.equal((await db.collection('union_fines').doc(fineId).get()).data().amountCents, 1111)

})
