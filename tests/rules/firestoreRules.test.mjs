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
  await assertFails(getDoc(doc(unauthDb, 'branches', 'punata')))
  await assertFails(getDoc(doc(unauthDb, 'manifests', 'MAN-001')))
})

test('2. Creación directa de encomiendas desde el cliente está BLOQUEADA (solo Cloud Functions)', async () => {
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

test('6. Creación y modificación directa de perfiles de usuario desde el cliente está BLOQUEADA', async () => {
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

  // Intento de la secretaria de auto-asignarse rol 'directiva_admin' -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(secDb, 'users', 'sec-punata'), {
      role: 'directiva_admin',
    })
  )

  // Intento de crear un nuevo usuario desde el navegador -> DEBE FALLAR
  await assertFails(
    setDoc(doc(secDb, 'users', 'nuevo-admin-hacker'), {
      role: 'directiva_admin',
      fullName: 'Hacker',
    })
  )

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

  // Transición ilegal: received -> delivered directo -> DEBE FALLAR
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

  await assertFails(
    updateDoc(doc(inactDb, 'shipments', 'PUN-2026-INACT-1'), {
      status: 'in_warehouse'
    })
  )
})

test('9. SEGURIDAD AUTORITATIVA: Token antiguo con claim isActive=true pero perfil en BD isActive=false es BLOQUEADO', async () => {
  // Simular que el usuario fue desactivado en Firestore pero su JWT token todavía afirma isActive: true
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'user-token-stale'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: false, // DESACTIVADO EN BASE DE DATOS
      fullName: 'Operador Suspendido',
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-STALE-1'), {
      trackingCode: 'PUN-2026-STALE-1',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      status: 'received',
    })
  })

  // Token JWT residual emitido antes de la suspensión
  const staleAuthContext = testEnv.authenticatedContext('user-token-stale', {
    role: 'secretaria',
    branchId: 'punata',
    isActive: true, // Claim obsoleto
  })
  const staleDb = staleAuthContext.firestore()

  // La lectura y la escritura DEBEN SER DENEGADAS porque el documento en Firestore es autoritativo
  await assertFails(getDoc(doc(staleDb, 'shipments', 'PUN-2026-STALE-1')))
  await assertFails(
    updateDoc(doc(staleDb, 'shipments', 'PUN-2026-STALE-1'), {
      status: 'in_warehouse',
    })
  )
})

test('10. SEGURIDAD AUTORITATIVA: Token antiguo con claim role=directiva_admin pero perfil rebajado a secretaria es BLOQUEADO', async () => {
  // Simular que el usuario fue rebajado de admin a secretaria en Firestore
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'user-demoted'), {
      role: 'secretaria', // REBAJADO EN FIRESTORE
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: true,
      fullName: 'Ex Directivo',
    })
    await setDoc(doc(context.firestore(), 'users', 'otro-usuario'), {
      role: 'conductor',
      fullName: 'Conductor Otro',
      isActive: true,
    })
  })

  // Token obsoleto que aún dice directiva_admin
  const demotedContext = testEnv.authenticatedContext('user-demoted', {
    role: 'directiva_admin', // Claim obsoleto
    branchId: 'punata',
    isActive: true,
  })
  const demotedDb = demotedContext.firestore()

  // Intento de leer perfil de otro usuario (solo permitido a admin activo en Firestore) -> DEBE FALLAR
  await assertFails(getDoc(doc(demotedDb, 'users', 'otro-usuario')))
})

test('11. ACCESO CRUZADO ENTRE SUCURSALES ES BLOQUEADO', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-cbb-cross'), {
      role: 'secretaria',
      primaryBranchId: 'cochabamba',
      allowedBranchIds: ['cochabamba'], // Solo Cochabamba
      isActive: true,
      fullName: 'Secretaria Cochabamba',
    })
    // Turno de caja de Punata
    await setDoc(doc(context.firestore(), 'cash_shifts', 'shift-punata-1'), {
      branchId: 'punata',
      operatorUid: 'sec-punata-1',
      status: 'open',
    })
    // Manifiesto con origen y destino exclusivos de Punata
    await setDoc(doc(context.firestore(), 'manifests', 'MAN-PUN-01'), {
      originBranchId: 'punata',
      destinationBranchId: 'punata',
    })
  })

  const crossContext = testEnv.authenticatedContext('sec-cbb-cross', {
    role: 'secretaria',
    branchId: 'cochabamba',
    isActive: true,
  })
  const crossDb = crossContext.firestore()

  // Secretaria de Cochabamba no puede leer turnos de caja de Punata
  await assertFails(getDoc(doc(crossDb, 'cash_shifts', 'shift-punata-1')))
  // Secretaria de Cochabamba no puede leer manifiestos de Punata
  await assertFails(getDoc(doc(crossDb, 'manifests', 'MAN-PUN-01')))
})

test('12. Conductor no asignado NO puede leer status_logs de encomienda ajena', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'driver-ajeno'), {
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Conductor No Asignado',
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-AUDIT-1'), {
      trackingCode: 'PUN-2026-AUDIT-1',
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      status: 'in_delivery',
      assignedVehicle: {
        driverUid: 'driver-asignado-oficial',
      },
    })
    await setDoc(doc(context.firestore(), 'shipments', 'PUN-2026-AUDIT-1', 'status_logs', 'log-1'), {
      note: 'Inspección confidencial',
    })
  })

  const driverContext = testEnv.authenticatedContext('driver-ajeno', {
    role: 'conductor',
    branchId: 'punata',
    isActive: true,
  })
  const driverDb = driverContext.firestore()

  // Conductor ajeno no puede leer el status_log de la encomienda
  await assertFails(getDoc(doc(driverDb, 'shipments', 'PUN-2026-AUDIT-1', 'status_logs', 'log-1')))
})
