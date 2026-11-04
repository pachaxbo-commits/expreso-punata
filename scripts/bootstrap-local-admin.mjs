import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const projectId = 'expreso-punata-dev'
process.env.GCLOUD_PROJECT ||= projectId
process.env.GOOGLE_CLOUD_PROJECT ||= projectId
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
if (!getApps().length) initializeApp({ projectId })

const email = 'directiva-admin@expresopunata.local'
const password = process.env.TEST_ADMIN_PASSWORD || `Local-${randomBytes(18).toString('base64url')}`
const auth = getAuth()
let user
try { user = await auth.getUserByEmail(email) } catch (error) {
  if (error.code !== 'auth/user-not-found') throw error
  user = await auth.createUser({ email, password, displayName: 'Directiva Admin Local', emailVerified: true })
}
const db = getFirestore()
await db.collection('users').doc(user.uid).set({
  uid: user.uid, email, fullName: 'Directiva Admin Local', role: 'directiva_admin',
  primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true,
  updatedAt: new Date().toISOString(), localOnly: true,
}, { merge: true })
await mkdir('.firebase-local-profile', { recursive: true })
await writeFile('.firebase-local-profile/directiva-admin-credentials.txt', `Correo: ${email}\nContraseña: ${password}\nProyecto: ${projectId}\nSucursal: punata\n`, { encoding: 'utf8', mode: 0o600 })
console.log(JSON.stringify({ email, uid: user.uid, profile: { role: 'directiva_admin', primaryBranchId: 'punata' }, credentialsFile: '.firebase-local-profile/directiva-admin-credentials.txt' }, null, 2))
