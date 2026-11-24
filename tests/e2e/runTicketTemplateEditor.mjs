import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080')
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099')
const projectId = process.env.GCLOUD_PROJECT || 'demo-expreso-punata'
const app = initializeApp({ projectId }, `ticket-editor-e2e-${process.pid}`)
const auth = getAuth(app)
const db = getFirestore(app)
const suffix = `${Date.now()}-${process.pid}`
const email = `ticket-editor-${suffix}@example.test`
const password = 'LocalOnly!23456'
const user = await auth.createUser({ email, password })
await db.collection('users').doc(user.uid).set({ uid: user.uid, email, fullName: 'Admin E2E', role: 'directiva_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true })

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4192', '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'print', { configurable: true, value: () => window.parent.postMessage({ type: 'synthetic-print-call' }, '*') })
  })
  page.on('pageerror', error => console.error('[ticket-editor e2e]', error.message))
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await page.goto('http://127.0.0.1:4192'); break } catch (error) { if (attempt === 39) throw error; await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  await page.getByRole('button', { name: 'Configuración', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Configuración', exact: true }).click()
  await page.getByRole('button', { name: 'Impresoras y Tickets', exact: true }).click()
  await page.getByRole('button', { name: 'Editor de guías', exact: true }).click()
  await page.getByTestId('ticket-template-editor').waitFor()
  assert.equal(await page.getByRole('checkbox', { name: /Fecha y hora/ }).isDisabled(), true)
  assert.equal(await page.getByRole('checkbox', { name: /Destino/ }).isDisabled(), true)
  const previewFrame = page.frameLocator('iframe[title="Vista previa del ticket sintético"]')
  await previewFrame.getByText('TEST-SINTETICO-0001').waitFor()
  await previewFrame.getByText('DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL').waitFor()
  await page.getByText(/NIT: no hay un NIT configurado/).waitFor()
  await page.getByLabel('Papel de vista previa').selectOption('58mm')
  await page.waitForFunction(() => document.querySelector('iframe[title="Vista previa del ticket sintético"]')?.contentDocument?.querySelector('style')?.textContent.includes('size:58mm auto'))
  await page.getByLabel('Papel de vista previa').selectOption('80mm')
  await page.waitForFunction(() => document.querySelector('iframe[title="Vista previa del ticket sintético"]')?.contentDocument?.querySelector('style')?.textContent.includes('size:80mm auto'))
  await page.getByTestId('second-copy-toggle').check()
  await page.waitForFunction(() => document.querySelector('iframe[title="Vista previa del ticket sintético"]')?.contentDocument?.querySelectorAll('.ticket-copy').length === 2)
  assert.equal(await previewFrame.getByText('GUÍA TEST-SINTETICO-0001', { exact: true }).count(), 2)
  await page.getByLabel('Copia que editas').selectOption('agency')
  await page.getByRole('button', { name: 'Duplicar a cliente' }).click()
  const headerText = page.getByLabel('Texto adicional de encabezado')
  await headerText.fill('Texto guardado desde Playwright')
  await page.getByTestId('save-ticket-template').click()
  await page.getByText('Plantilla guardada en versión 1. La auditoría quedó registrada.').waitFor()
  assert.equal((await db.doc('ticket_templates/shipment_guide').get()).data().template.customer.headerText, 'Texto guardado desde Playwright')
  await headerText.fill('Segunda versión sintética')
  await page.getByTestId('save-ticket-template').click()
  await page.getByText('Plantilla guardada en versión 2. La auditoría quedó registrada.').waitFor()
  await page.getByLabel('Versión para restaurar').selectOption('1')
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await page.getByText('Versión 1 restaurada como nueva versión 3.').waitFor()
  assert.equal((await db.doc('ticket_templates/shipment_guide').get()).data().template.customer.headerText, 'Texto guardado desde Playwright')
  await page.getByRole('button', { name: 'Prueba Rongta Windows', exact: true }).click()
  await page.getByTestId('rongta-print-test').waitFor()
  await page.getByRole('button', { name: 'Imprimir ticket 80 mm' }).waitFor()
  await page.getByText(/No interpretes “Diálogo abierto”/).waitFor()
  await page.getByLabel('Modelo de impresora').fill('Rongta RP80 sintética')
  await page.getByLabel('Versión/nombre del driver').fill('Driver local sintético 1.0')
  const beforeShipments = (await db.collection('shipments').get()).size
  const beforeMovements = (await db.collection('financial_movements').get()).size
  await page.getByTestId('print-80').click()
  await page.getByRole('status').filter({ hasText: 'Diálogo abierto; esta respuesta no confirma' }).waitFor()
  assert.equal((await db.collection('shipments').get()).size, beforeShipments)
  assert.equal((await db.collection('financial_movements').get()).size, beforeMovements)
  console.log('[ticket-editor e2e] editor, versions, two copies with shared guide number, 58/80 preview, simulated print without business writes, legal copy, NIT notice and Rongta test panel verified')
} finally {
  await browser.close()
  preview.kill()
  await auth.deleteUser(user.uid).catch(() => {})
  await db.collection('users').doc(user.uid).delete().catch(() => {})
}
