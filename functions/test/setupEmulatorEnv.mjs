// Debe cargarse antes de cualquier import de functions/index.js. La configuración
// solo la suministra scripts/run-isolated-firebase-tests.mjs; no hay fallbacks.
const expected = {
  GCLOUD_PROJECT: process.env.FUNCTIONS_TEST_PROJECT || 'demo-expreso-punata-finalization',
  GOOGLE_CLOUD_PROJECT: process.env.FUNCTIONS_TEST_PROJECT || 'demo-expreso-punata-finalization',
  FIRESTORE_EMULATOR_HOST: process.env.FUNCTIONS_TEST_FIRESTORE_HOST || '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FUNCTIONS_TEST_AUTH_HOST || '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: process.env.FUNCTIONS_TEST_STORAGE_HOST || '127.0.0.1:9199',
  FUNCTIONS_EMULATOR_HOST: process.env.FUNCTIONS_TEST_FUNCTIONS_HOST || '127.0.0.1:5001',
  FIREBASE_FUNCTIONS_EMULATOR_HOST: process.env.FUNCTIONS_TEST_FUNCTIONS_HOST || '127.0.0.1:5001',
  STORAGE_EMULATOR_HOST: process.env.FUNCTIONS_TEST_STORAGE_URL || 'http://127.0.0.1:9199',
  METADATA_SERVER_DETECTION: 'none',
}
for (const [name, value] of Object.entries(expected)) {
  if (process.env[name] !== value) {
    throw new Error(`[firebase-test-setup] ${name} must equal ${value}; run tests through npm test:* isolated scripts`)
  }
}
if (process.env.FUNCTIONS_EMULATOR && process.env.FUNCTIONS_EMULATOR !== 'true') {
  throw new Error('[firebase-test-setup] FUNCTIONS_EMULATOR must be true when supplied')
}
process.env.FUNCTIONS_EMULATOR = 'true'
