import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080')
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099')
const app = initializeApp({ projectId: 'demo-support-phase2' })
const db = getFirestore(app)
const auth = getAuth(app)
const suffix = Date.now()
const email = `support-${suffix}@example.test`
const password = 'LocalSupportOnly!234'
const user = await auth.createUser({ email, password })
await db.collection('users').doc(user.uid).set({ uid: user.uid, email, fullName: 'Soporte local', role: 'soporte_pachax', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
await db.collection('support_cleanup_fixtures').doc('fixture-guide').set({ category: 'encomiendas', testMarker: 'pachax-emulator-fixture-v1', dependsOn: [], branchId: 'punata' })
await db.collection('support_cleanup_fixtures').doc('fixture-payment').set({ category: 'cobros', testMarker: 'pachax-emulator-fixture-v1', dependsOn: ['fixture-guide'], branchId: 'punata' })
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4189', '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  for (let i = 0; i < 30; i++) {
    try { await page.goto('http://127.0.0.1:4189'); break } catch (error) { if (i === 29) throw error; await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  await page.getByRole('heading', { name: 'Centro de Soporte PACHAX' }).waitFor()
  await page.getByText('emulador', { exact: true }).waitFor()
  await page.getByLabel('encomiendas', { exact: true }).check()
  await page.getByRole('button', { name: 'SIMULAR LIMPIEZA' }).click()
  await page.getByText(/2 registros/).waitFor()
  assert.equal((await db.collection('support_cleanup_fixtures').get()).size, 2)
  await page.getByLabel(/Escriba LIMPIAR/).fill('LIMPIAR')
  await page.getByRole('button', { name: 'Ejecutar en emulador' }).click()
  await page.getByText(/Limpieza de emulador completada/).waitFor()
  assert.equal((await db.collection('support_cleanup_fixtures').get()).size, 0)
  assert.equal((await db.collection('support_cleanup_backups').get()).size, 1)
  console.log('Support E2E: panel responsive, simulación, dependencias, ejecución y respaldo aprobados.')
} finally { await browser.close(); preview.kill() }
