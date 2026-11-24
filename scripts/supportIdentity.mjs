import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

function arg(name) {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
    || (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : undefined)
}

const projectId = arg('project')
const uid = arg('uid')
const action = arg('action')
const approval = arg('approval-reference')
const apply = process.argv.includes('--apply')

if (!['provision', 'revoke'].includes(action) || !projectId || !uid || !approval || !/^[A-Za-z0-9._/-]{3,80}$/.test(approval) || !/^[A-Za-z0-9_-]{8,128}$/.test(uid)) {
  console.log('Uso: node scripts/supportIdentity.mjs --action provision|revoke --project <proyecto> --uid <UID existente> --approval-reference <ticket> [--apply]')
  console.log('La identidad y su MFA deben existir antes de provisionar. Nunca se crea ni se cambia una contraseña.')
  process.exit(2)
}
if (arg('email') || arg('password')) throw new Error('No se aceptan correo ni contrasenas como parametros.')
const configuredProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
if (!configuredProject || configuredProject !== projectId) throw new Error('El proyecto de ADC debe coincidir exactamente con --project.')

if (getApps().length === 0) initializeApp({ projectId })
const auth = getAuth()
const db = getFirestore()
const identity = await auth.getUser(uid)
const profileRef = db.collection('users').doc(uid)
const profileSnapshot = await profileRef.get()
const profile = profileSnapshot.data()

if (action === 'provision') {
  if (identity.disabled) throw new Error('La identidad existente esta deshabilitada; revisar recuperacion con el titular.')
  if (!(identity.multiFactor?.enrolledFactors?.length)) throw new Error('Bloqueado: Firebase Auth no confirma ningun segundo factor inscrito.')
  if (profile?.role && profile.role !== 'soporte_pachax') throw new Error('Bloqueado: el UID ya tiene otro rol operativo.')
  if (profile?.role === 'soporte_pachax' && profile.isActive === true) throw new Error('La cuenta tecnica ya esta activa.')
}
if (action === 'revoke' && profile?.role !== 'soporte_pachax') throw new Error('Solo se revoca una identidad con rol tecnico existente.')

console.log(`Accion: ${action}; proyecto: ${projectId}; UID: ${uid}; aprobacion: ${approval}`)
console.log(`Auth: disabled=${identity.disabled}; MFA inscritos=${identity.multiFactor?.enrolledFactors?.length || 0}; rol actual=${profile?.role || 'sin rol'}`)
if (!apply) { console.log('Vista previa solamente. No se modifico Auth ni Firestore; agregue --apply solo con aprobacion formal del titular.') ; process.exit(0) }

const rl = readline.createInterface({ input: stdin, output: stdout })
const confirmation = await rl.question(`Escriba ${action === 'provision' ? 'PROVISION' : 'REVOKE'} SUPPORT ${uid} para continuar: `)
rl.close()
if (confirmation !== `${action === 'provision' ? 'PROVISION' : 'REVOKE'} SUPPORT ${uid}`) throw new Error('Confirmacion incorrecta; no se hicieron cambios.')

const oldClaims = identity.customClaims || {}
if (action === 'provision') {
  await auth.setCustomUserClaims(uid, { role: 'soporte_pachax' })
  try {
    await db.runTransaction(async tx => {
      const current = await tx.get(profileRef)
      if (current.data()?.role && current.data().role !== 'soporte_pachax') throw new Error('El perfil cambio durante el aprovisionamiento.')
      const currentProfile = current.data() || {}
      tx.set(profileRef, { uid, fullName: currentProfile.fullName || identity.displayName || 'Soporte PACHAX', phone: currentProfile.phone || '', primaryBranchId: '', role: 'soporte_pachax', isActive: true, allowedBranchIds: [], updatedAtIso: new Date().toISOString() }, { merge: true })
      tx.create(db.collection('audit_logs').doc(), { action: 'SUPPORT_IDENTITY_PROVISIONED', uid, approvalReference: approval, actor: process.env.USERNAME || 'operator', createdAt: FieldValue.serverTimestamp() })
    })
    await auth.revokeRefreshTokens(uid)
  } catch (error) {
    try { await auth.setCustomUserClaims(uid, oldClaims) } catch {
      await auth.updateUser(uid, { disabled: true }).catch(() => {})
      await auth.revokeRefreshTokens(uid).catch(() => {})
      throw new Error('Fallo la provision y no se pudo restaurar el claim: cuenta deshabilitada y sesiones revocadas como contencion.')
    }
    throw error
  }
  console.log('Aprovisionado. El titular debe iniciar sesion con MFA; las llamadas sensibles requieren autenticacion reciente.')
} else {
  await auth.updateUser(uid, { disabled: true })
  await auth.revokeRefreshTokens(uid)
  const { role: _role, ...claims } = oldClaims
  await auth.setCustomUserClaims(uid, claims)
  await db.runTransaction(async tx => {
    tx.update(profileRef, { isActive: false, updatedAtIso: new Date().toISOString() })
    tx.create(db.collection('audit_logs').doc(), { action: 'SUPPORT_IDENTITY_REVOKED', uid, approvalReference: approval, actor: process.env.USERNAME || 'operator', createdAt: FieldValue.serverTimestamp() })
  })
  console.log('Revocado: identidad deshabilitada, sesiones invalidadas, claim tecnico removido y perfil inactivo.')
}
