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
      console.log(`[Evidence] Servidor estático iniciado en http://127.0.0.1:${PORT}`)
      resolve(server)
    })
  })
}

async function run() {
  const server = await startStaticServer()
  const artifactDir = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'
  const evidenceDir = path.resolve('tests/e2e/evidence')

  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true })
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true })

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[Evidence] Conectando a Chrome...`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    })
    const page = await context.newPage()

    console.log('[Evidence] Abriendo aplicación...')
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=EXPRESO PUNATA', { timeout: 10000 })

    // 1. Login como Directiva / Admin
    console.log('[Evidence] Iniciando sesión como Directiva / Admin...')
    const adminBtn = page.locator('button:has-text("Directiva / Admin")')
    if (await adminBtn.count() > 0) {
      await adminBtn.click()
    } else {
      await page.fill('input[type="email"]', 'admin@expresopunata.com')
      await page.fill('input[type="password"]', 'Admin123456*')
      await page.click('button:has-text("Ingresar al Sistema")')
    }

    await page.waitForSelector('text=Gestión de Encomiendas', { timeout: 10000 })
    console.log('[Evidence] Encomiendas 50/50 cargado.')

    const sampleShipment = {
      id: 'PUN202600001',
      trackingCode: 'PUN202600001',
      trackingNumber: 'PUN202600001',
      originBranchId: 'punata',
      originCity: 'Punata',
      destinationBranchId: 'cochabamba',
      destinationCity: 'Cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Faustino Choque', phone: '71234567', docNumber: '4589234 CB' },
      recipient: { name: 'Rosario Méndez', phone: '72345678', docNumber: '5678123 CB' },
      packageCount: 1,
      totalWeightKg: 4.5,
      items: [{ description: 'Caja con repuestos y muestras', quantity: 1, weightKg: 4.5, handlingNotes: 'Frágil' }],
      status: 'stored',
      paymentStatus: 'paid',
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      suggestedAmountCents: 1800,
      agreedAmountCents: 2000,
      finalAmountCents: 2000,
      isPriceAdjusted: true,
      priceAdjustmentReason: 'Embalaje reforzado acordado en mostrador',
      priceAdjustedByUid: 'usr-sec-01',
      priceAdjustedByName: 'Secretaria Central Punata',
      priceAdjustedAt: new Date().toISOString(),
      assignedVehicleMobileNumber: '04',
      assignedDriverName: 'Don Juan Perez',
      warehouseShelf: 'Estante A',
      warehouseModule: 'Módulo 2',
      createdAtIso: new Date().toISOString(),
      registeredByUid: 'usr-sec-01',
      registeredByName: 'Secretaria Central Punata',
      statusHistory: [
        { status: 'received', timestampIso: new Date(Date.now() - 3600000).toISOString(), operatorName: 'Secretaria Central Punata', notes: 'Recepción en ventanilla' },
        { status: 'in_transit', timestampIso: new Date(Date.now() - 1800000).toISOString(), operatorName: 'Don Juan Perez', notes: 'Carga despachada en móvil 04' },
        { status: 'stored', timestampIso: new Date().toISOString(), operatorName: 'Secretaria Cochabamba', notes: 'Recibido en almacén Estante A Módulo 2' }
      ]
    }

    await page.evaluate((shipment) => {
      if (window.__setShipments) {
        window.__setShipments([shipment])
      }
    }, sampleShipment)

    await page.waitForTimeout(500)

    // 2. Captura Ventanilla 50/50 Desktop (con fila de encomienda real)
    const shot39 = path.join(artifactDir, '39-ventanilla-50-50-desktop.png')
    await page.screenshot({ path: shot39, fullPage: true })
    fs.copyFileSync(shot39, path.join(evidenceDir, '39-ventanilla-50-50-desktop.png'))
    console.log(`[Evidence] Captura 39 guardada: ${shot39}`)

    // 3. Captura Ventanilla Mobile
    await page.setViewportSize({ width: 390, height: 844 })
    const shot40 = path.join(artifactDir, '40-ventanilla-mobile.png')
    await page.screenshot({ path: shot40, fullPage: true })
    fs.copyFileSync(shot40, path.join(evidenceDir, '40-ventanilla-mobile.png'))
    console.log(`[Evidence] Captura 40 guardada: ${shot40}`)

    // Restaurar Desktop
    await page.setViewportSize({ width: 1400, height: 900 })

    // 4. Abrir Wizard Nueva Encomienda y llegar a Paso 4 (Precio Editable)
    console.log('[Evidence] Abriendo Wizard Nueva Encomienda...')
    await page.click('button:has-text("NUEVA ENCOMIENDA")')
    await page.waitForSelector('text=1. Ruta', { timeout: 5000 })

    await page.click('button:has-text("Siguiente")')
    await page.waitForSelector('text=Datos del Remitente', { timeout: 5000 })

    await page.fill('input[placeholder="Ej. Juan Pérez"]', 'Faustino Choque')
    await page.fill('input[placeholder="Ej. 71712345"]', '71234567')
    await page.fill('input[placeholder="Ej. María López"]', 'Rosario Méndez')
    await page.fill('input[placeholder="Ej. 72234567"]', '72345678')
    await page.click('button:has-text("Siguiente")')
    await page.waitForSelector('text=Paquetes a Registrar', { timeout: 5000 })

    const descInput = page.locator('input[placeholder*="Ropa, repuestos"]').first()
    await descInput.fill('Caja con muestras textiles')
    await page.click('button:has-text("Siguiente")')
    await page.waitForSelector('text=Confirmación de Datos', { timeout: 5000 })

    // Paso 4: Precio Editable
    const shot41 = path.join(artifactDir, '41-wizard-precio-editable.png')
    await page.screenshot({ path: shot41 })
    fs.copyFileSync(shot41, path.join(evidenceDir, '41-wizard-precio-editable.png'))
    console.log(`[Evidence] Captura 41 guardada: ${shot41}`)

    // Cerrar Wizard
    await page.locator('button:has(svg.lucide-x)').first().click()
    await page.waitForTimeout(600)

    // Reinyectar fila por si el cierre reseteó estado
    await page.evaluate((shipment) => {
      if (window.__setShipments) {
        window.__setShipments([shipment])
      }
    }, sampleShipment)
    await page.waitForTimeout(500)

    // 5. Ver detalle de encomienda usando __openShipmentDetail
    console.log('[Evidence] Abriendo detalle de encomienda...')
    await page.evaluate((shipment) => {
      if (window.__openShipmentDetail) {
        window.__openShipmentDetail(shipment)
      }
    }, sampleShipment)
    await page.waitForSelector('text=Ficha Oficial de Encomienda', { timeout: 5000 })

    const shot42 = path.join(artifactDir, '42-detalle-encomienda-modal.png')
    await page.screenshot({ path: shot42 })
    fs.copyFileSync(shot42, path.join(evidenceDir, '42-detalle-encomienda-modal.png'))
    console.log(`[Evidence] Captura 42 guardada: ${shot42}`)

    // Pestaña Incidencias & Rezagos
    const incidentTab = page.locator('button:has-text("Incidencias")')
    if (await incidentTab.count() > 0) {
      await incidentTab.click()
      await page.waitForTimeout(400)
      const shot43 = path.join(artifactDir, '43-detalle-incidencias-tab.png')
      await page.screenshot({ path: shot43 })
      fs.copyFileSync(shot43, path.join(evidenceDir, '43-detalle-incidencias-tab.png'))
      console.log(`[Evidence] Captura 43 guardada: ${shot43}`)
    }

    // Pestaña Historial y Auditoría
    const historyTab = page.locator('button:has-text("Historial")')
    if (await historyTab.count() > 0) {
      await historyTab.click()
      await page.waitForTimeout(400)
      const shot43b = path.join(artifactDir, '43b-detalle-auditoria-tab.png')
      await page.screenshot({ path: shot43b })
      fs.copyFileSync(shot43b, path.join(evidenceDir, '43b-detalle-auditoria-tab.png'))
      console.log(`[Evidence] Captura 43b guardada: ${shot43b}`)
    }

    // Pestaña Rectificación & Edición
    const editTab = page.locator('button:has-text("Editar")')
    if (await editTab.count() > 0) {
      await editTab.click()
      await page.waitForTimeout(400)
      const shot43c = path.join(artifactDir, '43c-detalle-edicion-tab.png')
      await page.screenshot({ path: shot43c })
      fs.copyFileSync(shot43c, path.join(evidenceDir, '43c-detalle-edicion-tab.png'))
      console.log(`[Evidence] Captura 43c guardada: ${shot43c}`)
    }

    // Cerrar modal detalle
    const closeBtn = page.locator('button:has-text("Volver")').first()
    if (await closeBtn.count() > 0) await closeBtn.click()
    else await page.locator('button:has(svg.lucide-x)').first().click()

    // 6. Navegar a Despachos -> Comisiones de Choferes
    console.log('[Evidence] Navegando a Comisiones de Choferes...')
    await page.click('button:has-text("Despachos")')
    await page.waitForSelector('text=Comisiones de Choferes', { timeout: 5000 })
    await page.click('button:has-text("Comisiones de Choferes")')

    const shot44 = path.join(artifactDir, '44-comisiones-choferes.png')
    await page.screenshot({ path: shot44, fullPage: true })
    fs.copyFileSync(shot44, path.join(evidenceDir, '44-comisiones-choferes.png'))
    console.log(`[Evidence] Captura 44 guardada: ${shot44}`)

    // 7. Navegar a Inventario -> Consumibles e Insumos
    console.log('[Evidence] Navegando a Consumibles e Insumos...')
    await page.click('button:has-text("Inventario")')
    await page.waitForSelector('text=Consumibles e Insumos', { timeout: 5000 })
    await page.click('button:has-text("Consumibles e Insumos")')

    const shot45 = path.join(artifactDir, '45-consumibles-inventario.png')
    await page.screenshot({ path: shot45, fullPage: true })
    fs.copyFileSync(shot45, path.join(evidenceDir, '45-consumibles-inventario.png'))
    console.log(`[Evidence] Captura 45 guardada: ${shot45}`)

    // 8. Navegar a Configuración -> Configuración Oficial
    console.log('[Evidence] Navegando a Configuración Oficial del Sistema...')
    await page.click('button:has-text("Configuración")')
    await page.waitForSelector('text=General', { timeout: 5000 })
    await page.click('button:has-text("General")')
    await page.waitForSelector('text=Configuración Oficial del Sistema', { timeout: 5000 })

    const shot46 = path.join(artifactDir, '46-configuracion-oficial-sistema.png')
    await page.screenshot({ path: shot46, fullPage: true })
    fs.copyFileSync(shot46, path.join(evidenceDir, '46-configuracion-oficial-sistema.png'))
    console.log(`[Evidence] Captura 46 guardada: ${shot46}`)

    console.log('[Evidence] ¡TODAS las capturas generadas con éxito!')
  } finally {
    await browser.close()
    server.close()
  }
}

run().catch((err) => {
  console.error('[Evidence] Error:', err)
  process.exit(1)
})
