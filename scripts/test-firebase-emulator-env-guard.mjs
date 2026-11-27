import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const guard = pathToFileURL(path.join(root, 'scripts', 'firebase-emulator-env-guard.mjs')).href
const base = {
  ...process.env,
  GCLOUD_PROJECT: 'demo-expreso-punata-finalization',
  GOOGLE_CLOUD_PROJECT: 'demo-expreso-punata-finalization',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  FIREBASE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  METADATA_SERVER_DETECTION: 'none',
}
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_KEYFILE_JSON', 'GCLOUD_SERVICE_KEY', 'FIREBASE_TOKEN', 'FIREBASE_CONFIG']) delete base[key]

function run(env) {
  return spawnSync(process.execPath, ['--import', guard, '-e', 'process.stdout.write("guard accepted\\n")'], { cwd: root, env, encoding: 'utf8' })
}

const valid = run(base)
assert.equal(valid.status, 0, valid.stderr)
console.log('PASS valid isolated environment accepted')
for (const [name, key, value] of [
  ['project real', 'GCLOUD_PROJECT', 'expreso-punata-dev'],
  ['host externo', 'FIRESTORE_EMULATOR_HOST', 'firestore.googleapis.com:443'],
  ...Object.entries({
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9098',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9198',
    FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5002',
    FIREBASE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5002',
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9198',
  }).map(([envName, badValue]) => [`wrong ${envName}`, envName, badValue]),
  ...['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST', 'FIREBASE_FUNCTIONS_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST', 'METADATA_SERVER_DETECTION'].map((envName) => [`missing ${envName}`, envName, undefined]),
  ['credencial cloud', 'GOOGLE_APPLICATION_CREDENTIALS', 'not-a-real-path'],
  ['token Firebase Cloud', 'FIREBASE_TOKEN', 'not-a-real-token'],
]) {
  const env = { ...base }
  if (value === undefined) delete env[key]
  else env[key] = value
  const result = run(env)
  assert.equal(result.status, 78, `${name} should be rejected; got ${result.status}\n${result.stderr}`)
  console.log(`PASS ${name}: ${result.stderr.trim()}`)
}

for (const [name, value] of [
  ['project in FIREBASE_CONFIG', JSON.stringify({ projectId: 'expreso-punata-dev' })],
  ['bucket externo in FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-expreso-punata-finalization', storageBucket: 'expreso-punata-dev.appspot.com' })],
]) {
  const result = run({ ...base, FIREBASE_CONFIG: value })
  assert.equal(result.status, 78, `${name} should be rejected\n${result.stderr}`)
  console.log(`PASS ${name}: ${result.stderr.trim()}`)
}

const alteredChildEnv = { ...base, GOOGLE_CLOUD_PROJECT: 'expreso-punata-dev' }
const alteredChild = spawnSync(process.execPath, ['--import', guard, '-e', 'process.exit(0)'], { cwd: root, env: alteredChildEnv, encoding: 'utf8' })
assert.equal(alteredChild.status, 78, `child with altered config must be rejected\n${alteredChild.stderr}`)
console.log(`PASS child with altered project rejected: ${alteredChild.stderr.trim()}`)

const mutationChild = spawnSync(process.execPath, [
  '--import', guard,
  '-e', `
    const before = process.env.GCLOUD_PROJECT
    for (const [key, value] of [['GCLOUD_PROJECT', 'expreso-punata-dev'], ['FIRESTORE_EMULATOR_HOST', 'firestore.googleapis.com:443'], ['FIREBASE_TOKEN', 'unexpected']]) {
      let blocked = false
      try { process.env[key] = value } catch (error) { blocked = /Cannot (change|add) protected/.test(error.message) }
      if (!blocked) process.exit(31)
    }
    try { delete process.env.FIRESTORE_EMULATOR_HOST; process.exit(32) } catch (error) {
      if (!/Cannot delete protected FIRESTORE_EMULATOR_HOST/.test(error.message)) process.exit(33)
    }
    if (process.env.GCLOUD_PROJECT !== before || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') process.exit(34)
  `,
], { cwd: root, env: base, encoding: 'utf8' })
assert.equal(mutationChild.status, 0, `post-guard environment mutation must be blocked\n${mutationChild.stderr}`)
console.log('PASS post-guard project, host, and credential mutation blocked in child process')

const runner = path.join(root, 'scripts', 'run-isolated-firebase-tests.mjs')
const unauthorized = spawnSync(process.execPath, [runner, 'admin:credential'], { cwd: root, env: base, encoding: 'utf8' })
assert.equal(unauthorized.status, 78, `non-allowlisted test target must be rejected\n${unauthorized.stderr}`)
console.log(`PASS non-allowlisted target rejected: ${unauthorized.stderr.trim()}`)
