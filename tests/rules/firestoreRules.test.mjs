import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, collection, getDocs, query, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

let testEnv

test('soporte no puede escribir ni leer respaldos o auditoría directamente', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'support-direct-test'), { role: 'soporte_pachax', isActive: true, primaryBranchId: 'punata' })
    await setDoc(doc(context.firestore(), 'support_cleanup_backups', 'backup'), { sensitive: true })
    await setDoc(doc(context.firestore(), 'audit_logs', 'support-log'), { action: 'example' })
  })
  const support = testEnv.authenticatedContext('support-direct-test').firestore()
  await assertFails(getDoc(doc(support, 'support_cleanup_backups', 'backup')))
  await assertFails(setDoc(doc(support, 'support_cleanup_backups', 'forged'), { sensitive: false }))
  await assertFails(updateDoc(doc(support, 'audit_logs', 'support-log'), { action: 'forged' }))
})

test('auditoría y reservas de baja y eliminación protegidas frente a clientes administradores', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', 'retirement-rules-admin'), { role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
    for (const collectionName of ['audit_logs', 'user_retirement_operations', 'user_deletion_operations']) {
      await setDoc(doc(db, collectionName, 'operation-audit-test'), { status: 'pending' })
    }
  })
  const db = testEnv.authenticatedContext('retirement-rules-admin').firestore()
  const audit = doc(db, 'audit_logs', 'operation-audit-test')
  await assertSucceeds(getDoc(audit))
  await assertFails(updateDoc(audit, { status: 'completed' }))
  await assertFails(deleteDoc(audit))
  for (const collectionName of ['user_retirement_operations', 'user_deletion_operations']) {
    const operation = doc(db, collectionName, 'operation-audit-test')
    await assertFails(getDoc(operation))
    await assertFails(setDoc(operation, { status: 'completed' }))
  }
})

before(async () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  testEnv = await initializeTestEnvironment({
      projectId: process.env.FIRESTORE_RULES_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-expreso-punata-101',
    firestore: {
      rules,
      host: '127.0.0.1',
        port: Number(process.env.FIRESTORE_RULES_PORT || process.env.FIRESTORE_EMULATOR_PORT || 8080),
    },
  })
})

