import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expectedProject = 'demo-expreso-punata-finalization'
const required = {
  GCLOUD_PROJECT: expectedProject,
  GOOGLE_CLOUD_PROJECT: expectedProject,
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  FIREBASE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  METADATA_SERVER_DETECTION: 'none',
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_PROJECT_ID: expectedProject,
  VITE_FIREBASE_API_KEY: 'demo-api-key-expreso-punata-finalization',
  VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
  VITE_FIREBASE_STORAGE_BUCKET: `${expectedProject}.appspot.com`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
  VITE_FIREBASE_APP_ID: '1:123456789012:web:demo-local',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9199',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5001',
}
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_KEYFILE_JSON', 'GCLOUD_SERVICE_KEY', 'FIREBASE_TOKEN']) {
  if (process.env[key]) throw new Error(`No se permite ${key} durante el build aislado.`)
}
for (const [key, value] of Object.entries(required)) {
  if (process.env[key] && process.env[key] !== value) throw new Error(`${key} contradice el entorno demo aislado.`)
}
const env = { ...process.env, ...required }
Object.assign(process.env, required)
const guardUrl = pathToFileURL(path.join(root, 'scripts', 'firebase-emulator-env-guard.mjs')).href
env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${guardUrl}`].filter(Boolean).join(' ')
await import('./firebase-emulator-env-guard.mjs')

for (const [label, script, args] of [
  ['TypeScript', path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), ['-b']],
  ['Vite', path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ['build']],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${label} build failed with status ${result.status}`)
}

let bundleText = ''
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name)
    if (item.isDirectory()) await scan(file)
    else {
      const content = await readFile(file)
      bundleText += content.toString('utf8')
    }
  }
}

await scan(path.join(root, 'dist'))
if (bundleText.includes('expreso-punata-dev')) throw new Error('El build incluye el ID de Firebase Cloud expreso-punata-dev.')
for (const requiredEndpoint of ['127.0.0.1', 'demo-expreso-punata-finalization']) {
  if (!bundleText.includes(requiredEndpoint)) throw new Error(`El build no contiene la configuración emulator esperada: ${requiredEndpoint}`)
}
console.log(`[build-emulator] build aislado verificado: ${expectedProject}; no aparece expreso-punata-dev`)
