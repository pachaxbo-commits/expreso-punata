import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const project = 'demo-expreso-punata-transfer'
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/)
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):9099$/)
const db = getFirestore(initializeApp({ projectId: project }))
const nonce = Date.now()
async function createOperator(label, role, branch, branches = [branch]) {
  const email = label + nonce + '@example.test'
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo-password', returnSecureToken: true }),
  })
  const { localId: uid, idToken } = await response.json()
  assert(uid && idToken)
  await db.collection('users').doc(uid).set({ uid, email, fullName: label, role, primaryBranchId: branch, allowedBranchIds: branches, isActive: true })
  return { email, uid, idToken }
}

const origin = await createOperator('punata', 'secretaria', 'punata')
const dest = await createOperator('cochabamba', 'secretaria', 'cochabamba')
const driver = { uid: 'directory-only-' + nonce }
const admin = await createOperator('admin', 'directiva_admin', 'punata', ['punata', 'cochabamba'])
await db.collection('vehicles').doc('browser-' + nonce).set({ status: 'active', branchId: 'punata', mobileNumber: '88', plate: 'DEMO' })
await db.collection('driver_directory').doc(driver.uid).set({ uid: driver.uid, fullName: 'conductor', isActive: true })
const base = 'http://127.0.0.1:4187'
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4187', '--strictPort'], { stdio: 'inherit' })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  async function login(user) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    const page = await context.newPage()
    for (let i = 0; i < 20; i++) {
      try { await page.goto(base); break } catch (error) { if (i === 19) throw error; await new Promise(r => setTimeout(r, 250)) }
    }
    await page.locator('input[type=email]').fill(user.email)
    await page.locator('input[type=password]').fill('demo-password')
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click()
    await page.locator('[data-tutorial-target="nav-tabs-bar"]').waitFor()
    return page
  }
  const originPage = await login(origin)
  const destPage = await login(dest)
  const adminPage = await login(admin)
  const btn = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' })
  assert.equal(await btn(originPage, 'Caja del Turno').count(), 0)
  await btn(adminPage, 'Caja del Turno').waitFor()
  for (const page of [originPage, destPage]) {
    await btn(page, 'Abrir turno de ventanilla').click()
    await page.locator('input[type=number]').fill('50')
    await btn(page, 'Confirmar y Abrir Turno').click()
    await btn(page, 'Cerrar turno de ventanilla').waitFor()
  }
  async function openGuide(page, guide) {
    await page.locator('[data-tutorial-target="shipment-search-input"]').fill(guide)
    await page.getByText(guide, { exact: true }).last().click()
  }
  for (const [mode, timing] of [[/^Pagado en origen/i, 'origin_paid'], [/^Por pagar/i, 'destination_cod']]) {
    await originPage.locator('[data-tutorial-target="btn-new-shipment"]').click()
    await btn(originPage, 'Siguiente').click()
    for (const [placeholder, value] of [['Ej. Juan Pérez','Remitente Demo'], ['Ej. 71712345','70000001'], ['Ej. María López','Destinataria Demo'], ['Ej. 72234567','70000002']]) {
      await originPage.getByPlaceholder(placeholder, { exact: true }).fill(value)
    }
    await btn(originPage, 'Siguiente').click()
    await originPage.getByPlaceholder(/Ropa, repuestos/).first().fill('Paquete de prueba')
    await originPage.getByLabel(/Precio del Envío/).fill('25')
    await btn(originPage, 'Siguiente').click()
    await btn(originPage, mode).click()
    const response = originPage.waitForResponse(r => r.url().endsWith('/createShipment') && r.request().method() === 'POST')
    await btn(originPage, /Confirmar y Emitir Guía/i).click()
    const payload = await (await response).json()
    assert(payload.result?.trackingCode, JSON.stringify(payload.error))
    const guide = payload.result.trackingCode
    if (timing === 'destination_cod') await db.collection('shipments').doc(guide).update({ createdAtIso: '2025-06-10T14:00:00.000Z' })
    await originPage.reload()
    await openGuide(originPage, guide)
    await originPage.getByLabel('Vehículo').selectOption('browser-' + nonce)
    await originPage.getByRole('combobox', { name: /Conductor/i }).selectOption(driver.uid)
    await originPage.getByLabel('Constancia de entrega física al conductor').fill('Constancia sintética: carga recibida en el móvil.')
    const departure = originPage.waitForResponse(r => r.url().endsWith('/confirmShipmentDeparture') && r.request().method() === 'POST')
    await btn(originPage, 'Confirmar salida').click()
    const dispatch = (await (await departure).json()).result
    assert(dispatch?.manifestId)
    const manifest = (await db.collection('manifests').doc(dispatch.manifestId).get()).data()
    assert.equal(manifest.driverCustodyStatus, 'accepted')
    assert.equal(manifest.custodyHandoff.recordedByUid, origin.uid)
    assert.equal(manifest.custodyHandoff.driverUid, driver.uid)
    assert.deepEqual(manifest.custodyHandoff.shipmentIds, [guide])
    await originPage.getByTitle('Cerrar Ficha').click()
    if (timing === 'destination_cod') {
      await destPage.locator('[data-tutorial-target="shipment-search-input"]').fill('')
      await destPage.getByLabel('Desde').fill('2025-06-01')
      await destPage.getByLabel('Hasta').fill('2025-06-30')
      await destPage.getByText(guide, { exact: true }).first().waitFor()
    }
    await openGuide(destPage, guide)
    await destPage.getByLabel(/Bultos recibidos/).fill('1')
    await btn(destPage, 'Recibir encomienda').click()
    await destPage.getByLabel(/Bultos recibidos/).waitFor({ state: 'hidden' })
    await destPage.reload()
    await openGuide(destPage, guide)
    await btn(destPage, /Auditoría & Trazabilidad/).click()
    await destPage.getByText(/Recepción conforme\./).waitFor()
    await btn(destPage, 'Entregar Encomienda').click()
    await destPage.getByPlaceholder(/5234123/).fill('1234567')
    const canvas = destPage.locator('canvas')
    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    await destPage.mouse.move(box.x + 15, box.y + 15)
    await destPage.mouse.down()
    await destPage.mouse.move(box.x + 75, box.y + 35, { steps: 5 })
    await destPage.mouse.up()
    const recover = timing === 'destination_cod'
    if (recover) {
      await destPage.route('**/deliverShipment', async route => {
        if (route.request().method() !== 'POST') return route.continue()
        const backend = await route.fetch()
        assert((await backend.json()).result?.paymentCollected)
        await route.fulfill({ status: 500, json: { error: { status: 'INTERNAL', message: 'Respuesta perdida en prueba' } },
          headers: { 'Access-Control-Allow-Origin': base } })
      })
    }
    const delivery = destPage.waitForResponse(r => r.url().endsWith('/deliverShipment') && r.request().method() === 'POST')
    await btn(destPage, recover ? /Cobrar .* y Entregar/ : 'Confirmar Entrega Conforme').click()
    const receipt = await (await delivery).json()
    if (recover) {
      assert.equal(receipt.error?.status, 'INTERNAL')
      await destPage.getByText('ENTREGA YA REGISTRADA', { exact: true }).waitFor()
    } else {
      assert(receipt.result?.success, JSON.stringify(receipt.error))
      assert.equal(receipt.result.paymentCollected, false)
    }
    const stored = (await db.collection('shipments').doc(guide).get()).data()
    assert.equal(stored.status, 'delivered')
    assert(stored.deliveryRecord.signature)
    await destPage.reload()
    await openGuide(destPage, guide)
    const receiptPopup = destPage.waitForEvent('popup')
    await btn(destPage, 'Recibo Entrega').click()
    const receiptPage = await receiptPopup
    await receiptPage.waitForURL(url => url.protocol === 'blob:')
    await receiptPage.close()
    await destPage.getByTitle('Cerrar Ficha').click()
    console.log('Navegador autenticado:', timing, guide)
  }
  const dailyResponse = destPage.waitForResponse(r => r.url().endsWith('/getDailyOperationsReport') && r.request().method() === 'POST')
  await btn(destPage, 'Reporte del día').click()
  const daily = (await (await dailyResponse).json()).result
  assert.equal(daily.branchId, 'cochabamba')
  assert.equal(daily.delivered, 2)
  assert.equal(daily.income.cod, 2500)
  await btn(destPage, 'Imprimir reporte').waitFor()
  const reportResponse = adminPage.waitForResponse(r => r.url().endsWith('/getSystemReport') && r.request().method() === 'POST' && r.ok())
  await btn(adminPage, /Reportes & Estadísticas/).click()
  assert((await (await reportResponse).json()).result)

} finally {
  await browser.close()
  preview.kill()
}
