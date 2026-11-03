import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

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

async function setAdminPassword() {
  let newPassword = process.env.NEW_ADMIN_PASSWORD

  if (!newPassword) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input, output })
      try {
        console.log('--- ACTUALIZACIÓN SEGURA DE CONTRASEÑA ADMINISTRATIVA ---')
        console.log(`Cuenta objetivo: ${TARGET_EMAIL} (UID: ${EXPECTED_UID})`)
        newPassword = await rl.question('Ingrese la nueva contraseña deseada para el administrador: ')
        const confirm = await rl.question(`¿Confirma actualizar la contraseña de ${TARGET_EMAIL}? (s/N): `)
        if (confirm.toLowerCase() !== 's' && confirm.toLowerCase() !== 'si' && confirm.toLowerCase() !== 'y') {
          console.log('Operación cancelada por el usuario.')
          process.exit(0)
        }
      } finally {
        rl.close()
      }
    } else {
      throw new Error('Debe proporcionar NEW_ADMIN_PASSWORD en variables de entorno o ejecutar el script en una terminal interactiva.')
    }
  }

  if (!newPassword || newPassword.trim().length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.')
  }

  const token = getFirebaseCliToken()

  // 1. Validar cuenta en Firebase
  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=50`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  )
  const lookupData = await lookupRes.json()
  const user = lookupData.users?.find(u => u.email === TARGET_EMAIL)
  if (!user) {
    throw new Error(`No se encontró el usuario ${TARGET_EMAIL} en Firebase Auth.`)
  }
  if (user.localId !== EXPECTED_UID) {
    throw new Error(`Inconsistencia de UID: esperado ${EXPECTED_UID}, encontrado ${user.localId}`)
  }

  // 2. Actualizar ÚNICAMENTE a admin@expresopunata.com
  const updateRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localId: EXPECTED_UID,
        password: newPassword.trim(),
        emailVerified: true,
      }),
    }
  )

  const updateData = await updateRes.json()
  if (updateData.error) {
    throw new Error(`Error de Firebase Identity Toolkit: ${updateData.error.message}`)
  }

  // 3. Sincronizar de forma segura con .env.local (estrictamente fuera de Git)
  const envLocalPath = path.resolve('.env.local')
  let currentEnv = ''
  if (fs.existsSync(envLocalPath)) {
    currentEnv = fs.readFileSync(envLocalPath, 'utf8')
  }
  const lines = currentEnv.split('\n').filter(l => !l.startsWith('E2E_TEST_PASSWORD='))
  lines.push(`E2E_TEST_PASSWORD="${newPassword.trim()}"`)
  fs.writeFileSync(envLocalPath, lines.join('\n').trim() + '\n', 'utf8')

  console.log('====================================================================')
  console.log('CONTRASEÑA ADMINISTRATIVA ACTUALIZADA EXITOSAMENTE')
  console.log('====================================================================')
  console.log(`- Cuenta:            ${TARGET_EMAIL}`)
  console.log(`- UID:               ${EXPECTED_UID}`)
  console.log(`- Rol:               directiva_admin (Acceso total Punata y Cochabamba)`)
  console.log(`- Proyecto:          ${PROJECT_ID}`)
  console.log(`- Timestamp:         ${new Date().toISOString()}`)
  console.log(`- Estado de secreto: Protegido. Cero contraseñas expuestas en logs o git.`)
  console.log('====================================================================\n')
}

setAdminPassword().catch(err => {
  console.error('[SET PASSWORD ERROR]', err.message)
  process.exit(1)
})