test('19. Incidencias: lectura por sucursal y escritura directa bloqueada', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', 'incident-sec-punata'), { role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
    await setDoc(doc(seed, 'users', 'incident-admin'), { role: 'afiliado_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true })
    await setDoc(doc(seed, 'users', 'incident-inactive'), { role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: false })
    await setDoc(doc(seed, 'users', 'incident-no-role'), { primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
    await setDoc(doc(seed, 'shipment_incidents', 'incident-punata'), { branchId: 'punata', shipmentId: 'shipment-punata', incidentType: 'uncollected' })
    await setDoc(doc(seed, 'shipment_incidents', 'incident-cbba'), { branchId: 'cochabamba', shipmentId: 'shipment-cbba', incidentType: 'damaged' })
  })
  const secDb = testEnv.authenticatedContext('incident-sec-punata').firestore()
  const adminDb = testEnv.authenticatedContext('incident-admin').firestore()
  const inactiveDb = testEnv.authenticatedContext('incident-inactive').firestore()
  const noRoleDb = testEnv.authenticatedContext('incident-no-role').firestore()
  await assertSucceeds(getDoc(doc(secDb, 'shipment_incidents', 'incident-punata')))
  await assertFails(getDoc(doc(secDb, 'shipment_incidents', 'incident-cbba')))
  await assertSucceeds(getDoc(doc(adminDb, 'shipment_incidents', 'incident-punata')))
  await assertSucceeds(getDoc(doc(adminDb, 'shipment_incidents', 'incident-cbba')))
  await assertFails(getDoc(doc(inactiveDb, 'shipment_incidents', 'incident-punata')))
  await assertFails(getDoc(doc(noRoleDb, 'shipment_incidents', 'incident-punata')))
  await assertFails(setDoc(doc(adminDb, 'shipment_incidents', 'incident-new'), { branchId: 'punata' }))
  await assertFails(updateDoc(doc(secDb, 'shipment_incidents', 'incident-punata'), { description: 'tampered' }))
  await assertFails(deleteDoc(doc(adminDb, 'shipment_incidents', 'incident-punata')))
})

test('Seguridad financiera: clientes no pueden escribir directamente cuentas ni asientos de comisión', async () => {
  const clientDb = testEnv.authenticatedContext('commission-client').firestore()
  await assertFails(setDoc(doc(clientDb, 'driver_commission_accounts', 'driver-commission-client'), {
    driverUid: 'driver-commission-client', accruedCents: 250000, pendingCents: 250000,
  }))
  await assertFails(setDoc(doc(clientDb, 'driver_commission_records', 'commission-client-record'), {
    driverUid: 'driver-commission-client', shipmentId: 'nonexistent-shipment', commissionAmountCents: 250000,
  }))
  await assertFails(updateDoc(doc(clientDb, 'driver_commission_accounts', 'existing-commission-account'), { pendingCents: 0 }))
  await assertFails(deleteDoc(doc(clientDb, 'driver_commission_records', 'existing-commission-record')))
})

test('Pasajes: lectura limitada por sucursal/chofer y escrituras directas bloqueadas', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', 'tickets-sec-punata'), { role: 'secretaria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'users', 'tickets-driver'), { role: 'conductor', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'users', 'tickets-other-driver'), { role: 'conductor', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'users', 'tickets-treasury'), { role: 'tesoreria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'passenger_ticket_operations', 'ticket-punata'), { branchId: 'punata', driverUid: 'tickets-driver' })
    await setDoc(doc(seed, 'passenger_ticket_operations', 'ticket-cbba'), { branchId: 'cochabamba', driverUid: 'tickets-other-driver' })
    await setDoc(doc(seed, 'passenger_ticket_validations', 'validation-own'), { operationId: 'ticket-punata', branchId: 'punata', driverUid: 'tickets-driver' })
  })
  const secretaryDb = testEnv.authenticatedContext('tickets-sec-punata').firestore()
  const driverDb = testEnv.authenticatedContext('tickets-driver').firestore()
  const otherDriverDb = testEnv.authenticatedContext('tickets-other-driver').firestore()
  const treasuryDb = testEnv.authenticatedContext('tickets-treasury').firestore()
  await assertSucceeds(getDoc(doc(secretaryDb, 'passenger_ticket_operations', 'ticket-punata')))
  await assertFails(getDoc(doc(secretaryDb, 'passenger_ticket_operations', 'ticket-cbba')))
  await assertSucceeds(getDoc(doc(driverDb, 'passenger_ticket_operations', 'ticket-punata')))
  await assertFails(getDoc(doc(driverDb, 'passenger_ticket_operations', 'ticket-cbba')))
  await assertSucceeds(getDoc(doc(driverDb, 'passenger_ticket_validations', 'validation-own')))
  await assertFails(getDoc(doc(otherDriverDb, 'passenger_ticket_validations', 'validation-own')))
  await assertSucceeds(getDoc(doc(treasuryDb, 'passenger_ticket_operations', 'ticket-cbba')))
  await assertFails(setDoc(doc(secretaryDb, 'passenger_ticket_operations', 'ticket-client-write'), { branchId: 'punata' }))
  await assertFails(setDoc(doc(driverDb, 'passenger_ticket_validations', 'ticket-client-validation'), { operationId: 'ticket-punata' }))
})

