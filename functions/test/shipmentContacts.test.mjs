import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { registerShipmentContact } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.GCLOUD_PROJECT ||= 'demo-expreso-punata-contacts-test'
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

before(async () => {
  await db.collection('users').doc('contact-test-sec').set({ uid: 'contact-test-sec', role: 'secretaria', primaryBranchId: 'cochabamba', allowedBranchIds: ['cochabamba'], isActive: true, fullName: 'Secretaria Prueba' })
  await db.collection('shipments').doc('contact-test-shipment').set({ trackingCode: 'CBB-CONTACT-001', originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'uncollected', paymentStatus: 'pending', finalAmountCents: 1500, storageLocation: { branchId: 'cochabamba', shelfId: 'MODULO-1', spaceNumber: 1 }, incidentHistory: [{ incidentNumber: 'INC-TEST-1' }] })
})

after(async () => {
  await db.collection('users').doc('contact-test-sec').delete()
  await db.collection('shipments').doc('contact-test-shipment').delete()
  const contacts = await db.collection('shipment_contacts').where('shipmentId', '==', 'contact-test-shipment').get()
  await Promise.all(contacts.docs.map((doc) => doc.ref.delete()))
})

test('registerShipmentContact registra una gestión idempotente sin alterar la encomienda', async () => {
  const data = { shipmentId: 'contact-test-shipment', method: 'phone', result: 'no_answer', notes: 'Se intentó contactar sin respuesta.', idempotencyKey: 'contact-test-key-1' }
  const first = await registerShipmentContact.run({ auth: { uid: 'contact-test-sec' }, data })
  const second = await registerShipmentContact.run({ auth: { uid: 'contact-test-sec' }, data })
  assert.equal(first.contact.id, second.contact.id)
  assert.equal(first.contact.branchId, 'cochabamba')
  assert.equal(first.contact.performedByName, 'Secretaria Prueba')
  const shipment = (await db.collection('shipments').doc('contact-test-shipment').get()).data()
  assert.equal(shipment.status, 'uncollected')
  assert.equal(shipment.paymentStatus, 'pending')
  assert.equal(shipment.storageLocation.spaceNumber, 1)
  assert.equal(shipment.incidentHistory.length, 1)
  assert.equal((await db.collection('shipment_contacts').where('shipmentId', '==', 'contact-test-shipment').get()).size, 1)
})
