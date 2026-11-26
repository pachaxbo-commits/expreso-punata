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
const templateRef = db.doc('ticket_templates/shipment_guide')
const templateBefore = await templateRef.get()
const historyBefore = await templateRef.collection('history').get()
const suffix = `${Date.now()}-${process.pid}`
const email = `ticket-editor-${suffix}@example.test`
const password = 'LocalOnly!23456'
const user = await auth.createUser({ email, password })
await db.collection('users').doc(user.uid).set({ uid: user.uid, email, fullName: 'Admin E2E', role: 'directiva_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true })

const previewArgs = ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4192', '--strictPort']
if (process.env.E2E_DIST_DIR) previewArgs.push('--outDir', process.env.E2E_DIST_DIR)
const preview = spawn(process.execPath, previewArgs, { stdio: 'ignore' })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.addInitScript(() => {
    const originalAppend = document.body?.appendChild || Node.prototype.appendChild
    window.printJobs = []
    Node.prototype.appendChild = function(child) {
      const node = originalAppend.call(this, child)
      if (child instanceof HTMLIFrameElement && child.style.top === '-9999px') {
        child.contentWindow.print = () => {
          const frame = child.contentWindow
          window.printJobs.push({ text: frame.document.body.innerText, timestamp: performance.now() })
          setTimeout(() => frame.dispatchEvent(new frame.Event('afterprint')), 200)
        }
      }
      return node
    }
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
  await page.getByRole('navigation', { name: 'Herramientas de impresión' }).getByRole('button', { name: 'Centro de plantillas', exact: true }).click()
  await page.getByTestId('document-template-center').waitFor()
  await page.getByTestId('template-card-shipment_guide').click()
  await page.getByTestId('document-template-editor').waitFor()
  assert.equal(await page.getByRole('checkbox', { name: /Fecha y hora Obligatorio/ }).isDisabled(), true)
  assert.equal(await page.getByRole('checkbox', { name: /Origen y destino Obligatorio/ }).isDisabled(), true)
  const previewFrame = page.frameLocator('iframe[title="Vista previa del comprobante"]')
  await previewFrame.getByText('EP-TEST-000001').first().waitFor()
  await previewFrame.getByText('EJEMPLO SINTÉTICO — NO VÁLIDO COMO COMPROBANTE').first().waitFor()
  await page.getByLabel('Ancho').selectOption('58mm')
  await page.waitForFunction(() => document.querySelector('iframe[title="Vista previa del comprobante"]')?.contentDocument?.querySelector('style')?.textContent.includes('size:58mm auto'))
  await page.getByLabel('Ancho').selectOption('80mm')
  await page.waitForFunction(() => document.querySelector('iframe[title="Vista previa del comprobante"]')?.contentDocument?.querySelector('style')?.textContent.includes('size:80mm auto'))
  await page.getByRole('checkbox', { name: 'Imprimir también copia de agencia' }).check()
  assert.equal(await previewFrame.locator('.field').filter({ hasText: 'EP-TEST-000001' }).count(), 1)
  await page.getByRole('button', { name: /COPIA AGENCIA/ }).click()
  await previewFrame.getByText('COPIA AGENCIA').waitFor()
  await previewFrame.getByText('EP-TEST-000001').waitFor()
  const agencyRecipientPhone = page.getByRole('checkbox', { name: 'Teléfono del destinatario', exact: true })
  if (!await agencyRecipientPhone.isChecked()) await agencyRecipientPhone.check()
  await page.getByTestId('save-ticket-template').click()
  await page.getByText('Versión 1 guardada y auditada.').waitFor()
  assert.equal((await db.doc('ticket_templates/shipment_guide').get()).data().template.secondCopyEnabled, true)
  await page.getByTestId('save-ticket-template').click()
  await page.getByText('Versión 2 guardada y auditada.').waitFor()
  await page.getByLabel('Versión para restaurar').selectOption('1')
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await page.getByText('Versión restaurada como v3; quedó auditada.').waitFor()
  assert.equal((await db.doc('ticket_templates/shipment_guide').get()).data().template.secondCopyEnabled, true)
  const beforeSyntheticShipments = (await db.collection('shipments').get()).size
  const beforeSyntheticMovements = (await db.collection('financial_movements').get()).size
  await page.getByTestId('print-synthetic-template').click()
  await page.getByRole('status').filter({ hasText: 'Prueba sintética:' }).waitFor()
  assert.equal((await db.collection('shipments').get()).size, beforeSyntheticShipments)
  assert.equal((await db.collection('financial_movements').get()).size, beforeSyntheticMovements)
  await page.getByTestId('document-template-editor').getByRole('button', { name: 'Centro de plantillas', exact: true }).click()
  await page.getByTestId('template-card-payment_receipt').first().click()
  await page.getByTestId('document-template-editor').waitFor()
  const receiptPreview = page.frameLocator('iframe[title="Vista previa del comprobante"]')
  await receiptPreview.getByText('Destinatario de prueba').waitFor()
  await receiptPreview.getByText('Bs 25.00').waitFor()
  await page.getByTestId('document-template-editor').getByRole('button', { name: 'Centro de plantillas', exact: true }).click()
  await page.getByTestId('template-card-passenger_ticket').click()
  await page.getByTestId('document-template-editor').waitFor()
  const passengerPreview = page.frameLocator('iframe[title="Vista previa del comprobante"]')
  await passengerPreview.getByText('Pasajera sintética').waitFor()
  await passengerPreview.getByText('COMPROBANTE DE OFICINA').waitFor()
  await passengerPreview.getByText('PASAJE DEL CHOFER').waitFor()
  await page.getByRole('button', { name: 'Prueba Rongta Windows', exact: true }).click()
  await page.getByTestId('rongta-print-test').waitFor()
  const beforeShipments = (await db.collection('shipments').get()).size
  const beforeMovements = (await db.collection('financial_movements').get()).size
  await page.evaluate(() => { window.printJobs.length = 0 })
  await page.getByRole('button', { name: 'Imprimir cliente + agencia' }).click()
  await page.getByRole('status').filter({ hasText: 'Chrome recibió los trabajos de cliente y agencia' }).waitFor()
  const jobs = await page.evaluate(() => window.printJobs)
  assert.equal(jobs.length, 2)
  assert.match(jobs[0].text, /Destinatario de prueba/)
  assert.doesNotMatch(jobs[0].text, /COPIA AGENCIA/)
  assert.match(jobs[1].text, /COPIA AGENCIA/)
  assert.match(jobs[1].text, /70000002/)
  assert.ok(jobs[1].timestamp - jobs[0].timestamp >= 190)
  for (const job of jobs) assert.match(job.text, /TEST-SINTETICO-0001.*|Bs 12\.50/)
  assert.ok(jobs.every(job => job.text.includes('TEST-SINTETICO-0001') && job.text.includes('Bs 12.50')))
  assert.equal((await db.collection('shipments').get()).size, beforeShipments)
  assert.equal((await db.collection('financial_movements').get()).size, beforeMovements)
  await page.getByRole('navigation', { name: 'Herramientas de impresión' }).getByRole('button', { name: 'Centro de plantillas', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('document-template-center').waitFor()
  await page.getByTestId('template-card-shipment_guide').click()
  await page.getByTestId('document-template-editor').waitFor()
  const mobileWidth = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }))
  assert.ok(mobileWidth.content <= mobileWidth.viewport, `mobile horizontal overflow: ${JSON.stringify(mobileWidth)}`)
  console.log('[ticket-editor e2e] universal center, versioned template, required fields, compact agency copy, same guide number, 58/80 preview, synthetic print without business writes, and mobile layout verified')
} finally {
  await browser.close()
  preview.kill()
  const currentHistory = await templateRef.collection('history').get()
  const restoreBatch = db.batch()
  for (const doc of currentHistory.docs) restoreBatch.delete(doc.ref)
  for (const doc of historyBefore.docs) restoreBatch.set(templateRef.collection('history').doc(doc.id), doc.data())
  const generatedAudits = await db.collection('audit_logs').where('uid', '==', user.uid).get()
  for (const doc of generatedAudits.docs) restoreBatch.delete(doc.ref)
  if (templateBefore.exists) restoreBatch.set(templateRef, templateBefore.data())
  else restoreBatch.delete(templateRef)
  await restoreBatch.commit()
  await auth.deleteUser(user.uid).catch(() => {})
  await db.collection('users').doc(user.uid).delete().catch(() => {})
}