test('Cuotas: encargado limitado por sucursal sin reducir permisos vigentes de otros roles', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', 'dues-manager-punata'), { role: 'encargado_agencia', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'users', 'dues-secretary-punata'), { role: 'secretaria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'users', 'dues-treasury'), { role: 'tesoreria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'users', 'dues-admin'), { role: 'directiva_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] })
    await setDoc(doc(seed, 'users', 'dues-affiliate'), { role: 'afiliado', isActive: true, primaryBranchId: 'punata', unionMemberId: 'dues-member-punata' })
    await setDoc(doc(seed, 'union_members', 'dues-member-punata'), { branchId: 'punata' })
    await setDoc(doc(seed, 'union_dues', 'dues-punata'), { branchId: 'punata', memberId: 'dues-member-punata', balanceCents: 1000 })
    await setDoc(doc(seed, 'union_dues', 'dues-cochabamba'), { branchId: 'cochabamba', memberId: 'dues-member-cbba', balanceCents: 2000 })
    await setDoc(doc(seed, 'union_dues', 'dues-punata', 'payments', 'payment-punata'), { memberId: 'dues-member-punata' })
    await setDoc(doc(seed, 'union_dues', 'dues-cochabamba', 'payments', 'payment-cbba'), { memberId: 'dues-member-cbba' })
  })

  const managerDb = testEnv.authenticatedContext('dues-manager-punata').firestore()
  const secretaryDb = testEnv.authenticatedContext('dues-secretary-punata').firestore()
  const treasuryDb = testEnv.authenticatedContext('dues-treasury').firestore()
  const adminDb = testEnv.authenticatedContext('dues-admin').firestore()
  const affiliateDb = testEnv.authenticatedContext('dues-affiliate').firestore()
  await assertSucceeds(getDoc(doc(managerDb, 'union_dues', 'dues-punata')))
  await assertFails(getDoc(doc(managerDb, 'union_dues', 'dues-cochabamba')))
  await assertSucceeds(getDoc(doc(managerDb, 'union_dues', 'dues-punata', 'payments', 'payment-punata')))
  await assertFails(getDoc(doc(managerDb, 'union_dues', 'dues-cochabamba', 'payments', 'payment-cbba')))
  await assertFails(getDoc(doc(secretaryDb, 'union_dues', 'dues-cochabamba')))
  await assertSucceeds(getDoc(doc(treasuryDb, 'union_dues', 'dues-cochabamba')))
  await assertSucceeds(getDoc(doc(adminDb, 'union_dues', 'dues-cochabamba')))
  await assertFails(getDoc(doc(affiliateDb, 'union_dues', 'dues-punata')))
  await assertFails(getDoc(doc(affiliateDb, 'union_dues', 'dues-cochabamba')))
  await assertFails(setDoc(doc(managerDb, 'union_dues', 'dues-new'), { branchId: 'punata' }))
})

