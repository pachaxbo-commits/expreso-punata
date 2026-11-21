import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/)
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):9099$/)
const app = initializeApp({ projectId: 'demo-expreso-punata-transfer' })
const db = getFirestore(app)
const auth = getAuth(app)
const nonce = Date.now()
const password = 'Demo-Admin-Browser-Only'
async function makeUser(role, name) {
  const email = role + nonce + '@example.test'
  const { uid } = await auth.createUser({ email, password })
  await db.collection('users').doc(uid).set({
    uid, role, email, fullName: name, phone: '70000000', isActive: true, primaryBranchId: 'punata',
    allowedBranchIds: role === 'afiliado_admin' ? ['punata', 'cochabamba'] : ['punata'],
  })
  return { uid, email }
}
const operator = await makeUser('afiliado_admin', 'Administración sintética')
const secretary = await makeUser('secretaria', 'Secretaría para revisar')
await db.collection('system_config').doc('expreso_punata').set({
  status: 'configured', isOfficial: true, tariffs: { baseFeeBob: 15, extraKgRateBob: 2 },
  company: { name: 'Empresa sintética' },
}, { merge: true })

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4188', '--strictPort'], { stdio: 'inherit' })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('dialog', dialog => dialog.accept())
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await page.goto('http://127.0.0.1:4188'); break } catch (error) { if (attempt === 19) throw error; await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  await page.locator('input[type=email]').fill(operator.email)
  await page.locator('input[type=password]').fill(password)
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('Iniciar Sesión').click()
  const navigation = page.getByRole('navigation', { name: 'Secciones del sistema' })
  const visit = name => navigation.getByRole('button', { name, exact: true }).click()
  const call = async (functionName, action) => {
    const response = page.waitForResponse(res => res.url().endsWith('/' + functionName) && res.request().method() === 'POST')
    await action()
    const data = await (await response).json()
    assert(data.result?.success, JSON.stringify(data.error))
    return data.result
  }
  const failures = []
  async function verify(label, action) {
    try {
      await action()
      console.log('Administración en Chrome: ' + label)
    } catch (error) {
      console.error(label, error)
      failures.push(error)
      await page.reload()
    }
  }

  await verify('suspensión y reactivación en Auth', async () => {
    await visit('Configuración')
    await button('Usuarios y Permisos').click()
    const row = page.getByRole('row').filter({ hasText: 'Secretaría para revisar' })
    await call('adminProvisionUser', () => row.getByTitle('Suspender cuenta').click())
    assert.equal((await auth.getUser(secretary.uid)).disabled, true)
    await call('adminProvisionUser', () => row.getByTitle('Reactivar cuenta').click())
    assert.equal((await auth.getUser(secretary.uid)).disabled, false)
  })

  await verify('guardado de configuración institucional', async () => {
    await visit('Configuración')
    const config = await call('getSystemConfig', () => button('General').click())
    assert(config.isOfficial)
    await call('updateSystemConfig', () => button('Guardar Cambios').click())
  })

  await verify('registro de gasto operativo', async () => {
    await visit('Personal & Gastos')
    await button('Gastos Operativos').click()
    await button('Registrar Gasto Operativo').click()
    const concept = page.getByPlaceholder(/Pago servicio de energía/)
    const form = page.locator('form').filter({ has: concept })
    await concept.fill('Gasto sintético de verificación')
    await form.getByPlaceholder('0.00').fill('3')
    await form.locator('select').filter({ has: page.locator('option[value=transfer]') }).selectOption('transfer')
    await call('registerGeneralExpense', () => button('Registrar Egreso e Imprimir').click())
  })

  await verify('registro de bien fijo', async () => {
    await visit('Inventario / Bienes Fijos')
    await button('Registrar Bien Fijo').click()
    await page.getByPlaceholder(/Impresora Térmica Xprinter/).fill('Bien sintético de verificación')
    await call('manageFixedAsset', () => button('Guardar Activo').click())
  })

  if (failures.length) throw new AggregateError(failures, 'Fallaron escenarios administrativos.')
} finally {
  await browser.close()
  preview.kill()
}
