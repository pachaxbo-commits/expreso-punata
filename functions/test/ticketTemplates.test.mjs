import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import { getShipmentTicketTemplate, saveShipmentTicketTemplate } from '../index.js'

const db = getFirestore()
const uid = `ticket-template-${process.pid}`
const auth = { uid, token: { auth_time: Math.floor(Date.now() / 1000) } }
const request = data => ({ auth, data })

beforeEach(async () => {
  await db.collection('users').doc(uid).delete().catch(() => {})
  const audits = await db.collection('audit_logs').where('uid', '==', uid).get()
  for (const doc of audits.docs) await doc.ref.delete()
  await db.recursiveDelete(db.doc('ticket_templates/shipment_guide'))
  await db.collection('users').doc(uid).set({ role: 'directiva_admin', isActive: true })
})

const template = () => ({
  documentType: 'shipment_guide', version: 0, paperFormat: '80mm', marginsMm: 2,
  fontSize: 'normal', separator: 'dashed', spacing: 'normal', secondCopyEnabled: false,
  betweenCopies: 'page_break',
  customer: { visibleFields: ['sender', 'createdAt', 'destination', '<script>'], order: ['sender', 'createdAt', 'destination'], fieldStyles: {}, headerText: '<script>header()</script>', footerText: '' },
  agency: { visibleFields: ['recipient'], order: ['recipient'], fieldStyles: {}, headerText: '', footerText: '' },
})

test('versioned template save, allowlist, audit, conflict protection, and restore', async () => {
  const saved = await saveShipmentTicketTemplate.run(request({ template: template(), expectedVersion: 0 }))
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.template.customer.visibleFields, ['sender', 'createdAt', 'destination'])
  assert.equal(saved.template.customer.headerText, '<script>header()</script>')
  assert.equal((await db.collection('audit_logs').where('uid', '==', uid).get()).size, 1)

  await assert.rejects(() => saveShipmentTicketTemplate.run(request({ template: template(), expectedVersion: 0 })), { code: 'aborted' })
  const changed = template()
  changed.paperFormat = '58mm'
  const second = await saveShipmentTicketTemplate.run(request({ template: changed, expectedVersion: 1 }))
  const restored = await saveShipmentTicketTemplate.run(request({ action: 'restore', expectedVersion: 2, restoreVersion: 1 }))
  assert.equal(second.version, 2)
  assert.equal(restored.version, 3)
  assert.equal(restored.template.paperFormat, '80mm')
  assert.equal((await db.collection('audit_logs').where('uid', '==', uid).get()).size, 3)
})

test('reads require active profile; saves require current authentication and admin role', async () => {
  await assert.rejects(() => getShipmentTicketTemplate.run({ data: {} }), { code: 'unauthenticated' })
  await db.collection('users').doc(uid).update({ isActive: false })
  await assert.rejects(() => getShipmentTicketTemplate.run(request({})), { code: 'permission-denied' })
  await db.collection('users').doc(uid).set({ role: 'secretaria', isActive: true })
  await assert.rejects(() => saveShipmentTicketTemplate.run(request({ template: template(), expectedVersion: 0 })), { code: 'permission-denied' })
  await db.collection('users').doc(uid).set({ role: 'directiva_admin', isActive: true })
  await assert.rejects(() => saveShipmentTicketTemplate.run({ ...request({ template: template(), expectedVersion: 0 }), auth: { uid, token: { auth_time: 1 } } }), { code: 'failed-precondition' })
})
