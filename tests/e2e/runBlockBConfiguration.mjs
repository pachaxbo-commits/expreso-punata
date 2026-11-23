import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/)
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):9099$/)
const project = 'demo-expreso-punata-block-b-browser'
const app = initializeApp({ projectId: project })
const db = getFirestore(app)
const auth = getAuth(app)
const password = 'Browser-Fixtures-Only!42'
async function seed(role) {
  const email = `${role}-${Date.now()}@example.test`
  const { uid } = await auth.createUser({ email, password })
  await db.collection('users').doc(uid).set({
    uid, email, fullName: 'Operador de prueba', role, isActive: true, primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
  })
  return email
}
const [support, admin] = await Promise.all([seed('soporte_pachax'), seed('afiliado_admin')])
const config = db.collection('system_config').doc('expreso_punata')
await config.set({
  status: 'configured', isOfficial: true, company: { tradeName: 'Empresa sintética' },
  branches: { punata: { name: 'Agencia inicial', phone: '70700000', code: 'PUN' } },
  tariffs: { baseFeeCents: 1000, baseFeeBob: 10, extraKgRateCents: 0, extraKgRateBob: 0 },
})
const url = 'http://127.0.0.1:4188'
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4188', '--strictPort'], {
  env: { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: project }, stdio: 'inherit',
})
let browser
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function signIn(email, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  page.on('dialog', dialog => dialog.accept())
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(url); break }
    catch (error) {
      if (attempt === 29) throw error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await button(page, 'Iniciar Sesión').click()
  return page
}
async function call(page, name, action) {
  const response = page.waitForResponse(result => result.url().endsWith('/' + name) && result.request().method() === 'POST')
  await action()
  const { result, error } = await (await response).json()
  assert.ok(result, JSON.stringify(error))
  return result
}

try {
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await signIn(support, 390)
  await page.getByRole('heading', { name: 'Centro de Soporte PACHAX' }).waitFor()
  await page.getByText('La administración del cliente autoriza y publica las reglas comerciales.').waitFor()
  assert.equal(await button(page, 'Autorizar y publicar').count(), 0)
  const institutional = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Configuración institucional', exact: true }) })
  await button(institutional, 'Punata').click()
  await institutional.getByLabel('Nuevo valor').fill('Agencia actualizada en Chrome')
  await institutional.getByLabel('Motivo', { exact: true }).fill('Cambio sintético de comprobantes')
  await call(page, 'updateSupportConfiguration', () => button(institutional, 'Guardar cambio').click())
  await institutional.getByText('Agencia actualizada en Chrome', { exact: true }).waitFor()
  assert.equal((await config.get()).data().branches.punata.name, 'Agencia actualizada en Chrome')
  await institutional.getByLabel('Motivo', { exact: true }).fill('Restauración sintética en Chrome')
  await call(page, 'updateSupportConfiguration', () => button(institutional, 'Restaurar valor anterior').click())
  await institutional.getByText('Agencia inicial', { exact: true }).waitFor()
  assert.equal((await config.get()).data().branches.punata.code, 'PUN')
  const client = await signIn(admin, 1280)
  await client.getByRole('navigation', { name: 'Secciones del sistema' }).getByRole('button', { name: 'Configuración', exact: true }).click()
  await button(client, 'General').click()
  const commercial = client.locator('section').filter({ has: client.getByRole('heading', { name: 'Configuración comercial', exact: true }) })
  await commercial.getByLabel('Valor', { exact: true }).fill('3.25')
  await commercial.getByLabel('Motivo comercial').fill('Autorización sintética en Chrome')
  await call(client, 'updateCommercialSettings', () => button(commercial, 'Autorizar y publicar').click())
  await commercial.getByText('Regla autorizada y publicada.').waitFor()
  const saved = (await db.collection('commercial_settings').doc('commission').get()).data()
  assert.equal(saved.releases[0].value, 3.25)
  await commercial.getByLabel('Motivo comercial').fill('Restauración comercial sintética')
  await call(client, 'updateCommercialSettings', () => button(commercial, 'Restaurar como borrador').click())
  await commercial.getByText('Borrador guardado con historial.').waitFor()
  assert.equal((await db.collection('commercial_settings').doc('commission').get()).data().version, 2)
  console.log('Playwright: edición de agencia, restauración, separación de roles, publicación comercial e historial verificados.')
} finally {
  await browser?.close()
  vite.kill()
}
