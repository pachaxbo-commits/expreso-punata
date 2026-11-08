import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = new URL(process.argv[2] || 'http://127.0.0.1:4178')
assert(['localhost', '127.0.0.1'].includes(base.hostname))
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const external = []
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === base.origin) return route.continue()
    if (/googleapis|firebase|cloudfunctions/i.test(url.hostname) && url.hostname !== 'fonts.googleapis.com') external.push(url.hostname)
    return route.abort()
  })
  const page = await context.newPage()
  const button = name => page.getByRole('button', { name, exact: typeof name === 'string' })
  await page.goto(new URL('/demo', base).href)
  async function role(name) {
    await button(/Simular:/).click()
    await page.getByText(name, { exact: true }).last().click()
    await button(/Simular:/).waitFor()
  }
  await role('Encargado de Agencia')
  await role('Administrador General')
  await role('Secretaria Punata')
  await button(/nueva encomienda/i).click()
  await button('Siguiente').click()
  for (const [placeholder, value] of [['Ej. Juan Pérez', 'Remitente Demo'], ['Ej. 71712345', '70000001'], ['Ej. María López', 'Destinataria Demo'], ['Ej. 72234567', '70000002']]) {
    await page.getByPlaceholder(placeholder, { exact: true }).fill(value)
  }
  await button('Siguiente').click()
  await page.getByPlaceholder(/Ropa, repuestos/).first().fill('Paquete simulado')
  await button('Siguiente').click()
  await button(/^Por pagar/).click()
  await button(/confirmar y emitir guía/i).click()
  const key = 'expreso-punata:demo:state:v2'
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').shipments?.[0]?.recipient?.name === 'Destinataria Demo', key)
  const guide = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).shipments[0].trackingCode, key)
  await page.reload()
  const search = () => page.getByLabel('Guía de la demo').fill(guide)
  await search()
  await button('Confirmar salida').click()
  await role('Secretaria Cochabamba')
  await search()
  assert.equal(await button('Recibir encomienda').count(), 0)
  await role('Conductor de Bus (Móvil 14)')
  await search()
  await button('Confirmar custodia').click()
  await role('Secretaria Cochabamba')
  await search()
  await page.getByLabel(/Bultos de/).fill('1')
  await button('Recibir encomienda').click()
  await button('Cobrar en destino').click()
  await button('Entregar con firma').click()
  await page.locator('canvas').waitFor()
  const canvas = page.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + 15, box.y + 15)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 35, { steps: 5 })
  await page.mouse.up()
  const documentInput = page.getByPlaceholder(/5234123/)
  if (await documentInput.count() === 1) await documentInput.fill('1234567')
  await button(/Confirmar Entrega Conforme/).click()
  await page.waitForFunction(({ key, guide }) => JSON.parse(localStorage.getItem(key)).shipments.find(s => s.trackingCode === guide)?.status === 'delivered', { key, guide })
  await page.getByText('Historial del traslado', { exact: true }).click()
  assert(await page.getByText(/Entrega con firma ·/).isVisible())
  assert.equal(await page.getByRole('button', { name: 'Despacho y Planillas' }).count(), 0)
  await page.locator('[data-tutorial-target="header-btn-tutorial"]').click()
  await button('Aprender').first().click()
  const card = page.locator('[data-tutorial-card="true"]')
  await card.waitFor()
  for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844], [375, 667]]) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(({ width, height }) => {
      const box = document.querySelector('[data-tutorial-card="true"]')?.getBoundingClientRect()
      return box && box.left >= -1 && box.top >= -1 && box.right <= width + 1 && box.bottom <= height + 1
    }, { width, height })
  }
  assert.deepEqual(external, [])
  console.log('Cinco perfiles y recorrido de demo completos, sin solicitudes a Firebase real.')
} finally {
  await browser.close()
}

