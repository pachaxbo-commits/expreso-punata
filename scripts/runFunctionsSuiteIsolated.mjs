import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const functionsDir = path.join(root, 'functions')
const logDir = path.join(root, '.qa-automated', 'function-groups-official')
const firestoreHost = process.env.QA_FIRESTORE_EMULATOR_HOST || '127.0.0.1:17080'
const authHost = process.env.QA_AUTH_EMULATOR_HOST || '127.0.0.1:17099'
const storageHost = process.env.QA_STORAGE_EMULATOR_HOST || '127.0.0.1:17199'
const projectId = process.env.QA_FUNCTIONS_PROJECT || 'demo-expreso-punata-finalization'

await mkdir(logDir, { recursive: true })

async function resetProject(projectId) {
  const firestoreUrl = `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`
  const authUrl = `http://${authHost}/emulator/v1/projects/${projectId}/accounts`
  for (const url of [firestoreUrl, authUrl]) {
    const response = await fetch(url, { method: 'DELETE' })
    if (![200, 204, 404].includes(response.status)) throw new Error(`No se pudo limpiar ${url}: HTTP ${response.status}`)
  }
}

function projectFor(file) {
  const source = file.source
  return source.match(/projectId:\s*'([^']+)'/)?.[1] || 'demo-expreso-punata-admin-test'
}

const files = (await readdir(path.join(functionsDir, 'test')))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
const results = []

for (const name of files) {
  await resetProject(projectId)
  const startedAt = Date.now()
  const env = {
    ...process.env,
    GCLOUD_PROJECT: projectId,
    GOOGLE_CLOUD_PROJECT: projectId,
    FUNCTIONS_TEST_PROJECT: projectId,
    FIRESTORE_EMULATOR_HOST: firestoreHost,
    FIREBASE_AUTH_EMULATOR_HOST: authHost,
    FIREBASE_STORAGE_EMULATOR_HOST: storageHost,
    FUNCTIONS_EMULATOR_HOST: process.env.QA_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001',
    FIREBASE_FUNCTIONS_EMULATOR_HOST: process.env.QA_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001',
    STORAGE_EMULATOR_HOST: `http://${storageHost}`,
    FUNCTIONS_TEST_FIRESTORE_HOST: firestoreHost,
    FUNCTIONS_TEST_AUTH_HOST: authHost,
    FUNCTIONS_TEST_STORAGE_HOST: storageHost,
    FUNCTIONS_TEST_FUNCTIONS_HOST: process.env.QA_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001',
    FUNCTIONS_TEST_STORAGE_URL: `http://${storageHost}`,
    METADATA_SERVER_DETECTION: 'none',
    FUNCTIONS_EMULATOR: 'true',
  }
  const child = spawn(process.execPath, ['--import', './test/setupEmulatorEnv.mjs', '--test', '--test-concurrency=1', `test/${name}`], { cwd: functionsDir, env, windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const outcome = await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve({ code: null, blocked: true }) }, 90000)
    child.on('close', code => { clearTimeout(timer); resolve({ code, blocked: false }) })
  })
  await writeFile(path.join(logDir, name.replace('.mjs', '.log')), output)
  const pass = (output.match(/^✔/gm) || []).length
  const fail = (output.match(/^✖/gm) || []).length
  const skipped = (output.match(/ℹ skipped (\d+)/)?.[1] || '0')
  const result = { file: name, projectId, code: outcome.code, blocked: outcome.blocked, pass, fail, skipped: Number(skipped), durationMs: Date.now() - startedAt }
  results.push(result)
  console.log(JSON.stringify(result))
}

const summary = {
  filesDiscovered: files.length,
  filesPassed: results.filter(item => item.code === 0 && !item.blocked && item.fail === 0).length,
  filesFailed: results.filter(item => item.code !== 0 && !item.blocked).length,
  filesBlocked: results.filter(item => item.blocked).length,
  testsPassed: results.reduce((sum, item) => sum + item.pass, 0),
  testsFailed: results.reduce((sum, item) => sum + item.fail, 0),
  testsSkipped: results.reduce((sum, item) => sum + item.skipped, 0),
  results,
}
await writeFile(path.join(logDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (summary.filesFailed || summary.filesBlocked || summary.testsFailed || summary.testsSkipped) process.exitCode = 1
