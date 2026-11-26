import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage'
import fs from 'node:fs'

let testEnv
const projectId = process.env.GCLOUD_PROJECT
const firestoreEndpoint = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '')
const storageEndpoint = /^127\.0\.0\.1:(\d+)$/.exec(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')
if (projectId !== 'demo-expreso-punata-finalization' || !firestoreEndpoint || !storageEndpoint) {
  throw new Error('storageRules requiere el lanzador aislado y Firestore/Storage Emulator en loopback.')
}
const STORAGE_PORT = Number(storageEndpoint[1])

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: Number(firestoreEndpoint[1]) },
    storage: { host: '127.0.0.1', port: Number(storageEndpoint[1]), rules: fs.readFileSync('storage.rules', 'utf8') },
  })
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', 'admin-storage'), { role: 'directiva_admin', primaryBranchId: 'punata', isActive: true })
    await setDoc(doc(db, 'users', 'punata-storage'), { role: 'secretaria', primaryBranchId: 'punata', isActive: true })
    await setDoc(doc(db, 'users', 'cbba-storage'), { role: 'secretaria', primaryBranchId: 'cochabamba', isActive: true })
    await setDoc(doc(db, 'users', 'inactive-storage'), { role: 'directiva_admin', primaryBranchId: 'punata', isActive: false })
    await setDoc(doc(db, 'users', 'no-role-storage'), { primaryBranchId: 'punata', isActive: true })
    await setDoc(doc(db, 'shipments', 'ship-punata'), { originBranchId: 'punata', destinationBranchId: 'cochabamba' })
    await setDoc(doc(db, 'shipments', 'ship-cbba'), { originBranchId: 'cochabamba', destinationBranchId: 'punata' })
    await setDoc(doc(db, 'shipments', 'ship-punata-only'), { originBranchId: 'punata', destinationBranchId: 'punata' })
  })
  await testEnv.withSecurityRulesDisabled(async context => {
    // La foto existente representa evidencia histÃ³rica. Se prepara mediante la
    // API administrativa local del Emulator, sin activar la carga comercial.
    const adminStorage = context.storage()
    await uploadBytes(ref(adminStorage, 'shipments/ship-punata/photo.png'), Buffer.from([137, 80, 78, 71]), { contentType: 'image/png' })
  })
})

after(async () => { await testEnv?.cleanup() })

test('Storage Rules: autenticaÃ§Ã£o, sucursal, inactividad y escritura', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71])
  const admin = testEnv.authenticatedContext('admin-storage').storage()
  const punata = testEnv.authenticatedContext('punata-storage').storage()
  const cbba = testEnv.authenticatedContext('cbba-storage').storage()
  const inactive = testEnv.authenticatedContext('inactive-storage').storage()
  const noRole = testEnv.authenticatedContext('no-role-storage').storage()
  const anon = testEnv.unauthenticatedContext().storage()

  await assertSucceeds(getBytes(ref(punata, 'shipments/ship-punata/photo.png')))
  await assertSucceeds(getBytes(ref(cbba, 'shipments/ship-punata/photo.png')))
  await assertSucceeds(getBytes(ref(admin, 'shipments/ship-punata/photo.png')))
  await assertFails(getBytes(ref(cbba, 'shipments/ship-punata-only/photo.png')))
  await assertFails(getBytes(ref(anon, 'shipments/ship-punata/photo.png')))
  await assertFails(getBytes(ref(inactive, 'shipments/ship-punata/photo.png')))
  await assertFails(getBytes(ref(noRole, 'shipments/ship-punata/photo.png')))
  await assertFails(uploadBytes(ref(punata, 'shipments/ship-punata/text.txt'), new Uint8Array([1]), { contentType: 'text/plain' }))
  await assertFails(uploadBytes(ref(punata, 'shipments/ship-punata/new-photo.png'), bytes, { contentType: 'image/png' }))
  await assertFails(uploadBytes(ref(punata, 'shipments/ship-punata/large.png'), new Uint8Array(2 * 1024 * 1024), { contentType: 'image/png' }))
  await assertFails(uploadBytes(ref(cbba, 'shipments/ship-punata-only/photo.png'), bytes, { contentType: 'image/png' }))
  await assertFails(deleteObject(ref(punata, 'shipments/ship-punata/photo.png')))
})
