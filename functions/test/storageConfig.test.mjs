import assert from 'node:assert/strict'
import test from 'node:test'
import { getStorageBucketName } from '../storageConfig.js'

test('usa el bucket del proyecto cuando Storage Emulator está activo', () => {
  assert.equal(getStorageBucketName({
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:18199',
    GCLOUD_PROJECT: 'demo-expreso-punata-101',
  }), 'demo-expreso-punata-101.appspot.com')
})

test('respeta un bucket explícito y conserva el bucket de desarrollo fuera del emulador', () => {
  assert.equal(getStorageBucketName({ STORAGE_BUCKET_NAME: 'custom.qa.bucket' }), 'custom.qa.bucket')
  assert.equal(getStorageBucketName({}), 'expreso-punata-dev.firebasestorage.app')
})
