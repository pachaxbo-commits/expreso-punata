import { chromium } from 'playwright-core'
import path from 'path'
import fs from 'fs'

const evidenceDir = path.resolve('C:/Users/fabri/.gemini/antigravity/brain/39f1d6ec-67a4-438d-a34a-fc87f2af0029/evidence')
const localEvidenceDir = path.resolve('evidence')

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

async function runProdLiveCheck() {
  console.log('🌐 Ejecutando verificación directa sobre https://expreso-punata.vercel.app...')
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true,
  })

  try {
    const page = await browser.newPage()

    // 1. Login View en Producción
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('https://expreso-punata.vercel.app', { waitUntil: 'networkidle' })
    await page.waitForSelector('a[href="/demo"]', { timeout: 10000 })
    await saveScreenshot(page, '72-prod-live-login-demo-button.png')
    console.log('   ✅ [PROD] Botón demo en Login verificado.')

    // 2. Demo View en Producción
    await page.goto('https://expreso-punata.vercel.app/demo', { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Modo Demostración', { timeout: 10000 })
    await saveScreenshot(page, '69-prod-live-demo-overview.png')
    console.log('   ✅ [PROD] Entorno /demo verificado en producción.')

    // 3. Modal Roles en Producción
    const roleBtn = page.locator('button:has-text("Simular:")').first()
    await roleBtn.click()
    await page.waitForSelector('text=Selecciona un Usuario de Demostración', { timeout: 5000 })
    await saveScreenshot(page, '70-prod-live-demo-switcher.png')
    console.log('   ✅ [PROD] Selector de roles simulados verificado en producción.')

    // Cerrar modal y probar tutorial
    const closeBtn = page.locator('button:has-text("Cerrar"), button svg.lucide-x').first()
    await closeBtn.click()
    await page.waitForTimeout(400)

    // 4. Tutorial Anti-desbordamiento en Producción
    await page.setViewportSize({ width: 1366, height: 768 })
    const tutorialCenterBtn = page.locator('[data-tutorial-target="header-btn-tutorial"]')
    await tutorialCenterBtn.click()
    await page.waitForTimeout(500)

    const startBtn = page.locator('button:has-text("Aprender")').first()
    await startBtn.click()
    await page.waitForSelector('[data-tutorial-card="true"]', { timeout: 5000 })

    const tutorialCard = page.locator('[data-tutorial-card="true"]')
    const box = await tutorialCard.boundingBox()
    console.log(`   📐 [PROD] Dimensiones en 768px: y=${box.y}, height=${box.height}, bottom=${box.y + box.height}`)
    await saveScreenshot(page, '71-prod-live-tutorial-laptop.png')
    console.log('   ✅ [PROD] Tutorial anti-desbordamiento capturado en producción.')

    console.log('🎯 Todas las verificaciones LIVE en Producción completadas exitosamente.')
  } finally {
    await browser.close()
  }
}

runProdLiveCheck().catch((err) => {
  console.error('Error en Prod Live Check:', err)
  process.exit(1)
})
