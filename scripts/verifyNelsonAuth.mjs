import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) throw new Error('No access_token found in firebase-tools.json')
  return token
}

async function verifyNelson() {
  const token = getFirebaseCliToken()
  const projectId = 'expreso-punata-dev'
  const targetUid = 'hqsHSQksaMfiLuoxO9EGG5PCNNJ2'

  console.log(`[VERIFICACIÓN NELSON] Proyecto: ${projectId}, UID: ${targetUid}`)

  // 1. Firebase Authentication Account
  const authRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [targetUid] }),
    }
  )

  const authData = await authRes.json()
  const user = authData.users?.[0]
  if (!user) {
    console.error('[AUTH ERROR] Usuario Nelson NO encontrado en Firebase Auth!')
    process.exit(1)
  }

  console.log('--- Firebase Authentication ---')
  console.log('UID:', user.localId)
  console.log('Email:', user.email)
  console.log('Email Verified:', user.emailVerified)
  console.log('Disabled:', Boolean(user.disabled))
  console.log('Custom Attributes (Claims):', user.customAttributes)
  console.log('Last Login At:', user.lastLoginAt)
  console.log('Created At:', user.createdAt)

  // 2. Cloud Firestore Profile
  const docRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  )

  const docData = await docRes.json()
  console.log('--- Cloud Firestore Profile (/users/' + targetUid + ') ---')
  if (docData.error) {
    console.error('Firestore Doc Error:', docData.error)
  } else {
    const fields = docData.fields || {}
    console.log('fullName:', fields.fullName?.stringValue)
    console.log('email:', fields.email?.stringValue)
    console.log('role:', fields.role?.stringValue)
    console.log('primaryBranchId:', fields.primaryBranchId?.stringValue)
    console.log('allowedBranchIds:', fields.allowedBranchIds?.arrayValue?.values?.map(v => v.stringValue))
    console.log('phone:', fields.phone?.stringValue)
    console.log('ci:', fields.ci?.nullValue !== undefined ? 'null (no registrado)' : fields.ci?.stringValue)
    console.log('isActive:', fields.isActive?.booleanValue)
    console.log('syncStatus:', fields.syncStatus?.stringValue)
  }
}

verifyNelson().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
