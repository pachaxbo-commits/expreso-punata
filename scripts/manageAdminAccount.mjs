import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const TARGET_ADMIN_UID = 'hqsHSQksaMfiLuoxO9EGG5PCNNJ2'
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'expreso-punata-dev'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`No se encontró el archivo de configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) {
    throw new Error('No se encontró un access_token activo en Firebase CLI. Ejecute "firebase login".')
  }
  return token
}

function askHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const stdin = process.openStdin()
    process.stdin.on('data', (char) => {
      char = char + ''
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.pause()
          break
        default:
          process.stdout.clearLine(0)
          readline.cursorTo(process.stdout, 0)
          process.stdout.write(query + '*'.repeat(rl.line ? rl.line.length : 0))
          break
      }
    })
    rl.question(query, (value) => {
      rl.history = rl.history.slice(1)
      rl.close()
      resolve(value)
    })
  })
}

function parseArgs() {
  const args = process.argv.slice(2)
  const params = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        params[key] = args[i + 1]
        i++
      } else {
        params[key] = true
      }
    }
  }
  return params
}

async function main() {
  const params = parseArgs()
  const token = getFirebaseCliToken()

  console.log('====================================================================')
  console.log(`[PACHAX] Gestión Segura de Credenciales de Administrador`)
  console.log(`- Proyecto:    ${PROJECT_ID}`)
  console.log(`- Target UID:  ${TARGET_ADMIN_UID}`)
  console.log('====================================================================\n')

  // 1. Obtener usuario actual en Firebase Auth
  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [TARGET_ADMIN_UID] }),
    }
  )

  const lookupData = await lookupRes.json()
  const user = lookupData.users?.[0]
  if (!user) {
    console.error(`[ERROR] No se encontró el usuario administrador con UID '${TARGET_ADMIN_UID}'.`)
    process.exit(1)
  }

  console.log(`Usuario autenticado en Auth: ${user.email} (Verificado: ${user.emailVerified}, Inhabilitado: ${Boolean(user.disabled)})\n`)

  // Opción 1: Vincular a nuevo correo legítimo
  if (params['link-email']) {
    const newEmail = String(params['link-email']).trim().toLowerCase()
    if (!newEmail.includes('@') || newEmail.length < 5) {
      console.error('[ERROR] Correo electrónico inválido.')
      process.exit(1)
    }

    console.log(`Vinculando cuenta administradora al correo: ${newEmail}...`)

    // Actualizar en Auth
    const authUpdateRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          localId: TARGET_ADMIN_UID,
          email: newEmail,
          emailVerified: false, // Debe verificarse legítimamente
        }),
      }
    )
    const authUpdateData = await authUpdateRes.json()
    if (authUpdateData.error) {
      console.error('[ERROR Auth]:', authUpdateData.error)
      process.exit(1)
    }

    // Actualizar en Firestore users
    const firestorePatchRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${TARGET_ADMIN_UID}?updateMask.fieldPaths=email&updateMask.fieldPaths=updatedAtIso`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            email: { stringValue: newEmail },
            updatedAtIso: { stringValue: new Date().toISOString() },
          },
        }),
      }
    )

    console.log(`✓ Cuenta de Administrador vinculada con éxito al correo: ${newEmail}`)
    console.log(`  (Se mantiene la trazabilidad histórica completa bajo el UID ${TARGET_ADMIN_UID}).`)
    return
  }

  // Opción 2: Generar enlace seguro de restablecimiento de contraseña
  if (params['generate-reset-link']) {
    console.log(`Generando enlace seguro de restablecimiento para ${user.email}...`)
    const apiKey = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAWSWtpZXjhDgq7IPS-Mvo4dp2cJsEqawg'
    const oobRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email: user.email,
        }),
      }
    )
    const oobData = await oobRes.json()
    if (oobData.error) {
      console.error('[ERROR OOB]:', oobData.error)
      process.exit(1)
    }

    console.log(`✓ Correo de restablecimiento despachado por Firebase a: ${user.email}`)
    return
  }

  // Opción 3: Establecer contraseña directamente de forma segura
  if (params['set-password'] || params['password']) {
    let newPassword = params.password || process.env.ADMIN_PASSWORD
    if (!newPassword) {
      newPassword = await askHidden('Ingrese la nueva contraseña para el Administrador: ')
      console.log('')
    }

    if (!newPassword || newPassword.trim().length < 8) {
      console.error('[ERROR] La contraseña debe tener al menos 8 caracteres.')
      process.exit(1)
    }

    const updateRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          localId: TARGET_ADMIN_UID,
          password: newPassword.trim(),
        }),
      }
    )

    const updateData = await updateRes.json()
    if (updateData.error) {
      console.error('[ERROR Auth]:', updateData.error)
      process.exit(1)
    }

    console.log(`✓ Contraseña actualizada exitosamente para la cuenta administradora (${user.email}).`)
    console.log(`  No se almacenó la contraseña en ningún archivo ni registro público.`)
    return
  }

  // Si no se pasaron opciones, mostrar ayuda
  console.log(`Comandos disponibles:
  node scripts/manageAdminAccount.mjs --set-password
    Establece interactivamente la contraseña de la cuenta administradora.

  node scripts/manageAdminAccount.mjs --link-email <nuevo_correo>
    Vincula el administrador a un correo corporativo o personal legítimo de PACHAX.

  node scripts/manageAdminAccount.mjs --generate-reset-link
    Despacha un correo seguro de recuperación de contraseña vía Firebase.
  `)
}

main().catch((err) => {
  console.error('[ERROR INESPERADO]:', err.message)
  process.exit(1)
})
