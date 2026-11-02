import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { adminProvisionUser } from '../index.js'

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
  // Cuando la colección 'users' está vacía, un atacante no puede auto-aprovisionarse como admin
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

  // Verificar que la BD permanece completamente vacía
  const userDoc = await db.collection('users').doc('atacante-aleatorio').get()
  assert.equal(userDoc.exists, false)
})

test('2. Administrador activo puede aprovisionar secretarias y sincronizar Custom Claims', async () => {
  // Setup: Crear cuenta en Auth Emulator y admin en la BD
  let testTargetUser
  try {
    testTargetUser = await auth.createUser({
      uid: 'sec-punata-uid',
      email: 'sec.punata@expreso-punata.bo',
      displayName: 'María Secretaria Punata',
    })
  } catch (err) {
    // Si ya existe en el emulador, obtenerlo
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

  // Verificar documento en Firestore
  const secDoc = await db.collection('users').doc('sec-punata-uid').get()
  assert.equal(secDoc.exists, true)
  assert.equal(secDoc.data().role, 'secretaria')
  assert.equal(secDoc.data().primaryBranchId, 'punata')

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
    isActive: false // Inactivo
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

test('5. Desactivación de usuario: sincroniza isActive=false en claims', async () => {
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
