import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

/**
 * Script de Administración Privada — PACHAX EXPRESO PUNATA 1.0
 * Inicialización controlada del Administrador Inicial (Directiva Admin).
 * 
 * Uso:
 * node scripts/bootstrapAdmin.mjs --uid <FIREBASE_AUTH_UID> [--email <CORREO>] --fullName <NOMBRE> --phone <TELEFONO> [--ci <CI>] [--force]
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

async function runBootstrap() {
  const params = parseArgs()

  const {
    uid,
    email,
    fullName,
    ci,
    phone,
    force = false,
  } = params

  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    console.error('[BOOTSTRAP ERROR] El parámetro --uid es obligatorio.')
    console.error('Uso: node scripts/bootstrapAdmin.mjs --uid <UID> [--email <CORREO>] --fullName <NOMBRE> --phone <TELEFONO> [--ci <CI>]')
    process.exit(1)
  }

  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    console.error('[BOOTSTRAP ERROR] El parámetro --fullName es obligatorio.')
    process.exit(1)
  }

  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    console.error('[BOOTSTRAP ERROR] El parámetro --phone es obligatorio.')
    process.exit(1)
  }

  const safeUid = uid.trim()
  const safeFullName = fullName.trim()
  const safePhone = phone.trim()
  // CI opcional: guardar como null si no es proporcionado; nunca inventar datos ficticios
  const safeCi = ci && typeof ci === 'string' && ci.trim() ? ci.trim() : null

  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'expreso-punata-dev'

  console.log('====================================================================')
  console.log(`[BOOTSTRAP PACHAX] Inicialización de Administrador — ${projectId}`)
  console.log(`- Modo:             ${isEmulator ? 'Emulador Local' : 'Cloud Firebase'}`)
  console.log(`- Target UID:       ${safeUid}`)
  console.log(`- Nombre:           ${safeFullName}`)
  console.log(`- Teléfono:         ${safePhone}`)
  console.log(`- CI:               ${safeCi === null ? '(No proporcionado / Opcional)' : safeCi}`)
  console.log('====================================================================')

  if (isEmulator) {
    // Modo Emulador Local
    if (getApps().length === 0) {
      initializeApp({ projectId })
    }
    const db = getFirestore()
    const auth = getAuth()

    if (!force) {
      const existingAdmins = await db
        .collection('users')
        .where('role', '==', 'directiva_admin')
        .where('isActive', '==', true)
        .limit(1)
        .get()

      if (!existingAdmins.empty) {
        console.error(`[BOOTSTRAP ERROR] Ya existe un Administrador activo en el emulador (UID: ${existingAdmins.docs[0].id}).`)
        process.exit(1)
      }
    }

    let authUser = null
    try {
      authUser = await auth.getUser(safeUid)
    } catch (err) {
      console.error(`[BOOTSTRAP ERROR] No se encontró usuario con UID '${safeUid}' en Auth Emulator:`, err.message)
      process.exit(1)
    }

    const safeEmail = (email || authUser.email || '').trim().toLowerCase()
    const nowIso = new Date().toISOString()
    const targetUserRef = db.collection('users').doc(safeUid)

    const profileData = {
      uid: safeUid,
      email: safeEmail,
      fullName: safeFullName,
      ci: safeCi,
      phone: safePhone,
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      assignedVehiclePlate: null,
      assignedMobileNumber: null,
      isActive: true,
      syncStatus: 'synced',
      createdReason: 'cli_bootstrap_authorized',
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
    }

    await targetUserRef.set(profileData, { merge: true })
    await auth.setCustomUserClaims(safeUid, {
      role: 'directiva_admin',
      branchId: 'punata',
      allowedBranches: ['punata', 'cochabamba'],
      isActive: true,
    })

    console.log('[BOOTSTRAP EXITOSO EN EMULADOR]')
    return
  }

  // Modo Cloud: Usar Token Autorizado de Firebase CLI
  const token = getFirebaseCliToken()

  // 1. Obtener usuario desde Firebase Auth REST API
  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: [safeUid] }),
    }
  )

  const lookupData = await lookupRes.json()
  if (!lookupData.users || lookupData.users.length === 0) {
    console.error(`[BOOTSTRAP ERROR] No se encontró ningún usuario con UID '${safeUid}' en Firebase Authentication.`)
    process.exit(1)
  }

  const cloudAuthUser = lookupData.users[0]
  if (cloudAuthUser.disabled === true) {
    console.error(`[BOOTSTRAP ERROR] La cuenta '${safeUid}' se encuentra inhabilitada en Firebase Authentication.`)
    process.exit(1)
  }

  const userEmail = (cloudAuthUser.email || '').toLowerCase()
  if (email && email.trim().toLowerCase() !== userEmail) {
    console.error(`[BOOTSTRAP ERROR] El correo proporcionado (${email}) no coincide con el de Firebase Auth (${userEmail}).`)
    process.exit(1)
  }

  console.log(`[AUTH VERIFICADA] Correo verificado: ${userEmail} (Cuenta habilitada: OK)`)

  // 2. Verificar que no exista ya un directiva_admin activo en Firestore
  if (!force) {
    const queryRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  {
                    fieldFilter: {
                      field: { fieldPath: 'role' },
                      op: 'EQUAL',
                      value: { stringValue: 'directiva_admin' },
                    },
                  },
                  {
                    fieldFilter: {
                      field: { fieldPath: 'isActive' },
                      op: 'EQUAL',
                      value: { booleanValue: true },
                    },
                  },
                ],
              },
            },
            limit: 1,
          },
        }),
      }
    )

    const queryData = await queryRes.json()
    const matches = Array.isArray(queryData) ? queryData.filter(item => item.document) : []
    if (matches.length > 0) {
      const docPath = matches[0].document.name
      const existingId = docPath.split('/').pop()
      console.error(`[BOOTSTRAP ERROR] Ya existe un Administrador activo en el sistema (UID: ${existingId}).`)
      console.error('Para modificar permisos use la sesión de Directiva en el sistema o añada la bandera --force si es una re-inicialización autorizada.')
      process.exit(1)
    }
  }

  // 3. Comprobar que UID anterior no tenga permisos
  const oldUid = '76QVZZUpvedjeuP4wgKlroVc8ks1'
  const oldDocRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${oldUid}`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    }
  )
  if (oldDocRes.status === 200) {
    const oldDoc = await oldDocRes.json()
    console.warn(`[ADVERTENCIA] El UID anterior '${oldUid}' existe en Firestore con rol '${oldDoc.fields?.role?.stringValue}'.`)
    if (oldDoc.fields?.role?.stringValue === 'directiva_admin') {
      console.error('[BOOTSTRAP ERROR] El UID anterior posee rol directiva_admin. Debe rebajarse antes de continuar.')
      process.exit(1)
    }
  } else {
    console.log(`[VERIFICACIÓN] UID anterior '${oldUid}' no tiene privilegios administrativos en el sistema.`)
  }

  // 4. Asignar Custom Claims en Firebase Authentication
  const customClaims = {
    role: 'directiva_admin',
    branchId: 'punata',
    allowedBranches: ['punata', 'cochabamba'],
    isActive: true,
  }

  const claimsRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        localId: safeUid,
        customAttributes: JSON.stringify(customClaims),
      }),
    }
  )

  const claimsData = await claimsRes.json()
  if (claimsData.error) {
    console.error('[BOOTSTRAP ERROR] Error al asignar custom claims:', claimsData.error)
    process.exit(1)
  }

  console.log('[CLAIMS ASIGNADOS] role=directiva_admin, branchId=punata, allowedBranches=[punata, cochabamba], isActive=true')

  // 5. Escribir documento en Firestore users/{uid}
  const nowIso = new Date().toISOString()
  const firestoreFields = {
    uid: { stringValue: safeUid },
    email: { stringValue: userEmail },
    fullName: { stringValue: safeFullName },
    phone: { stringValue: safePhone },
    role: { stringValue: 'directiva_admin' },
    primaryBranchId: { stringValue: 'punata' },
    allowedBranchIds: {
      arrayValue: {
        values: [{ stringValue: 'punata' }, { stringValue: 'cochabamba' }],
      },
    },
    assignedVehiclePlate: { nullValue: null },
    assignedMobileNumber: { nullValue: null },
    isActive: { booleanValue: true },
    syncStatus: { stringValue: 'synced' },
    createdReason: { stringValue: 'cli_bootstrap_authorized' },
    createdAtIso: { stringValue: nowIso },
    updatedAtIso: { stringValue: nowIso },
  }

  if (safeCi !== null) {
    firestoreFields.ci = { stringValue: safeCi }
  } else {
    firestoreFields.ci = { nullValue: null }
  }

  const patchDocRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${safeUid}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: firestoreFields }),
    }
  )

  const patchData = await patchDocRes.json()
  if (patchData.error) {
    console.error('[BOOTSTRAP ERROR] Error al escribir perfil en Firestore:', patchData.error)
    process.exit(1)
  }

  console.log(`[FIRESTORE PROFILE CREADO] users/${safeUid}`)

  // 6. Escribir log en audit_logs
  const auditFields = {
    entityType: { stringValue: 'user_profile' },
    entityId: { stringValue: safeUid },
    action: { stringValue: 'INITIAL_ADMIN_BOOTSTRAP_CLI' },
    performedBy: { stringValue: 'PACHAX_CLI_TOOL' },
    details: {
      mapValue: {
        fields: {
          email: { stringValue: userEmail },
          fullName: { stringValue: safeFullName },
          phone: { stringValue: safePhone },
          role: { stringValue: 'directiva_admin' },
          primaryBranchId: { stringValue: 'punata' },
          ciProvided: { booleanValue: safeCi !== null },
        },
      },
    },
    timestampIso: { stringValue: nowIso },
  }

  await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/audit_logs`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: auditFields }),
    }
  )

  console.log('[AUDIT LOG REGISTRADO] audit_logs')
  console.log('====================================================================')
  console.log('[BOOTSTRAP EXITOSO COMPLETO]')
  console.log(`- Administrador:    ${safeFullName}`)
  console.log(`- UID:              ${safeUid}`)
  console.log(`- Correo:           ${userEmail}`)
  console.log(`- Teléfono:         ${safePhone}`)
  console.log(`- CI:               ${safeCi || 'null (opcional)'}`)
  console.log(`- Rol:              directiva_admin`)
  console.log(`- Sucursales:       Punata y Cochabamba (Acceso Central)`)
  console.log(`- Claims:           role=directiva_admin, branchId=punata, isActive=true`)
  console.log('====================================================================')
}

runBootstrap().catch((err) => {
  console.error('[BOOTSTRAP FATAL ERROR]', err)
  process.exit(1)
})
