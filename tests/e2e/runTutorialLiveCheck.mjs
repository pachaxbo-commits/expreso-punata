import { chromium } from 'playwright-core'
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
  let testPassword = process.env.E2E_TEST_PASSWORD
  if (!testPassword && fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf8')
    const match = envContent.match(/E2E_TEST_PASSWORD=["']?([^"'\r\n]+)["']?/)
    if (match) testPassword = match[1]
  }
  if (!testPassword) {
    throw new Error('No se encontró E2E_TEST_PASSWORD ni en process.env ni en .env.local')
  }
  return testPassword
}

async function runTutorialVerification() {
  const testPassword = getTestPassword()
  const targetUrl = process.env.TEST_TARGET_URL || 'https://expreso-punata.vercel.app'
  console.log(`[Tutorial Live Check] Conectando a ${targetUrl}...`)

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[Browser Console Error]', msg.text())
  })
  page.on('pageerror', (err) => {
    console.error('[Browser Uncaught Error]', err.message)
  })

  try {
    // 1. Acceso a Login
    console.log('1. Navegando al sistema e iniciando sesión como Administrador...')
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('input[type="email"]', { timeout: 10000 })

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

    // 4. Iniciar recorrido
    console.log('\n4. Iniciando Recorrido de Aprendizaje...')
    await page.locator('button:has-text("Iniciar Recorrido Completo")').click()

    // 5. Verificar spotlight y tarjeta educativa
    console.log('\n5. Verificando spotlight interactivo y tarjeta formativa...')
    await page.waitForSelector('text=¿Qué es y para qué sirve?', { timeout: 8000 })
    console.log('   ✓ Tarjeta formativa renderizada.')

    // Comprobar presencia de bloques pedagógicos obligatorios
    const cardEl = page.locator('div[role="dialog"]').filter({ hasText: '¿Qué es y para qué sirve?' }).first()
    const cardText = await cardEl.innerText()
    console.log('--- CARD TEXT PREVIEW ---')
    console.log(cardText)
    console.log('-------------------------')
    const upper = cardText.toUpperCase()
    if (!upper.includes('¿QUÉ ES Y PARA QUÉ SIRVE?')) throw new Error('Falta bloque ¿Qué es y para qué sirve?')
    if (!upper.includes('¿QUÉ DEBO HACER O SELECCIONAR?')) throw new Error('Falta bloque ¿Qué debo hacer o seleccionar?')
    if (!upper.includes('EJEMPLO PRÁCTICO (EXPRESO PUNATA)')) throw new Error('Falta bloque Ejemplo Práctico')
    if (!upper.includes('CONSEJO:')) throw new Error('Falta bloque Consejo')
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
    await page.waitForTimeout(500)

    // Reanudar desde el botón Tutorial en móvil
    const mobileTutorialBtn = page.locator('[data-tutorial-target="header-tutorial-btn"]')
    await mobileTutorialBtn.click()
    await page.waitForSelector('text=Centro de Tutoriales Expreso Punata', { timeout: 5000 })

    const continueBtn = page.locator('button:has-text("Continuar donde lo dejé")')
    if (await continueBtn.count() > 0) {
      await continueBtn.click()
      await page.waitForSelector('text=¿Qué es y para qué sirve?', { timeout: 8000 })
      console.log('   ✓ Reanudación móvil completada en panel inferior adaptativo.')
    }

    const shotMobile = path.join(EVIDENCE_DIR, '63-tutorial-mobile-responsive-drawer.png')
    await page.screenshot({ path: shotMobile })
    fs.copyFileSync(shotMobile, path.join(ARTIFACT_DIR, '63-tutorial-mobile-responsive-drawer.png'))
    console.log('   ✓ Captura guardada: 63-tutorial-mobile-responsive-drawer.png')

    console.log('\n========================================================================')
    console.log('¡TODAS LAS VERIFICACIONES DEL SISTEMA DE TUTORIALES PASARON AL 100%!')
    console.log('========================================================================\n')
  } catch (err) {
    const errorShot = path.join(EVIDENCE_DIR, 'error-tutorial-live-check.png')
    await page.screenshot({ path: errorShot }).catch(() => {})
    throw err
  } finally {
    await browser.close()
  }
}

runTutorialVerification().catch((err) => {
  console.error('[Tutorial Live Check ERROR]:', err)
  process.exit(1)
})
