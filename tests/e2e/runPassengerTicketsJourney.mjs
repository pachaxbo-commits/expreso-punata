process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.GCLOUD_PROJECT ||= 'demo-expreso-punata'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { chromium } from 'playwright-core'
import { openCashShift } from '../../functions/index.js'

const projectId = process.env.GCLOUD_PROJECT
if (!projectId.startsWith('demo-')) throw new Error('Este E2E requiere un proyecto Firebase demo aislado.')
if (getApps().length === 0) initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore()
const authAdmin = getAuth()
const suffix = Date.now().toString(36)
const officeUid = `ticket-office-${suffix}`
const driverUid = `ticket-driver-${suffix}`
const emails = { office: `${officeUid}@example.test`, driver: `${driverUid}@example.test` }
const password = 'LocalOnly!2026'

function startStaticServer(port = 4174) {
  const distDir = path.resolve('dist')
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0])
    const requested = path.join(distDir, requestPath === '/' ? 'index.html' : requestPath)
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(distDir, 'index.html')
    const type = path.extname(file) === '.js' ? 'application/javascript' : path.extname(file) === '.css' ? 'text/css' : 'text/html; charset=utf-8'
    res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function login(page, email) {
  await page.goto('http://127.0.0.1:4174', { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.getByRole('complementary', { name: 'Navegación principal' }).waitFor({ timeout: 15000 })
}

async function run() {
  await db.collection('users').doc(officeUid).set({ uid: officeUid, email: emails.office, role: 'secretaria', fullName: 'Secretaría Pasajes Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
  await db.collection('users').doc(driverUid).set({ uid: driverUid, email: emails.driver, role: 'conductor', fullName: 'Chofer Pasajes Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
  await authAdmin.createUser({ uid: officeUid, email: emails.office, password, displayName: 'Secretaría Pasajes Demo' })
  await authAdmin.createUser({ uid: driverUid, email: emails.driver, password, displayName: 'Chofer Pasajes Demo' })
  await openCashShift.run({ auth: { uid: officeUid }, data: { branchId: 'punata', initialCashCents: 50000 } })
  const evidenceDir = process.env.E2E_EVIDENCE_DIR || path.resolve('tmp/passenger-tickets')
  fs.mkdirSync(evidenceDir, { recursive: true })
  const server = await startStaticServer()
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('requestfailed', (request) => errors.push(`${request.url()} ${request.failure()?.errorText || ''}`))
    await login(page, emails.office)
    const sidebar = page.getByRole('complementary', { name: 'Navegación principal' })
    await sidebar.getByRole('button', { name: 'Pasajes', exact: true }).click()
    await page.getByRole('button', { name: 'Nuevo pasaje' }).click()
    await page.getByLabel('Fecha del viaje').fill('2026-12-15')
    const saleForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Registrar pasaje' }) })
    await saleForm.getByLabel('Chofer').selectOption(driverUid)
    await saleForm.getByLabel('Nombre del pasajero (opcional)').fill('Pasajero Demo')
    await saleForm.getByLabel('Cantidad de pasajes').fill('2')
    await saleForm.getByLabel('Importe por pasaje (Bs)').fill('12,50')
    assert.match(await saleForm.locator('strong.font-mono.text-xl').textContent(), /25/)
    await page.screenshot({ path: path.join(evidenceDir, '01-venta-pasajes.png'), fullPage: true })
    await page.getByRole('button', { name: 'Registrar operación' }).click()
    await page.getByRole('heading', { name: 'Confirmar pago QR recibido' }).waitFor()
    await page.getByLabel('Importe que aparece recibido (Bs)').fill('25,00')
    await page.getByLabel('Referencia bancaria (opcional)').fill('REF-DEMO')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Confirmar pago recibido' }).click()
    await page.getByTitle('Vista previa de los dos comprobantes').waitFor()
    const frame = page.frameLocator('iframe[title="Vista previa de los dos comprobantes"]')
    assert.equal(await frame.locator('[data-ticket-copy]').count(), 2)
    const ticketHtml = await frame.locator('html').evaluate((element) => element.outerHTML)
    const ticketEvidence = await browser.newPage({ viewport: { width: 900, height: 1200 } })
    await ticketEvidence.setContent(`<!doctype html>${ticketHtml}`)
    await ticketEvidence.screenshot({ path: path.join(evidenceDir, '02-dos-comprobantes.png'), fullPage: true })
    await ticketEvidence.close()
    await page.getByRole('button', { name: 'Cerrar comprobantes' }).click()
    await page.getByText('Pendiente de entrega', { exact: false }).first().waitFor()
    await page.screenshot({ path: path.join(evidenceDir, '03-pendiente-chofer.png'), fullPage: true })
    const operation = (await db.collection('passenger_ticket_operations').where('createdByUid', '==', officeUid).limit(1).get()).docs[0]
    assert.ok(operation)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('complementary', { name: 'Navegación principal' }).getByRole('button', { name: 'Pasajes', exact: true }).click()
    await page.getByText(operation.data().operationNumber, { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Reimprimir (duplicado)' }).click()
    const reprint = page.frameLocator('iframe[title="Vista previa de los dos comprobantes"]')
    assert.equal(await reprint.getByText('DUPLICADO · REIMPRESIÓN').count(), 2)
    await page.getByRole('button', { name: 'Cerrar comprobantes' }).click()

    const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const driverPage = await driverContext.newPage()
    await login(driverPage, emails.driver)
    const driverSidebar = driverPage.getByRole('complementary', { name: 'Navegación principal' })
    await driverPage.getByRole('button', { name: 'Abrir menú de navegación' }).click()
    await driverSidebar.getByRole('button', { name: 'Validar pasajes', exact: true }).click()
    await driverPage.getByText(operation.data().operationNumber).waitFor()
    await driverPage.locator('#passenger-ticket-code').fill(operation.id)
    await driverPage.getByRole('button', { name: 'Validar pasaje', exact: true }).click()
    await driverPage.getByRole('status').waitFor()
    await driverPage.screenshot({ path: path.join(evidenceDir, '04-validacion-chofer-movil.png'), fullPage: true })
    await driverContext.close()

    await page.getByRole('button', { name: 'Entregar efectivo' }).click()
    await page.getByRole('button', { name: 'Confirmar entrega en efectivo' }).click()
    await page.getByText('Entrega registrada.', { exact: false }).waitFor()
    const result = (await db.collection('passenger_ticket_operations').doc(operation.id).get()).data()
    assert.equal(result.settlementStatus, 'delivered')
    assert.equal(result.pendingSettlementCents, 0)
    assert.equal((await db.collection('financial_movements').where('ticketOperationId', '==', operation.id).get()).size, 2)
    assert.deepEqual(errors, [], `errores de navegador/red: ${errors.join('; ')}`)
    console.log(`E2E pasajes aprobado; evidencia: ${evidenceDir}; operación: ${result.operationNumber}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
