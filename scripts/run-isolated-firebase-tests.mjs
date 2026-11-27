import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = 'demo-expreso-punata-finalization'
const hostUserProfile = process.env.USERPROFILE
const hosts = {
  GCLOUD_PROJECT: project,
  GOOGLE_CLOUD_PROJECT: project,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  FIREBASE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  METADATA_SERVER_DETECTION: 'none',
}
const tests = {
  rules: { services: 'firestore,auth,storage', command: 'node --import ./scripts/firebase-emulator-env-guard.mjs --test --test-concurrency=1 tests/rules/*.test.mjs' },
  functions: { services: 'firestore,auth,storage', command: 'node --import ./functions/test/setupEmulatorEnv.mjs --test --test-concurrency=1 functions/test/*.test.mjs' },
  'finance-authorization': { services: 'firestore,auth,storage', command: 'node --import ./functions/test/setupEmulatorEnv.mjs --test --test-concurrency=1 functions/test/cashShift.test.mjs functions/test/affiliateOperations.test.mjs functions/test/unionDebtAlerts.test.mjs functions/test/unionLoanBranchAccess.test.mjs functions/test/unionFineSecretaryCreation.test.mjs functions/test/collectMemberDueSecretary.test.mjs' },
  'report-scope': { services: 'firestore,auth,storage', command: 'node --import ./functions/test/setupEmulatorEnv.mjs --test --test-concurrency=1 functions/test/reports.test.mjs functions/test/commissionsAndConsumables.test.mjs' },
  'caja-lifecycle': { services: 'firestore,auth', command: 'node --import ./scripts/firebase-emulator-env-guard.mjs tests/e2e/runCajaLifecycle.mjs' },
  'logistics-lifecycle': { services: 'firestore,auth', command: 'node --import ./scripts/firebase-emulator-env-guard.mjs tests/e2e/runLogisticsLifecycle.mjs' },
  'delivery-lifecycle': { services: 'firestore,auth,storage', command: 'node --import ./scripts/firebase-emulator-env-guard.mjs tests/e2e/runDeliveryAndCodLifecycle.mjs' },
  journey: { services: 'firestore,auth,storage', command: 'node --import ./scripts/firebase-emulator-env-guard.mjs tests/e2e/runFullAuthenticatedBusinessJourney.mjs' },
  integration: { services: 'firestore,auth,storage,functions', command: 'node --experimental-strip-types --import ./scripts/firebase-emulator-env-guard.mjs --test tests/integration/*.test.mjs' },
  browser: { services: 'firestore,auth,storage,functions', command: 'node --import ./scripts/firebase-emulator-env-guard.mjs scripts/build-emulator.mjs && node --import ./scripts/firebase-emulator-env-guard.mjs tests/e2e/runBrowserVerification.mjs' },
  emulators: { services: 'firestore,auth,storage,functions', start: true },
}

function reject(message) {
  console.error(`[isolated-firebase-tests] ${message}`)
  process.exit(78)
}

const name = process.argv[2]
const selected = tests[name]
if (!selected) reject(`test target is not allowlisted: ${name || '(missing)'}`)

for (const [key, expected] of Object.entries(hosts)) {
  if (process.env[key] && process.env[key] !== expected) reject(`${key} conflicts with the isolated test environment`)
}
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_KEYFILE_JSON', 'GCLOUD_SERVICE_KEY', 'FIREBASE_TOKEN']) {
  if (process.env[key]) reject(`${key} is present; cloud credentials are forbidden for emulator tests`)
}
if (process.env.FIREBASE_CONFIG) {
  let config
  try { config = JSON.parse(process.env.FIREBASE_CONFIG) } catch { reject('FIREBASE_CONFIG is invalid JSON') }
  if (config.projectId && config.projectId !== project) reject('FIREBASE_CONFIG points to a different project')
  if (config.storageBucket && !config.storageBucket.startsWith(`${project}.`)) reject('FIREBASE_CONFIG contains a non-demo bucket')
}

const env = { ...process.env, ...hosts }
Object.assign(env, {
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_PROJECT_ID: project,
  VITE_FIREBASE_API_KEY: 'demo-api-key-expreso-punata-finalization',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:demo-local',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9199',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5001',
  E2E_FIREBASE_PROJECT_ID: project,
  E2E_EVIDENCE_DIR: path.join(root, '.runtime', 'evidence', 'browser-verification'),
})
if (name === 'integration') {
  // Exercise the server-calculated tariff path with an explicit demo tariff fixture.
  env.ENABLE_AUTOMATIC_PARCEL_PRICING = 'true'
}
if ((name === 'browser' || name === 'journey') && hostUserProfile) env.E2E_BROWSER_USERPROFILE = hostUserProfile
const isolatedHome = path.join(root, '.runtime', 'firebase-cli-home')
const emulatorCache = path.join(root, '.runtime', 'firebase-emulators')
await mkdir(isolatedHome, { recursive: true })
await mkdir(emulatorCache, { recursive: true })
env.HOME = isolatedHome
env.USERPROFILE = isolatedHome
env.FIREBASE_CLI_DISABLE_UPDATE_CHECK = '1'
env.FIREBASE_CLI_DISABLE_USAGE_COLLECTION = '1'
env.FIREBASE_EMULATORS_PATH = emulatorCache
env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ''}`
const guardImport = pathToFileURL(path.join(root, 'scripts', 'firebase-emulator-env-guard.mjs')).href
env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${guardImport}`].filter(Boolean).join(' ')
const firebaseCli = path.join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
const cliArgs = [firebaseCli, selected.start ? 'emulators:start' : 'emulators:exec', '--config', 'firebase.emulator.json', '--project', project, '--only', selected.services]
if (selected.command) cliArgs.push(selected.command)

const child = spawn(process.execPath, cliArgs, { cwd: root, env, stdio: 'inherit', windowsHide: true })
child.on('error', (error) => reject(`could not start local Firebase CLI: ${error.message}`))
child.on('exit', (code, signal) => {
  if (signal) reject(`Firebase CLI terminated by ${signal}`)
  process.exitCode = code ?? 1
})
