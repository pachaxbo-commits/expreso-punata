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

async function generateResetLink() {
  const token = getFirebaseCliToken()

  // 1. Validar que la cuenta existe y corresponde exactamente al UID esperado
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

  // 2. Generar enlace oficial de restablecimiento OOB
  const oobRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:sendOobCode`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: TARGET_EMAIL,
        returnOobLink: true,
      }),
    }
  )

  const oobData = await oobRes.json()
  if (!oobData.oobLink) {
    throw new Error(`Fallo al generar enlace OOB: ${JSON.stringify(oobData)}`)
  }

  console.log('====================================================================')
  console.log('ENLACE OFICIAL DE RECUPERACIÓN DE CONTRASEÑA — EXPRESO PUNATA')
  console.log('====================================================================')
  console.log(`- Cuenta:            ${TARGET_EMAIL}`)
  console.log(`- UID:               ${user.localId}`)
  console.log(`- Rol:               Administrador General (directiva_admin)`)
  console.log(`- Proyecto Firebase: ${PROJECT_ID}`)
  console.log('\nAbra el siguiente enlace seguro en su navegador para escribir su nueva contraseña privada:')
  console.log(oobData.oobLink)
  console.log('\n(Este enlace es de uso único, expira automáticamente y es procesado directamente por Google Firebase)')
  console.log('====================================================================')
}

generateResetLink().catch(err => {
  console.error('[RESET LINK ERROR]', err.message)
  process.exit(1)
})
