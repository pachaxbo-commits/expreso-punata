import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PREVIEW_URL = 'https://expreso-punata-git-develop-pachaxbo-8256s-projects.vercel.app'
const ARTIFACT_DIR = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'

async function capture() {
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  }

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[Preview Live] Abriendo Chrome hacia: ${PREVIEW_URL}`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  try {
    // 1. Desktop view
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    })

    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    const resp = await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 35000 })
    console.log(`HTTP Status: ${resp.status()}`)
    const title = await page.title()
    console.log(`Page Title: "${title}"`)

    const heading = await page.locator('h1, h2, h3').allInnerTexts()
    console.log(`Headings:`, heading)

    const shotDesktop = path.join(ARTIFACT_DIR, '20-vercel-preview-entrega5-desktop.png')
    await page.screenshot({ path: shotDesktop, fullPage: true })
    console.log(`Desktop screenshot saved: ${shotDesktop}`)

    // 2. Mobile view (iPhone 14 style)
    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    })
    await mobilePage.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 35000 })
    const shotMobile = path.join(ARTIFACT_DIR, '21-vercel-preview-entrega5-mobile.png')
    await mobilePage.screenshot({ path: shotMobile, fullPage: true })
    console.log(`Mobile screenshot saved: ${shotMobile}`)

    console.log(`Console Errors count: ${consoleErrors.length}`)
    if (consoleErrors.length > 0) {
      console.log('Console Errors:', consoleErrors)
    }
  } finally {
    await browser.close()
  }
}

capture().catch((e) => {
  console.error('Error during capture:', e)
  process.exit(1)
})
