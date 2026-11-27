import { spawn } from 'node:child_process'

const env = {
  ...process.env,
  GCLOUD_PROJECT: 'demo-expreso-punata-admin-test',
  FIRESTORE_RULES_PROJECT_ID: 'demo-expreso-punata-admin-test',
  FIRESTORE_RULES_HOST: process.env.QA_FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
  FIRESTORE_RULES_PORT: process.env.QA_FIRESTORE_EMULATOR_HOST?.split(':').at(-1) || '17080',
}
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/rules/firestoreRules.test.mjs'], { env, stdio: 'inherit', windowsHide: true })
child.on('close', code => { process.exitCode = code ?? 1 })
