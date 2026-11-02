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
  await assertFails(getDoc(doc(unauthDb, 'counters', 'PUN_2026')))
  await assertFails(getDoc(doc(unauthDb, 'financial_movements', 'MOV-001')))
})

test('2. Creación directa de encomiendas desde el cliente está BLOQUEADA (solo Cloud Functions)', async () => {
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

  // Intento de creación directa de encomienda desde el cliente -> DEBE FALLAR
  await assertFails(
    setDoc(doc(secDb, 'shipments', 'PUN-2026-00001'), {
      trackingCode: 'PUN-2026-00001',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      registeredByUid: 'sec-punata',
      status: 'received',
    })
  )

  // Intento de escritura directa a contadores -> DEBE FALLAR
  await assertFails(
    setDoc(doc(secDb, 'counters', 'PUN_2026'), {
      current: 99,
    })
  )

  // Intento de escritura directa a movimientos financieros -> DEBE FALLAR
  await assertFails(
    setDoc(doc(secDb, 'financial_movements', 'MOV-001'), {
      amountCents: 1500,
      branchId: 'punata',
    })
  )
})

test('3. Secretaria de Cochabamba puede LEER encomiendas con destino a su sucursal', async () => {
  // Simular encomienda creada por backend desde Punata hacia Cochabamba
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-cbb'), {
      role: 'secretaria',
      primaryBranchId: 'cochabamba',
      allowedBranchIds: ['cochabamba'],
      fullName: 'Elena Secretaria',
    })

    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-00001'), {
      trackingCode: 'PUN-2026-00001',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      registeredByUid: 'sec-punata',
      status: 'in_transit',
    })
  })

  const cbbContext = testEnv.authenticatedContext('sec-cbb', {
    role: 'secretaria',
    branchId: 'cochabamba',
  })
  const cbbDb = cbbContext.firestore()

  // Secretaria de Cochabamba debe poder leer la encomienda entrante
  await assertSucceeds(getDoc(doc(cbbDb, 'shipments', 'PUN-2026-00001')))
})

test('4. Directiva / Administrador tiene acceso a reportes y configuraciones', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'admin-1'), {
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      fullName: 'Directorio Central',
    })
    await setDoc(doc(context.firestore(), 'shipments', 'CBB-2026-00001'), {
      trackingCode: 'CBB-2026-00001',
      originBranchId: 'cochabamba',
      destinationBranchId: 'punata',
      registeredByUid: 'sec-cbb',
      status: 'received',
    })
  })

  const adminContext = testEnv.authenticatedContext('admin-1', {
    role: 'directiva_admin',
    branchId: 'punata',
  })
  const adminDb = adminContext.firestore()

  await assertSucceeds(getDoc(doc(adminDb, 'shipments', 'CBB-2026-00001')))
  await assertSucceeds(getDoc(doc(adminDb, 'users', 'admin-1')))
})

test('5. Conductor solo puede actualizar entregas en encomiendas asignadas', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'driver-1'), {
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      fullName: 'Conductor Don Pedro',
    })

    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-00010'), {
      trackingCode: 'PUN-2026-00010',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      status: 'in_delivery',
      assignedVehicle: {
        driverUid: 'driver-1',
        driverName: 'Conductor Don Pedro',
      },
    })
  })

  const driverContext = testEnv.authenticatedContext('driver-1', {
    role: 'conductor',
    branchId: 'punata',
  })
  const driverDb = driverContext.firestore()

  // Conductor puede actualizar status y deliveryRecord de su encomienda asignada
  await assertSucceeds(
    updateDoc(doc(driverDb, 'shipments', 'PUN-2026-00010'), {
      status: 'delivered',
      deliveryRecord: {
        receivedByName: 'Destinatario Final',
        deliveredAt: '2026-11-01T23:00:00Z',
      },
    })
  )

  // Conductor no puede borrar
  await assertFails(deleteDoc(doc(driverDb, 'shipments', 'PUN-2026-00010')))
})
