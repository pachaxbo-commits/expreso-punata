process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.GCLOUD_PROJECT ||= 'expreso-punata-dev'
process.env.GOOGLE_CLOUD_PROJECT ||= process.env.GCLOUD_PROJECT

const { initializeApp, getApps } = await import('../functions/node_modules/firebase-admin/lib/esm/app/index.js')
const { getFirestore } = await import('../functions/node_modules/firebase-admin/lib/esm/firestore/index.js')
const { assignShipmentStorage } = await import('../functions/index.js')
if (getApps().length === 0) initializeApp({ projectId: 'expreso-punata-dev' })
const db = getFirestore()
const enabled = process.env.STORAGE_PHOTOS_ENABLED === 'true'
const uid = `photo-toggle-${enabled ? 'on' : 'off'}`
const shipmentId = `photo-toggle-shipment-${enabled ? 'on' : 'off'}`
const auth = { uid, token: { email: `${uid}@local.test`, name: 'Prueba local' } }

await db.collection('users').doc(uid).set({ uid, role: 'directiva_admin', branchId: 'punata', primaryBranchId: 'punata', isActive: true })
await db.collection('branches').doc('punata').collection('shelves').doc('MODULO-1').set({ id: 'MODULO-1', name: 'Módulo 1 — Prueba', code: 'MOD-1', branchId: 'punata', moduleCount: 1, floorCount: 2, rowCountPerFloor: 2, spaceCountPerFloor: 10, capacityPerSpace: 1, active: true })
await db.collection('shipments').doc(shipmentId).set({ id: shipmentId, trackingCode: shipmentId, destinationBranchId: 'punata', status: 'received_at_dest', paymentStatus: 'paid', items: [{ description: 'Prueba fotografía' }] })

let result = 'rejected'
let errorCode = null
try {
  await assignShipmentStorage.run({ auth, data: { shipmentId, warehouseId: 'ALMACEN-1', warehouseName: 'Almacén 1', shelfId: 'MODULO-1', shelfName: 'Módulo 1', moduleId: 'MOD-1', moduleNumber: 1, floorNumber: 1, rowNumber: 1, spaceNumber: enabled ? 2 : 1, photo: { storagePath: `shipments/${shipmentId}/storage/test.png`, contentType: 'image/png', sizeBytes: 10 } } })
  result = 'accepted'
} catch (error) {
  errorCode = error.code
}
if (enabled && result !== 'accepted') throw new Error(`La fotografía habilitada fue rechazada: ${errorCode}`)
if (!enabled && result !== 'rejected') throw new Error('La fotografía deshabilitada fue aceptada por el backend.')
console.log(JSON.stringify({ enabled, result, errorCode }))