test('20. Seguimiento de destinatarios: lectura por sucursal e historial inmutable', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', 'contact-sec-punata'), { role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
    await setDoc(doc(seed, 'users', 'contact-admin'), { role: 'directiva_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true })
    await setDoc(doc(seed, 'users', 'contact-inactive'), { role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: false })
    await setDoc(doc(seed, 'shipment_contacts', 'contact-punata'), { shipmentId: 'shipment-punata', branchId: 'punata', trackingCode: 'PUN-CONTACT-1' })
    await setDoc(doc(seed, 'shipment_contacts', 'contact-cbba'), { shipmentId: 'shipment-cbba', branchId: 'cochabamba', trackingCode: 'CBB-CONTACT-1' })
  })
  const secDb = testEnv.authenticatedContext('contact-sec-punata').firestore()
  const adminDb = testEnv.authenticatedContext('contact-admin').firestore()
  const inactiveDb = testEnv.authenticatedContext('contact-inactive').firestore()
  await assertSucceeds(getDoc(doc(secDb, 'shipment_contacts', 'contact-punata')))
  await assertFails(getDoc(doc(secDb, 'shipment_contacts', 'contact-cbba')))
  await assertSucceeds(getDoc(doc(adminDb, 'shipment_contacts', 'contact-cbba')))
  await assertFails(getDoc(doc(inactiveDb, 'shipment_contacts', 'contact-punata')))
  await assertFails(updateDoc(doc(secDb, 'shipment_contacts', 'contact-punata'), { notes: 'tampered' }))
  await assertFails(deleteDoc(doc(adminDb, 'shipment_contacts', 'contact-punata')))
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

test('17. FASE A: BLOQUEO ESTRICTO DE ESCRITURA DIRECTA A DOCUMENTOS FINANCIEROS Y ACTIVOS FIJOS', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'admin-user'), {
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Nelson Directiva',
    })
    await setDoc(doc(context.firestore(), 'users', 'treasury-user'), {
      role: 'tesoreria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      fullName: 'Tesorero Oficial',
    })
    // Seed existing documents
    await setDoc(doc(context.firestore(), 'union_members', 'mem-1'), {
      fullName: 'Socio Juan Pérez',
      status: 'active',
      monthlyFeeCents: 5000,
    })
    await setDoc(doc(context.firestore(), 'union_dues', 'due-1'), {
      memberId: 'mem-1',
      period: '2026-11',
      amountCents: 5000,
      balanceCents: 5000,
      status: 'pending',
    })
    await setDoc(doc(context.firestore(), 'union_workers', 'work-1'), {
      fullName: 'Pedro Choque',
      role: 'estibador',
      status: 'active',
    })
    await setDoc(doc(context.firestore(), 'fixed_assets', 'asset-1'), {
      name: 'Balanza Digital 300kg',
      category: 'herramientas',
      status: 'available',
    })
  })

  const adminDb = testEnv.authenticatedContext('admin-user', { role: 'directiva_admin', isActive: true }).firestore()
  const treasuryDb = testEnv.authenticatedContext('treasury-user', { role: 'tesoreria', isActive: true }).firestore()

  // 1. union_members: Lectura permitida, escritura directa BLOQUEADA
  await assertSucceeds(getDoc(doc(adminDb, 'union_members', 'mem-1')))
  await assertFails(setDoc(doc(adminDb, 'union_members', 'mem-2'), { fullName: 'Nuevo' }))
  await assertFails(updateDoc(doc(adminDb, 'union_members', 'mem-1'), { fullName: 'Alterado' }))
  await assertFails(deleteDoc(doc(adminDb, 'union_members', 'mem-1')))
  await assertFails(setDoc(doc(treasuryDb, 'union_members', 'mem-2'), { fullName: 'Nuevo' }))

  // 2. union_dues y pagos: Lectura permitida, escritura directa BLOQUEADA
  await assertSucceeds(getDoc(doc(treasuryDb, 'union_dues', 'due-1')))
  await assertFails(setDoc(doc(treasuryDb, 'union_dues', 'due-2'), { amountCents: 5000 }))
  await assertFails(updateDoc(doc(treasuryDb, 'union_dues', 'due-1'), { balanceCents: 0 }))
  await assertFails(deleteDoc(doc(adminDb, 'union_dues', 'due-1')))
  await assertFails(setDoc(doc(treasuryDb, 'union_dues', 'due-1', 'payments', 'pay-1'), { amountCents: 5000 }))

  // 3. union_workers y pagos de nómina: Lectura permitida, escritura directa BLOQUEADA
  await assertSucceeds(getDoc(doc(adminDb, 'union_workers', 'work-1')))
  await assertFails(setDoc(doc(adminDb, 'union_workers', 'work-2'), { fullName: 'Nuevo' }))
  await assertFails(updateDoc(doc(adminDb, 'union_workers', 'work-1'), { fullName: 'Modificado' }))
  await assertFails(deleteDoc(doc(adminDb, 'union_workers', 'work-1')))
  await assertFails(setDoc(doc(adminDb, 'union_worker_payments', 'pay-1'), { amountCents: 200000 }))

  // 4. union_expenses: Lectura permitida, escritura directa BLOQUEADA
  await assertFails(setDoc(doc(adminDb, 'union_expenses', 'exp-1'), { amountCents: 15000 }))
  await assertFails(deleteDoc(doc(adminDb, 'union_expenses', 'exp-1')))

  // 5. fixed_assets y auditoría: Lectura permitida, escritura directa BLOQUEADA
  await assertSucceeds(getDoc(doc(adminDb, 'fixed_assets', 'asset-1')))
  await assertFails(setDoc(doc(adminDb, 'fixed_assets', 'asset-2'), { name: 'Impresora' }))
  await assertFails(updateDoc(doc(adminDb, 'fixed_assets', 'asset-1'), { status: 'disposed' }))
  await assertFails(deleteDoc(doc(adminDb, 'fixed_assets', 'asset-1')))
  await assertFails(setDoc(doc(adminDb, 'fixed_assets', 'asset-1', 'audit_logs', 'log-1'), { action: 'hacked' }))
})

