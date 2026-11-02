import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PREVIEW_URL = 'https://expreso-punata-5hgl0mc67-pachaxbo-8256s-projects.vercel.app'
const EVIDENCE_DIR = path.resolve('tests/e2e/evidence')
const ARTIFACT_DIR = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'

async function runPreviewCheck() {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  }

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[Preview Check] Lanzando Google Chrome (${chromePath}) hacia: ${PREVIEW_URL}`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    })

    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    console.log(`[Preview Check] Navegando a ${PREVIEW_URL}...`)
    const response = await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 })
    console.log(`[Preview Check] Código de respuesta HTTP: ${response.status()}`)

    const title = await page.title()
    console.log(`[Preview Check] Título de la página: "${title}"`)

    const heading = await page.locator('h1, h2, h3').allInnerTexts()
    console.log(`[Preview Check] Encabezados detectados:`, heading)

    const shot1 = path.join(EVIDENCE_DIR, '18-vercel-preview-live.png')
    const shot1Art = path.join(ARTIFACT_DIR, '18-vercel-preview-live.png')
    await page.screenshot({ path: shot1, fullPage: true })
    fs.copyFileSync(shot1, shot1Art)
    console.log(`[Preview Check] Captura guardada: ${shot1}`)

    // Vista móvil
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const shot2 = path.join(EVIDENCE_DIR, '19-vercel-preview-mobile.png')
    const shot2Art = path.join(ARTIFACT_DIR, '19-vercel-preview-mobile.png')
    await page.screenshot({ path: shot2, fullPage: true })
    fs.copyFileSync(shot2, shot2Art)
    console.log(`[Preview Check] Captura móvil guardada: ${shot2}`)

    console.log(`[Preview Check] Console errors: ${consoleErrors.length}`)
    if (consoleErrors.length > 0) {
      console.log(`[Preview Check] Detalles errores consola:`, consoleErrors.slice(0, 5))
    }

    console.log(`[Preview Check] Verificación de Vercel Preview completada exitosamente.`)
  } finally {
    await browser.close()
  }
}

runPreviewCheck().catch((err) => {
  console.error('[Preview Check] Error:', err)
  process.exit(1)
})
