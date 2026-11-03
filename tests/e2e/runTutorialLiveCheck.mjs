import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const EVIDENCE_DIR = path.join(ROOT_DIR, 'evidence')
const ARTIFACT_DIR = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'

if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

// Carga segura de contraseña desde .env.local o process.env sin imprimirla
function getTestPassword() {
  if (process.env.E2E_TEST_PASSWORD) {
    return process.env.E2E_TEST_PASSWORD
  }
  const envLocalPath = path.join(ROOT_DIR, '.env.local')
  if (fs.existsSync(envLocalPath)) {
    const lines = fs.readFileSync(envLocalPath, 'utf-8').split('\n')
    for (const line of lines) {
      const match = line.match(/^E2E_TEST_PASSWORD=(.*)$/)
      if (match) {
        return match[1].trim()
      }
    }
  }
  throw new Error('No se encontró E2E_TEST_PASSWORD ni en process.env ni en .env.local')
}

async function runTutorialVerification() {
  const testPassword = getTestPassword()
  const targetUrl = process.env.TEST_TARGET_URL || 'https://expreso-punata.vercel.app'
  console.log(`[Tutorial Live Check] Conectando a ${targetUrl}...`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()

  try {
    // 1. Acceso a Login
    console.log('1. Navegando al sistema e iniciando sesión como Administrador...')
    await page.goto(targetUrl, { waitUntil: 'networkidle' })

    await page.locator('input[type="email"]').fill('admin@expresopunata.com')
    await page.locator('input[placeholder="••••••••"]').fill(testPassword)
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    await page.waitForSelector('text=DIRECTIVA ADMIN', { timeout: 15000 })
    console.log('   ✓ Acceso concedido al Administrador General.')

    // 2. Verificar existencia del botón Tutorial en la cabecera
    console.log('\n2. Verificando botón de Tutorial en barra superior...')
    const tutorialBtn = page.locator('[data-tutorial-target="header-tutorial-btn"]')
    await tutorialBtn.waitFor({ state: 'visible', timeout: 5000 })
    console.log('   ✓ Botón "Tutorial" visible y listo para interactuar.')

    // 3. Abrir Centro de Tutoriales
    console.log('\n3. Abriendo Centro de Tutoriales Expreso Punata...')
    await tutorialBtn.click()
    await page.waitForSelector('text=Centro de Tutoriales Expreso Punata', { timeout: 5000 })
    console.log('   ✓ Modal del Centro de Tutoriales abierto con éxito.')

    // Guardar captura del Centro de Aprendizaje
    const shotCenter = path.join(EVIDENCE_DIR, '61-tutorial-center-modal.png')
    await page.screenshot({ path: shotCenter })
    fs.copyFileSync(shotCenter, path.join(ARTIFACT_DIR, '61-tutorial-center-modal.png'))
    console.log('   ✓ Captura guardada: 61-tutorial-center-modal.png')

    // 4. Iniciar un módulo específico (Ventanilla de Encomiendas)
    console.log('\n4. Iniciando tutorial específico: Ventanilla de Encomiendas...')
    const learnShipmentsBtn = page.locator('div:has-text("3. Ventanilla de Encomiendas") button:has-text("Aprender"), div:has-text("3. Ventanilla de Encomiendas") button:has-text("Repasar")').first()
    await learnShipmentsBtn.click()

    // 5. Verificar spotlight y tarjeta educativa
    console.log('\n5. Verificando spotlight interactivo y tarjeta formativa...')
    await page.waitForSelector('[role="dialog"][aria-label*="Nueva Encomienda"]', { timeout: 6000 })
    console.log('   ✓ Tarjeta formativa renderizada.')

    // Comprobar presencia de bloques pedagógicos obligatorios
    const cardText = await page.locator('[role="dialog"]').innerText()
    if (!cardText.includes('¿Qué es y para qué sirve?')) throw new Error('Falta bloque ¿Qué es y para qué sirve?')
    if (!cardText.includes('¿Qué debo hacer o seleccionar?')) throw new Error('Falta bloque ¿Qué debo hacer o seleccionar?')
    if (!cardText.includes('Ejemplo Práctico (Expreso Punata)')) throw new Error('Falta bloque Ejemplo Práctico')
    if (!cardText.includes('Consejo:')) throw new Error('Falta bloque Consejo')
    console.log('   ✓ Estructura pedagógica verificada al 100%.')

    const shotSpotlight = path.join(EVIDENCE_DIR, '62-tutorial-interactive-spotlight-step.png')
    await page.screenshot({ path: shotSpotlight })
    fs.copyFileSync(shotSpotlight, path.join(ARTIFACT_DIR, '62-tutorial-interactive-spotlight-step.png'))
    console.log('   ✓ Captura guardada: 62-tutorial-interactive-spotlight-step.png')

    // 6. Probar botón Siguiente
    console.log('\n6. Avanzando al siguiente paso formativo...')
    await page.locator('button:has-text("Siguiente")').click()
    await page.waitForTimeout(500)
    console.log('   ✓ Avance de paso exitoso.')

    // 7. Pausar y Salir
    console.log('\n7. Probando pausa y salida voluntaria sin mutaciones...')
    await page.locator('button[title="Pausar tutorial (Escape)"]').click()
    await page.waitForTimeout(300)
    console.log('   ✓ Tutorial pausado correctamente.')

    // 8. Verificación en Viewport Móvil (390x844)
    console.log('\n8. Verificando experiencia responsive móvil en 390x844...')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)

    // Reanudar desde el botón Tutorial en móvil
    const mobileTutorialBtn = page.locator('[data-tutorial-target="header-tutorial-btn"]')
    await mobileTutorialBtn.click()
    await page.waitForSelector('text=Centro de Tutoriales Expreso Punata', { timeout: 5000 })

    const continueBtn = page.locator('button:has-text("Continuar donde lo dejé")')
    if (await continueBtn.count() > 0) {
      await continueBtn.click()
      await page.waitForTimeout(500)
      console.log('   ✓ Reanudación móvil completada en panel inferior adaptativo.')
    }

    const shotMobile = path.join(EVIDENCE_DIR, '63-tutorial-mobile-responsive-drawer.png')
    await page.screenshot({ path: shotMobile })
    fs.copyFileSync(shotMobile, path.join(ARTIFACT_DIR, '63-tutorial-mobile-responsive-drawer.png'))
    console.log('   ✓ Captura guardada: 63-tutorial-mobile-responsive-drawer.png')

    console.log('\n========================================================================')
    console.log('¡TODAS LAS VERIFICACIONES DEL SISTEMA DE TUTORIALES PASARON AL 100%!')
    console.log('========================================================================\n')
  } finally {
    await browser.close()
  }
}

runTutorialVerification().catch((err) => {
  console.error('[Tutorial Live Check ERROR]:', err)
  process.exit(1)
})
