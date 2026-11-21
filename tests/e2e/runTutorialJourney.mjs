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
import { TUTORIAL_SECTIONS } from '../../src/modules/tutorial/tutorialSectionsData.ts'

const projectId = process.env.GCLOUD_PROJECT
if (!projectId.startsWith('demo-')) throw new Error('El recorrido solo admite un proyecto Firebase demo de Emulator.')
if (getApps().length === 0) initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore()
const authAdmin = getAuth()
const suffix = Date.now().toString(36)
const password = 'TutorialLocalOnly!2026'
const users = {
  secretary: { uid: `tutorial-secretary-${suffix}`, role: 'secretaria', fullName: 'Secretaría Tutorial Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata'] },
  driver: { uid: `tutorial-driver-${suffix}`, role: 'conductor', fullName: 'Chofer Tutorial Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata'], assignedMobileNumber: 'T-14' },
  treasury: { uid: `tutorial-treasury-${suffix}`, role: 'tesoreria', fullName: 'Tesorería Tutorial Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] },
  director: { uid: `tutorial-director-${suffix}`, role: 'directiva_admin', fullName: 'Dirección Tutorial Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] },
  affiliate: { uid: `tutorial-affiliate-${suffix}`, role: 'afiliado', fullName: 'Afiliado Tutorial Demo', primaryBranchId: 'punata', allowedBranchIds: ['punata'], unionMemberId: `member-${suffix}` },
}
for (const user of Object.values(users)) {
  const email = `${user.uid}@example.test`
  await db.collection('users').doc(user.uid).set({ ...user, email, isActive: true })
  await authAdmin.createUser({ uid: user.uid, email, password, displayName: user.fullName })
}
await db.collection('union_members').doc(users.affiliate.unionMemberId).set({
  id: users.affiliate.unionMemberId,
  fullName: users.affiliate.fullName,
  memberNumber: 'DEMO-TUT-01',
  branchId: 'punata',
  status: 'active',
})
await openCashShift.run({ auth: { uid: users.secretary.uid }, data: { branchId: 'punata', initialCashCents: 25000 } })

const evidenceDir = path.resolve(process.env.E2E_EVIDENCE_DIR || 'tmp/tutorial-final')
fs.mkdirSync(evidenceDir, { recursive: true })
const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0])
  const requested = path.join(path.resolve('dist'), requestPath === '/' ? 'index.html' : requestPath)
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.resolve('dist/index.html')
  const extension = path.extname(file).toLowerCase()
  const contentType = extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : extension === '.svg' ? 'image/svg+xml' : 'text/html; charset=utf-8'
  res.writeHead(200, { 'Content-Type': contentType })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(4175, '127.0.0.1', resolve))

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: fs.existsSync(chromePath) ? chromePath : undefined, headless: true })
const browserErrors = []

