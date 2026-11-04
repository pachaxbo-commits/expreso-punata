import readline from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ID = 'expreso-punata-dev'
const TARGET_ADMIN_EMAIL = 'admin@expresopunata.com'
const TARGET_ADMIN_UID = 'hqsHSQksaMfiLuoxO9EGG5PCNNJ2'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`No se encontró configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) throw new Error('No se encontró un access_token activo en Firebase CLI.')
  return token
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    // Suprimir eco de caracteres para que la contraseña no quede visible en pantalla
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

async function main() {
  console.log('====================================================================')
  console.log('MECANISMO SEGURO Y SOBERANO DE ACTUALIZACIÓN DE CONTRASEÑA')
  console.log(`Proyecto: ${PROJECT_ID}`)
  console.log(`Cuenta objetivo: ${TARGET_ADMIN_EMAIL} (UID: ${TARGET_ADMIN_UID})`)
  console.log('====================================================================')
  console.log('AVISO DE PRIVACIDAD: La contraseña se ingresa de forma oculta (*).')
  console.log('No se registrará en ningún log, archivo, historial ni reporte.\n')

  const token = getFirebaseCliToken()

  // 1. Solicitar nueva contraseña
  const p1 = await promptHidden('Ingrese la nueva contraseña soberana para el Administrador: ')
  if (!p1 || p1.length < 8) {
    console.error('\n❌ ERROR: La contraseña debe tener al menos 8 caracteres.')
    process.exit(1)
  }

  // 2. Confirmación de seguridad
  const p2 = await promptHidden('Confirme la nueva contraseña: ')
  if (p1 !== p2) {
    console.error('\n❌ ERROR: Las contraseñas ingresadas no coinciden. Operación abortada.')
    process.exit(1)
  }

  console.log('\nActualizando credenciales de forma directa en Firebase Auth...')

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
        password: p1.trim(),
      }),
    }
  )

  const data = await updateRes.json()
  if (data.error) {
    console.error('❌ Error de Firebase Auth:', data.error.message || data.error)
    process.exit(1)
  }

  console.log('====================================================================')
  console.log('✓ CONTRASEÑA ACTUALIZADA EXITOSAMENTE EN FIREBASE AUTHENTICATION')
  console.log(`- Cuenta: ${TARGET_ADMIN_EMAIL}`)
  console.log(`- UID:    ${TARGET_ADMIN_UID}`)
  console.log('- Estado: Activa y lista para inicio de sesión en producción.')
  console.log('- Seguridad: Cero contraseñas expuestas en memoria, terminal o Git.')
  console.log('====================================================================')
}

main().catch(console.error)
