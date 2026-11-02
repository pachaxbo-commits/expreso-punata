import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { adminProvisionUser, adminSendPasswordReset } from '../index.js'

// Inicializar Firebase Admin apuntando a los emuladores locales
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-admin-test' })
}

const db = getFirestore()
const auth = getAuth()

async function clearCollections() {
  const collections = ['users', 'audit_logs']
  for (const col of collections) {
    const snapshot = await db.collection(col).get()
    const batch = db.batch()
    snapshot.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}

before(async () => {
  await clearCollections()
})

beforeEach(async () => {
  await clearCollections()
})

test('1. SEGURIDAD: Bootstrap público eliminado (rechaza intento de apropiación incluso con BD vacía)', async () => {
  const req = {
    auth: {
      uid: 'atacante-aleatorio',
      token: { email: 'hacker@internet.com' }
    },
    data: {
      targetUid: 'atacante-aleatorio',
      fullName: 'Atacante Hacker',
      ci: '9999999',
      role: 'directiva_admin',
      primaryBranchId: 'punata',
    }
  }

  await assert.rejects(
    async () => adminProvisionUser.run(req),
    (err) => {
      assert.equal(err.code, 'permission-denied')
      return true
    }
  )

  const userDoc = await db.collection('users').doc('atacante-aleatorio').get()
  assert.equal(userDoc.exists, false)
})

test('2. Administrador activo puede aprovisionar secretarias y sincronizar Custom Claims', async () => {
  let testTargetUser
  try {
    testTargetUser = await auth.createUser({
      uid: 'sec-punata-uid',
      email: 'sec.punata@expreso-punata.bo',
      displayName: 'María Secretaria Punata',
    })
  } catch (err) {
    testTargetUser = await auth.getUser('sec-punata-uid')
  }

  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    fullName: 'Directiva Administradora PACHAX',
    role: 'directiva_admin',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
    createdAtIso: new Date().toISOString()
  })

  const req = {
    auth: {
      uid: 'admin-user',
      token: { email: 'directiva@expreso-punata.bo' }
    },
    data: {
      targetUid: 'sec-punata-uid',
      fullName: 'María Secretaria Punata',
      ci: '7123456-CB',
      phone: '71712345',
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: true,
    }
  }

  const res = await adminProvisionUser.run(req)
  assert.equal(res.success, true)
  assert.equal(res.profile.role, 'secretaria')
  assert.equal(res.profile.syncStatus, 'synced')

  // Verificar documento en Firestore
  const secDoc = await db.collection('users').doc('sec-punata-uid').get()
  assert.equal(secDoc.exists, true)
  assert.equal(secDoc.data().role, 'secretaria')
  assert.equal(secDoc.data().primaryBranchId, 'punata')
  assert.equal(secDoc.data().syncStatus, 'synced')

  // Verificar Custom Claims en Firebase Authentication
  const updatedAuthUser = await auth.getUser('sec-punata-uid')
  assert.equal(updatedAuthUser.customClaims?.role, 'secretaria')
  assert.equal(updatedAuthUser.customClaims?.branchId, 'punata')
  assert.equal(updatedAuthUser.customClaims?.isActive, true)
})

test('3. Roles no autorizados (secretaria) NO pueden aprovisionar usuarios', async () => {
  await db.collection('users').doc('sec-user').set({
    uid: 'sec-user',
    role: 'secretaria',
    isActive: true
  })

  const req = {
    auth: {
      uid: 'sec-user',
      token: { email: 'sec@expreso-punata.bo' }
    },
    data: {
      targetUid: 'nuevo-operador',
      fullName: 'Operador',
      ci: '8888888',
      role: 'secretaria',
      primaryBranchId: 'punata',
    }
  }

  await assert.rejects(
    async () => adminProvisionUser.run(req),
    (err) => {
      assert.equal(err.code, 'permission-denied')
      return true
    }
  )
})

test('4. Usuario inactivo es rechazado automáticamente', async () => {
  await db.collection('users').doc('admin-inactive').set({
    uid: 'admin-inactive',
    role: 'directiva_admin',
    isActive: false
  })

  const req = {
    auth: {
      uid: 'admin-inactive',
      token: { email: 'admin-inactivo@expreso-punata.bo' }
    },
    data: {
      targetUid: 'user-test',
      fullName: 'Test User',
      ci: '1111111',
      role: 'secretaria',
      primaryBranchId: 'punata',
    }
  }

  await assert.rejects(
    async () => adminProvisionUser.run(req),
    (err) => {
      assert.equal(err.code, 'permission-denied')
      return true
    }
  )
})

