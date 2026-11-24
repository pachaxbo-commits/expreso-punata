import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/)
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):9099$/)
const project = 'demo-expreso-punata-users'
const app = initializeApp({ projectId: project })
const db = getFirestore(app)
const auth = getAuth(app)
const nonce = Date.now()
const password = 'Synthetic-Users-Only!32'
async function createAdmin(index) {
  const email = `admin-${index}-${nonce}@example.test`
  const { uid } = await auth.createUser({ email, password })
  await db.collection('users').doc(uid).set({
    uid, email, fullName: `Administrador sintético ${index}`, phone: '70000000',
    role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'],
  })
  return email
}
const firstAdmin = await createAdmin(1)
const secondAdmin = await createAdmin(2)
const url = 'http://127.0.0.1:4188'
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4188', '--strictPort'], {
  env: { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: project },
  stdio: 'inherit',
})
let browser
const button = (page, name) => page.getByRole('button', { name, exact: true })
async function login(email) {
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ serviceWorkers: 'block' })
  page.setDefaultTimeout(15000)
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'Operación sintética autorizada' : undefined))
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
  await page.getByRole('navigation', { name: 'Secciones del sistema' }).getByRole('button', { name: 'Configuración', exact: true }).click()
  await button(page, 'Usuarios y Permisos').click()
  return page
}
async function call(page, functionName, action, expectedError) {
  const response = page.waitForResponse(res => res.url().endsWith('/' + functionName) && res.request().method() === 'POST')
  await action()
  const data = await (await response).json()
  if (expectedError) assert.equal(data.error?.status, expectedError, JSON.stringify(data))
  else assert.ok(data.result, JSON.stringify(data.error))
  return data.result
}

