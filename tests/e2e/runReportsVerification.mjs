import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const DIST_DIR = path.resolve('dist')
const PORT = 4174

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0]
    if (reqUrl === '/') reqUrl = '/index.html'

    const filePath = path.join(DIST_DIR, reqUrl)
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase()
      const mime = MIME_TYPES[ext] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': mime })
      fs.createReadStream(filePath).pipe(res)
    } else {
      const indexPath = path.join(DIST_DIR, 'index.html')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(indexPath).pipe(res)
    }
  })

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Reports Verification] Servidor estático en http://127.0.0.1:${PORT}`)
      resolve(server)
    })
  })
}

async function runReportsVerification() {
  const server = await startStaticServer()
  const evidenceDir = path.resolve('tests/e2e/evidence')
  const artifactDir = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'

  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true })
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true })

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[Reports Verification] Conectando a Google Chrome: ${chromePath}`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()

    console.log('[Reports Verification] Navegando al login...')
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=EXPRESO PUNATA', { timeout: 10000 })

    // Iniciar sesión con rol directiva_admin
    console.log('[Reports Verification] Iniciando sesión como Directiva / Admin...')
    const adminButton = page.locator('button:has-text("Directiva / Admin")')
    await adminButton.click()

    await page.waitForSelector('text=Reportes & Estadísticas', { timeout: 8000 })
    console.log('[Reports Verification] Dashboard cargado. Navegando a pestaña Reportes & Estadísticas...')

    // Clic en pestaña Reportes & Estadísticas
    await page.click('button:has-text("Reportes & Estadísticas")')
    await page.waitForTimeout(1000)

    // Helper para guardar captura en ambos destinos
    const saveShot = async (filename) => {
      const p1 = path.join(evidenceDir, filename)
      const p2 = path.join(artifactDir, filename)
      await page.screenshot({ path: p1, fullPage: true })
      fs.copyFileSync(p1, p2)
      console.log(`[Reports Verification] Captura guardada: ${filename}`)
    }

    // 1. Tablero Consolidado
    console.log('[Reports Verification] Verificando Tablero Consolidado...')
    await saveShot('29-entrega7-reportes-dashboard.png')

    // 2. Encomiendas y Logística
    console.log('[Reports Verification] Navegando a Encomiendas y Logística...')
    await page.click('button:has-text("Encomiendas y Logística")')
    await page.waitForTimeout(600)
    await saveShot('30-entrega7-reportes-encomiendas.png')

    // 3. Caja y Finanzas
    console.log('[Reports Verification] Navegando a Caja y Finanzas...')
    await page.click('button:has-text("Caja y Finanzas")')
    await page.waitForTimeout(600)
    await saveShot('31-entrega7-reportes-caja.png')

    // 4. Conductores y Custodia
    console.log('[Reports Verification] Navegando a Conductores y Custodia...')
    await page.click('button:has-text("Conductores y Custodia")')
    await page.waitForTimeout(600)
    await saveShot('32-entrega7-reportes-conductores.png')

    // 5. Socios y Mensualidades
    console.log('[Reports Verification] Navegando a Socios y Mensualidades...')
    await page.click('button:has-text("Socios y Mensualidades")')
    await page.waitForTimeout(600)
    await saveShot('33-entrega7-reportes-socios.png')

    // 6. Personal y Gastos
    console.log('[Reports Verification] Navegando a Personal y Gastos...')
    await page.click('button:has-text("Personal y Gastos")')
    await page.waitForTimeout(600)
    await saveShot('34-entrega7-reportes-personal-gastos.png')

    // 7. Bienes Fijos e Inventario
    console.log('[Reports Verification] Navegando a Bienes Fijos e Inventario...')
    await page.click('button:has-text("Bienes Fijos e Inventario")')
    await page.waitForTimeout(600)
    await saveShot('35-entrega7-reportes-bienes-fijos.png')

    // 8. Vista móvil responsiva (390x844)
    console.log('[Reports Verification] Verificando vista móvil...')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.click('button:has-text("Tablero Consolidado")')
    await page.waitForTimeout(600)
    await saveShot('36-entrega7-reportes-mobile.png')

    console.log('====================================================')
    console.log('¡VERIFICACIÓN DE REPORTES COMPLETADA CON ÉXITO!')
    console.log('====================================================')
  } finally {
    await browser.close()
    server.close()
  }
}

runReportsVerification().catch((err) => {
  console.error('[Reports Verification Error]', err)
  process.exit(1)
})
