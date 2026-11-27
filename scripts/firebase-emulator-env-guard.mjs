const EXPECTED_PROJECT = 'demo-expreso-punata-finalization'
const EXPECTED_HOSTS = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  FIREBASE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
}
const CLOUD_CREDENTIALS = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_KEYFILE_JSON',
  'GCLOUD_SERVICE_KEY',
  'FIREBASE_TOKEN',
]

function fail(message) {
  console.error(`[firebase-emulator-guard] ${message}`)
  process.exit(78)
}

if (process.env.GCLOUD_PROJECT !== EXPECTED_PROJECT) {
  fail(`GCLOUD_PROJECT must be ${EXPECTED_PROJECT}`)
}
if (process.versions.node !== '22.17.0') {
  fail(`Node.js 22.17.0 is required; found ${process.versions.node}`)
}
if (process.env.GOOGLE_CLOUD_PROJECT !== EXPECTED_PROJECT) {
  fail(`GOOGLE_CLOUD_PROJECT must be ${EXPECTED_PROJECT}`)
}
for (const [name, expected] of Object.entries(EXPECTED_HOSTS)) {
  if (process.env[name] !== expected) fail(`${name} must be ${expected}`)
}
if (process.env.METADATA_SERVER_DETECTION !== 'none') {
  fail('METADATA_SERVER_DETECTION must be none')
}
if (process.env.VITE_USE_FIREBASE_EMULATORS && process.env.VITE_USE_FIREBASE_EMULATORS !== 'true') {
  fail('VITE_USE_FIREBASE_EMULATORS must be true when supplied')
}
if (process.env.VITE_FIREBASE_PROJECT_ID && process.env.VITE_FIREBASE_PROJECT_ID !== EXPECTED_PROJECT) {
  fail(`VITE_FIREBASE_PROJECT_ID must be ${EXPECTED_PROJECT}`)
}
const credentialName = CLOUD_CREDENTIALS.find((name) => process.env[name])
if (credentialName) fail(`${credentialName} must not be present`)

if (process.env.FIREBASE_CONFIG) {
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG)
    if (config.projectId && config.projectId !== EXPECTED_PROJECT) {
      fail(`FIREBASE_CONFIG projectId must be ${EXPECTED_PROJECT}`)
    }
    if (config.storageBucket && !config.storageBucket.startsWith(`${EXPECTED_PROJECT}.`)) {
      fail('FIREBASE_CONFIG storageBucket must belong to the demo project')
    }
  } catch (error) {
    if (error?.code === 'ERR_SCRIPT_EXECUTION_INTERRUPTED') throw error
    if (String(error?.message).includes('FIREBASE_CONFIG')) throw error
    fail('FIREBASE_CONFIG must be valid JSON')
  }
}

// Lock Firebase routing variables after validation. Node child processes inherit
// a plain snapshot through spawn's env option; this process cannot silently
// redirect a later SDK initialization by assigning a different project/host.
const lockedValues = {
  GCLOUD_PROJECT: EXPECTED_PROJECT,
  GOOGLE_CLOUD_PROJECT: EXPECTED_PROJECT,
  ...EXPECTED_HOSTS,
  METADATA_SERVER_DETECTION: 'none',
  ...(process.env.FIREBASE_CONFIG ? { FIREBASE_CONFIG: process.env.FIREBASE_CONFIG } : {}),
  ...(process.env.VITE_USE_FIREBASE_EMULATORS ? { VITE_USE_FIREBASE_EMULATORS: 'true' } : {}),
  ...(process.env.VITE_FIREBASE_PROJECT_ID ? { VITE_FIREBASE_PROJECT_ID: EXPECTED_PROJECT } : {}),
  ...Object.fromEntries(CLOUD_CREDENTIALS.map(name => [name, undefined])),
  ...(!process.env.FIREBASE_CONFIG ? { FIREBASE_CONFIG: undefined } : {}),
}
const lockedNames = new Map(Object.keys(lockedValues).map(name => [name.toLowerCase(), name]))
const initialEnv = process.env
const envSnapshot = Object.create(null)
for (const name of Object.keys(initialEnv)) envSnapshot[name] = initialEnv[name]
const protectedEnv = new Proxy(envSnapshot, {
  get(target, property) {
    if (typeof property !== 'string') return Reflect.get(target, property)
    const protectedName = lockedNames.get(property.toLowerCase())
    if (protectedName) return lockedValues[protectedName]
    const actualName = Object.keys(target).find(name => name.toLowerCase() === property.toLowerCase())
    return actualName ? target[actualName] : undefined
  },
  set(target, property, value) {
    if (typeof property !== 'string') return Reflect.set(target, property, value)
    const protectedName = lockedNames.get(property.toLowerCase())
    if (protectedName) {
      if (lockedValues[protectedName] === undefined) throw new Error(`[firebase-emulator-guard] Cannot add protected ${protectedName}`)
      const attempted = String(value)
      if (attempted !== lockedValues[protectedName]) throw new Error(`[firebase-emulator-guard] Cannot change protected ${protectedName}`)
      return true
    }
    const actualName = Object.keys(target).find(name => name.toLowerCase() === property.toLowerCase()) || property
    target[actualName] = String(value)
    return true
  },
  deleteProperty(target, property) {
    if (typeof property === 'string' && lockedNames.has(property.toLowerCase())) {
      throw new Error(`[firebase-emulator-guard] Cannot delete protected ${lockedNames.get(property.toLowerCase())}`)
    }
    const actualName = typeof property === 'string'
      ? Object.keys(target).find(name => name.toLowerCase() === property.toLowerCase())
      : undefined
    return actualName ? Reflect.deleteProperty(target, actualName) : true
  },
})
Object.defineProperty(process, 'env', { value: protectedEnv, configurable: false, enumerable: true, writable: false })
