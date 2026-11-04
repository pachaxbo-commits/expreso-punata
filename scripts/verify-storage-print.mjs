import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { manageShelf, assignShipmentStorage } from '../functions/index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.FUNCTIONS_EMULATOR = 'true'
if (getAdminApps().length === 0) initializeAdminApp({ projectId: 'expreso-punata-dev' })
const db = getFirestore()
const uid = 'storage-print-test-runner'
const auth = { uid, token: { email: 'storage-print-test@local.test', name: 'Prueba de Almacén' } }
const stamp = Date.now()
const guide = `PUN-PRINT-${stamp}`

const shelf = (n) => ({
  id: `MODULO-${n}`, name: `Módulo ${n}`, code: `MOD-${n}`, moduleCount: 1,
  floorCount: 3, spaceCountPerFloor: 10, capacityPerSpace: 1,
  physicalWarehouseId: 'ALMACEN-1', physicalWarehouseName: 'Almacén 1', active: true,
})
const shipment = {
  trackingCode: guide, destinationBranchId: 'punata', originBranchId: 'punata',
  status: 'received_at_dest', paymentStatus: 'paid', paymentTiming: 'origin_paid',
  packageCount: 1, totalWeightKg: 1, finalAmountCents: 1000,
  items: [{ description: 'Zapatos deportivos', quantity: 1, weightKg: 1 }],
  sender: { name: 'Remitente Prueba', phone: '70000001' },
  recipient: { name: 'Destinatario Prueba', phone: '70000002' },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}
await db.collection('shipments').doc(guide).set(shipment)
await db.collection('users').doc(uid).set({ uid, email: auth.token.email, fullName: auth.token.name, role: 'directiva_admin', branchId: 'punata', isActive: true })
for (const n of [1, 2]) await manageShelf.run({ auth, data: { action: 'create_or_update', branchId: 'punata', shelfData: shelf(n) } })

const location1 = { warehouseId: 'ALMACEN-1', warehouseName: 'Almacén 1', shelfId: 'MODULO-1', shelfName: 'Módulo 1', moduleId: 'MOD-1', moduleNumber: 1, floorNumber: 2, rowNumber: 2, spaceNumber: 5, position: 'P2-E5' }
await assignShipmentStorage.run({ auth, data: { shipmentId: guide, ...location1, photo: { storagePath: `shipments/${guide}/storage/test.png`, contentType: 'image/png', sizeBytes: 68, uploadedBy: uid, uploadedAt: new Date().toISOString() } } })
const afterAssign = (await db.collection('shipments').doc(guide).get()).data()
const move = { ...location1, shelfId: 'MODULO-2', shelfName: 'Módulo 2', moduleId: 'MOD-2', moduleNumber: 2, floorNumber: 1, rowNumber: 1, spaceNumber: 1, position: 'P1-E1' }
await assignShipmentStorage.run({ auth, data: { shipmentId: guide, ...move } })
const afterMove = (await db.collection('shipments').doc(guide).get()).data()
const moves = await db.collection('shipments').doc(guide).collection('storage_moves').get()
let duplicateError = null
const duplicate = `PUN-PRINT-DUP-${stamp}`
await db.collection('shipments').doc(duplicate).set({ ...shipment, trackingCode: duplicate })
try { await assignShipmentStorage.run({ auth, data: { shipmentId: duplicate, ...move } }) } catch (error) { duplicateError = error.message }
console.log(JSON.stringify({ guide, description: afterMove.items[0].description, initialLocation: afterAssign.storageLocation, finalLocation: afterMove.storageLocation, photo: afterAssign.storagePhoto, storageMoveCount: moves.size, duplicateError }, null, 2))
