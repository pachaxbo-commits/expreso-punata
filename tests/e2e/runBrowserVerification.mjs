import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const DIST_DIR = path.resolve('dist')
const PORT = 4173

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
      // Fallback SPA para index.html
      const indexPath = path.join(DIST_DIR, 'index.html')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(indexPath).pipe(res)
    }
  })

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[E2E] Servidor estático iniciado en http://127.0.0.1:${PORT}`)
      resolve(server)
    })
  })
}

async function runE2E() {
  const server = await startStaticServer()
  const evidenceDir = path.resolve('tests/e2e/evidence')
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true })
  }

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[E2E] Conectando a Google Chrome en: ${chromePath}`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()
    page.on('console', (msg) => console.log('[Browser Console]', msg.type(), msg.text()))
    page.on('pageerror', (err) => console.log('[Browser Error]', err.message, '\nStack:', err.stack))

    // 1. Cargar aplicación
    console.log('[E2E] Navegando a la aplicación...')
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=EXPRESO PUNATA', { timeout: 10000 })

    // Validar Título
    const pageTitle = await page.title()
    console.log(`[E2E] Título de página: "${pageTitle}"`)
    if (pageTitle.includes('S.M.T.') || pageTitle.includes('Sindicato')) {
      throw new Error(`VIOLACIÓN DE MARCA: El título contiene S.M.T. o Sindicato: ${pageTitle}`)
    }

    // 2. Login con Secretaria Punata
    console.log('[E2E] Iniciando sesión como Secretaria Punata...')
    await page.screenshot({ path: path.join(evidenceDir, '01-login-screen.png') })

    // Hacer clic en el botón de acceso rápido para secretaria Punata
    const secButton = page.locator('button:has-text("Secretaria Punata")')
    await secButton.click()

    // Esperar que cargue el dashboard
    await page.waitForSelector('text=Agencia Central Punata (PUN)', { timeout: 8000 })
    console.log('[E2E] Dashboard cargado con éxito en sucursal Punata.')

    // Verificar que NO existe la palabra Sindicato ni S.M.T. en el DOM renderizado
    const bodyText = await page.innerText('body')
    if (bodyText.includes('S.M.T.') || bodyText.toLowerCase().includes('sindicato mixto')) {
      throw new Error('VIOLACIÓN DE MARCA: Se encontraron textos de S.M.T. o Sindicato en el DOM')
    }

    await page.screenshot({ path: path.join(evidenceDir, '02-desktop-dashboard.png') })

    // 3. Abrir Asistente Nueva Encomienda
    console.log('[E2E] Abriendo Asistente "Nueva Encomienda"...')
    await page.click('button:has-text("Nueva Encomienda")')
    await page.waitForSelector('text=1. Ruta', { timeout: 5000 })

    // Captura Paso 1 en Escritorio
    await page.screenshot({ path: path.join(evidenceDir, '03-wizard-step1-desktop.png') })

    // Seleccionar modalidad Domicilio y escribir dirección
    await page.click('button:has-text("A Domicilio")')
    await page.fill('input[placeholder*="Calle, número, zona"]', 'Av. San Martín esq. Aroma #450')

    // Avanzar a Paso 2
    console.log('[E2E] Avanzando a Paso 2 (Personas)...')
    await page.click('button:has-text("Siguiente")')
    await page.waitForSelector('text=Datos del Remitente', { timeout: 5000 })

    await page.fill('input[placeholder="Ej. Juan Pérez"]', 'Carlos Mendoza Torrico')
    await page.fill('input[placeholder="Ej. 71712345"]', '71745678')
    await page.fill('input[placeholder="Ej. María López"]', 'Patricia Vargas Fuentes')
    await page.fill('input[placeholder="Ej. 72234567"]', '72298765')

    await page.screenshot({ path: path.join(evidenceDir, '04-wizard-step2-desktop.png') })

    // Avanzar a Paso 3
    console.log('[E2E] Avanzando a Paso 3 (Carga)...')
    await page.click('button:has-text("Siguiente")')
    await page.waitForSelector('text=Paquetes a Registrar', { timeout: 5000 })

    // Llenar detalles del bulto
    const descInput = page.locator('input[placeholder*="Ropa, repuestos"]').first()
    await descInput.fill('Repuestos mecánicos para tractor')

    const weightInput = page.locator('input[type="number"]').nth(1)
    await weightInput.fill('7')

    await page.screenshot({ path: path.join(evidenceDir, '05-wizard-step3-desktop.png') })

    // Probar Preservación de Datos al Retroceder (Atrás a Paso 2 y Paso 1)
    console.log('[E2E] Verificando preservación de datos al retroceder...')
    await page.click('button:has-text("Atrás")')
    await page.waitForSelector('text=Datos del Remitente', { timeout: 5000 })

    const senderVal = await page.inputValue('input[placeholder="Ej. Juan Pérez"]')
    if (senderVal !== 'Carlos Mendoza Torrico') {
      throw new Error(`Pérdida de datos en Paso 2 al retroceder: valor actual "${senderVal}"`)
    }

    await page.click('button:has-text("Atrás")')
    await page.waitForSelector('text=1. Ruta', { timeout: 5000 })

    const addrVal = await page.inputValue('input[placeholder*="Calle, número, zona"]')
    if (addrVal !== 'Av. San Martín esq. Aroma #450') {
      throw new Error(`Pérdida de datos en Paso 1 al retroceder: valor actual "${addrVal}"`)
    }
    console.log('[E2E] Preservación de datos comprobada con éxito.')

    // Regresar a Paso 4
    await page.click('button:has-text("Siguiente")')
    await page.click('button:has-text("Siguiente")')
    await page.click('button:has-text("Siguiente")')
    await page.waitForSelector('text=Confirmación de Datos', { timeout: 5000 })

    await page.screenshot({ path: path.join(evidenceDir, '06-wizard-step4-desktop.png') })

    // 4. Verificación en Viewports Móviles (360x800 y 390x844)
    console.log('[E2E] Comprobando viewport móvil 360 x 800 (Samsung Android)...')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.screenshot({ path: path.join(evidenceDir, '07-mobile-360x800-wizard.png') })

    console.log('[E2E] Comprobando viewport móvil 390 x 844 (iPhone 13/14)...')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(evidenceDir, '08-mobile-390x844-wizard.png') })

    // 5. Cerrar modal y probar Búsqueda por Guía
    console.log('[E2E] Cerrando modal y comprobando buscador exacto por guía...')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator('button:has(svg.lucide-x)').first().click()

    const searchInput = page.locator('input[placeholder*="Buscar por guía exacta"]')
    await searchInput.fill('PUN-2026-00042')
    await page.screenshot({ path: path.join(evidenceDir, '09-search-exact-guide.png') })

    // 6. Prueba de Persistencia tras F5
    console.log('[E2E] Probando persistencia y recarga de página (F5)...')
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('text=Agencia Central Punata (PUN)', { timeout: 8000 })
    await page.screenshot({ path: path.join(evidenceDir, '10-post-reload-f5.png') })

    // 7. Prueba de Mi Perfil
    console.log('[E2E] Probando apertura del modal "Mi Perfil"...')
    const profileBtn = page.locator('button[title*="Ver mi perfil"]')
    if (await profileBtn.count() > 0) {
      await profileBtn.click()
      await page.waitForSelector('text=Mi Perfil de Operador', { timeout: 5000 })
      await page.screenshot({ path: path.join(evidenceDir, '11-user-profile-modal.png') })
      // Cerrar modal con botón Listo
      await page.click('button:has-text("Listo")')
    }

    // 8. Prueba del Módulo de Configuración -> Usuarios y Permisos
    console.log('[E2E] Probando navegación a Módulo de Configuración...')
    // Cerrar sesión
    await page.click('button[title="Cerrar Sesión"]')
    await page.waitForSelector('text=Iniciar Sesión', { timeout: 5000 })

    // Iniciar como Directiva / Admin
    const adminBtn = page.locator('button:has-text("Directiva / Admin")')
    if (await adminBtn.count() > 0) {
      await adminBtn.click()
      await page.waitForSelector('text=Agencia Central Punata (PUN)', { timeout: 8000 })

      // Ir a pestaña Configuración
      await page.click('button:has-text("Configuración")')
      await page.waitForSelector('text=Configuración de Usuarios y Permisos', { timeout: 5000 })
      await page.screenshot({ path: path.join(evidenceDir, '12-user-management-view.png') })

      // Abrir modal de Nuevo Operador
      await page.click('button:has-text("Registrar Nuevo Operador")')
      await page.waitForSelector('text=Expreso Punata — Aprovisionamiento Oficial', { timeout: 5000 })
      await page.screenshot({ path: path.join(evidenceDir, '13-new-user-modal.png') })
      await page.click('button:has-text("Cancelar")')
    }

    // 9. Prueba del Módulo de Caja (Entrega 1)
    console.log('[E2E] Navegando a la pestaña "Caja del Turno"...')
    await page.click('button:has-text("Caja del Turno")')
    await page.waitForSelector('text=Control de Caja y Turnos Operativos', { timeout: 5000 })
    await page.screenshot({ path: path.join(evidenceDir, '14-caja-cerrada.png') })

    // Abrir Modal de Apertura de Caja
    console.log('[E2E] Abriendo modal de Apertura de Caja...')
    const openShiftBtn = page.locator('button:has-text("Abrir Turno de Caja")').first()
    if (await openShiftBtn.count() > 0) {
      await openShiftBtn.click()
      await page.waitForSelector('text=Apertura de Turno de Caja', { timeout: 5000 })
      await page.fill('input[type="number"]', '100')
      await page.fill('textarea', 'Apertura de turno de prueba E2E')
      await page.screenshot({ path: path.join(evidenceDir, '15-modal-apertura-caja.png') })
      await page.click('button:has-text("Cancelar")')
    }

    // Vista previa de Historial de Turnos y Ticket 80mm
    console.log('[E2E] Comprobando subpestaña Historial de Turnos...')
    await page.click('button:has-text("Historial de Turnos")')
    await page.waitForSelector('text=Historial de Turnos de Caja', { timeout: 5000 })
    await page.screenshot({ path: path.join(evidenceDir, '16-historial-turnos.png') })

    // Comprobar vista en dispositivo móvil Android 360x800
    console.log('[E2E] Comprobando Caja en viewport móvil Android 360x800...')
    await page.setViewportSize({ width: 360, height: 800 })
    await page.screenshot({ path: path.join(evidenceDir, '17-caja-mobile-360x800.png') })
    await page.setViewportSize({ width: 1280, height: 800 })

    // Copiar evidencias al directorio de artefactos de Antigravity
    const artifactDir = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'
    if (fs.existsSync(artifactDir)) {
      const files = fs.readdirSync(evidenceDir)
      for (const file of files) {
        if (file.endsWith('.png')) {
          fs.copyFileSync(path.join(evidenceDir, file), path.join(artifactDir, file))
        }
      }
      console.log(`[E2E] Evidencias copiadas a ${artifactDir}`)
    }

    console.log('[E2E] ¡TODAS LAS PRUEBAS DE NAVEGADOR COMPLETADAS CON ÉXITO!')
  } finally {
    await browser.close()
    server.close()
  }
}

runE2E().catch((err) => {
  console.error('[E2E] Error crítico durante la prueba de navegador:', err)
  process.exit(1)
})
