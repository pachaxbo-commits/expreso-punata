import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = new URL(process.argv[2] || 'http://127.0.0.1:4173')
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort())
  const page = await context.newPage()
  await page.goto(new URL('/demo', base).href)
  await page.getByRole('button', { name: /nueva encomienda/i }).click()
  const next = page.getByRole('button', { name: 'Siguiente', exact: true })
  await next.click()
  for (const [placeholder, value] of [['Ej. Juan Pérez', 'Remitente Demo'], ['Ej. 71712345', '70000001'], ['Ej. María López', 'Destinataria Demo'], ['Ej. 72234567', '70000002']]) {
    await page.getByPlaceholder(placeholder, { exact: true }).fill(value)
  }
  await next.click()
  await page.getByPlaceholder(/Ropa, repuestos/).first().fill('Paquete simulado')
  await next.click()
  const choices = page.locator('[data-tutorial-target="shipment-payment-mode"]')
  await choices.waitFor()
  assert.equal(await choices.getByRole('button').count(), 2)
  const origin = choices.getByRole('button', { name: /^Pagado en origen/ })
  const destination = choices.getByRole('button', { name: /^Por pagar/ })
  for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844], [375, 667]]) {
    await page.setViewportSize({ width, height })
    await origin.click()
    for (const method of ['Efectivo', 'QR Simple', 'Transferencia']) assert(await page.getByRole('button', { name: new RegExp(method) }).isVisible())
    await destination.click()
    assert.equal(await destination.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('button', { name: /QR Simple/ }).count(), 0)
    for (const choice of [origin, destination]) {
      const box = await choice.boundingBox()
      assert(box && box.x >= 0 && box.x + box.width <= width + 1)
    }
    await page.getByRole('button', { name: /confirmar y emitir guía/i }).scrollIntoViewIfNeeded()
    console.log(`Paso 4 aprobado a ${width}×${height}`)
  }
} finally {
  await browser.close()
}
