process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'
process.env.ENABLE_AUTOMATIC_PARCEL_PRICING = 'false'

const projectId = process.env.GCLOUD_PROJECT || 'demo-expreso-punata-navigation-pricing'
if (!projectId.startsWith('demo-')) throw new Error(`Este recorrido solo admite un proyecto demo de Emulator; recibido: ${projectId}`)
process.env.GCLOUD_PROJECT = projectId

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { chromium } from 'playwright-core'
import { openCashShift } from '../../functions/index.js'

if (getApps().length === 0) initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore()
const authAdmin = getAuth()
const uid = `sidebar-manual-${Date.now().toString(36)}`
const email = `${uid}@example.test`
const password = 'LocalOnly!2026'

function startStaticServer(port = 4173) {
  const distDir = path.resolve('dist')
  const server = http.createServer((req, res) => {
    const requested = path.join(distDir, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0])
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(distDir, 'index.html')
    const extension = path.extname(file).toLowerCase()
    const contentType = extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : extension === '.svg' ? 'image/svg+xml' : 'text/html; charset=utf-8'
    res.writeHead(200, { 'Content-Type': contentType })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function run() {
  await db.collection('users').doc(uid).set({
    uid, email, role: 'secretaria', fullName: 'Secretaría E2E',
    primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true,
  })
  await authAdmin.createUser({ uid, email, password, displayName: 'Secretaría E2E' })
  const shift = await openCashShift.run({ auth: { uid }, data: { branchId: 'punata', initialCashCents: 5000 } })

  const evidenceDir = process.env.E2E_EVIDENCE_DIR || path.resolve('tmp/navigation-manual-pricing')
  fs.mkdirSync(evidenceDir, { recursive: true })
  const server = await startStaticServer()
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const browserErrors = []
    page.on('pageerror', error => browserErrors.push(error.message))
    page.on('requestfailed', request => browserErrors.push(`${request.url()} ${request.failure()?.errorText || ''}`))
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.getByRole('complementary', { name: 'Navegación principal' }).waitFor()
    const sidebar = page.getByRole('complementary', { name: 'Navegación principal' })
    assert.equal(await sidebar.getByRole('button', { name: 'Configuración' }).count(), 0, 'Secretaría no ve Configuración')
    assert.equal(await page.getByText(/tarifa base o precio acordado/i).count(), 0, 'la pantalla no sugiere que se aplique una tarifa automática')
    const sectionButtons = await sidebar.locator('nav button').all()
    for (const button of sectionButtons) {
      const sectionName = await button.getAttribute('aria-label')
      await button.click()
      assert.equal(await button.getAttribute('aria-current'), 'page', `la navegación selecciona ${sectionName}`)
    }
    await sidebar.getByRole('button', { name: 'Encomiendas', exact: true }).click()
    await page.screenshot({ path: path.join(evidenceDir, '01-menu-expandido.png') })

    await page.getByRole('button', { name: 'Contraer menú lateral' }).click()
    await page.getByRole('button', { name: 'Expandir menú lateral' }).waitFor()
    await page.screenshot({ path: path.join(evidenceDir, '02-menu-contraido.png') })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Expandir menú lateral' }).waitFor()
    await page.getByRole('button', { name: 'Expandir menú lateral' }).click()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Abrir menú de navegación' }).click()
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(evidenceDir, '03-menu-movil.png') })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'el menú móvil no genera desplazamiento horizontal')
    const openDrawerBox = await sidebar.boundingBox()
    assert.ok(openDrawerBox && Math.abs(openDrawerBox.x) <= 1, `el drawer debe quedar visible desde el borde izquierdo: ${JSON.stringify(openDrawerBox)}`)
    await sidebar.getByRole('button', { name: 'Cerrar menú de navegación' }).click()
    await page.getByRole('button', { name: 'Abrir menú de navegación' }).click()
    await page.mouse.click(375, 820)
    await page.waitForTimeout(200)
    const outsideClosedBox = await sidebar.boundingBox()
    assert.ok(outsideClosedBox && outsideClosedBox.x < -200, 'tocar fuera del drawer lo cierra')
    await page.getByRole('button', { name: 'Abrir menú de navegación' }).click()
    await page.getByRole('button', { name: 'Encomiendas', exact: true }).click()
    await page.waitForTimeout(200)
    const mobileSidebarBox = await sidebar.boundingBox()
    assert.ok(mobileSidebarBox && mobileSidebarBox.x < -200, 'seleccionar una sección cierra el menú móvil')
    await page.setViewportSize({ width: 768, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'el diseño tablet no genera desplazamiento horizontal')
    await page.screenshot({ path: path.join(evidenceDir, '04-menu-tablet.png') })
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.locator('[data-tutorial-target="btn-new-shipment"]').click()
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await page.locator('input[placeholder="Ej. Juan Pérez"]').fill('Remitente E2E')
    await page.locator('input[placeholder="Ej. 71712345"]').fill('70011111')
    await page.locator('input[placeholder="Ej. María López"]').fill('Destinataria E2E')
    await page.locator('input[placeholder="Ej. 72234567"]').fill('70022222')
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await page.getByText('Escriba el importe acordado con el cliente. El sistema no calcula tarifas automáticamente.', { exact: true }).waitFor()
    const priceInput = page.locator('#shipment-manual-price')
    assert.equal(await priceInput.inputValue(), '', 'el monto inicia vacío y no recibe una sugerencia automática')
    assert.equal(await page.getByText(/Tarifa sugerida por peso\/tipo/).count(), 0)
    await priceInput.fill('12.34')
    await page.screenshot({ path: path.join(evidenceDir, '05-encomienda-precio-manual.png') })
    const wizardPanel = page.locator('div.max-w-2xl.overflow-hidden')
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(200)
      const panelBox = await wizardPanel.boundingBox()
      assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= width, `el formulario se ajusta a ${width}px`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `el formulario no genera desbordamiento a ${width}px`)
      await priceInput.scrollIntoViewIfNeeded()
      const priceBox = await priceInput.boundingBox()
      const nextButtonBox = await page.getByRole('button', { name: 'Siguiente', exact: true }).boundingBox()
      assert.ok(priceBox && nextButtonBox && priceBox.y + priceBox.height <= nextButtonBox.y, `el campo de precio queda visible sobre los controles a ${width}px`)
      if (width === 390) await page.screenshot({ path: path.join(evidenceDir, '06-encomienda-precio-manual-movil.png') })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await page.getByRole('button', { name: 'Confirmar y Emitir Guía' }).click()
    await page.getByText('¡Guía de Encomienda Emitida Exitosamente!').waitFor({ timeout: 15000 })

    const shipmentSnapshot = await db.collection('shipments').where('registeredByUid', '==', uid).limit(1).get()
    assert.equal(shipmentSnapshot.size, 1)
    const shipment = shipmentSnapshot.docs[0].data()
    assert.equal(shipment.agreedAmountCents, 1234)
    assert.equal(shipment.finalAmountCents, 1234)
    assert.equal(shipment.suggestedAmountCents, null)
    const movement = await db.collection('financial_movements').doc(`MOV-${shipment.trackingCode}`).get()
    assert.equal(movement.data().amountCents, 1234)
    assert.equal((await db.collection('cash_shifts').doc(shift.shift.id).get()).data().expectedCashCents, 6234)
    assert.deepEqual(browserErrors, [], 'el navegador no informa fallos de página ni solicitudes')
    console.log('PASS: menú expandido/contraído, persistencia, rol, drawer móvil y precio manual de Bs 12.34.')
    console.log(`Evidencias guardadas en ${evidenceDir}`)
  } finally {
    await browser.close()
    server.close()
  }
}

run().catch(error => {
  console.error('FALLO EN RECORRIDO DE NAVEGACIÓN Y PRECIO MANUAL:', error)
  process.exit(1)
})
