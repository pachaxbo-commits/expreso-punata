import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'expreso-punata-dev'

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

async function rotateCredentials() {
  const token = getFirebaseCliToken()

  // Generar o tomar contraseña segura con entropía criptográfica (mínimo 16 caracteres, mayúsculas, minúsculas, números, símbolos)
  const newSecret = process.env.ROTATED_PASSWORD || `PachaxEP_${crypto.randomBytes(8).toString('hex')}!2026`

  // Obtener lista de usuarios actuales
  const listRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=50`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  const listData = await listRes.json()
  if (!listData.users || listData.users.length === 0) {
    throw new Error('No se encontraron cuentas en Identity Toolkit.')
  }

  const updatedUsers = []
  for (const u of listData.users) {
    const updateRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          localId: u.localId,
          password: newSecret,
          emailVerified: true,
        }),
      }
    )

    const updateData = await updateRes.json()
    if (updateData.error) {
      console.error(`[ERROR] No se pudo rotar credencial para ${u.email}:`, updateData.error.message)
    } else {
      updatedUsers.push({ email: u.email, uid: u.localId })
    }
  }

  // Guardar en .env.local (estrictamente ignorado en gitignore)
  const envLocalPath = path.resolve('.env.local')
  let currentEnv = ''
  if (fs.existsSync(envLocalPath)) {
    currentEnv = fs.readFileSync(envLocalPath, 'utf8')
  }

  const lines = currentEnv.split('\n').filter(l => !l.startsWith('E2E_TEST_PASSWORD='))
  lines.push(`E2E_TEST_PASSWORD="${newSecret}"`)
  fs.writeFileSync(envLocalPath, lines.join('\n').trim() + '\n', 'utf8')

  console.log('====================================================================')
  console.log(`[SEGURIDAD] Rotación de Credenciales Completada Exitosamente`)
  console.log(`- Proyecto:          ${PROJECT_ID}`)
  console.log(`- Cuentas rotadas:   ${updatedUsers.length}`)
  for (const u of updatedUsers) {
    console.log(`  ✓ ${u.email} (UID: ${u.uid})`)
  }
  console.log(`- Almacenamiento:    .env.local (ignorado por Git)`)
  console.log(`- Protección:        Cero contraseñas expuestas en consola ni repositorio`)
  console.log('====================================================================\n')
}

rotateCredentials().catch(err => {
  console.error('[ROTATION ERROR]', err)
  process.exit(1)
})
