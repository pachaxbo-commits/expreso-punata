import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

/**
 * Script de Administración Privada — PACHAX EXPRESO PUNATA 1.0
 * Inicialización controlada del Administrador Inicial (Directiva Admin).
 * 
 * Uso:
 * node scripts/bootstrapAdmin.mjs --uid <FIREBASE_AUTH_UID> --email <CORREO> [--fullName <NOMBRE>] [--ci <CI>] [--phone <TELEFONO>] [--force]
 */

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

async function runBootstrap() {
  const params = parseArgs()

  const {
    uid,
    email,
    fullName = 'Directiva Expreso Punata',
    ci = '1020304-CB',
    phone = '71700000',
    force = false,
  } = params

  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    console.error('[BOOTSTRAP ERROR] El parámetro --uid es obligatorio.')
    console.error('Uso: node scripts/bootstrapAdmin.mjs --uid <AUTH_UID> --email <CORREO>')
    process.exit(1)
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    console.error('[BOOTSTRAP ERROR] El parámetro --email es obligatorio.')
    process.exit(1)
  }

  const safeUid = uid.trim()
  const safeEmail = email.trim().toLowerCase()

  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'expreso-punata-dev'

  if (getApps().length === 0) {
    initializeApp({ projectId })
  }

  const db = getFirestore()
  const auth = getAuth()

  console.log(`[BOOTSTRAP] Iniciando aprovisionamiento del Administrador Inicial para proyecto: ${projectId}...`)

  // 1. Verificar si ya existe un administrador activo
  if (!force) {
    const existingAdmins = await db
      .collection('users')
      .where('role', '==', 'directiva_admin')
      .where('isActive', '==', true)
      .limit(1)
      .get()

    if (!existingAdmins.empty) {
      const existingId = existingAdmins.docs[0].id
      console.error(`[BOOTSTRAP ERROR] Ya existe un Administrador activo en el sistema (UID: ${existingId}).`)
      console.error('Para modificar permisos use la sesión de Directiva en el sistema o añada la bandera --force si es una re-inicialización autorizada.')
      process.exit(1)
    }
  }

  // 2. Verificar existencia de la cuenta en Firebase Authentication
  let authUser = null
  try {
    authUser = await auth.getUser(safeUid)
  } catch (err) {
    console.error(`[BOOTSTRAP ERROR] No se encontró ningún usuario con UID '${safeUid}' en Firebase Authentication:`, err.message)
    process.exit(1)
  }

  if (authUser.email && authUser.email.toLowerCase() !== safeEmail) {
    console.error(`[BOOTSTRAP ERROR] El correo proporcionado (${safeEmail}) no coincide con el registrado en Firebase Auth (${authUser.email}).`)
    process.exit(1)
  }

  const nowIso = new Date().toISOString()
  const targetUserRef = db.collection('users').doc(safeUid)
  const auditDocRef = db.collection('audit_logs').doc()

  const profileData = {
    uid: safeUid,
    email: authUser.email || safeEmail,
    fullName: fullName.trim(),
    ci: ci.trim(),
    phone: phone.trim(),
    role: 'directiva_admin',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    assignedVehiclePlate: null,
    assignedMobileNumber: null,
    isActive: true,
    createdReason: 'cli_bootstrap_authorized',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso,
  }

  // 3. Escribir documento en Firestore y log de auditoría
  await db.runTransaction(async (transaction) => {
    const existingDoc = await transaction.get(targetUserRef)
    if (!existingDoc.exists) {
      profileData.createdAt = FieldValue.serverTimestamp()
      profileData.createdAtIso = nowIso
    }
    transaction.set(targetUserRef, profileData, { merge: true })

    transaction.set(auditDocRef, {
      id: auditDocRef.id,
      entityType: 'user_profile',
      entityId: safeUid,
      action: 'INITIAL_ADMIN_BOOTSTRAP_CLI',
      performedBy: 'PACHAX_CLI_TOOL',
      details: {
        email: safeEmail,
        role: 'directiva_admin',
        primaryBranchId: 'punata',
        allowedBranchIds: ['punata', 'cochabamba'],
        isForce: Boolean(force),
      },
      timestamp: FieldValue.serverTimestamp(),
      timestampIso: nowIso,
    })
  })

  // 4. Asignar Custom Claims en Firebase Authentication
  await auth.setCustomUserClaims(safeUid, {
    role: 'directiva_admin',
    branchId: 'punata',
    allowedBranches: ['punata', 'cochabamba'],
    isActive: true,
  })

  console.log('====================================================================')
  console.log('[BOOTSTRAP EXITOSO] Administrador Inicial Aprovisionado')
  console.log(`- UID:              ${safeUid}`)
  console.log(`- Correo:           ${safeEmail}`)
  console.log(`- Nombre:           ${fullName}`)
  console.log(`- Rol:              directiva_admin`)
  console.log(`- Sucursales:       Punata y Cochabamba (Acceso Global)`)
  console.log(`- Custom Claims:    role=directiva_admin, branchId=punata, isActive=true`)
  console.log('====================================================================')
}

runBootstrap().catch((err) => {
  console.error('[BOOTSTRAP FATAL ERROR]', err)
  process.exit(1)
})