test('18. FASE A: Alcance por sucursal y auditoría de encomiendas', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', 'sec-punata-scope'), {
      role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true,
    })
    await setDoc(doc(seed, 'users', 'admin-scope'), {
      role: 'directiva_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true,
    })
    await setDoc(doc(seed, 'users', 'sec-cbba-scope'), {
      role: 'secretaria', primaryBranchId: 'cochabamba', allowedBranchIds: ['cochabamba'], isActive: true,
    })
    await setDoc(doc(seed, 'users', 'inactive-scope'), {
      role: 'directiva_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: false,
    })
    await setDoc(doc(seed, 'users', 'no-role-scope'), {
      primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true,
    })
    await setDoc(doc(seed, 'fixed_assets', 'asset-punata-scope'), { branchId: 'punata', assetCode: 'ACT-PUN-SCOPE' })
    await setDoc(doc(seed, 'fixed_assets', 'asset-cbba-scope'), { branchId: 'cochabamba', assetCode: 'ACT-CBB-SCOPE' })
    await setDoc(doc(seed, 'branch_consumables', 'consumable-punata-scope'), { branchId: 'punata', name: 'Insumo Punata' })
    await setDoc(doc(seed, 'branch_consumables', 'consumable-cbba-scope'), { branchId: 'cochabamba', name: 'Insumo Cbba' })
    await setDoc(doc(seed, 'shipments', 'shipment-audit-scope'), { originBranchId: 'punata', destinationBranchId: 'cochabamba' })
    await setDoc(doc(seed, 'shipments', 'shipment-audit-scope', 'audit_logs', 'cancel-1'), { action: 'cancel_shipment' })
  })

  const punataDb = testEnv.authenticatedContext('sec-punata-scope').firestore()
  const cbbaDb = testEnv.authenticatedContext('sec-cbba-scope').firestore()
  const inactiveDb = testEnv.authenticatedContext('inactive-scope').firestore()
  const noRoleDb = testEnv.authenticatedContext('no-role-scope').firestore()
  const adminDb = testEnv.authenticatedContext('admin-scope').firestore()

  await assertFails(getDoc(doc(punataDb, 'fixed_assets', 'asset-punata-scope')))
  await assertFails(getDoc(doc(punataDb, 'fixed_assets', 'asset-cbba-scope')))
  await assertFails(getDoc(doc(cbbaDb, 'branch_consumables', 'consumable-cbba-scope')))
  await assertFails(getDoc(doc(cbbaDb, 'branch_consumables', 'consumable-punata-scope')))
  await assertFails(getDoc(doc(inactiveDb, 'fixed_assets', 'asset-punata-scope')))
  await assertFails(getDoc(doc(noRoleDb, 'fixed_assets', 'asset-punata-scope')))
  await assertSucceeds(getDoc(doc(adminDb, 'fixed_assets', 'asset-cbba-scope')))
  await assertSucceeds(getDoc(doc(adminDb, 'branch_consumables', 'consumable-punata-scope')))
  await assertSucceeds(getDoc(doc(adminDb, 'shipments', 'shipment-audit-scope', 'audit_logs', 'cancel-1')))
  await assertFails(setDoc(doc(adminDb, 'shipments', 'shipment-audit-scope', 'audit_logs', 'hack'), { action: 'tampered' }))
})

test('cashier can observe a missing own shift lock only in an authorized branch', async () => {
  const uid = 'missing-cash-lock-secretary'
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true,
    })
  })
  const cashier = testEnv.authenticatedContext(uid).firestore()
  const lock = id => doc(cashier, 'cash_shift_active_locks', id)
  const own = await assertSucceeds(getDoc(lock(uid + '_punata')))
  if (own.exists()) throw new Error('Expected the shift lock to be absent')
  await assertFails(getDoc(lock(uid + '_cochabamba')))
  await assertFails(getDoc(lock('other-operator_punata')))
  await assertFails(setDoc(lock(uid + '_punata'), { operatorUid: uid, branchId: 'punata' }))
})

test('only the active company administrator can read the global commissions ledger', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    for (const [id, role, isActive] of [
      ['ledger-admin', 'directiva_admin', true], ['ledger-inactive', 'directiva_admin', false],
      ['ledger-secretary', 'secretaria', true], ['ledger-affiliate', 'afiliado', true],
    ]) await setDoc(doc(seed, 'users', id), { role, isActive })
    await setDoc(doc(seed, 'driver_commission_accounts', 'ledger-driver'), { pendingCents: 200 })
    await setDoc(doc(seed, 'driver_commission_records', 'ledger-record'), { amountCents: 200 })
  })
  for (const [collectionName, id] of [
    ['driver_commission_accounts', 'ledger-driver'], ['driver_commission_records', 'ledger-record'],
  ]) {
    const ref = uid => doc(testEnv.authenticatedContext(uid).firestore(), collectionName, id)
    await assertSucceeds(getDoc(ref('ledger-admin')))
    await assertFails(updateDoc(ref('ledger-admin'), { pendingCents: 0 }))
    for (const uid of ['ledger-inactive', 'ledger-secretary', 'ledger-affiliate']) await assertFails(getDoc(ref(uid)))
  }
})

