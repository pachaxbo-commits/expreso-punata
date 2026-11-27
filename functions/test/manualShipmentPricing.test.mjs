import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createShipment, openCashShift } from '../index.js'

process.env.ENABLE_AUTOMATIC_PARCEL_PRICING = 'false'
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

test('El precio manual es obligatorio, no lee tarifas ni permite activar el cálculo desde la llamada', async () => {
  const suffix = Date.now().toString(36)
  const uid = `manual-pricing-${suffix}`
  const idempotencyKey = `manual-pricing-${suffix}`
  await db.collection('users').doc(uid).set({
    uid, role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'],
    fullName: 'Secretaría de prueba', isActive: true,
  })
  const shift = await openCashShift.run({ auth: { uid }, data: { branchId: 'punata', initialCashCents: 5000 } })
  const basePayload = {
    originBranchId: 'punata', destinationBranchId: 'cochabamba', deliveryType: 'agency',
    sender: { name: 'Remitente de prueba', phone: '70011111' },
    recipient: { name: 'Destinatario de prueba', phone: '70022222' },
    items: [{ description: 'Paquete de prueba', quantity: 1, weightKg: 25 }],
    paymentTiming: 'origin_paid', paymentMethod: 'cash', cashShiftId: shift.shift.id,
    prohibitedGoodsNoticeAccepted: true,
  }

  await assert.rejects(
    () => createShipment.run({ auth: { uid }, data: { ...basePayload, idempotencyKey } }),
    (error) => error.code === 'invalid-argument' && /Ingrese manualmente/.test(error.message),
  )
  await assert.rejects(
    () => createShipment.run({ auth: { uid }, data: { ...basePayload, idempotencyKey: `${idempotencyKey}-negative`, agreedAmountCents: -1 } }),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    () => createShipment.run({ auth: { uid }, data: { ...basePayload, idempotencyKey: `${idempotencyKey}-fraction`, agreedAmountCents: 1234.5 } }),
    (error) => error.code === 'invalid-argument',
  )
  await assert.rejects(
    () => createShipment.run({ auth: { uid }, data: { ...basePayload, idempotencyKey: `${idempotencyKey}-incomplete`, agreedAmountCents: 1234, recipient: { ...basePayload.recipient, name: '' } } }),
    (error) => error.code === 'invalid-argument' && /destinatario/.test(error.message),
  )
  await assert.rejects(
    () => createShipment.run({ auth: { uid }, data: { ...basePayload, originBranchId: 'cochabamba', destinationBranchId: 'punata', idempotencyKey: `${idempotencyKey}-branch`, agreedAmountCents: 1234 } }),
    (error) => error.code === 'permission-denied',
  )
  const deniedUid = `${uid}-unauthorized`
  await db.collection('users').doc(deniedUid).set({
    uid: deniedUid, role: 'tesoreria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true,
  })
  await assert.rejects(
    () => createShipment.run({ auth: { uid: deniedUid }, data: { ...basePayload, idempotencyKey: `${idempotencyKey}-role`, agreedAmountCents: 1234 } }),
    (error) => error.code === 'permission-denied',
  )
  await assert.rejects(
    () => createShipment.run({ auth: { uid }, data: { ...basePayload, idempotencyKey: `${idempotencyKey}-auto`, pricingMode: 'automatic', agreedAmountCents: 1500 } }),
    (error) => error.code === 'failed-precondition',
  )

  const result = await createShipment.run({
    auth: { uid },
    data: { ...basePayload, idempotencyKey: `${idempotencyKey}-manual`, pricingMode: 'manual', agreedAmountCents: 1234 },
  })
  assert.equal(result.success, true)
  assert.equal(result.shipment.finalAmountCents, 1234)
  assert.equal(result.shipment.agreedAmountCents, 1234)
  assert.equal(result.shipment.suggestedAmountCents, null)
  assert.equal(result.shipment.shippingFeeCents, null)
  assert.equal(result.shipment.weightSurchargeCents, null)
  assert.equal(result.shipment.homeDeliveryFeeCents, null)
  const movement = await db.collection('financial_movements').doc(`MOV-${result.trackingCode}`).get()
  assert.equal(movement.data().amountCents, 1234)
  const updatedShift = await db.collection('cash_shifts').doc(shift.shift.id).get()
  assert.equal(updatedShift.data().expectedCashCents, 6234)
})
