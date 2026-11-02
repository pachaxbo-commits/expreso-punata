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
      isActive: true,
    })
  })

  const secContext = testEnv.authenticatedContext('sec-punata', {
    role: 'secretaria',
    branchId: 'punata',
    isActive: true,
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

  // Crear encomienda en contexto administrative para probar intentos de alteración
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-00001'), {
      trackingCode: 'PUN-2026-00001',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      registeredByUid: 'sec-punata',
      finalAmountCents: 1500,
      paymentStatus: 'paid',
      status: 'received',
    })
  })

  // Intento de alterar importes financieros desde el cliente -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(secDb, 'shipments', 'PUN-2026-00001'), {
      finalAmountCents: 500,
    })
  )

  // Intento de alterar estado de pago o código de guía -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(secDb, 'shipments', 'PUN-2026-00001'), {
      paymentStatus: 'refunded',
    })
  )
  await assertFails(
    updateDoc(doc(secDb, 'shipments', 'PUN-2026-00001'), {
      trackingCode: 'PUN-2026-99999',
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
      isActive: true,
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
    isActive: true,
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
      isActive: true,
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
    isActive: true,
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
      isActive: true,
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
    isActive: true,
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


test('6. Creación y modificación directa de perfiles de usuario desde el cliente está BLOQUEADA (Admin SDK exclusivo)', async () => {
  // Setup: Crear secretaria en contexto con reglas desactivadas
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-punata'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      fullName: 'María Secretaria',
      isActive: true,
    })
  })

  const secContext = testEnv.authenticatedContext('sec-punata', {
    role: 'secretaria',
    branchId: 'punata',
  })
  const secDb = secContext.firestore()

  // 1. Intento de la secretaria de auto-asignarse rol 'directiva_admin' -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(secDb, 'users', 'sec-punata'), {
      role: 'directiva_admin',
    })
  )

  // 2. Intento de crear un nuevo usuario desde el navegador -> DEBE FALLAR
  await assertFails(
    setDoc(doc(secDb, 'users', 'nuevo-admin-hacker'), {
      role: 'directiva_admin',
      fullName: 'Hacker',
    })
  )

  // 3. Intento de usuario no autenticado de escribir en users -> DEBE FALLAR
  const unauthDb = testEnv.unauthenticatedContext().firestore()
  await assertFails(
    setDoc(doc(unauthDb, 'users', 'unauth-user'), {
      role: 'secretaria',
    })
  )
})


test('7. Transiciones ilegítimas de estado de encomienda son BLOQUEADAS', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-punata'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-TRANS-1'), {
      trackingCode: 'PUN-2026-TRANS-1',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      status: 'received',
    })
  })

  const secContext = testEnv.authenticatedContext('sec-punata', {
    role: 'secretaria',
    branchId: 'punata',
    isActive: true,
  })
  const secDb = secContext.firestore()

  // Transición ilegal: received -> delivered directo (salto de ruta sin llegada ni entrega) -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(secDb, 'shipments', 'PUN-2026-TRANS-1'), {
      status: 'delivered',
      deliveryRecord: { receivedByName: 'Salto Ilegal' }
    })
  )

  // Transición legal: received -> in_warehouse -> DEBE PASAR
  await assertSucceeds(
    updateDoc(doc(secDb, 'shipments', 'PUN-2026-TRANS-1'), {
      status: 'in_warehouse',
    })
  )
})

test('8. Usuarios inactivos son BLOQUEADOS de leer y operar en el sistema', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-inactiva'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: false, // Inactiva
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-INACT-1'), {
      trackingCode: 'PUN-2026-INACT-1',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      status: 'received',
    })
  })

  const inactContext = testEnv.authenticatedContext('sec-inactiva', {
    role: 'secretaria',
    branchId: 'punata',
    isActive: false,
  })
  const inactDb = inactContext.firestore()

  // Intento de actualización por usuaria inactiva -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(inactDb, 'shipments', 'PUN-2026-INACT-1'), {
      status: 'in_warehouse'
    })
  )
})