async function login(page, user, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport)
  await page.goto('http://127.0.0.1:4175', { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', `${user.uid}@example.test`)
  await page.fill('input[type="password"]', password)
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click()
  try {
    await page.getByRole('complementary', { name: 'Navegación principal' }).waitFor({ timeout: 20000 })
  } catch (error) {
    await page.screenshot({ path: path.join(evidenceDir, `login-failure-${user.role}.png`) }).catch(() => {})
    const visibleText = (await page.locator('body').innerText().catch(() => '')).slice(0, 1200)
    throw new Error(`Inicio de sesión E2E de ${user.role} no llegó al panel. Página: ${visibleText}. Error: ${error.message}`)
  }
}

async function openCenter(page) {
  await page.locator('[data-tutorial-target="header-tutorial-btn"]').click()
  await page.getByRole('dialog', { name: 'Centro de Aprendizaje Expreso Punata' }).waitFor()
}

async function startSection(page, sectionId) {
  const section = TUTORIAL_SECTIONS.find((item) => item.id === sectionId)
  assert.ok(section, `Sección de tutorial desconocida: ${sectionId}`)
  await page.getByRole('button', { name: section.isOptional ? /^Configuración \/ Opcionales/ : /^Ruta Operativa/ }).click()
  const card = page.locator(`[data-tutorial-section-card="${sectionId}"]`)
  await card.getByRole('button', { name: 'Aprender', exact: true }).click()
  await page.locator('[data-tutorial-card="true"]').waitFor()
  return section
}

async function assertCurrentTarget(page, section, index) {
  const step = section.steps[index]
  let target = page.locator(step.target).first()
  try {
    await target.waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    if (step.fallbackTarget) {
      target = page.locator(step.fallbackTarget).first()
      await target.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    }
  }
  assert.equal(await target.isVisible().catch(() => false), true, `El target del paso ${step.id} no está visible: ${step.target}`)
  const warning = page.getByText('Elemento en vista actual', { exact: true })
  assert.equal(await warning.count(), 0, `El tutorial no encontró el ancla del paso ${step.id}`)
  const viewport = page.viewportSize()
  const spotlight = page.locator('[data-tutorial-spotlight="true"]')
  let targetBox = null
  let spotlightBox = null
  for (let attempt = 0; attempt < 20; attempt++) {
    targetBox = await target.boundingBox()
    spotlightBox = await spotlight.boundingBox().catch(() => null)
    const targetIsOnScreen = targetBox && viewport
      && targetBox.x >= -1 && targetBox.x + targetBox.width <= viewport.width + 1
      && targetBox.y < viewport.height && targetBox.y + targetBox.height > 0
    if (targetIsOnScreen && spotlightBox
      && Math.abs(spotlightBox.x - (targetBox.x - 4)) <= 10
      && Math.abs(spotlightBox.y - (targetBox.y - 4)) <= 10
      && Math.abs(spotlightBox.width - (targetBox.width + 8)) <= 10
      && Math.abs(spotlightBox.height - (targetBox.height + 8)) <= 10) break
    await page.waitForTimeout(50)
  }
  assert.ok(targetBox && viewport && spotlightBox
    && targetBox.x >= -1 && targetBox.x + targetBox.width <= viewport.width + 1
    && targetBox.y < viewport.height && targetBox.y + targetBox.height > 0
    && Math.abs(spotlightBox.x - (targetBox.x - 4)) <= 10
    && Math.abs(spotlightBox.y - (targetBox.y - 4)) <= 10
    && Math.abs(spotlightBox.width - (targetBox.width + 8)) <= 10
    && Math.abs(spotlightBox.height - (targetBox.height + 8)) <= 10,
  'El resaltado no coincide con el elemento ' + step.id + ': target=' + JSON.stringify(targetBox) + ' spotlight=' + JSON.stringify(spotlightBox))
  const card = await page.locator('[data-tutorial-card="true"]').boundingBox()
  assert.ok(card && viewport && card.x >= 0 && card.y >= 0 && card.x + card.width <= viewport.width + 1 && card.y + card.height <= viewport.height + 1,
    `La tarjeta del paso ${step.id} se desborda del viewport ${JSON.stringify(viewport)}: ${JSON.stringify(card)}`)
}

async function advance(page, section, index) {
  await tutorialButton(page, 'Siguiente').click()
  await assertCurrentTarget(page, section, index + 1)
}

function tutorialButton(page, name) {
  return page.locator('[data-tutorial-card="true"]').getByRole('button', { name, exact: true })
}

try {
  const before = {
    movements: (await db.collection('financial_movements').get()).size,
    tickets: (await db.collection('passenger_ticket_operations').get()).size,
    shipments: (await db.collection('shipments').get()).size,
  }
  const secretaryContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await secretaryContext.newPage()
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('requestfailed', (request) => browserErrors.push(`${request.url()} ${request.failure()?.errorText || ''}`))
  await login(page, users.secretary)
  const sidebar = page.getByRole('complementary', { name: 'Navegación principal' })
  await sidebar.getByRole('button', { name: 'Contraer menú lateral' }).click()
  await openCenter(page)
  const nav = await startSection(page, 'panel_navigation')
  await assertCurrentTarget(page, nav, 0)
  await page.screenshot({ path: path.join(evidenceDir, '01-menu-lateral-1440.png'), fullPage: true })
  await advance(page, nav, 0)
  await assertCurrentTarget(page, nav, 1)
  await tutorialButton(page, 'Anterior').click()
  await assertCurrentTarget(page, nav, 0)
  await tutorialButton(page, 'Siguiente').click()
  await assertCurrentTarget(page, nav, 1)
  await page.keyboard.press('Escape')
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })
  await openCenter(page)
  await page.getByRole('button', { name: 'Continuar donde lo dejé' }).click()
  await assertCurrentTarget(page, nav, 1)
  await tutorialButton(page, 'Siguiente').click()
  await assertCurrentTarget(page, nav, 2)
  await tutorialButton(page, 'Siguiente').click()
  await assertCurrentTarget(page, nav, 3)
  await tutorialButton(page, 'Finalizar Módulo').click()
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })

  await openCenter(page)
  const shipments = await startSection(page, 'shipments_window')
  await assertCurrentTarget(page, shipments, 0)
  await advance(page, shipments, 0)
  await assertCurrentTarget(page, shipments, 1)
  await page.screenshot({ path: path.join(evidenceDir, '02-encomiendas-formulario.png'), fullPage: true })
  await tutorialButton(page, 'Pausar tutorial (Escape)').click()
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })
  await openCenter(page)
  await page.getByRole('button', { name: 'Continuar donde lo dejé' }).click()
  await assertCurrentTarget(page, shipments, 1)
  for (let index = 1; index < shipments.steps.length - 1; index++) await advance(page, shipments, index)
  await tutorialButton(page, 'Finalizar Módulo').click()
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })

  await openCenter(page)
  const pricing = await startSection(page, 'shipments_pricing')
  await assertCurrentTarget(page, pricing, 0)
  await page.screenshot({ path: path.join(evidenceDir, '02b-precio-manual.png'), fullPage: true })
  await tutorialButton(page, 'Salir del tutorial').click()
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-tutorial-target="shipment-pricing-box"]').count(), 0, 'Salir del tutorial debe cerrar el formulario que abrió el tutorial')

  await openCenter(page)
  const tickets = await startSection(page, 'passenger_ticket_sales')
  await assertCurrentTarget(page, tickets, 0)
  await advance(page, tickets, 0)
  await assertCurrentTarget(page, tickets, 1)
  await page.screenshot({ path: path.join(evidenceDir, '03-pasajes-venta-manual.png'), fullPage: true })
  await advance(page, tickets, 1)
  await assertCurrentTarget(page, tickets, 2)
  await advance(page, tickets, 2)
  await assertCurrentTarget(page, tickets, 3)
  await advance(page, tickets, 3)
  await assertCurrentTarget(page, tickets, 4)
  await tutorialButton(page, 'Finalizar Módulo').click()
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('heading', { name: 'Registrar pasaje' }).count(), 0, 'El tutorial no debe dejar abierto su formulario de pasajes')

  await openCenter(page)
  const cash = await startSection(page, 'cash_management')
  await assertCurrentTarget(page, cash, 0)
  await advance(page, cash, 0)
  await assertCurrentTarget(page, cash, 1)
  await page.screenshot({ path: path.join(evidenceDir, '04-caja-movimientos-qr.png'), fullPage: true })
  await page.setViewportSize({ width: 768, height: 900 })
  await page.waitForTimeout(150)
  await assertCurrentTarget(page, cash, 1)
  await page.screenshot({ path: path.join(evidenceDir, '07-tutorial-768.png'), fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(150)
  await assertCurrentTarget(page, cash, 1)
  await page.screenshot({ path: path.join(evidenceDir, '08-tutorial-1920.png'), fullPage: true })
  await page.getByRole('button', { name: 'Salir del tutorial' }).click()
  await page.locator('[data-tutorial-card="true"]').waitFor({ state: 'detached' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sidebar.waitFor({ state: 'visible' })
  await openCenter(page)
  assert.equal(await page.getByRole('button', { name: 'Continuar donde lo dejé' }).count(), 1, 'El progreso debe conservarse después de recargar')
  await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click()

  const roleContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const treasuryPage = await roleContext.newPage()
  treasuryPage.on('pageerror', (error) => browserErrors.push(error.message))
  await login(treasuryPage, users.treasury)
  await openCenter(treasuryPage)
  await treasuryPage.getByRole('button', { name: /^Configuración \/ Opcionales/ }).click()
  const treasurySections = await treasuryPage.locator('[data-tutorial-section-card]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-tutorial-section-card')))
  assert.ok(treasurySections.includes('passenger_ticket_review'), `Tesorería debe ver su tutorial de pasajes. Tarjetas: ${treasurySections.join(', ')}`)
  assert.ok(!treasurySections.includes('passenger_ticket_sales'), 'Tesorería no debe ver el recorrido de venta de pasajes.')
  await treasuryPage.getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await roleContext.close()

  const affiliateContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const affiliatePage = await affiliateContext.newPage()
  affiliatePage.on('pageerror', (error) => browserErrors.push(error.message))
  await login(affiliatePage, users.affiliate, { width: 390, height: 844 })
  await openCenter(affiliatePage)
  assert.equal(await affiliatePage.getByText('24. Mi cuenta de afiliado', { exact: true }).count(), 1)
  const affiliateSection = await startSection(affiliatePage, 'affiliate_account')
  await assertCurrentTarget(affiliatePage, affiliateSection, 0)
  await affiliatePage.screenshot({ path: path.join(evidenceDir, '06-tutorial-movil-afiliado-390.png'), fullPage: true })
  await tutorialButton(affiliatePage, 'Salir del tutorial').click()
  await affiliateContext.close()

  const directorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const directorPage = await directorContext.newPage()
  directorPage.on('pageerror', (error) => browserErrors.push(error.message))
  await login(directorPage, users.director)
  await openCenter(directorPage)
  const unionAdmin = await startSection(directorPage, 'union_management')
  await assertCurrentTarget(directorPage, unionAdmin, 0)
  for (let index = 0; index < 5; index++) await advance(directorPage, unionAdmin, index)
  await assertCurrentTarget(directorPage, unionAdmin, 5)
  await tutorialButton(directorPage, 'Salir del tutorial').click()
  await directorContext.close()

  const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const driverPage = await driverContext.newPage()
  driverPage.on('pageerror', (error) => browserErrors.push(error.message))
  await login(driverPage, users.driver, { width: 390, height: 844 })
  assert.equal(await driverPage.getByText('Sesión activa', { exact: true }).count(), 1, 'El chofer no debe heredar el indicador de la suscripción de Encomiendas')
  assert.equal(await driverPage.getByText('El menú muestra las funciones disponibles para tu perfil.').count(), 1)
  await openCenter(driverPage)
  assert.equal(await driverPage.getByText('19. Chofer: Validar pasajes asignados', { exact: true }).count(), 1)
  assert.equal(await driverPage.getByText('18. Pasajes: Venta QR, comprobantes y entrega al chofer', { exact: true }).count(), 0)
  const driverTutorial = await startSection(driverPage, 'passenger_ticket_driver')
  await assertCurrentTarget(driverPage, driverTutorial, 0)
  await driverPage.screenshot({ path: path.join(evidenceDir, '05-chofer-validar-pasaje.png'), fullPage: true })
  await advance(driverPage, driverTutorial, 0)
  await assertCurrentTarget(driverPage, driverTutorial, 1)
  await driverPage.setViewportSize({ width: 390, height: 844 })
  await assertCurrentTarget(driverPage, driverTutorial, 1)
  await driverPage.screenshot({ path: path.join(evidenceDir, '06-tutorial-movil-chofer-390.png'), fullPage: true })
  await tutorialButton(driverPage, 'Finalizar Módulo').click()
  await driverContext.close()

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobilePage = await mobileContext.newPage()
  mobilePage.on('pageerror', (error) => browserErrors.push(error.message))
  await login(mobilePage, users.secretary, { width: 390, height: 844 })
  await openCenter(mobilePage)
  const mobileNav = await startSection(mobilePage, 'panel_navigation')
  await advance(mobilePage, mobileNav, 0)
  await assertCurrentTarget(mobilePage, mobileNav, 1)
  await mobilePage.screenshot({ path: path.join(evidenceDir, '06-tutorial-movil-menu-390.png'), fullPage: true })
  await advance(mobilePage, mobileNav, 1)
  await assertCurrentTarget(mobilePage, mobileNav, 2)
  await mobilePage.setViewportSize({ width: 390, height: 844 })
  await assertCurrentTarget(mobilePage, mobileNav, 2)
  await tutorialButton(mobilePage, 'Salir del tutorial').click()
  await mobileContext.close()

  const after = {
    movements: (await db.collection('financial_movements').get()).size,
    tickets: (await db.collection('passenger_ticket_operations').get()).size,
    shipments: (await db.collection('shipments').get()).size,
  }
  assert.deepEqual(after, before, 'Los recorridos del tutorial no deben modificar Caja, pasajes ni encomiendas.')
  assert.deepEqual(browserErrors, [], `Errores de consola/red: ${browserErrors.join('; ')}`)
  console.log(`Tutorial E2E aprobado para roles y viewports. Evidencias: ${evidenceDir}`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
