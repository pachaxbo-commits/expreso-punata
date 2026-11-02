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

test('5. SEGURIDAD AUTORITATIVA: Modificación directa de encomiendas desde el cliente está BLOQUEADA', async () => {
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

  // Conductor NO puede modificar directamente status ni deliveryRecord (solo backend autoritativo)
  await assertFails(
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

test('7. SEGURIDAD AUTORITATIVA: Modificaciones directas de estado de encomienda desde el cliente son BLOQUEADAS', async () => {
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

  // Transición directa desde cliente: received -> delivered -> DEBE FALLAR
  await assertFails(
    updateDoc(doc(secDb, 'shipments', 'PUN-2026-TRANS-1'), {
      status: 'delivered',
      deliveryRecord: { receivedByName: 'Salto Ilegal' }
    })
  )

  // Modificación directa desde cliente: received -> in_warehouse -> DEBE FALLAR (solo backend Cloud Functions)
  await assertFails(
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

test('13. SEGURIDAD AUTORITATIVA: Creación y modificación directa de manifiestos desde el cliente está BLOQUEADA', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'sec-punata'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: true,
      fullName: 'Secretaria Punata',
    })
    await setDoc(doc(context.firestore(), 'manifests', 'MAN-EXISTENTE'), {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      status: 'dispatched',
    })
  })

  const secContext = testEnv.authenticatedContext('sec-punata', {
    role: 'secretaria',
    branchId: 'punata',
    isActive: true,
  })
  const secDb = secContext.firestore()

  // Secretaria NO puede crear manifiesto directamente desde cliente
  await assertFails(setDoc(doc(secDb, 'manifests', 'MAN-NUEVO'), {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    status: 'dispatched',
  }))

  // Secretaria NO puede modificar manifiesto directamente desde cliente
  await assertFails(updateDoc(doc(secDb, 'manifests', 'MAN-EXISTENTE'), {
    status: 'received',
  }))

  // Secretaria NO puede borrar manifiesto
  await assertFails(deleteDoc(doc(secDb, 'manifests', 'MAN-EXISTENTE')))
})

test('14. VEHÍCULOS: Personal activo puede leer; modificación directa desde el cliente está BLOQUEADA (solo manageVehicle backend)', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'admin-user'), {
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Admin User',
    })
    await setDoc(doc(context.firestore(), 'users', 'sec-user'), {
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: true,
      fullName: 'Sec User',
    })
    await setDoc(doc(context.firestore(), 'vehicles', 'veh-1'), {
      mobileNumber: '10',
      plate: '1234-ABC',
      status: 'active',
      branchId: 'punata',
    })
  })

  const adminDb = testEnv.authenticatedContext('admin-user', { role: 'directiva_admin', isActive: true }).firestore()
  const secDb = testEnv.authenticatedContext('sec-user', { role: 'secretaria', isActive: true }).firestore()

  // Ambos pueden leer vehículos
  await assertSucceeds(getDoc(doc(secDb, 'vehicles', 'veh-1')))
  await assertSucceeds(getDoc(doc(adminDb, 'vehicles', 'veh-1')))

  // Escrituras directas desde cliente están BLOQUEADAS para todos (deben usar manageVehicle para unicidad)
  await assertFails(setDoc(doc(adminDb, 'vehicles', 'veh-2'), {
    mobileNumber: '11',
    plate: '5678-DEF',
    status: 'active',
  }))

  await assertFails(setDoc(doc(secDb, 'vehicles', 'veh-3'), {
    mobileNumber: '12',
    plate: '9999-ZZZ',
  }))

  // Nadie puede eliminar vehículos (historial permanente)
  await assertFails(deleteDoc(doc(adminDb, 'vehicles', 'veh-1')))
})

test('15. CONDUCTOR ASIGNADO: Puede leer su propio manifiesto pero no el de otro conductor', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'driver-mio'), {
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Chofer Asignado',
    })
    await setDoc(doc(context.firestore(), 'users', 'driver-otro'), {
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Chofer Otro',
    })
    await setDoc(doc(context.firestore(), 'manifests', 'MAN-MIO'), {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      driverUid: 'driver-mio',
      status: 'in_transit',
    })
  })

  const driverMioDb = testEnv.authenticatedContext('driver-mio', { role: 'conductor', isActive: true }).firestore()
  const driverOtroDb = testEnv.authenticatedContext('driver-otro', { role: 'conductor', isActive: true }).firestore()

  // Conductor asignado puede leer su manifiesto
  await assertSucceeds(getDoc(doc(driverMioDb, 'manifests', 'MAN-MIO')))

  // Conductor no asignado NO puede leer manifiesto ajeno
  await assertFails(getDoc(doc(driverOtroDb, 'manifests', 'MAN-MIO')))
})

test('16. CUSTODIA DE CONDUCTORES: Lectura autorizada; escritura directa desde el cliente está BLOQUEADA', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'chofer-custodia'), {
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Chofer Custodia',
    })
    await setDoc(doc(context.firestore(), 'driver_custody_accounts', 'chofer-custodia'), {
      driverUid: 'chofer-custodia',
      cashUnderCustodyCents: 5000,
      pendingRemittanceCents: 5000,
    })
  })

  const driverDb = testEnv.authenticatedContext('chofer-custodia', { role: 'conductor', isActive: true }).firestore()
  const unauthDb = testEnv.unauthenticatedContext().firestore()

  // Conductor puede leer su propia cuenta de custodia
  await assertSucceeds(getDoc(doc(driverDb, 'driver_custody_accounts', 'chofer-custodia')))

  // Escritura directa bloqueada desde el cliente
  await assertFails(updateDoc(doc(driverDb, 'driver_custody_accounts', 'chofer-custodia'), {
    pendingRemittanceCents: 0,
  }))

  // No autenticado es bloqueado
  await assertFails(getDoc(doc(unauthDb, 'driver_custody_accounts', 'chofer-custodia')))
})
