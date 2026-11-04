// Debe cargarse antes de cualquier import de functions/index.js.
// Así Admin SDK apunta al emulador desde su primera inicialización.
process.env.GCLOUD_PROJECT ||= 'demo-expreso-punata-admin-test'
process.env.GOOGLE_CLOUD_PROJECT ||= process.env.GCLOUD_PROJECT
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.FUNCTIONS_EMULATOR ||= 'true'
