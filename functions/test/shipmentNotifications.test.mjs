import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createShipment, updateShipment, listShipmentNotifications, markShipmentNotificationRead, confirmShipmentDeparture } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.GCLOUD_PROJECT ||= 'demo-expreso-punata-shipment-notifications-test'
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

async function makeUser(uid, role, branchId) {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId: branchId, allowedBranchIds: [branchId], fullName: `Operador ${uid}`, isActive: true })
}

test('Avisos entre agencias: creación atómica, acceso por destino, lectura, idempotencia y traslado', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const originUid = `notice-origin-${suffix}`
  const destinationUid = `notice-destination-${suffix}`
  const deniedUid = `notice-denied-${suffix}`
  const driverUid = `notice-driver-${suffix}`
  const vehicleId = `notice-vehicle-${suffix}`
  await Promise.all([
    makeUser(originUid, 'secretaria', 'punata'),
    makeUser(destinationUid, 'secretaria', 'cochabamba'),
    makeUser(deniedUid, 'secretaria', 'punata'),
    makeUser(driverUid, 'conductor', 'punata'),
  ])
  await db.collection('vehicles').doc(vehicleId).set({ id: vehicleId, branchId: 'punata', status: 'active', plate: 'TEST-NOTICE', mobileNumber: `NT${suffix.slice(-6)}` })

  const idempotencyKey = `notice-create-${suffix}`
  const payload = {
    originBranchId: 'punata', destinationBranchId: 'cochabamba', deliveryType: 'agency',
    sender: { name: 'Remitente Ficticio', phone: '+1 202 555 0123' },
    recipient: { name: 'Destinataria Ficticia', phone: '71234567' },
    items: [{ description: 'Sobre de prueba', quantity: 1, weightKg: 0.1, packaging: 'sobre' }],
    paymentTiming: 'destination_cod', paymentMethod: 'cash', prohibitedGoodsNoticeAccepted: true, idempotencyKey,
  }
  const attempts = await Promise.all([
    createShipment.run({ auth: { uid: originUid }, data: payload }),
    createShipment.run({ auth: { uid: originUid }, data: payload }),
  ])
  const created = attempts.find((result) => !result.isDuplicate)
  assert.ok(created, 'una solicitud crea la guía confirmada')
  assert.equal(attempts.filter((result) => result.isDuplicate).length, 1)
  const trackingCode = created.trackingCode
  const notificationRef = db.collection('shipment_notifications').doc(trackingCode)
  const createdNotification = await notificationRef.get()
  assert.equal(createdNotification.exists, true, 'el aviso se escribe en la transacción de creación')
  assert.equal(createdNotification.data().eventType, 'shipment_registered')
  assert.equal(createdNotification.data().status, 'received', 'el aviso no espera despacho')
  assert.deepEqual(createdNotification.data().readByUids, [])
  assert.equal(Object.hasOwn(createdNotification.data(), 'sender'), false, 'el aviso no copia datos personales')

  const destinationList = await listShipmentNotifications.run({ auth: { uid: destinationUid }, data: { branchId: 'cochabamba' } })
  assert.equal(destinationList.notifications.some((notice) => notice.id === trackingCode && !notice.isReadByCurrentUser), true)
  const originList = await listShipmentNotifications.run({ auth: { uid: originUid }, data: { branchId: 'punata' } })
  assert.equal(originList.notifications.some((notice) => notice.id === trackingCode), false, 'la agencia de origen no recibe su aviso de destino')
  await assert.rejects(() => listShipmentNotifications.run({ auth: { uid: deniedUid }, data: { branchId: 'cochabamba' } }), (error) => error.code === 'permission-denied')

  const readResult = await markShipmentNotificationRead.run({ auth: { uid: destinationUid }, data: { notificationId: trackingCode, branchId: 'cochabamba' } })
  assert.equal(readResult.isRead, true)
  assert.equal((await listShipmentNotifications.run({ auth: { uid: destinationUid }, data: { branchId: 'cochabamba' } })).notifications.find((notice) => notice.id === trackingCode).isReadByCurrentUser, true)
  await assert.rejects(() => markShipmentNotificationRead.run({ auth: { uid: originUid }, data: { notificationId: trackingCode, branchId: 'cochabamba' } }), (error) => error.code === 'permission-denied')

  const replay = await createShipment.run({ auth: { uid: originUid }, data: payload })
  assert.equal(replay.isDuplicate, true)
  assert.equal((await db.collection('shipment_notifications').where('trackingCode', '==', trackingCode).get()).size, 1)

  await updateShipment.run({ auth: { uid: originUid }, data: { trackingCode, handlingNotes: 'Actualización ficticia de prueba' } })
  assert.equal((await db.collection('shipment_notifications').where('trackingCode', '==', trackingCode).get()).size, 1, 'editar la guía no duplica el aviso')

  const failedKey = `notice-failed-${suffix}`
  const notificationsBeforeFailure = await db.collection('shipment_notifications').where('destinationBranchId', '==', 'cochabamba').get()
  await assert.rejects(() => createShipment.run({ auth: { uid: originUid }, data: { ...payload, idempotencyKey: failedKey, prohibitedGoodsNoticeAccepted: false } }))
  const notificationsAfterFailure = await db.collection('shipment_notifications').where('destinationBranchId', '==', 'cochabamba').get()
  assert.equal(notificationsAfterFailure.size, notificationsBeforeFailure.size, 'un alta fallida no deja aviso huérfano')

  process.env.SIMPLE_SHIPMENT_TRANSFER = 'true'
  await confirmShipmentDeparture.run({ auth: { uid: originUid }, data: { shipmentId: trackingCode, originBranchId: 'punata', destinationBranchId: 'cochabamba', vehicleId, driverUid } })
  assert.equal((await db.collection('shipment_notifications').where('trackingCode', '==', trackingCode).get()).size, 1, 'el traslado por guía conserva un solo aviso de registro')
  assert.equal((await db.collection('shipments').doc(trackingCode).get()).data().status, 'in_transit')
  const afterDispatch = await listShipmentNotifications.run({ auth: { uid: destinationUid }, data: { branchId: 'cochabamba' } })
  assert.equal(afterDispatch.notifications.find((notice) => notice.id === trackingCode).status, 'in_transit', 'la consulta muestra el estado vigente de la guía')
})
