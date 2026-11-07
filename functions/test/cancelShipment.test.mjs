import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { cancelShipment } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.GCLOUD_PROJECT ||= 'demo-expreso-punata-cancel-test'
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

const createdUserRefs = []
const createdShipmentRefs = []
let fixtureSequence = 0

function nextFixtureId(prefix) {
  fixtureSequence += 1
  return `${prefix}-${Date.now()}-${fixtureSequence}`
}

async function makeFixture({
  user: userOverrides = {},
  shipment: shipmentOverrides = {},
} = {}) {
  const uid = nextFixtureId('cancel-user')
  const trackingCode = nextFixtureId('PUN-CANCEL')
  const user = {
    uid,
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    isActive: true,
    fullName: 'Secretaria de prueba',
    ...userOverrides,
  }
  if (Object.hasOwn(userOverrides, 'isActive') && userOverrides.isActive === undefined) delete user.isActive
  const shipment = {
    trackingCode,
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    status: 'received',
    paymentStatus: 'pending',
    sender: { name: 'Remitente de prueba', phone: '70000001' },
    recipient: { name: 'Destinatario de prueba', phone: '70000002' },
    ...shipmentOverrides,
  }
  const userRef = db.collection('users').doc(uid)
  const shipmentRef = db.collection('shipments').doc(trackingCode)
  createdUserRefs.push(userRef)
  createdShipmentRefs.push(shipmentRef)
  await userRef.set(user)
  await shipmentRef.set(shipment)
  return { uid, user, shipment, shipmentRef }
}

async function cancel(uid, trackingCode, reason = 'Registro duplicado en ventanilla') {
  return cancelShipment.run({
    auth: { uid },
    data: { trackingCode, reason },
  })
}

afterEach(async () => {
  for (const shipmentRef of createdShipmentRefs.splice(0)) {
    const nestedAudit = await shipmentRef.collection('audit_logs').get()
    if (!nestedAudit.empty) {
      const batch = db.batch()
      nestedAudit.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
    }
    await shipmentRef.delete()
    const topLevelAudit = await db.collection('audit_logs')
      .where('trackingCode', '==', shipmentRef.id)
      .get()
    if (!topLevelAudit.empty) {
      const batch = db.batch()
      topLevelAudit.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
    }
  }
  for (const userRef of createdUserRefs.splice(0)) await userRef.delete()
})

test('anula lógicamente una guía elegible y registra auditoría en ambas ubicaciones', async () => {
  const { uid, shipment, shipmentRef } = await makeFixture()
  const result = await cancel(uid, shipment.trackingCode)

  assert.equal(result.status, 'cancelled')
  assert.equal(result.auditEntry.previousStatus, 'received')
  assert.equal(result.auditEntry.newStatus, 'cancelled')

  const saved = (await shipmentRef.get()).data()
  assert.equal(saved.status, 'cancelled')
  assert.equal(saved.cancellationReason, 'Registro duplicado en ventanilla')
  assert.equal(saved.financialMovementId, undefined)

  const topLevelAudit = await db.collection('audit_logs')
    .where('trackingCode', '==', shipment.trackingCode)
    .where('action', '==', 'cancel_shipment')
    .get()
  const nestedAudit = await shipmentRef.collection('audit_logs').get()
  assert.equal(topLevelAudit.size, 1)
  assert.equal(nestedAudit.size, 1)
})

test('rechaza usuarios sin perfil activo o sin rol autorizado', async (t) => {
  await t.test('sin autenticación', async () => {
    await assert.rejects(
      () => cancelShipment.run({ auth: null, data: { trackingCode: 'PUN-CANCEL-1', reason: 'Motivo válido' } }),
      { code: 'unauthenticated' },
    )
  })

  for (const user of [
    { isActive: false },
    { isActive: undefined },
    { role: 'conductor' },
  ]) {
    const { uid, shipment } = await makeFixture({ user })
    await assert.rejects(() => cancel(uid, shipment.trackingCode), { code: 'permission-denied' })
  }
})

test('solo permite cancelar desde la sucursal de origen, como la interfaz', async () => {
  const { uid, shipment } = await makeFixture({
    user: { primaryBranchId: 'cochabamba', allowedBranchIds: ['cochabamba'] },
  })
  await assert.rejects(() => cancel(uid, shipment.trackingCode), { code: 'permission-denied' })
})

test('rechaza guías pagadas, con referencias financieras, despacho, custodia o entrega', async () => {
  const blockedCases = [
    { shipment: { paymentStatus: 'paid' } },
    { shipment: { cashShiftId: 'shift-1' } },
    { shipment: { financialMovementId: 'MOV-PUN-1' } },
    { shipment: { manifestId: 'manifest-1' } },
    { shipment: { assignedVehicle: { manifestId: 'manifest-1' } } },
    { shipment: { driverCustody: { driverUid: 'driver-1' } } },
    { shipment: { deliveryRecord: { receivedByName: 'Destinatario' } } },
    { shipment: { status: 'dispatched' } },
    { shipment: { status: 'stored' } },
  ]

  for (const fixture of blockedCases) {
    const { uid, shipment } = await makeFixture(fixture)
    await assert.rejects(() => cancel(uid, shipment.trackingCode), { code: 'failed-precondition' })
  }
})

test('valida motivo, existencia de la guía y reintentos de anulación', async () => {
  const { uid, shipment } = await makeFixture()
  await assert.rejects(() => cancel(uid, shipment.trackingCode, 'no'), { code: 'invalid-argument' })
  await assert.rejects(() => cancel(uid, 'PUN-CANCEL-MISSING'), { code: 'not-found' })

  await cancel(uid, shipment.trackingCode)
  await assert.rejects(() => cancel(uid, shipment.trackingCode), { code: 'already-exists' })
})

test('dos anulaciones concurrentes producen un único resultado y una única auditoría', async () => {
  const { uid, shipment, shipmentRef } = await makeFixture()
  const results = await Promise.allSettled([
    cancel(uid, shipment.trackingCode),
    cancel(uid, shipment.trackingCode),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'already-exists')
  assert.equal((await shipmentRef.get()).data().status, 'cancelled')
  assert.equal((await shipmentRef.collection('audit_logs').get()).size, 1)
  assert.equal(
    (await db.collection('audit_logs').where('trackingCode', '==', shipment.trackingCode).get()).size,
    1,
  )
})
