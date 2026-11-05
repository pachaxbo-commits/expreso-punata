process.env.GCLOUD_PROJECT = 'expreso-punata-dev'
process.env.GOOGLE_CLOUD_PROJECT = 'expreso-punata-dev'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FUNCTIONS_EMULATOR = 'true'
const [{ initializeApp, getApps }, { getFirestore }, { manageShelf }] = await Promise.all([
  import('firebase-admin/app'), import('firebase-admin/firestore'), import('../functions/index.js'),
])
if (!getApps().length) initializeApp({ projectId: 'expreso-punata-dev' })
const db = getFirestore()
const adminUid = 'config-test-admin'
const secretaryUid = 'config-test-secretary'
await db.collection('users').doc(adminUid).set({ uid: adminUid, role: 'directiva_admin', isActive: true })
await db.collection('users').doc(secretaryUid).set({ uid: secretaryUid, role: 'secretaria', isActive: true })
const data = { action: 'create_or_update', branchId: 'punata', shelfData: { id: 'MODULO-5', name: 'Módulo 5', code: 'MOD-5', moduleCount: 1, floorCount: 2, spaceCountPerFloor: 4, capacityPerSpace: 1 } }
let secretaryError = null
try { await manageShelf.run({ auth: { uid: secretaryUid }, data }) } catch (e) { secretaryError = `${e.code}: ${e.message}` }
await manageShelf.run({ auth: { uid: adminUid }, data })
const saved = (await db.collection('branches').doc('punata').collection('shelves').doc('MODULO-5').get()).data()
await db.collection('shipments').doc('config-occupied-test').set({ destinationBranchId: 'punata', status: 'stored', storageLocation: { shelfId: 'MODULO-5', floorNumber: 2, spaceNumber: 4 } })
let reductionError = null
try { await manageShelf.run({ auth: { uid: adminUid }, data: { ...data, shelfData: { ...data.shelfData, floorCount: 1 } } }) } catch (e) { reductionError = `${e.code}: ${e.message}` }
console.log(JSON.stringify({ secretaryError, saved: { floorCount: saved.floorCount, spaceCountPerFloor: saved.spaceCountPerFloor }, reductionError }, null, 2))
