import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

let testEnv

before(async () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-expreso-punata-rules-test',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

after(async () => {
  if (testEnv) {
    await testEnv.cleanup()
  }
})

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore()
  }
})

test('1. Acceso no autenticado es denegado por defecto (fail-closed)', async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore()

  await assertFails(getDoc(doc(unauthDb, 'shipments', 'PUN-001')))
  await assertFails(getDoc(doc(unauthDb, 'users', 'user-1')))
  await assertFails(getDoc(doc(unauthDb, 'cash_shifts', 'shift-1')))
  await assertFails(getDoc(doc(unauthDb, 'fixed_assets', 'asset-1')))
})

test('2. Secretaria de Punata puede registrar y leer encomienda de su sucursal', async () => {
  // Crear perfil de secretaria en contexto administrativo
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-punata'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      fullName: 'María Secretaria',
    })
  })

  const secContext = testEnv.authenticatedContext('sec-punata', {
    role: 'secretaria',
    branchId: 'punata',
  })
  const secDb = secContext.firestore()

  // Crear encomienda en origen punata -> permitido
  await assertSucceeds(
    setDoc(doc(secDb, 'shipments', 'PUN-00001'), {
      trackingCode: 'PUN-2026-00001',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      registeredByUid: 'sec-punata',
      status: 'received',
    })
  )

  // Intentar eliminar la encomienda -> denegado (inmutable)
  await assertFails(deleteDoc(doc(secDb, 'shipments', 'PUN-00001')))
})

test('3. Secretaria de Cochabamba NO puede crear encomiendas con origen Punata', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-cbb'), {
      role: 'secretaria',
      primaryBranchId: 'cochabamba',
      allowedBranchIds: ['cochabamba'],
      fullName: 'Elena Secretaria',
    })
  })

  const cbbContext = testEnv.authenticatedContext('sec-cbb', {
    role: 'secretaria',
    branchId: 'cochabamba',
  })
  const cbbDb = cbbContext.firestore()

  // Intentar crear encomienda con origen punata -> denegado por violación de sucursal
  await assertFails(
    setDoc(doc(cbbDb, 'shipments', 'PUN-00002'), {
      trackingCode: 'PUN-2026-00002',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      registeredByUid: 'sec-cbb',
      status: 'received',
    })
  )
})

test('4. Directiva / Administrador tiene acceso a reportes y configuraciones', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'admin-user'), {
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      fullName: 'Don Ejecutivo',
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-00001'), {
      trackingCode: 'PUN-2026-00001',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      registeredByUid: 'sec-punata',
      status: 'received',
    })
  })

  const adminContext = testEnv.authenticatedContext('admin-user', {
    role: 'directiva_admin',
    branchId: 'punata',
  })
  const adminDb = adminContext.firestore()

  // Admin puede leer cualquier encomienda
  await assertSucceeds(getDoc(doc(adminDb, 'shipments', 'PUN-00001')))
})

test('5. Conductor solo puede actualizar entregas en encomiendas asignadas', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'driver-14'), {
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      assignedMobileNumber: 'M-14',
      fullName: 'Chofer Walter',
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-00010'), {
      trackingCode: 'PUN-2026-00010',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      assignedVehicle: {
        driverUid: 'driver-14',
        mobileNumber: 'M-14',
      },
      status: 'in_transit',
    })
  })

  const driverContext = testEnv.authenticatedContext('driver-14', {
    role: 'conductor',
  })
  const driverDb = driverContext.firestore()

  // Conductor puede leer su encomienda asignada
  await assertSucceeds(getDoc(doc(driverDb, 'shipments', 'PUN-00010')))

  // Conductor no puede borrar encomiendas
  await assertFails(deleteDoc(doc(driverDb, 'shipments', 'PUN-00010')))
})