test('soporte técnico solo puede leer su propio perfil de Firestore', async () => {
  const uid = 'technical-support-test'
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', uid), { role: 'soporte_pachax', isActive: true })
    await setDoc(doc(seed, 'branches', 'technical-branch'), { name: 'Sucursal' })
  })
  const support = testEnv.authenticatedContext(uid, { role: 'directiva_admin' }).firestore()
  await assertSucceeds(getDoc(doc(support, 'users', uid)))
  await assertFails(getDoc(doc(support, 'branches', 'technical-branch')))
  await assertFails(updateDoc(doc(support, 'users', uid), { role: 'directiva_admin' }))
})

test('historical search accepts an agency-scoped phone query and rejects an unscoped search', async () => {
  const uid = 'historical-search-secretary'
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    await setDoc(doc(seed, 'users', uid), { role: 'secretaria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] })
    await setDoc(doc(seed, 'shipments', 'old-guide-punata'), { originBranchId: 'punata', destinationBranchId: 'cochabamba', createdAtIso: '2025-01-01T00:00:00.000Z', sender: { phone: '70000001' } })
    await setDoc(doc(seed, 'shipments', 'old-guide-foreign'), { originBranchId: 'cochabamba', destinationBranchId: 'cochabamba', createdAtIso: '2025-01-01T00:00:00.000Z', sender: { phone: '70000001' } })
  })
  const shipments = collection(testEnv.authenticatedContext(uid).firestore(), 'shipments')
  const phone = where('sender.phone', '==', '70000001')
  const result = await assertSucceeds(getDocs(query(shipments, where('originBranchId', '==', 'punata'), phone)))
  assert.deepEqual(result.docs.map(doc => doc.id), ['old-guide-punata'])
  await assertFails(getDocs(query(shipments, phone)))
})

test('administración institucional y perfiles de agencia mantienen fronteras de lectura y escritura', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const seed = context.firestore()
    for (const [uid, role, agencies] of [
      ['scope-full', 'afiliado_admin', ['punata', 'cochabamba']],
      ['scope-limit', 'afiliado_admin', ['punata']],
      ['scope-secretary', 'secretaria', ['punata']],
      ['scope-member', 'afiliado', ['punata']],
      ['scope-support', 'soporte_pachax', ['punata', 'cochabamba']],
    ]) {
      await setDoc(doc(seed, 'users', uid), { role, primaryBranchId: 'punata', allowedBranchIds: agencies, isActive: true })
    }
    await setDoc(doc(seed, 'driver_commission_accounts', 'scope-driver'), { pendingCents: 200 })
    await setDoc(doc(seed, 'driver_commission_records', 'scope-record'), { originBranchId: 'punata', commissionAmountCents: 200 })
    await setDoc(doc(seed, 'financial_movements', 'scope-financial'), { branchId: 'cochabamba', amountCents: 200 })
    await setDoc(doc(seed, 'financial_movements', 'scope-financial-own-branch'), { branchId: 'punata', amountCents: 200 })
    await setDoc(doc(seed, 'union_members', 'scope-member-punata'), { branchId: 'punata' })
    await setDoc(doc(seed, 'union_members', 'scope-member-cocha'), { branchId: 'cochabamba' })
  })
  const full = testEnv.authenticatedContext('scope-full').firestore()
  const limited = testEnv.authenticatedContext('scope-limit').firestore()
  const secretary = testEnv.authenticatedContext('scope-secretary').firestore()
  await assertFails(getDoc(doc(secretary, 'financial_movements', 'scope-financial-own-branch')))
  await assertSucceeds(getDoc(doc(limited, 'union_members', 'scope-member-punata')))
  await assertFails(getDoc(doc(limited, 'union_members', 'scope-member-cocha')))
  for (const [collectionId, id] of [
    ['driver_commission_accounts', 'scope-driver'],
    ['driver_commission_records', 'scope-record'],
    ['financial_movements', 'scope-financial'],
  ]) {
    await assertSucceeds(getDoc(doc(full, collectionId, id)))
    await assertFails(updateDoc(doc(full, collectionId, id), { amountCents: 0 }))
    for (const uid of ['scope-limit', 'scope-secretary', 'scope-member', 'scope-support']) {
      const db = testEnv.authenticatedContext(uid, { role: 'directiva_admin' }).firestore()
      await assertFails(getDoc(doc(db, collectionId, id)))
    }
  }
})
