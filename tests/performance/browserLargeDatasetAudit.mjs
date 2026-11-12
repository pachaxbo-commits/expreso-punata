import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const port = 4173
const distDir = path.resolve('dist')
assert.ok(existsSync(path.join(distDir, 'index.html')), 'el build debe apuntar a emuladores antes de iniciar el navegador')
const requests = []
const pageErrors = []
const results = []
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer((req, res) => {
  const requestPath = new URL(req.url, `http://127.0.0.1:${port}`).pathname
  const filePath = path.join(distDir, requestPath === '/' ? 'index.html' : requestPath)
  const selectedPath = existsSync(filePath) ? filePath : path.join(distDir, 'index.html')
  res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(selectedPath)] || 'application/octet-stream' })
  res.end(readFileSync(selectedPath))
})

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
try {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfinished', (request) => {
    if (/127\.0\.0\.1:(8080|5001)\//.test(request.url())) requests.push({ service: request.url().includes(':8080/') ? 'firestore' : 'functions', method: request.method(), path: new URL(request.url()).pathname })
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const loginStarted = performance.now()
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', 'auditoria.rendimiento@expresopunata.local')
  await page.fill('input[type="password"]', 'AuditLocal!2026')
  await page.click('button[type="submit"]')
  await page.waitForSelector('[data-tutorial-target="header-branch-badge"]', { timeout: 30000 })
  const loginMs = Number((performance.now() - loginStarted).toFixed(1))
  results.push({ operation: 'login_mobile_4x_cpu', elapsedMs: loginMs })
  const exitTutorial = page.locator('button[title="Salir del tutorial"]')
  if (await exitTutorial.count()) await exitTutorial.click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  const membersStarted = performance.now()
  await page.getByRole('button', { name: 'Afiliados & Aportes' }).evaluate((button) => button.click())
  await page.getByText('Padrón de Afiliados y Gestión de Cuotas').waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: /Padrón de Afiliados \(500\)/ }).waitFor({ timeout: 30000 })
  const membersMs = Number((performance.now() - membersStarted).toFixed(1))
  results.push({ operation: 'open_affiliates_500_mobile_4x_cpu', elapsedMs: membersMs, records: 500 })

  const search = page.getByPlaceholder('Buscar por nombre, afiliado (SOC-...), CI, móvil o placa...')
  const firestoreBeforeSearch = requests.filter((entry) => entry.service === 'firestore').length
  const searchStarted = performance.now()
  await search.fill('Afiliado Ficticio 0250')
  await page.getByText('Afiliado Ficticio 0250', { exact: true }).waitFor({ timeout: 10000 })
  const searchMs = Number((performance.now() - searchStarted).toFixed(1))
  const firestoreAfterSearch = requests.filter((entry) => entry.service === 'firestore').length
  results.push({ operation: 'local_member_search', elapsedMs: searchMs, firestoreRequestsDuringSearch: firestoreAfterSearch - firestoreBeforeSearch })

  const statementStarted = performance.now()
  await page.getByRole('button', { name: 'Extracto' }).evaluate((button) => button.click())
  await page.getByText(/Saldo Deudor:/).waitFor({ timeout: 20000 })
  results.push({ operation: 'open_affiliate_statement', elapsedMs: Number((performance.now() - statementStarted).toFixed(1)) })

  await page.getByRole('button', { name: 'Cerrar' }).click().catch(() => {})
  await page.getByRole('button', { name: 'Afiliados & Aportes' }).evaluate((button) => button.click())
  const debtStarted = performance.now()
  await page.getByRole('button', { name: 'Deudas', exact: true }).evaluate((button) => button.click())
  await page.getByText(/Afiliados con deudas pendientes:/).waitFor({ timeout: 20000 })
  results.push({ operation: 'open_debt_alerts', elapsedMs: Number((performance.now() - debtStarted).toFixed(1)) })

  const reportStarted = performance.now()
  await page.getByRole('button', { name: 'Reportes & Estadísticas' }).evaluate((button) => button.click())
  await page.locator('[data-tutorial-target="reports-filters-card"]').waitFor({ timeout: 30000 })
  const reportMs = Number((performance.now() - reportStarted).toFixed(1))
  const reportResources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /ReportsManagementView-/.test(name)))
  assert.ok(reportResources.length > 0, 'la vista de reportes se descargó solo al abrir el módulo')
  results.push({ operation: 'open_reports_lazy_chunk', elapsedMs: reportMs, reportChunksLoaded: reportResources.length })

  const metrics = await cdp.send('Performance.getMetrics')
  const metricMap = Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]))
  const heapUsage = await cdp.send('Runtime.getHeapUsage')
  const summary = {
    viewport: { width: 375, height: 812 }, cpuThrottle: '4x',
    emulatorRequests: requests.length,
    firestoreRequests: requests.filter((entry) => entry.service === 'firestore').length,
    functionsRequests: requests.filter((entry) => entry.service === 'functions').length,
    jsHeapUsedBytes: Math.round(heapUsage.usedSize || metricMap.JSHeapUsedSize || 0),
    metrics: results,
    pageErrors,
    failed: pageErrors.length > 0,
    notes: ['Las mediciones corresponden a emuladores locales y Chromium con CPU limitada; no equivalen a latencia de producción.'],
  }
  mkdirSync('tmp/performance-audit', { recursive: true })
  writeFileSync('tmp/performance-audit/browser-large-dataset-results.json', JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await browser.close()
  server.close()
}
