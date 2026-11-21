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
const admin = await createOperator('admin', 'afiliado_admin', 'punata', ['punata', 'cochabamba'])
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
  const shiftResponse = await fetch('http://127.0.0.1:5001/' + project + '/us-central1/openCashShift', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.idToken },
    body: JSON.stringify({ data: { branchId: 'punata', initialCashCents: 1000 } }),
  })
  assert((await shiftResponse.json()).result?.shift?.id)
  let commissionSource
  for (const [mode, timing] of [[/^Pagado en origen/i, 'origin_paid'], [/^Por pagar/i, 'destination_cod']]) {
    const senderPage = timing === 'origin_paid' ? adminPage : originPage
    const senderUid = timing === 'origin_paid' ? admin.uid : origin.uid
    await senderPage.locator('[data-tutorial-target="btn-new-shipment"]').click()
    await btn(senderPage, 'Siguiente').click()
    for (const [placeholder, value] of [['Ej. Juan Pérez','Remitente Demo'], ['Ej. 71712345','70000001'], ['Ej. María López','Destinataria Demo'], ['Ej. 72234567','70000002']]) {
      await senderPage.getByPlaceholder(placeholder, { exact: true }).fill(value)
    }
    await btn(senderPage, 'Siguiente').click()
    await senderPage.getByPlaceholder(/Ropa, repuestos/).first().fill('Paquete de prueba')
    await senderPage.getByLabel(/Precio del Envío/).fill('25')
    await btn(senderPage, 'Siguiente').click()
    await btn(senderPage, mode).click()
    const response = senderPage.waitForResponse(r => r.url().endsWith('/createShipment') && r.request().method() === 'POST')
    await btn(senderPage, /Confirmar y Emitir Guía/i).click()
    const payload = await (await response).json()
    assert(payload.result?.trackingCode, JSON.stringify(payload.error))
    const guide = payload.result.trackingCode
    if (timing === 'destination_cod') await db.collection('shipments').doc(guide).update({ createdAtIso: '2025-06-10T14:00:00.000Z' })
    await senderPage.reload()
    await openGuide(senderPage, guide)
    await senderPage.getByLabel('Vehículo').selectOption('browser-' + nonce)
    await senderPage.getByRole('combobox', { name: /Conductor/i }).selectOption(driver.uid)
    await senderPage.getByLabel('Constancia de entrega física al conductor').fill('Constancia sintética: carga recibida en el móvil.')
    const departure = senderPage.waitForResponse(r => r.url().endsWith('/confirmShipmentDeparture') && r.request().method() === 'POST')
    await btn(senderPage, 'Confirmar salida').click()
    const dispatch = (await (await departure).json()).result
    assert(dispatch?.manifestId)
    if (timing === 'origin_paid') commissionSource = { shipmentId: guide, manifestId: dispatch.manifestId }
    const manifest = (await db.collection('manifests').doc(dispatch.manifestId).get()).data()
    assert.equal(manifest.driverCustodyStatus, 'accepted')
    assert.equal(manifest.custodyHandoff.recordedByUid, senderUid)
    assert.equal(manifest.custodyHandoff.driverUid, driver.uid)
    assert.deepEqual(manifest.custodyHandoff.shipmentIds, [guide])
    await senderPage.getByTitle('Cerrar Ficha').click()
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
  await btn(destPage, 'Encomiendas').click()
  await btn(destPage, 'Cerrar turno de ventanilla').click()
  await btn(destPage, 'Ingreso Manual Total').click()
  await destPage.locator('input[type=number]').fill('75')
  await btn(destPage, 'Revisar y Cerrar').click()
  const closeResponse = destPage.waitForResponse(r => r.url().endsWith('/closeCashShift') && r.request().method() === 'POST')
  await btn(destPage, 'Confirmar Cierre Definitivo').click()
  const closed = (await (await closeResponse).json()).result
  assert.equal(closed?.shift?.status, 'closed')
  assert.equal(closed.shift.expectedCashCents, 7500)
  assert.equal(closed.shift.differenceCents, 0)
  const retry = await fetch('http://127.0.0.1:5001/' + project + '/us-central1/closeCashShift', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dest.idToken },
    body: JSON.stringify({ data: { shiftId: closed.shift.id, actualCashCents: 7500 } }),
  })
  assert.equal((await retry.json()).error?.status, 'FAILED_PRECONDITION')
  await btn(destPage, 'Abrir turno de ventanilla').waitFor()
  console.log('Arqueo integrado: Bs 75, diferencia cero, segundo cierre rechazado.')
  for (const label of ['Pasajes', 'Módulos de Almacén', 'Afiliados & Aportes', 'Personal & Gastos', 'Inventario / Bienes Fijos', 'Comisiones de conductores']) {
    await btn(adminPage, label).waitFor()
  }
  assert.equal(await btn(originPage, 'Configuración').count(), 0)
  await btn(adminPage, 'Configuración').click()
  await btn(adminPage, 'Usuarios y Permisos').click()
  await btn(adminPage, 'Registrar Nuevo Operador').click()
  await adminPage.getByPlaceholder('Ej. María Flores Rocha').fill('Secretaría Sintética')
  await adminPage.getByPlaceholder('usuario@expresopunata.com').fill('new-secretary-' + nonce + '@example.test')
  await adminPage.getByPlaceholder('Ej. 75999279').fill('70000001')
  await adminPage.locator('select').filter({ has: adminPage.locator('option[value="afiliado_admin"]') }).last().selectOption('secretaria')
  adminPage.on('dialog', dialog => dialog.accept())
  const provisionResponse = adminPage.waitForResponse(r => r.url().endsWith('/adminProvisionUser') && r.request().method() === 'POST')
  await btn(adminPage, 'Crear Operador').click()
  const provisioned = await (await provisionResponse).json()
  assert.equal(provisioned.result?.profile?.role, 'secretaria', JSON.stringify(provisioned.error))
  await adminPage.getByText('Secretaría Sintética', { exact: true }).waitFor()
  await btn(adminPage, 'General').click()
  for (const subtab of ['Empresa / Identidad', 'Sucursales / Agencias', 'Tarifario Sugerido', 'Comisiones Conductor', 'Impresión y Tickets']) {
    await btn(adminPage, subtab).click()
  }
  const reportResponse = adminPage.waitForResponse(r => r.url().endsWith('/getSystemReport') && r.request().method() === 'POST' && r.ok())
  await btn(adminPage, /Reportes & Estadísticas/).click()
  assert((await (await reportResponse).json()).result)
  console.log('Administrador afiliado autenticado: aprovisionamiento de secretaría, configuración y reporte general.')
  await db.collection('system_config').doc('expreso_punata').set({
    status: 'configured', isOfficial: true, commissions: { defaultType: 'fixed_per_shipment', defaultValue: 2 },
  }, { merge: true })
  await adminPage.locator('[data-tutorial-target="nav-tabs-bar"]').getByRole('button', { name: 'Comisiones de conductores', exact: true }).click()
  await btn(adminPage, 'Devengar').click()
  await adminPage.getByPlaceholder('ID del documento de encomienda').fill(commissionSource.shipmentId)
  await adminPage.getByPlaceholder('ID del manifiesto', { exact: true }).fill(commissionSource.manifestId)
  const accrualResponse = adminPage.waitForResponse(r => r.url().endsWith('/accrueDriverCommission') && r.request().method() === 'POST')
  await adminPage.getByRole('button', { name: 'Devengar', exact: true }).last().click()
  const accrual = await (await accrualResponse).json()
  assert.equal(accrual.result?.commissionAmountCents, 200, JSON.stringify(accrual.error))
  await adminPage.getByText(commissionSource.shipmentId, { exact: true }).waitFor()
  await btn(adminPage, 'Liquidar Comisión').click()
  const settlementResponse = adminPage.waitForResponse(r => r.url().endsWith('/settleDriverCommission') && r.request().method() === 'POST')
  await btn(adminPage, 'Confirmar y Pagar').click()
  const settlement = await (await settlementResponse).json()
  assert.equal(settlement.result?.voucher?.remainingPendingCents, 0, JSON.stringify(settlement.error))
  assert.equal(settlement.result.voucher.settledAmountCents, 200)
  await adminPage.getByText('Vale: ' + settlement.result.voucher.voucherNumber, { exact: true }).waitFor()
  console.log('Administrador afiliado autenticado: cuenta, asiento y liquidación de Bs 2 para un conductor de directorio.')


} finally {
  await browser.close()
  preview.kill()
}