try {
  let page = await login(firstAdmin)
  const email = `operador-${nonce}@example.test`
  await button(page, 'Registrar Nuevo Operador').click()
  await page.getByPlaceholder('Ej. María Flores Rocha').fill('Operador sintético')
  await page.getByPlaceholder('usuario@expresopunata.com').fill(email)
  await page.getByPlaceholder('Ej. 75999279').fill('70000000')
  await page.locator('form').filter({ has: button(page, 'Crear Operador') }).locator('select').filter({ has: page.locator('option[value=secretaria]') }).selectOption('secretaria')
  await call(page, 'adminProvisionUser', () => button(page, 'Crear Operador').click())
  const { uid } = await auth.getUserByEmail(email)
  const profile = db.collection('users').doc(uid)
  const lock = db.collection('cash_shift_active_locks').doc(`fixture-${uid}`)
  const history = db.collection('financial_movements').doc(`fixture-${uid}`)
  await profile.update({ emulatorDeletionEligible: true })
  await history.set({ operatorUid: uid, amountCents: 1500 })
  const row = () => page.getByRole('row').filter({ hasText: email })
  await page.getByPlaceholder(/Buscar por nombre, correo/).fill(email)
  await row().waitFor()
  assert.equal(await page.getByRole('row').filter({ hasText: firstAdmin }).count(), 0)
  await row().getByTitle('Editar datos de usuario').click()
  const form = page.locator('form').filter({ has: button(page, 'Guardar Cambios') })
  await form.locator('input[type=text]').first().fill('Operador sintético editado')
  await form.locator('select').selectOption('cochabamba')
  await call(page, 'adminProvisionUser', () => button(page, 'Guardar Cambios').click())
  assert.equal((await profile.get()).data().primaryBranchId, 'cochabamba')
  assert.equal((await profile.get()).data().fullName, 'Operador sintético editado')
  await call(page, 'adminProvisionUser', () => row().getByTitle('Suspender cuenta').click())
  assert.equal((await auth.getUser(uid)).disabled, true)
  await call(page, 'adminProvisionUser', () => row().getByTitle('Reactivar cuenta').click())
  assert.equal((await auth.getUser(uid)).disabled, false)
  await call(page, 'adminRevokeUserSessions', () => row().getByTitle('Revocar sesiones').click())
  await lock.set({ operatorUid: uid, status: 'open' })
  await row().getByTitle('Baja y eliminación de Auth').click()
  await call(page, 'adminRetireUser', () => button(page, 'Dar de baja').click(), 'FAILED_PRECONDITION')
  assert.equal((await auth.getUser(uid)).disabled, false)
  await lock.update({ status: 'closed' })
  const retirement = await call(page, 'adminRetireUser', () => button(page, 'Dar de baja').click())
  assert.equal((await auth.getUser(uid)).disabled, true)
  await page.getByText(retirement.operationId, { exact: false }).waitFor()
  await button(page, 'Cerrar operaciones').click()
  await row().getByTitle('Ver historial de auditoría').click()
  await page.getByLabel('Acción', { exact: true }).selectOption('USER_RETIRED')
  await page.getByLabel('Estado', { exact: true }).selectOption('success')
  await page.getByText('USER_RETIRED', { exact: true }).last().waitFor()
  await page.getByLabel('Acción, operador o resultado', { exact: true }).fill('texto sin coincidencias')
  await page.getByText('No hay eventos que coincidan con los filtros.').waitFor()
  await page.getByLabel('Acción, operador o resultado', { exact: true }).fill('operación sintética')
  await page.getByText(retirement.operationId, { exact: false }).waitFor()

  await page.getByLabel('Desde', { exact: true }).fill('2099-01-01')
  await page.getByText('No hay eventos que coincidan con los filtros.').waitFor()
  await page.getByLabel('Desde', { exact: true }).fill('')
  await page.getByLabel('Hasta', { exact: true }).fill('2000-01-01')
  await page.getByText('No hay eventos que coincidan con los filtros.').waitFor()
  await page.getByLabel('Hasta', { exact: true }).fill('')

  await page.getByText(retirement.operationId, { exact: false }).waitFor()
  await button(page, 'Cerrar Bitácora').click()
  await row().getByTitle('Baja y eliminación de Auth').click()
  // Force an Auth/Firestore mismatch on this emulator identity to exercise the real recovery path.
  await auth.updateUser(uid, { disabled: false })
  await call(page, 'adminDeleteRetiredUser', () => button(page, 'Eliminar identidad de Auth').click(), 'UNAVAILABLE')
  await page.getByText('Requiere reintento', { exact: true }).waitFor()
  const deletionId = (await profile.get()).data().authDeletionOperationId
  assert.equal((await auth.getUser(uid)).disabled, false)
  await auth.updateUser(uid, { disabled: true })
  await browser.close()
  page = await login(secondAdmin)
  await row().getByTitle('Baja y eliminación de Auth').click()
  await page.getByText(retirement.operationId, { exact: false }).waitFor()
  const deletion = await call(page, 'adminDeleteRetiredUser', () => button(page, 'Reintentar eliminación de auth').click())
  assert.equal(deletion.operationId, deletionId)
  await page.getByText(deletion.operationId, { exact: false }).waitFor()
  await assert.rejects(() => auth.getUser(uid), { code: 'auth/user-not-found' })
  assert.equal((await profile.get()).data().syncStatus, 'auth_deleted')
  assert.equal((await history.get()).data().operatorUid, uid)
  await button(page, 'Cerrar operaciones').click()
  await row().getByTitle('Ver historial de auditoría').click()
  await page.getByText(retirement.operationId, { exact: false }).waitFor()
  await page.getByLabel('Acción', { exact: true }).selectOption('USER_AUTH_DELETION')
  await page.getByText(deletion.operationId, { exact: false }).waitFor()
  console.log('Playwright: creación, edición, agencia, suspensión, reactivación, revocación, baja, historial, segunda sesión y eliminación de Auth verificados.')
} finally {
  await browser?.close()
  vite.kill()
}
