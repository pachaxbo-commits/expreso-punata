import crypto from 'node:crypto'

const TEST_ONLY_KEY = 'pachax-cleanup-provenance-v1-emulator-only'
function stable(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return { __timestamp: value.toDate().toISOString() }
  if (Buffer.isBuffer(value)) return { __bytes: value.toString('base64') }
  if (Array.isArray(value)) return value.map(stable)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}
export function testCleanupHash(data) { return crypto.createHash('sha256').update(JSON.stringify(stable(data))).digest('hex') }
export async function registerSyntheticTestRecord(db, collection, id, data, datasetId = 'cleanup-e2e') {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw new Error('Los fixtures con procedencia solo se registran en emuladores demo.')
  const recordPath = `${collection}/${id}`
  const contentHash = testCleanupHash(data)
  const signature = crypto.createHmac('sha256', TEST_ONLY_KEY).update(`${recordPath}\0${contentHash}\0${datasetId}`).digest('hex')
  const registryId = crypto.createHash('sha256').update(recordPath).digest('hex')
  await db.collection('support_cleanup_provenance').doc(registryId).create({ recordPath, contentHash, datasetId, signature, source: 'test-seed-helper-v1', createdAtIso: new Date().toISOString() })
}
