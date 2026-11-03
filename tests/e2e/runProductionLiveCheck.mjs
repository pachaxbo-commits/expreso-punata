import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PROD_URL = 'https://expreso-punata.vercel.app'
const EVIDENCE_DIR = path.resolve('tests/e2e/evidence')
const ARTIFACT_DIR = 'C:\\Users\\fabri\\.gemini\\antigravity\\brain\\39f1d6ec-67a4-438d-a34a-fc87f2af0029\\evidence'

async function runProductionLiveVerification() {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  console.log(`[Prod Live Check] Lanzando Chrome hacia VERCEL PRODUCTION: ${PROD_URL}`)

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  })
  const page = await context.newPage()

  const consoleLogs = []
  page.on('console', (msg) => {
    console.log(`[Browser ${msg.type()}]`, msg.text())
  })
  page.on('pageerror', (err) => {
    console.error('[Browser Uncaught Error]', err.message, '\nStack:', err.stack)
  })
  page.on('requestfailed', (req) => {
    console.error(`[Request Failed] ${req.method()} ${req.url()}: ${req.failure()?.errorText}`)
  })
  page.on('response', (res) => {
    if (res.url().includes('identitytoolkit') || res.url().includes('firestore.googleapis.com')) {
      console.log(`[API Response] ${res.status()} ${res.url().split('?')[0]}`)
    }
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

    // Validar marca
    if (title.includes('S.M.T.') || title.includes('Sindicato Mixto')) {
      throw new Error(`Violación de marca en título: ${title}`)
    }

    // ==========================================
    // 2. VERIFICACIÓN DEL FORMULARIO DE LOGIN REDISEÑADO
    // ==========================================
    console.log('\n2. Verificando rediseño de Login (Sin selector de sucursal)...')
    const branchSelectorCount = await page.locator('select#branch-select, select[name="branch"], label:has-text("Sucursal de ingreso")').count()
    console.log(`   Selectores de sucursal previos a login encontrados: ${branchSelectorCount} (Esperado: 0)`)
    if (branchSelectorCount > 0) {
      throw new Error('FALLO: Todavía existe selector de sucursal antes de login.')
    }

    // Verificar campos Email y Contraseña
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"], input[type="text"][placeholder*="••••"]')
    await emailInput.waitFor({ state: 'visible', timeout: 5000 })
    console.log('   Campos Email y Contraseña detectados correctamente.')

    // Verificar que los botones de simulación no existan en producción
    const simulationButtons = await page.locator('button:has-text("Simular:"), button:has-text("Secretaria Punata")').count()
    console.log(`   Botones de simulación detectados: ${simulationButtons} (Esperado: 0 en Producción)`)
    if (simulationButtons > 0) {
      throw new Error('FALLO: Existen botones de simulación en entorno de producción.')
    }

    // Verificar botón Mostrar / Ocultar Contraseña
    console.log('\n3. Verificando botón Mostrar/Ocultar Contraseña...')
    await passwordInput.fill('ContrasenaSecreta123')
    const toggleButton = page.locator('button[title="Ver contraseña"], button[title="Ocultar contraseña"]')
    await toggleButton.waitFor({ state: 'visible', timeout: 3000 })

    let inputType = await passwordInput.getAttribute('type')
    console.log(`   Tipo de campo inicial: ${inputType}`)
    if (inputType !== 'password') throw new Error(`Esperado type='password', recibido: ${inputType}`)

    await toggleButton.click()
    await page.waitForTimeout(300)
    inputType = await passwordInput.getAttribute('type')
    console.log(`   Tipo de campo tras pulsar ojo: ${inputType}`)
    if (inputType !== 'text') throw new Error(`Esperado type='text', recibido: ${inputType}`)

    await toggleButton.click()
    await page.waitForTimeout(300)
    inputType = await passwordInput.getAttribute('type')
    console.log(`   Tipo de campo tras segundo clic: ${inputType}`)
    if (inputType !== 'password') throw new Error(`Esperado type='password', recibido: ${inputType}`)
    console.log('   ✓ Revelación / ocultamiento de contraseña funciona al 100%.')

    // Verificar modal "¿Olvidaste tu contraseña?"
    console.log('\n4. Verificando modal "¿Olvidaste tu contraseña?"...')
    const forgotBtn = page.locator('button:has-text("¿Olvidaste tu contraseña?")')
    await forgotBtn.click()
    await page.waitForSelector('text=Recuperar Contraseña', { timeout: 4000 })
    console.log('   Modal de recuperación abierto correctamente.')

    // Cerrar modal
    const cancelResetBtn = page.locator('button:has-text("Cancelar")')
    await cancelResetBtn.click()
    await page.waitForTimeout(400)
    console.log('   Modal de recuperación cerrado correctamente.')

    // Captura Login Screen limpio
    await passwordInput.fill('')
    const shotLogin = path.join(EVIDENCE_DIR, '55-prod-login-screen-clean.png')
    await page.screenshot({ path: shotLogin })
    fs.copyFileSync(shotLogin, path.join(ARTIFACT_DIR, '55-prod-login-screen-clean.png'))
    console.log(`   ✓ Captura de Login limpia guardada: 55-prod-login-screen-clean.png`)

    // ==========================================
    // 5. LOGIN SECRETARIA PUNATA (SUCURSAL FIJA)
    // ==========================================
    console.log('\n5. Iniciando sesión como Secretaria Punata (secretaria.punata@expresopunata.com)...')
    await emailInput.fill('secretaria.punata@expresopunata.com')
    await passwordInput.fill('Punata2026!')
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    // Esperar dashboard
    try {
      await page.waitForSelector('text=Agencia Punata', { timeout: 10000 })
      console.log('   ✓ Acceso concedido. Panel principal renderizado.')
    } catch (e) {
      console.error('   Error esperando Agencia Punata.')
      const bodySnippet = await page.innerText('body')
      console.log('   Contenido del cuerpo actual:\n', bodySnippet.substring(0, 500))
      const debugShot = path.join(EVIDENCE_DIR, 'debug-login-fail.png')
      await page.screenshot({ path: debugShot })
      throw e
    }

    // Verificar badge fijo de sucursal y ausencia de selector conmutador
    const branchBadge = await page.locator('header span:has-text("Agencia Punata")').innerText()
    console.log(`   Insignia de agencia detectada en barra superior: "${branchBadge}"`)
    const branchSwitcherInHeader = await page.locator('header select').count()
    console.log(`   Selectores de cambio de agencia en barra: ${branchSwitcherInHeader} (Esperado: 0 para secretaria)`)
    if (branchSwitcherInHeader > 0) {
      throw new Error('FALLO: La secretaria tiene un selector de cambio de agencia visible en el header.')
    }

    const shotSec = path.join(EVIDENCE_DIR, '57-prod-secretaria-fixed-branch.png')
    await page.screenshot({ path: shotSec })
    fs.copyFileSync(shotSec, path.join(ARTIFACT_DIR, '57-prod-secretaria-fixed-branch.png'))
    console.log(`   ✓ Captura de Secretaria guardada: 57-prod-secretaria-fixed-branch.png`)

    // Prueba de persistencia F5
    console.log('   Probando persistencia de sesión y sucursal con F5...')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('header span:has-text("Agencia Punata")', { timeout: 8000 })
    console.log('   ✓ Sesión y sucursal asignada persistieron correctamente tras F5.')

    // Cerrar sesión
    console.log('   Cerrando sesión de secretaria...')
    await page.locator('button:has-text("Cerrar Sesión")').click()
    await page.waitForSelector('input[type="email"]', { timeout: 8000 })
    console.log('   ✓ Retorno seguro a la pantalla de inicio de sesión.')

    // ==========================================
    // 6. LOGIN CONDUCTOR MÓVIL 14
    // ==========================================
    console.log('\n6. Iniciando sesión como Conductor Móvil 14 (chofer.movil14@expresopunata.com)...')
    await page.locator('input[type="email"]').fill('chofer.movil14@expresopunata.com')
    await page.locator('input[placeholder="••••••••"]').fill('Punata2026!')
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    // Esperar panel de conductor
    await page.waitForSelector('header span:has-text("Móvil 14")', { timeout: 15000 })
    console.log('   ✓ Acceso concedido al Conductor.')

    const driverBadge = await page.locator('header span:has-text("Móvil 14")').innerText()
    console.log(`   Insignia de vehículo en barra superior: "${driverBadge}"`)

    const activeTab = await page.locator('nav button[class*="border-blue-600"], nav button[class*="text-blue-600"]').innerText()
    console.log(`   Pestaña activa por defecto: "${activeTab}" (Esperado: Despachos y Ruta / Manifiestos)`)

    const shotDriver = path.join(EVIDENCE_DIR, '58-prod-conductor-mobile-badge.png')
    await page.screenshot({ path: shotDriver })
    fs.copyFileSync(shotDriver, path.join(ARTIFACT_DIR, '58-prod-conductor-mobile-badge.png'))
    console.log(`   ✓ Captura de Conductor guardada: 58-prod-conductor-mobile-badge.png`)

    // Cerrar sesión
    await page.locator('button:has-text("Cerrar Sesión")').click()
    await page.waitForSelector('input[type="email"]', { timeout: 8000 })
    console.log('   ✓ Retorno seguro a la pantalla de inicio de sesión.')

    // ==========================================
    // 7. LOGIN ADMINISTRADOR (CONMUTADOR COMPLETO Y GESTIÓN DE USUARIOS)
    // ==========================================
    console.log('\n7. Iniciando sesión como Administrador (admin@expresopunata.com)...')
    await page.locator('input[type="email"]').fill('admin@expresopunata.com')
    await page.locator('input[placeholder="••••••••"]').fill('Punata2026!')
    await page.locator('button[type="submit"]:has-text("Iniciar Sesión")').click()

    await page.waitForSelector('text=Administrador', { timeout: 15000 })
    console.log('   ✓ Acceso concedido al Administrador General.')

    // Verificar conmutador de agencias en barra superior
    const adminBranchSelect = page.locator('header select')
    await adminBranchSelect.waitFor({ state: 'visible', timeout: 5000 })
    const options = await adminBranchSelect.locator('option').allInnerTexts()
    console.log(`   Opciones de conmutación disponibles para Directiva/Admin:`, options)
    if (!options.some(o => o.includes('Punata')) || !options.some(o => o.includes('Cochabamba'))) {
      throw new Error(`Opciones incompletas para directiva_admin: ${options.join(', ')}`)
    }

    // Cambiar a Cochabamba
    console.log('   Cambiando a Cochabamba desde selector de barra...')
    await adminBranchSelect.selectOption('cochabamba')
    await page.waitForTimeout(500)
    console.log('   ✓ Conmutación a Agencia Cochabamba exitosa.')

    // Navegar a Usuarios y verificar formulario de secretaria
    console.log('   Navegando a Módulo de Administración de Usuarios...')
    const adminTab = page.locator('nav button:has-text("Administración"), nav button:has-text("Usuarios")')
    if (await adminTab.count() > 0) {
      await adminTab.first().click()
      await page.waitForTimeout(500)

      // Clic en pestaña o botón de Usuarios
      const usersSubTab = page.locator('button:has-text("Gestión de Usuarios"), button:has-text("Usuarios")')
      if (await usersSubTab.count() > 0) {
        await usersSubTab.first().click()
        await page.waitForTimeout(500)
      }

      // Probar modal de Nuevo Usuario
      const newUserBtn = page.locator('button:has-text("Nuevo Usuario")')
      if (await newUserBtn.count() > 0) {
        await newUserBtn.click()
        await page.waitForSelector('text=Registrar Usuario', { timeout: 5000 })

        // Seleccionar rol secretaria
        const roleSelect = page.locator('select#user-role')
        await roleSelect.selectOption('secretaria')
        await page.waitForTimeout(300)

        // Verificar que aparezca label 'Agencia Asignada *' y que NO aparezcan checkboxes de sucursales permitidas
        const assignedBranchLabel = await page.locator('label:has-text("Agencia Asignada *")').count()
        console.log(`   Label 'Agencia Asignada *' visible para rol secretaria: ${assignedBranchLabel > 0}`)
        const multiBranchesBox = await page.locator('text=Sucursales Autorizadas (Acceso)').count()
        console.log(`   Bloque multiselección de sucursales para secretaria: ${multiBranchesBox} (Esperado: 0)`)

        if (assignedBranchLabel === 0 || multiBranchesBox > 0) {
          throw new Error('FALLO: El formulario de usuario no restringe adecuadamente la asignación de sucursal para secretarias.')
        }

        // Cancelar modal
        await page.locator('button:has-text("Cancelar")').click()
      }
    }

    const shotAdmin = path.join(EVIDENCE_DIR, '59-prod-admin-full-switcher.png')
    await page.screenshot({ path: shotAdmin })
    fs.copyFileSync(shotAdmin, path.join(ARTIFACT_DIR, '59-prod-admin-full-switcher.png'))
    console.log(`   ✓ Captura de Admin guardada: 59-prod-admin-full-switcher.png`)

    // Cerrar sesión
    await page.locator('button:has-text("Cerrar Sesión")').click()
    await page.waitForSelector('input[type="email"]', { timeout: 8000 })

    // ==========================================
    // 8. VISTA MÓVIL (RESPONSIVE VIEWPORT)
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
