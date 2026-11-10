import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { manageFixedAsset, managePhysicalInventoryDocument, listPhysicalInventoryDocuments } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-patrimonial-test' })
const db = getFirestore()

async function createUser(uid, role) {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], fullName: uid, isActive: true })
}

test('Inventario patrimonial: lotes, QR únicos, inmuebles, sedes, trazabilidad y documentos físicos', async () => {
  const suffix = Date.now().toString(36)
  const admin = `patrimonial-admin-${suffix}`
  const denied = `patrimonial-driver-${suffix}`
  await createUser(admin, 'directiva_admin')
  await createUser(denied, 'conductor')

  const oldAssetRef = db.collection('fixed_assets').doc(`legacy-${suffix}`)
  const oldAsset = { id: oldAssetRef.id, assetCode: `LEGACY-${suffix}`, name: 'Activo antiguo', category: 'oficina', branchId: 'punata', physicalLocation: 'Anaquel histórico A-2', status: 'available' }
  await oldAssetRef.set(oldAsset)
  const shelfRef = db.collection('branches').doc('punata').collection('shelves').doc(`untouched-${suffix}`)
  const shelfFixture = { id: shelfRef.id, label: 'Estante de encomiendas de prueba', location: 'Módulo R-4', status: 'active' }
  await shelfRef.set(shelfFixture)

  const batchRequestId = `batch-${suffix}-chairs`
  const payload = { name: 'Silla de oficina', category: 'muebles', description: 'Silla estándar', patrimonialLocationId: 'sede_punata', branchId: 'punata', quantity: 50, acquisitionDate: '2026-10-01', acquisitionCostCents: 125000, batchRequestId }
  const [first, concurrentRetry] = await Promise.all([
    manageFixedAsset.run({ auth: { uid: admin }, data: { ...payload, action: 'create_batch' } }),
    manageFixedAsset.run({ auth: { uid: admin }, data: { ...payload, action: 'create_batch' } }),
  ])
  assert.equal(first.assets.length, 50)
  assert.deepEqual(first.assets.map((asset) => asset.id).sort(), concurrentRetry.assets.map((asset) => asset.id).sort(), 'reintento del lote devuelve los mismos bienes')
  const codes = first.assets.map((asset) => asset.assetCode)
  const qrPayloads = first.assets.map((asset) => asset.qrPayload)
  assert.equal(new Set(codes).size, 50)
  assert.equal(new Set(qrPayloads).size, 50)
  assert.ok(first.assets.every((asset) => asset.patrimonialLocationId === 'sede_punata' && asset.quantityTotal === 50))
  assert.equal(first.assets.reduce((sum, asset) => sum + asset.acquisitionCostCents, 0), 125000, 'valor de grupo no se duplica por cada unidad')
  assert.ok(first.assets.every((asset) => asset.qrPayload === `EXPRESO-PUNATA:ACTIVO:${asset.id}`))

  const transferred = first.assets[0]
  const stableQr = transferred.qrPayload
  await manageFixedAsset.run({ auth: { uid: admin }, data: { id: transferred.id, action: 'update', name: 'Silla identificada', patrimonialLocationId: 'oficina_punata' } })
  const edited = (await db.collection('fixed_assets').doc(transferred.id).get()).data()
  assert.equal(edited.patrimonialLocationId, 'oficina_punata')
  assert.equal(edited.branchId, 'punata', 'cambiar la ubicación patrimonial no altera la sucursal operativa')
  assert.equal(edited.qrPayload, stableQr)
  assert.equal((await db.collection('fixed_assets').doc(transferred.id).get()).id, transferred.id, 'consulta directa por identificador estable')

  const inmueble = await manageFixedAsset.run({ auth: { uid: admin }, data: { action: 'create_batch', name: 'Inmueble Sede Punata', category: 'inmuebles', propertyType: 'Sede', address: 'Punata', patrimonialLocationId: 'sede_punata', quantity: 1, batchRequestId: `estate-${suffix}` } })
  assert.equal(inmueble.assets[0].category, 'inmuebles')
  assert.equal(inmueble.assets[0].propertyType, 'Sede')
  await assert.rejects(() => manageFixedAsset.run({ auth: { uid: admin }, data: { action: 'create_batch', name: 'Lote de inmuebles', category: 'inmuebles', patrimonialLocationId: 'sede_punata', quantity: 2, batchRequestId: `estate-invalid-${suffix}` } }), (error) => error.code === 'invalid-argument')

  const concurrentPayload = (location, key) => ({ action: 'create_batch', name: 'Escritorio', category: 'muebles', patrimonialLocationId: location, quantity: 1, batchRequestId: key })
  const offices = await Promise.all([
    manageFixedAsset.run({ auth: { uid: admin }, data: concurrentPayload('oficina_punata', `office-pnt-${suffix}`) }),
    manageFixedAsset.run({ auth: { uid: admin }, data: concurrentPayload('oficina_cochabamba', `office-cbb-${suffix}`) }),
  ])
  assert.equal(offices[0].assets[0].patrimonialLocationId, 'oficina_punata')
  assert.equal(offices[1].assets[0].patrimonialLocationId, 'oficina_cochabamba')
  assert.equal(offices[0].assets[0].assetCode === offices[1].assets[0].assetCode, false)
  const sameBranchConcurrent = await Promise.all([
    manageFixedAsset.run({ auth: { uid: admin }, data: concurrentPayload('oficina_punata', `same-branch-a-${suffix}`) }),
    manageFixedAsset.run({ auth: { uid: admin }, data: concurrentPayload('sede_punata', `same-branch-b-${suffix}`) }),
  ])
  assert.equal(new Set(sameBranchConcurrent.map((entry) => entry.assets[0].assetCode)).size, 2, 'lotes concurrentes de la misma sucursal reservan códigos distintos')
  await assert.rejects(() => manageFixedAsset.run({ auth: { uid: denied }, data: { ...concurrentPayload('sede_punata', `denied-${suffix}`) } }), (error) => error.code === 'permission-denied')

  const doc = await managePhysicalInventoryDocument.run({ auth: { uid: admin }, data: { action: 'create', title: 'Carpeta de actas', documentType: 'Carpeta', description: 'Actas administrativas', patrimonialLocationId: 'sede_punata', sheetCount: 120, documentDate: '2026-11-01' } })
  assert.equal(doc.document.sheetCount, 120)
  await managePhysicalInventoryDocument.run({ auth: { uid: admin }, data: { action: 'update', id: doc.id, title: 'Carpeta de actas', documentType: 'Carpeta', description: 'Actas administrativas', patrimonialLocationId: 'sede_punata', sheetCount: 121, documentDate: '2026-11-01' } })
  assert.equal((await db.collection('physical_inventory_documents').doc(doc.id).get()).data().sheetCount, 121)
  await assert.rejects(() => managePhysicalInventoryDocument.run({ auth: { uid: admin }, data: { action: 'create', title: 'Libro inválido', documentType: 'Libro', patrimonialLocationId: 'sede_punata', sheetCount: -1 } }), (error) => error.code === 'invalid-argument')
  await assert.rejects(() => managePhysicalInventoryDocument.run({ auth: { uid: denied }, data: { action: 'create', title: 'No autorizado', documentType: 'Carpeta', patrimonialLocationId: 'sede_punata', sheetCount: 0 } }), (error) => error.code === 'permission-denied')
  const docs = await listPhysicalInventoryDocuments.run({ auth: { uid: admin }, data: { patrimonialLocationId: 'sede_punata', search: 'actas' } })
  assert.equal(docs.documents.some((entry) => entry.id === doc.id), true)
  await assert.rejects(() => listPhysicalInventoryDocuments.run({ auth: { uid: denied }, data: {} }), (error) => error.code === 'permission-denied')

  assert.deepEqual((await oldAssetRef.get()).data(), oldAsset, 'se conserva íntegro el registro anterior con su ubicación histórica')
  assert.equal((await db.collection('financial_movements').where('referenceId', 'in', [transferred.id, inmueble.assets[0].id]).get()).size, 0, 'el registro patrimonial no genera movimientos financieros')
  assert.deepEqual((await shelfRef.get()).data(), shelfFixture, 'las ubicaciones logísticas conservan sus datos')
})
