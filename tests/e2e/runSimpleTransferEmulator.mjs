import assert from 'node:assert/strict'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const project = 'demo-expreso-punata-transfer'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/)
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):9099$/)
const db = getFirestore(initializeApp({ projectId: project }))
const signatureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzUAAIpCA/54h55cAAAAAElFTkSuQmCC'
const nonce = Date.now()

async function operator(label, role, primaryBranchId, allowedBranchIds = [primaryBranchId]) {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: label + nonce + '@example.test', password: 'demo-password', returnSecureToken: true }),
  })
  const { localId: uid, idToken } = await res.json()
  assert(uid && idToken)
  await db.collection('users').doc(uid).set({ uid, fullName: label, role, isActive: true, primaryBranchId, allowedBranchIds })
  return { uid, idToken }
}

async function call(name, user, data) {
  const response = await fetch('http://127.0.0.1:5001/' + project + '/us-central1/' + name, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user.idToken },
    body: JSON.stringify({ data }),
  })
  const body = await response.json()
  if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.status })
  assert(response.ok)
  return body.result
}

const origin = await operator('punata', 'secretaria', 'punata')
const destination = await operator('cochabamba', 'secretaria', 'cochabamba')
const driver = await operator('conductor', 'conductor', 'punata')
const manager = await operator('encargado', 'encargado_agencia', 'punata')
const admin = await operator('admin', 'directiva_admin', 'punata', ['punata', 'cochabamba'])
const vehicleId = 'vehicle-' + nonce
await db.collection('vehicles').doc(vehicleId).set({ status: 'active', branchId: 'punata', plate: 'DEMO', mobileNumber: '01' })
const originShift = (await call('openCashShift', origin, { branchId: 'punata', initialCashCents: 10000, idempotencyKey: 'origin-' + nonce })).shift.id
const destinationShift = (await call('openCashShift', destination, { branchId: 'cochabamba', initialCashCents: 5000, idempotencyKey: 'destination-' + nonce })).shift.id

for (const paymentTiming of ['origin_paid', 'destination_cod']) {
  const { shipment } = await call('createShipment', origin, {
    originBranchId: 'punata', destinationBranchId: 'cochabamba',
    sender: { name: 'Remitente Demo', phone: '71000001' }, recipient: { name: 'Destinataria Demo', phone: '72000002' },
    items: [{ description: 'Caja de prueba', quantity: 1, packaging: 'caja', weightKg: 2 }],
    paymentTiming, paymentMethod: 'cash', cashShiftId: originShift,
    prohibitedGoodsNoticeAccepted: true, idempotencyKey: paymentTiming + nonce,
  })
  const shipmentId = shipment.id
  const isPaid = paymentTiming === 'origin_paid'
  assert.equal(shipment.paymentStatus, isPaid ? 'paid' : 'pending')
  const departure = { shipmentId, originBranchId: 'punata', destinationBranchId: 'cochabamba', vehicleId, driverUid: driver.uid }
  const vehicleRef = db.collection('vehicles').doc(vehicleId)
  await vehicleRef.update({ branchId: 'cochabamba' })
  await assert.rejects(call('confirmShipmentDeparture', manager, departure), { code: 'FAILED_PRECONDITION' })
  await vehicleRef.update({ branchId: 'punata' })
  const driverRef = db.collection('users').doc(driver.uid)
  await driverRef.update({ isActive: false })
  await assert.rejects(call('confirmShipmentDeparture', manager, departure), { code: 'FAILED_PRECONDITION' })
  await driverRef.update({ isActive: true })
  const cancelledId = shipmentId + '-cancelled'
  await db.collection('shipments').doc(cancelledId).set({
    status: 'cancelled', originBranchId: 'punata', destinationBranchId: 'cochabamba',
  })
  await assert.rejects(call('confirmShipmentDeparture', manager, { ...departure, shipmentId: cancelledId }), { code: 'FAILED_PRECONDITION' })
  // Descarta la respuesta de salida y vuelve a consultar, como después de un resultado incierto.
  await call('confirmShipmentDeparture', manager, departure)
  const { manifestId } = (await db.collection('shipments').doc(shipmentId).get()).data()
  assert(manifestId)
  await assert.rejects(call('confirmShipmentDeparture', origin, departure), { code: 'FAILED_PRECONDITION' })
  const reception = { shipmentId, manifestId, receivedPackages: 1, condition: 'good' }
  await assert.rejects(call('confirmShipmentReception', destination, reception), { code: 'FAILED_PRECONDITION' })
  await call('driverConfirmCustody', driver, { manifestId })
  await assert.rejects(call('confirmShipmentReception', origin, reception), { code: 'PERMISSION_DENIED' })
  await call('confirmShipmentReception', admin, reception)
  await assert.rejects(call('confirmShipmentReception', destination, reception), { code: 'FAILED_PRECONDITION' })
  const delivery = { shipmentId, receivedByName: 'Destinataria Demo', receivedByDocType: 'CI',
    receivedByDocNumber: '1234567', recipientRelationship: 'titular', signatureDataUrl, paymentMethod: 'cash' }
  const attempts = await Promise.allSettled([call('deliverShipment', destination, delivery), call('deliverShipment', destination, delivery)])
  const successes = attempts.filter(result => result.status === 'fulfilled')
  assert.equal(successes.length, 1, JSON.stringify(attempts.map(r => r.status === 'rejected' ? r.reason.message : r.status)))
  assert.equal(successes[0].value.paymentCollected, !isPaid)
  const saved = (await db.collection('shipments').doc(shipmentId).get()).data()
  await assert.rejects(call('confirmShipmentReception', admin, reception), { code: 'FAILED_PRECONDITION' })
  assert.equal(saved.status, 'delivered')
  assert.equal(saved.paymentStatus, 'paid')
  assert(saved.deliveryRecord.signature)
  assert(saved.auditHistory.some(e => e.action === 'confirm_shipment_departure'))
  assert(saved.auditHistory.some(e => e.action === 'confirm_shipment_reception'))
  if (!isPaid) {
    const shift = (await db.collection('cash_shifts').doc(destinationShift).get()).data()
    assert.equal(shift.breakdown.codIncomeCents, shipment.finalAmountCents)
  }
  console.log('Flujo HTTP verificado:', paymentTiming, shipmentId)
}
