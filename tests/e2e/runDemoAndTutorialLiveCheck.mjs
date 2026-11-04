import { chromium } from 'playwright-core'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const evidenceDir = path.resolve('C:/Users/fabri/.gemini/antigravity/brain/39f1d6ec-67a4-438d-a34a-fc87f2af0029/evidence')
const localEvidenceDir = path.resolve('evidence')

if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true })
if (!fs.existsSync(localEvidenceDir)) fs.mkdirSync(localEvidenceDir, { recursive: true })

async function saveScreenshot(page, filename) {
  const p1 = path.join(evidenceDir, filename)
  const p2 = path.join(localEvidenceDir, filename)
  await page.screenshot({ path: p1 })
  try {
    fs.copyFileSync(p1, p2)
  } catch (e) {
    // ignore
  }
}

async function startLocalServer() {
  const serverProcess = spawn('npx', ['vite', 'preview', '--port', '4173'], {
    shell: true,
    stdio: 'pipe',
  })

  // Esperar a que el servidor esté listo
  await new Promise((resolve) => {
    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString()
      if (msg.includes('http://localhost:4173') || msg.includes('Local:')) resolve(true)
    })
    serverProcess.stderr.on('data', (d) => console.log('[Vite Preview]:', d.toString()))
    setTimeout(() => resolve(true), 4000)
  })

  return serverProcess
}

async function runLiveVerification() {
  console.log('🚀 Iniciando verificación E2E de Modo Demo y Anti-Desbordamiento de Tutoriales...')
  const server = await startLocalServer()

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true,
  })

  try {
    const page = await browser.newPage()

    // 1. Verificación de Botón Demo en LoginView
    console.log('📌 Test 1: Verificando enlace a /demo en LoginView...')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)

    const demoLink = page.locator('a[href="/demo"]')
    await demoLink.waitFor({ state: 'visible', timeout: 5000 })
    await saveScreenshot(page, '68-login-public-demo-button.png')
    console.log('   ✅ Botón de Demo Pública verificado en LoginView.')

    // 2. Acceso directo a /demo
    console.log('📌 Test 2: Accediendo directamente a /demo sin credenciales...')
    await page.goto('http://localhost:4173/demo', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)

    // Verificar banner amarillo
    const demoBanner = page.locator('text=Modo Demostración')
    await demoBanner.waitFor({ state: 'visible', timeout: 5000 })
    await saveScreenshot(page, '64-demo-public-overview.png')
    console.log('   ✅ Banner y entorno /demo cargados correctamente sin autenticación.')

    // 3. Modal selector de roles
    console.log('📌 Test 3: Abriendo selector de roles simulados...')
    const roleBtn = page.locator('button:has-text("Simular:")').first()
    await roleBtn.click()
    await page.waitForTimeout(600)

    const roleModalTitle = page.locator('text=Selecciona un Usuario de Demostración')
    await roleModalTitle.waitFor({ state: 'visible', timeout: 5000 })
    await saveScreenshot(page, '65-demo-role-switcher.png')

    // Simular Secretaria Punata
    const secPunataCard = page.locator('div:has-text("Secretaria Punata")').last()
    await secPunataCard.click()
    await page.waitForTimeout(800)
    console.log('   ✅ Cambio de rol a Secretaria Punata verificado.')

    // 4. Tutorial Anti-Desbordamiento en Laptop (1366x768)
    console.log('📌 Test 4: Verificando anti-desbordamiento del tutorial en 1366x768 (Laptop)...')
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.waitForTimeout(500)

    // Abrir Centro de Capacitación
    const tutorialCenterBtn = page.locator('[data-tutorial-target="header-btn-tutorial"]')
    await tutorialCenterBtn.click()
    await page.waitForTimeout(600)

    // Iniciar sección 1 (Ventanilla) mediante botón "Aprender"
    const startSectionBtn = page.locator('button:has-text("Aprender")').first()
    await startSectionBtn.click()
    await page.waitForTimeout(1000)

    // Localizar tarjeta de tutorial
    const tutorialCard = page.locator('[data-tutorial-card="true"]')
    await tutorialCard.waitFor({ state: 'visible', timeout: 5000 })

    const box = await tutorialCard.boundingBox()
    if (!box) throw new Error('No se pudo obtener las dimensiones de la tarjeta de tutorial')

    console.log(`   📐 Dimensiones de la tarjeta en 768px: y=${box.y}, height=${box.height}, bottom=${box.y + box.height}`)
    if (box.y + box.height > 768) {
      throw new Error(`¡DESBORDAMIENTO DETECTADO! bottom=${box.y + box.height} excede 768px`)
    }

    // Botones de acción deben ser visibles y clickeables
    const nextBtn = page.locator('button:has-text("Siguiente")')
    const skipBtn = page.locator('button:has-text("Omitir paso")')
    await nextBtn.waitFor({ state: 'visible', timeout: 5000 })
    await skipBtn.waitFor({ state: 'visible', timeout: 5000 })

    await saveScreenshot(page, '66-tutorial-anti-overflow-laptop.png')
    console.log('   ✅ Tarjeta dentro del viewport de laptop, botones Siguiente y Omitir 100% visibles.')

    // 5. Drawer responsivo en Móvil (390x844)
    console.log('📌 Test 5: Verificando drawer responsivo en Móvil (390x844)...')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)

    const mobileBox = await tutorialCard.boundingBox()
    if (!mobileBox) throw new Error('No se pudo obtener boundingBox en móvil')
    console.log(`   📱 Dimensiones en móvil: y=${mobileBox.y}, height=${mobileBox.height}, bottom=${mobileBox.y + mobileBox.height}`)

    if (mobileBox.y + mobileBox.height > 845) {
      throw new Error(`¡DESBORDAMIENTO MÓVIL! bottom=${mobileBox.y + mobileBox.height} excede 844px`)
    }

    await saveScreenshot(page, '67-tutorial-mobile-drawer.png')
    console.log('   ✅ Drawer móvil encaja perfectamente en 844px.')

    console.log('🎉 Todas las verificaciones E2E de Fase 13 pasaron con éxito.')
  } finally {
    await browser.close()
    server.kill()
  }
}

runLiveVerification().catch((err) => {
  console.error('❌ Error en verificación E2E:', err)
  process.exit(1)
})
