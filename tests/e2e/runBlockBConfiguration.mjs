import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const firestorePort = process.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || '8080'
const authPort = process.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || '9099'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', new RegExp(`^(localhost|127\\.0\\.0\\.1):${firestorePort}$`))
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', new RegExp(`^(localhost|127\\.0\\.0\\.1):${authPort}$`))
const project = process.env.B4_PROJECT_ID || 'demo-expreso-punata-block-b-browser'
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
  if (name === 'updateB4Settings') {
    await page.getByText('Configuración guardada con versión e historial.', { exact: true }).waitFor()
  }
  return result
}

try {
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await signIn(support, 390)
  await page.getByRole('heading', { name: 'Centro de Soporte PACHAX' }).waitFor()
  await page.getByRole('heading', { name: 'Configuración comercial', exact: true }).waitFor()
  assert.equal(await button(page, 'Autorizar y publicar').count(), 0)
  const b4 = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Configuraciones operativas B4', exact: true }) })
  await b4.getByLabel('Área').selectOption('reports')
  await b4.locator('fieldset').filter({ hasText: 'Afiliados' }).getByLabel('fullName').uncheck()
  await b4.getByLabel('Motivo del cambio').fill('Preferencia sintética de columnas')
  await call(page, 'updateB4Settings', () => button(b4, 'Guardar configuración').click())
  assert.equal((await db.collection('b4_settings').doc('reports').get()).data().value.optionalColumns.members.includes('fullName'), false)
  await b4.getByLabel('Motivo del cambio').fill('Segunda preferencia para prueba de restauración')
  await b4.getByLabel('Orden de columnas').selectOption('alphabetical')
  await call(page, 'updateB4Settings', () => button(b4, 'Guardar configuración').click())
  await b4.getByLabel('Motivo del cambio').fill('Restauración sintética de columnas')
  await call(page, 'updateB4Settings', () => button(b4, 'Restaurar versión').nth(1).click())
  assert.equal((await db.collection('b4_settings').doc('reports').get()).data().value.order, 'source')
  await b4.getByLabel('Área').selectOption('notifications')
  await b4.getByLabel('Mostrar avisos de encomienda registrada').uncheck()
  await b4.getByLabel('Motivo del cambio').fill('Ocultar aviso informativo sintético')
  await call(page, 'updateB4Settings', () => button(b4, 'Guardar configuración').click())
  assert.equal((await db.collection('b4_settings').doc('notifications').get()).data().value.shipmentRegisteredVisible, false)
  await b4.getByLabel('Área').selectOption('catalogs')
  await b4.getByRole('combobox').nth(1).selectOption('fixedAssetCategories')
  await b4.getByLabel('oficina').fill('Oficina verificada por navegador')
  await b4.getByLabel('Motivo del cambio').fill('Etiqueta sintética de catálogo')
  await call(page, 'updateB4Settings', () => button(b4, 'Guardar configuración').click())
  assert.equal((await db.collection('b4_settings').doc('catalogs').get()).data().value.fixedAssetCategories.find(option => option.id === 'oficina').label, 'Oficina verificada por navegador')
  const institutional = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Configuración institucional', exact: true }) })
  await button(institutional, 'Punata').click()
  await institutional.getByLabel('Nuevo valor').fill('Agencia actualizada en Chrome')
  await institutional.getByLabel('Motivo', { exact: true }).fill('Cambio sintético de comprobantes')
  await call(page, 'updateSupportConfiguration', () => button(institutional, 'Guardar cambio').click())
  await institutional.getByText('Agencia actualizada en Chrome', { exact: true }).waitFor()
  assert.equal((await config.get()).data().branches.punata.name, 'Agencia actualizada en Chrome')
  const client = await signIn(admin, 1280)
  await client.getByRole('navigation', { name: 'Secciones del sistema' }).waitFor()
  const documentPreview = () => client.evaluate(async () => {
    const { printEngine } = await import('/src/services/printing/printEngineService.ts')
    return printEngine.generatePreviewHtml({
      documentType: 'test_page', title: 'Comprobante sintético', branchId: 'punata',
      branchName: 'Valor estático', documentNumber: 'TEST-1', timestampIso: new Date().toISOString(),
      operatorName: 'Operador de prueba', items: [], footerNotes: [],
    })
  })
  assert.match(await documentPreview(), /Agencia actualizada en Chrome/)
  await institutional.getByLabel('Motivo', { exact: true }).fill('Restauración sintética en Chrome')
  await call(page, 'updateSupportConfiguration', () => button(institutional, 'Restaurar valor anterior').click())
  await institutional.getByText('Agencia inicial', { exact: true }).waitFor()
  assert.equal((await config.get()).data().branches.punata.code, 'PUN')
  await button(institutional, 'Reportes').click()
  await institutional.getByLabel('Nuevo valor').selectOption('last_month')
  await institutional.getByLabel('Motivo', { exact: true }).fill('Preferencia sintética de reporte')
  await call(page, 'updateSupportConfiguration', () => button(institutional, 'Guardar cambio').click())
  await institutional.locator('strong').filter({ hasText: 'Mes anterior' }).waitFor()
  assert.match(await documentPreview(), /Agencia inicial/)
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
  await commercial.locator('select').first().selectOption('punata-cochabamba')
  await commercial.getByLabel('Tarifa base (centavos)', { exact: true }).fill('1600')
  await commercial.getByLabel('Peso incluido (kg)', { exact: true }).fill('2')
  await commercial.getByLabel('Kg adicional (centavos)', { exact: true }).fill('125')
  await commercial.getByLabel('Entrega a domicilio (centavos)', { exact: true }).fill('400')
  await commercial.getByLabel('Motivo comercial').fill('Tarifa sintética de navegador')
  await call(client, 'updateCommercialSettings', () => button(commercial, 'Autorizar y publicar').click())
  await commercial.getByText('Regla autorizada y publicada.').waitFor()
  assert.equal((await db.collection('commercial_settings').doc('punata-cochabamba').get()).data().releases[0].baseFeeCents, 1600)
  await client.getByRole('navigation', { name: 'Secciones del sistema' }).getByRole('button', { name: 'Reportes & Estadísticas', exact: true }).click()
  await button(client, 'Mes Anterior').and(client.locator('button.bg-emerald-900')).waitFor()
  const reportMonth = new Date()
  reportMonth.setUTCDate(1)
  reportMonth.setUTCMonth(reportMonth.getUTCMonth() - 1)
  await db.collection('union_members').doc('b4-chrome-report-member').set({
    id: 'b4-chrome-report-member', memberNumber: 'B4-CHROME', fullName: 'Afiliado sintético de reporte', category: 'socio_general',
    branchId: 'punata', status: 'active', monthlyFeeCents: 4200, createdAtIso: `${reportMonth.toISOString().slice(0, 7)}-15T12:00:00.000Z`,
  })
  await button(client, 'Afiliados y obligaciones').click()
  const reportTable = client.locator('table').filter({ hasText: 'B4-CHROME' })
  await reportTable.waitFor()
  const headers = (await reportTable.locator('thead th').allTextContents()).map(header => header.replace(/\s/g, '').toLowerCase())
  assert.ok(headers.includes('membernumber'))
  assert.equal(headers.includes('fullname'), false, 'la preferencia guardada se refleja en la tabla del reporte real')
  console.log('Playwright: configuraciones B4, restauración de columnas, visibilidad de avisos, etiquetas de catálogos, edición institucional, tarifas, comisiones y período de reportes verificados.')
} finally {
  await browser?.close()
  vite.kill()
}
