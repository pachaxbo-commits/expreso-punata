import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { adminProvisionUser } from '../index.js'

// Inicializar Firebase Admin apuntando al emulador local
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-admin-test' })
}

const db = getFirestore()

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

test('1. Aprovisionamiento Bootstrap: permite crear el primer administrador cuando la BD está vacía', async () => {
  const req = {
    auth: {
      uid: 'super-admin-uid',
      token: { email: 'admin@expreso-punata.bo' }
    },
    data: {
      targetUid: 'super-admin-uid',
      fullName: 'Administrador Inicial PACHAX',
      ci: '1020304-CB',
      phone: '77788990',
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
    }
  }

  const res = await adminProvisionUser.run(req)
  assert.equal(res.success, true)
  assert.equal(res.profile.role, 'directiva_admin')

  // Verificar en Firestore
  const userDoc = await db.collection('users').doc('super-admin-uid').get()
  assert.equal(userDoc.exists, true)
  assert.equal(userDoc.data().role, 'directiva_admin')
  assert.equal(userDoc.data().createdReason, 'bootstrap_initial_admin')

  // Verificar audit log
  const auditSnapshot = await db.collection('audit_logs').where('entityId', '==', 'super-admin-uid').get()
  assert.equal(auditSnapshot.empty, false)
  assert.equal(auditSnapshot.docs[0].data().action, 'USER_PROFILE_PROVISIONED')
})

test('2. Administrador activo puede aprovisionar secretarias y otros roles legítimos', async () => {
  // Setup: Crear admin en la BD
  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    fullName: 'Directiva Administradora',
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

  const secDoc = await db.collection('users').doc('sec-punata-uid').get()
  assert.equal(secDoc.exists, true)
  assert.equal(secDoc.data().role, 'secretaria')
  assert.equal(secDoc.data().primaryBranchId, 'punata')
})

test('3. Roles no autorizados (secretaria) NO pueden aprovisionar usuarios', async () => {
  // Setup: Crear secretaria y admin
  await db.collection('users').doc('admin-user').set({
    uid: 'admin-user',
    role: 'directiva_admin',
    isActive: true
  })
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
      targetUid: 'nuevo-hacker',
      fullName: 'Hacker Intruso',
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

test('5. Validación de argumentos: rechaza roles o sucursales inválidas', async () => {
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
      targetUid: 'user-test',
      fullName: 'Test User',
      ci: '1111111',
      role: 'rol_inexistente_hacker',
      primaryBranchId: 'punata',
    }
  }

  await assert.rejects(
    async () => adminProvisionUser.run(req),
    (err) => {
      assert.equal(err.code, 'invalid-argument')
      return true
    }
  )
})
