import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return config.tokens.access_token
}

async function markNelsonEmailVerified() {
  const token = getFirebaseCliToken()
  const projectId = 'expreso-punata-dev'
  const targetUid = 'hqsHSQksaMfiLuoxO9EGG5PCNNJ2'

  console.log(`[VERIFICACIÓN CORREO] Marcando correo de Nelson como verificado en Firebase Auth...`)

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localId: targetUid,
        emailVerified: true,
      }),
    }
  )

  const data = await res.json()
  if (data.error) {
    console.error('Error al verificar correo:', data.error)
    process.exit(1)
  }

  console.log('[ÉXITO] Correo verificado para:', data.email, 'emailVerified:', data.emailVerified)
}

markNelsonEmailVerified().catch(err => {
  console.error(err)
  process.exit(1)
})
