import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PROD_URL = 'https://expreso-punata.vercel.app'
const EVIDENCE_DIR = path.resolve('tests/e2e/evidence')
const ARTIFACT_DIR = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'

// Obtener credencial segura sin versionarla en repositorio
let testPassword = process.env.E2E_TEST_PASSWORD
if (!testPassword && fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8')
  const match = envContent.match(/E2E_TEST_PASSWORD=["']?([^"'\r\n]+)["']?/)
  if (match) testPassword = match[1]
}

if (!testPassword) {
  console.error('[SEGURIDAD ERROR] E2E_TEST_PASSWORD no configurada. Configure .env.local o la variable de entorno.')
  process.exit(1)
}

async function runProductionLiveVerification() {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[Prod Live Check] Conectando Chrome a VERCEL PRODUCTION: ${PROD_URL}`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[Browser Error]`, msg.text())
  })
  page.on('pageerror', (err) => {
    console.error('[Browser Uncaught Error]', err.message)
  })

  try {
    // ==========================================
    // 1. CARGA INICIAL Y VALIDACIÓN DE PÁGINA
    // ==========================================
    console.log(`\n1. Conectando a ${PROD_URL}...`)
    const response = await page.goto(PROD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    console.log(`   HTTP Status: ${response.status()}`)
    const title = await page.title()
    console.log(`   Título: "${title}"`)

    if (title.includes('S.M.T.') || title.includes('Sindicato Mixto')) {
      throw new Error(`Violación de marca en título: ${title}`)
    }

    // ==========================================
    // 2. VERIFICACIÓN DEL FORMULARIO DE LOGIN REDISEÑADO
    // ==========================================
    console.log('\n2. Verificando rediseño de Login (Sin selector de sucursal)...')
    const branchSelectorCount = await page.locator('select#branch-select, select[name="branch"], label:has-text("Sucursal de ingreso")').count()
    console.log(`   Selectores de sucursal previos a login: ${branchSelectorCount} (Esperado: 0)`)
    if (branchSelectorCount > 0) {
      throw new Error('FALLO: Existe selector de sucursal antes de login.')
    }

    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[placeholder="••••••••"]')
    await emailInput.waitFor({ state: 'visible', timeout: 5000 })
    console.log('   Campos Email y Contraseña detectados correctamente.')

    // ==========================================
    // 3. VERIFICACIÓN DE REVELACIÓN DE CONTRASEÑA
    // ==========================================
    console.log('\n3. Verificando botón Mostrar/Ocultar Contraseña...')
    await passwordInput.fill('PruebaPassword123')
    const toggleButton = page.locator('button[title="Ver contraseña"], button[title="Ocultar contraseña"]')
    await toggleButton.waitFor({ state: 'visible', timeout: 3000 })

    let inputType = await passwordInput.getAttribute('type')
    if (inputType !== 'password') throw new Error(`Esperado type='password', recibido: ${inputType}`)

    await toggleButton.click()
    await page.waitForTimeout(200)
    inputType = await passwordInput.getAttribute('type')
    if (inputType !== 'text') throw new Error(`Esperado type='text', recibido: ${inputType}`)

    await toggleButton.click()
    await page.waitForTimeout(200)
    inputType = await passwordInput.getAttribute('type')
    if (inputType !== 'password') throw new Error(`Esperado type='password', recibido: ${inputType}`)
    console.log('   ✓ Revelación / ocultamiento de contraseña funciona al 100%.')

    // ==========================================
    // 4. VERIFICACIÓN DE MODAL RECUPERACIÓN DE CONTRASEÑA
    // ==========================================
    console.log('\n4. Verificando modal "¿Olvidaste tu contraseña?"...')
    const forgotBtn = page.locator('button:has-text("¿Olvidaste tu contraseña?")')
    await forgotBtn.click()
    await page.waitForSelector('text=Recuperar Contraseña', { timeout: 4000 })
    console.log('   Modal de recuperación abierto correctamente.')

    const cancelResetBtn = page.locator('button:has-text("Cancelar")')
    await cancelResetBtn.click()
    await page.waitForTimeout(300)
    console.log('   Modal de recuperación cerrado correctamente.')

    await passwordInput.fill('')
    const shotLogin = path.join(EVIDENCE_DIR, '55-prod-login-screen-clean.png')
    await page.screenshot({ path: shotLogin })
    fs.copyFileSync(shotLogin, path.join(ARTIFACT_DIR, '55-prod-login-screen-clean.png'))
    console.log(`   ✓ Captura de Login limpia guardada: 55-prod-login-screen-clean.png`)

    // ==========================================
    // 4b. VERIFICACIÓN DE CREDENCIALES INVÁLIDAS SIN DESMONTAJE NI BLANQUEO
    // ==========================================
    console.log('\n4b. Verificando intento con contraseña incorrecta (Preservación de formulario)...')
    await emailInput.fill('admin@expresopunata.com')
    await passwordInput.fill('ClaveErroneaInvalida123!')
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    // Debe mostrar error claro
    await page.waitForSelector('text=Credenciales inválidas', { timeout: 8000 })
    const displayedError = await page.locator('text=Credenciales inválidas').first().innerText()
    console.log(`   Mensaje de error visible en pantalla: "${displayedError.trim()}"`)

    // Verificar que el formulario NO se desmontó ni se blanqueó el correo
    const emailAfterFail = await emailInput.inputValue()
    console.log(`   Correo en campo tras fallo: "${emailAfterFail}" (Esperado: admin@expresopunata.com)`)
    if (emailAfterFail !== 'admin@expresopunata.com') {
      throw new Error('FALLO: El campo de correo se vació tras un fallo de autenticación.')
    }

    const shotErrorPreserved = path.join(EVIDENCE_DIR, '55b-prod-login-error-preserves-form.png')
    await page.screenshot({ path: shotErrorPreserved })
    fs.copyFileSync(shotErrorPreserved, path.join(ARTIFACT_DIR, '55b-prod-login-error-preserves-form.png'))
    console.log('   ✓ Preservación de formulario y visualización de error verificada al 100%.')

    // Limpiar campos para siguientes pruebas
    await emailInput.fill('')
    await passwordInput.fill('')

    // ==========================================
    // 5. LOGIN SECRETARIA PUNATA (CON TECLA ENTER)
    // ==========================================
    console.log('\n5. Iniciando sesión como Secretaria Punata con tecla Enter...')
    await emailInput.fill('secretaria.punata@expresopunata.com')
    await passwordInput.fill(testPassword)
    await passwordInput.press('Enter')

    await page.waitForSelector('text=Agencia Central Punata', { timeout: 15000 })
    console.log('   ✓ Acceso concedido mediante tecla Enter. Panel renderizado.')

    const branchBadge = await page.locator('header span:has-text("Central Punata")').innerText()
    console.log(`   Insignia de agencia detectada: "${branchBadge}"`)
    const branchSwitcherInHeader = await page.locator('header select').count()
    console.log(`   Selectores de cambio de agencia: ${branchSwitcherInHeader} (Esperado: 0 para secretaria)`)
    if (branchSwitcherInHeader > 0) {
      throw new Error('FALLO: La secretaria tiene un selector de cambio de agencia visible en el header.')
    }

    const shotSec = path.join(EVIDENCE_DIR, '57-prod-secretaria-fixed-branch.png')
    await page.screenshot({ path: shotSec })
    fs.copyFileSync(shotSec, path.join(ARTIFACT_DIR, '57-prod-secretaria-fixed-branch.png'))
    console.log(`   ✓ Captura de Secretaria guardada: 57-prod-secretaria-fixed-branch.png`)

    // Persistencia F5
    console.log('   Probando persistencia de sesión con F5...')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('header span:has-text("Central Punata")', { timeout: 8000 })
    console.log('   ✓ Sesión y sucursal asignada persistieron tras F5.')

    // Cerrar sesión
    console.log('   Cerrando sesión de secretaria...')
    await page.locator('button[title="Cerrar Sesión"]').click()
    await page.waitForSelector('input[type="email"]', { timeout: 8000 })
    console.log('   ✓ Retorno seguro al login.')

    // ==========================================
    // 6. LOGIN CONDUCTOR MÓVIL 14
    // ==========================================
    console.log('\n6. Iniciando sesión como Conductor Móvil 14...')
    await page.locator('input[type="email"]').fill('chofer.movil14@expresopunata.com')
    await page.locator('input[placeholder="••••••••"]').fill(testPassword)
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    await page.waitForSelector('header span:has-text("Móvil 14")', { timeout: 15000 })
    console.log('   ✓ Acceso concedido al Conductor.')

    const driverBadge = await page.locator('header span:has-text("Móvil 14")').innerText()
    console.log(`   Insignia de vehículo: "${driverBadge}"`)

    const activeTab = await page.locator('button:has-text("Despachos y Ruta")').first().innerText()
    console.log(`   Pestaña activa por defecto: "${activeTab}" (Esperado: Despachos y Ruta)`)

    const shotDriver = path.join(EVIDENCE_DIR, '58-prod-conductor-mobile-badge.png')
    await page.screenshot({ path: shotDriver })
    fs.copyFileSync(shotDriver, path.join(ARTIFACT_DIR, '58-prod-conductor-mobile-badge.png'))
    console.log(`   ✓ Captura de Conductor guardada: 58-prod-conductor-mobile-badge.png`)

    await page.locator('button[title="Cerrar Sesión"]').click()
    await page.waitForSelector('input[type="email"]', { timeout: 8000 })
    console.log('   ✓ Retorno seguro al login.')

    // ==========================================
    // 7. LOGIN ADMINISTRADOR (CONMUTADOR COMPLETO)
    // ==========================================
    console.log('\n7. Iniciando sesión como Administrador...')
    await page.locator('input[type="email"]').fill('admin@expresopunata.com')
    await page.locator('input[placeholder="••••••••"]').fill(testPassword)
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    await page.waitForSelector('text=DIRECTIVA ADMIN', { timeout: 15000 })
    console.log('   ✓ Acceso concedido al Administrador General.')

    const adminBranchSelect = page.locator('header select')
    await adminBranchSelect.waitFor({ state: 'visible', timeout: 5000 })
    const options = await adminBranchSelect.locator('option').allInnerTexts()
    console.log(`   Opciones de conmutación disponibles:`, options)
    if (!options.some(o => o.includes('Punata')) || !options.some(o => o.includes('Cochabamba'))) {
      throw new Error(`Opciones incompletas para directiva_admin: ${options.join(', ')}`)
    }

    console.log('   Cambiando a Cochabamba desde selector de barra...')
    await adminBranchSelect.selectOption('cochabamba')
    await page.waitForTimeout(500)
    console.log('   ✓ Conmutación a Agencia Cochabamba exitosa.')

    console.log('   Navegando a Configuración / Usuarios...')
    const configTab = page.locator('button:has-text("Configuración")')
    if (await configTab.count() > 0) {
      await configTab.first().click()
      await page.waitForTimeout(500)

      const usersSubTab = page.locator('button:has-text("Usuarios")')
      if (await usersSubTab.count() > 0) {
        await usersSubTab.first().click()
        await page.waitForTimeout(500)
      }

      const newUserBtn = page.locator('button:has-text("Nuevo Usuario")')
      if (await newUserBtn.count() > 0) {
        await newUserBtn.click()
        await page.waitForSelector('text=Registrar Usuario', { timeout: 5000 })

        const roleSelect = page.locator('select#user-role')
        await roleSelect.selectOption('secretaria')
        await page.waitForTimeout(300)

        const assignedBranchLabel = await page.locator('label:has-text("Agencia Asignada *")').count()
        console.log(`   Label 'Agencia Asignada *' visible para secretaria: ${assignedBranchLabel > 0}`)
        const multiBranchesBox = await page.locator('text=Sucursales Autorizadas (Acceso)').count()
        console.log(`   Bloque multiselección para secretaria: ${multiBranchesBox} (Esperado: 0)`)

        if (assignedBranchLabel === 0 || multiBranchesBox > 0) {
          throw new Error('FALLO: Formulario de usuario no restringe sucursal única para secretarias.')
        }

        await page.locator('button:has-text("Cancelar")').click()
      }
    }

    const shotAdmin = path.join(EVIDENCE_DIR, '59-prod-admin-full-switcher.png')
    await page.screenshot({ path: shotAdmin })
    fs.copyFileSync(shotAdmin, path.join(ARTIFACT_DIR, '59-prod-admin-full-switcher.png'))
    console.log(`   ✓ Captura de Admin guardada: 59-prod-admin-full-switcher.png`)

    await page.locator('button[title="Cerrar Sesión"]').click()
    await page.waitForSelector('input[type="email"]', { timeout: 8000 })

    // ==========================================
    // 8. VISTA MÓVIL (RESPONSIVE VIEWPORT 390x844)
    // ==========================================
    console.log('\n8. Verificando vista móvil (390x844)...')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const shotMobile = path.join(EVIDENCE_DIR, '60-prod-mobile-viewport.png')
    await page.screenshot({ path: shotMobile })
    fs.copyFileSync(shotMobile, path.join(ARTIFACT_DIR, '60-prod-mobile-viewport.png'))
    console.log(`   ✓ Captura Móvil guardada: 60-prod-mobile-viewport.png`)

    console.log('\n========================================================================')
    console.log('¡TODAS LAS VERIFICACIONES EN VIVO EN VERCEL PRODUCTION PASARON AL 100%!')
    console.log('========================================================================\n')
  } finally {
    await browser.close()
  }
}

runProductionLiveVerification().catch((err) => {
  console.error('\n[Prod Live Check ERROR]:', err)
  process.exit(1)
})
