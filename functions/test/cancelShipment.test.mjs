import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { cancelShipment } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-cancel-test' })
const db = getFirestore()

beforeEach(async () => {
  for (const collection of ['users', 'shipments', 'audit_logs']) {
    const snap = await db.collection(collection).get()
    const batch = db.batch()
    snap.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
})

const user = { uid: 'sec-1', role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true, fullName: 'Secretaria Test' }
const shipment = { trackingCode: 'PUN202600099', originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', sender: { name: 'A', phone: '70000001' }, recipient: { name: 'B', phone: '70000002' } }

test('anula lógicamente con motivo y conserva auditoría', async () => {
  await db.collection('users').doc(user.uid).set(user)
  await db.collection('shipments').doc(shipment.trackingCode).set(shipment)
  await assert.rejects(() => cancelShipment.run({ auth: { uid: user.uid }, data: { trackingCode: shipment.trackingCode, reason: '' } }), { code: 'invalid-argument' })
  const result = await cancelShipment.run({ auth: { uid: user.uid }, data: { trackingCode: shipment.trackingCode, reason: 'Registro duplicado en ventanilla' } })
  assert.equal(result.status, 'cancelled')
  assert.equal((await db.collection('shipments').doc(shipment.trackingCode).get()).data().status, 'cancelled')
  assert.equal((await db.collection('audit_logs').where('action', '==', 'cancel_shipment').get()).size, 1)
  await assert.rejects(() => cancelShipment.run({ auth: { uid: user.uid }, data: { trackingCode: shipment.trackingCode, reason: 'Segundo intento' } }), { code: 'already-exists' })
})

test('bloquea anulación con pago o después de despacho', async () => {
  await db.collection('users').doc(user.uid).set(user)
  await db.collection('shipments').doc('PAID-0001').set({ ...shipment, trackingCode: 'PAID-0001', paymentStatus: 'paid' })
  await assert.rejects(() => cancelShipment.run({ auth: { uid: user.uid }, data: { trackingCode: 'PAID-0001', reason: 'Corrección contable' } }), { code: 'failed-precondition' })
})
