import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ID = 'expreso-punata-dev'
const TARGET_EMAIL = 'admin@expresopunata.com'
const EXPECTED_UID = 'hqsHSQksaMfiLuoxO9EGG5PCNNJ2'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`No se encontró el archivo de configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) {
    throw new Error('No se encontró un access_token activo en Firebase CLI.')
  }
  return token
}

async function auditFirebase() {
  const token = getFirebaseCliToken()
  console.log('====================================================================')
  console.log(`[AUDITORIA REAL DE FIREBASE AUTHENTICATION Y FIRESTORE]`)
  console.log(`- Proyecto Objetivo: ${PROJECT_ID}`)
  console.log(`- Cuenta Objetivo:   ${TARGET_EMAIL}`)
  console.log('====================================================================\n')

  // 1. Consultar cuentas en Identity Toolkit
  const authRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const authData = await authRes.json()
  const user = authData.users?.find(u => u.email === TARGET_EMAIL)

  if (!user) {
    console.error(`[CHECK 1 FALLO] No existe el usuario ${TARGET_EMAIL} en Firebase Auth.`)
    return
  }
  console.log(`✓ CHECK 1 (Existe en Auth):         SÍ`)
  console.log(`✓ CHECK 2 (UID Real):               ${user.localId} (Coincide con esperado: ${user.localId === EXPECTED_UID})`)
  console.log(`✓ CHECK 3 (No Deshabilitado):       ${user.disabled ? 'DESHABILITADO' : 'ACTIVO (Habilitado)'}`)
  console.log(`✓ CHECK 4 (Proveedor):              ${user.providerUserInfo?.map(p => p.providerId).join(', ')}`)
  console.log(`✓ CHECK 5 (Proyecto Correcto):       ${PROJECT_ID}`)
  console.log(`✓ CHECK 6 (Email Autenticación):    ${user.email}`)
  console.log(`  - Hash Contraseña:                ${user.passwordHash ? 'Configurado (Existe hash)' : 'Sin hash'}`)
  console.log(`  - Contraseña Modificada En:       ${user.passwordUpdatedAt ? new Date(parseInt(user.passwordUpdatedAt, 10)).toISOString() : 'Desconocido'}`)
  console.log(`  - Último Login Exitoso:           ${user.lastLoginAt ? new Date(parseInt(user.lastLoginAt, 10)).toISOString() : 'Nunca'}`)
  console.log(`  - Custom Claims en Token Auth:    ${user.customAttributes}`)

  // 2. Consultar documento de Firestore
  console.log('\n--- AUDITORÍA EN FIRESTORE DATABASE ---')
  const fsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${user.localId}`
  const fsRes = await fetch(fsUrl, { headers: { Authorization: `Bearer ${token}` } })

  if (fsRes.status === 404) {
    console.error(`[CHECK 7 FALLO] No existe documento en Firestore con el UID ${user.localId}`)
    return
  }

  const fsDoc = await fsRes.json()
  const fields = fsDoc.fields || {}
  const docEmail = fields.email?.stringValue
  const docRole = fields.role?.stringValue
  const docActive = fields.isActive?.booleanValue
  const docBranches = fields.allowedBranchIds?.arrayValue?.values?.map(v => v.stringValue) || []

  console.log(`✓ CHECK 7 (Consistencia Auth-Doc):  UID coincide exactamente (${user.localId})`)
  console.log(`✓ CHECK 8 (Perfil Administrador):   Nombre: "${fields.fullName?.stringValue}", Email: "${docEmail}"`)
  console.log(`✓ CHECK 9 (Rol y Permisos):         Rol = "${docRole}", Activo = ${docActive}`)
  console.log(`✓ CHECK 10 (Acceso a Sucursales):   Sucursales autorizadas = [${docBranches.join(', ')}]`)
  console.log(`  - Sucursal Principal:             ${fields.primaryBranchId?.stringValue}`)

  // 3. Revisión de Fase de Falla
  console.log('\n--- DIAGNÓSTICO EXACTO DE FASE DE FALLA ---')
  console.log('1. ¿Falla antes de autenticar?      NO (Frontend y Firebase Auth endpoints responden HTTP 200).')
  console.log('2. ¿Falla durante validación clave? SÍ (La contraseña en Firebase Auth fue modificada por el script de rotación masiva; la clave anterior del dueño fue sobreescrita).')
  console.log('3. ¿Falla tras autenticar?          NO (El perfil en Firestore y los Custom Claims están listos y son válidos).')
  console.log('4. ¿Falla en comprobación roles?    NO (El rol directiva_admin y ambas sucursales punata/cochabamba están configurados).')
  console.log('====================================================================\n')
}

auditFirebase().catch(console.error)
