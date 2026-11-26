export function getStorageBucketName(env = process.env) {
  if (env.STORAGE_BUCKET_NAME) return env.STORAGE_BUCKET_NAME
  const emulatorHost = env.FIREBASE_STORAGE_EMULATOR_HOST || env.STORAGE_EMULATOR_HOST
  if (emulatorHost) return `${env.GCLOUD_PROJECT || env.GCP_PROJECT || 'demo-expreso-punata-101'}.appspot.com`
  return 'expreso-punata-dev.firebasestorage.app'
}
