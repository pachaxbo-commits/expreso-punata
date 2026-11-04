import readline from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const TARGET_PROJECT_ID = 'expreso-punata-dev'
export const TARGET_ADMIN_EMAIL = 'admin@expresopunata.com'
export const TARGET_ADMIN_UID = 'hqsHSQksaMfiLuoxO9EGG5PCNNJ2'
const WEB_API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAWSWtpZXjhDgq7IPS-Mvo4dp2cJsEqawg'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`[SEGURIDAD] No se encontró configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) throw new Error('[SEGURIDAD] No se encontró un access_token activo en Firebase CLI.')
  return token
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    process.stdout.write(question)
    
    let password = ''
    process.stdin.setRawMode?.(true)
    process.stdin.resume()

    const onData = (chunk) => {
      const char = chunk.toString('utf8')
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(password)
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdin.setRawMode?.(false)
        process.stdout.write('\nOperación cancelada por el usuario.\n')
        process.exit(1)
      } else if (char === '\u0008' || char === '\x7f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        password += char
        process.stdout.write('*')
      }
    }

    process.stdin.on('data', onData)
  })
}

export async function main() {
  console.log('====================================================================')
  console.log('PACHAX EXPRESO PUNATA — ACTUALIZACIÓN SOBERANA DE CONTRASEÑA')
  console.log(`PROYECTO:          ${TARGET_PROJECT_ID}`)
  console.log(`CUENTA OBJETIVO:   ${TARGET_ADMIN_EMAIL}`)
  console.log(`UID REQUERIDO:     ${TARGET_ADMIN_UID}`)
  console.log('====================================================================')
  console.log('POLÍTICA DE SEGURIDAD:')
  console.log('1. Entrada oculta (*) — Sin visibilidad en pantalla ni historial de terminal.')
  console.log('2. Longitud mínima: 12 caracteres (recomendada frase de contraseña o gestor de claves).')
  console.log('3. Preservación exacta: NO se aplica .trim() para respetar la entrada literal.')
  console.log('4. Cero registro de contraseñas, hashes o tokens en logs, terminal o repositorios.')
  console.log('5. Verificación inmediata de autenticación contra Firebase Auth.\n')

  const token = getFirebaseCliToken()

  // 1. Pre-validación estricta de la cuenta en Firebase Authentication
  console.log('Verificando identidad de la cuenta en Firebase Authentication...')
  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [TARGET_ADMIN_UID] }),
    }
  )

  if (!lookupRes.ok) {
    console.error(`[ERROR]: Falló consulta de usuario en Firebase Auth: HTTP ${lookupRes.status}`)
    process.exit(1)
  }

  const lookupData = await lookupRes.json()
  const user = lookupData.users?.[0]

  if (!user) {
    console.error(`[ERROR CRÍTICO]: No se encontró el usuario con UID ${TARGET_ADMIN_UID} en el proyecto ${TARGET_PROJECT_ID}.`)
    process.exit(1)
  }

  if (user.email !== TARGET_ADMIN_EMAIL || user.localId !== TARGET_ADMIN_UID) {
    console.error(`[ERROR SEGURIDAD]: Discrepancia entre la cuenta solicitada (${TARGET_ADMIN_EMAIL} / ${TARGET_ADMIN_UID}) y la registrada en Firebase (${user.email} / ${user.localId}). Operación abortada.`)
    process.exit(1)
  }

  console.log(`✓ Cuenta confirmada: ${user.email} (UID: ${user.localId}, Creada: ${new Date(Number(user.createdAt)).toISOString()})\n`)

  // 2. Solicitar nueva contraseña soberana sin .trim()
  const p1 = await promptHidden('Ingrese la nueva contraseña soberana (mínimo 12 caracteres): ')
  if (!p1 || p1.length < 12) {
    console.error('\n❌ ERROR DE POLÍTICA: La contraseña de administrador debe tener al menos 12 caracteres.')
    console.error('   Recomendación: Utilice una frase de contraseña larga generada por un gestor de claves (Bitwarden, 1Password, etc.).')
    process.exit(1)
  }

  // 3. Confirmación exacta de contraseña
  const p2 = await promptHidden('Confirme la nueva contraseña: ')
  if (p1 !== p2) {
    console.error('\n❌ ERROR: Las contraseñas ingresadas no coinciden exactamente. Operación abortada.')
    process.exit(1)
  }

  console.log('\nActualizando credenciales de forma soberana en Firebase Auth...')

  // 4. Actualización directa sin .trim()
  const updateRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/accounts:update`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localId: TARGET_ADMIN_UID,
        password: p1,
      }),
    }
  )

  const updateData = await updateRes.json()
  if (updateData.error) {
    console.error('❌ Error de Firebase Auth al actualizar:', updateData.error.message || updateData.error)
    process.exit(1)
  }

  console.log('✓ Credencial actualizada en Firebase Identity Toolkit.')
  console.log('Verificando acceso funcional inmediato mediante signInWithPassword...')

  // 5. Verificación directa contra Firebase Auth usando Web API Key
  const verifyRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TARGET_ADMIN_EMAIL,
        password: p1,
        returnSecureToken: true,
      }),
    }
  )

  const verifyData = await verifyRes.json()
  if (!verifyRes.ok || !verifyData.idToken) {
    console.error('❌ Error en prueba de inicio de sesión:', verifyData.error?.message || 'Token no recibido')
    process.exit(1)
  }

  console.log('✓ Prueba de inicio de sesión exitosa: La nueva contraseña funciona al 100% en Firebase Auth.')

  console.log('\n====================================================================')
  console.log('CONTRASEÑA ADMINISTRATIVA ACTUALIZADA Y VERIFICADA EXITOSAMENTE')
  console.log(`- Cuenta:         ${TARGET_ADMIN_EMAIL}`)
  console.log(`- UID:            ${TARGET_ADMIN_UID}`)
  console.log('- Estado Auth:    Activa y operativa para inicio de sesión en Producción')
  console.log('- Seguridad:      Cero contraseñas expuestas en memoria, terminal o Git')
  console.log('====================================================================')
  console.log('\nGUÍA PARA RECUPERACIÓN AUTÓNOMA FUTURA (GESTIÓN SOBERANA):')
  console.log('1. El correo actual "admin@expresopunata.com" es ficticio y no recibe enlaces de recuperación.')
  console.log('2. Para habilitar recuperación autónoma sin depender de scripts administrativos:')
  console.log('   a) El propietario debe registrar un correo real y accesible (ej. gerencia@pachax.org).')
  console.log('   b) Actualizar el correo del administrador desde la consola de Firebase Authentication')
  console.log('      o solicitar cambio autenticado con verificación de email (sendEmailVerification).')
  console.log('   c) Una vez verificado, el enlace "¿Olvidaste tu contraseña?" del login enviará')
  console.log('      automáticamente el enlace de recuperación directo al buzón del propietario.')
  console.log('====================================================================\n')
}

if (process.argv[1]?.endsWith('updateAdminPasswordSovereign.mjs')) {
  main().catch(err => {
    console.error('[EXCEPCIÓN CRÍTICA]:', err)
    process.exit(1)
  })
}