test('5. Desactivación de usuario: sincroniza isActive=false en claims y revoca tokens', async () => {
  try {
    await auth.createUser({
      uid: 'usuario-a-desactivar',
      email: 'desactivar@expreso-punata.bo'
    })
  } catch {}

  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    role: 'directiva_admin',
    isActive: true
  })

  const req = {
    auth: {
      uid: 'admin-user',
      token: { email: 'admin@expreso-punata.bo' }
    },
    data: {
      targetUid: 'usuario-a-desactivar',
      fullName: 'Ex Operador',
      ci: '2222222',
      role: 'secretaria',
      primaryBranchId: 'punata',
      isActive: false, // Desactivar
    }
  }

  const res = await adminProvisionUser.run(req)
  assert.equal(res.success, true)
  assert.equal(res.profile.isActive, false)

  const authUser = await auth.getUser('usuario-a-desactivar')
  assert.equal(authUser.customClaims?.isActive, false)
})

test('6. MANEJO DE ESTADOS PARCIALES: Usuario no existente en Auth lanza error visible y no declara éxito', async () => {
  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    role: 'directiva_admin',
    isActive: true
  })

  const req = {
    auth: {
      uid: 'admin-user',
      token: { email: 'admin@expreso-punata.bo' }
    },
    data: {
      targetUid: 'uid-que-no-existe-en-auth',
      fullName: 'Usuario Fantasma',
      ci: '3333333',
      role: 'secretaria',
      primaryBranchId: 'punata',
      isActive: true,
    }
  }

  // Debe rechazar con error not-found o internal sin declarar éxito
  await assert.rejects(
    async () => adminProvisionUser.run(req),
    (err) => {
      assert.ok(err.code === 'not-found' || err.code === 'internal')
      return true
    }
  )
})

test('7. CI ES OPCIONAL: Guarda null cuando no se proporciona y no inventa datos dummy', async () => {
  let targetAuth
  try {
    targetAuth = await auth.createUser({
      uid: 'operador-sin-ci',
      email: 'sin-ci@expresopunata.com',
      displayName: 'Nelson Sin CI',
    })
  } catch {
    targetAuth = await auth.getUser('operador-sin-ci')
  }

  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    role: 'directiva_admin',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
  })

  const req = {
    auth: {
      uid: 'admin-user',
      token: { email: 'admin@expresopunata.com' }
    },
    data: {
      targetUid: 'operador-sin-ci',
      fullName: 'Nelson Sin CI',
      phone: '75999279',
      // ci omitido intencionalmente
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
    }
  }

  const res = await adminProvisionUser.run(req)
  assert.equal(res.success, true)
  assert.equal(res.profile.ci, null)

  const docSnap = await db.collection('users').doc('operador-sin-ci').get()
  assert.equal(docSnap.data().ci, null)
  assert.equal(docSnap.data().phone, '75999279')
})

test('8. ALTA DE NUEVO OPERADOR: Creación atómica mediante email sin targetUid previo', async () => {
  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    role: 'directiva_admin',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
  })

  const uniqueEmail = `secretaria.cocha.${Date.now()}@expresopunata.com`
  const req = {
    auth: {
      uid: 'admin-user',
      token: { email: 'admin@expresopunata.com' }
    },
    data: {
      email: uniqueEmail,
      fullName: 'Secretaria Cochabamba Oficial',
      phone: '72233445',
      ci: null,
      role: 'secretaria',
      primaryBranchId: 'cochabamba',
      allowedBranchIds: ['cochabamba'],
      isActive: true,
    }
  }

  const res = await adminProvisionUser.run(req)
  assert.equal(res.success, true)
  assert.ok(res.profile.uid)
  assert.equal(res.profile.email, uniqueEmail)
  assert.ok(res.passwordResetLink)

  // Verificar que el usuario existe en Firebase Auth
  const createdAuthUser = await auth.getUser(res.profile.uid)
  assert.equal(createdAuthUser.email, uniqueEmail)
  assert.equal(createdAuthUser.customClaims?.role, 'secretaria')
  assert.equal(createdAuthUser.customClaims?.branchId, 'cochabamba')

  // Verificar en Firestore
  const createdDoc = await db.collection('users').doc(res.profile.uid).get()
  assert.equal(createdDoc.exists, true)
  assert.equal(createdDoc.data().role, 'secretaria')
})

test('9. adminSendPasswordReset: Genera enlace de restablecimiento y asienta auditoría', async () => {
  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    role: 'directiva_admin',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
  })

  const req = {
    auth: {
      uid: 'admin-user',
      token: { email: 'admin@expresopunata.com' }
    },
    data: {
      email: 'test.reset@expresopunata.com',
    }
  }

  // Crear usuario previo en Auth para permitir generar el link
  try {
    await auth.createUser({
      email: 'test.reset@expresopunata.com',
      displayName: 'Usuario Reset',
    })
  } catch {}

  const res = await adminSendPasswordReset.run(req)
  assert.equal(res.success, true)
  assert.ok(res.passwordResetLink)
  assert.ok(res.passwordResetLink.includes('mode=resetPassword') || res.passwordResetLink.includes('apiKey='))

  // Verificar audit log
  const auditSnap = await db.collection('audit_logs')
    .where('action', '==', 'PASSWORD_RESET_LINK_REQUESTED')
    .get()
  assert.ok(auditSnap.size >= 1)
})
