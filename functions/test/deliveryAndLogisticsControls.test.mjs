import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  createDispatchManifest,
  driverConfirmCustody,
  receiveDispatchManifest,
  assignShipmentStorage,
  manageVehicle,
  listActiveDrivers,
  manageShelf,
  deliverShipment,
  settleDriverCash,
  getDriverCustodyBalance,
  openCashShift,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-delivery-test' })
}

const db = getFirestore()

async function clearCollections() {
  const collections = [
    'users',
    'vehicles',
    'manifests',
    'shipments',
    'counters',
    'audit_logs',
    'idempotency_keys',
    'cash_shifts',
    'cash_shift_active_locks',
    'financial_movements',
    'driver_directory',
    'driver_settlements',
    'driver_custody_accounts',
    'driver_custody_records',
  ]
  for (const coll of collections) {
    const snap = await db.collection(coll).get()
    const batch = db.batch()
    snap.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
}

async function createTestUser(uid, role, primaryBranchId = 'punata', allowedBranchIds = null, isActive = true, extra = {}) {
  const allowed = allowedBranchIds || [primaryBranchId]
  await db.collection('users').doc(uid).set({
    uid,
    role,
    primaryBranchId,
    allowedBranchIds: allowed,
    isActive,
    fullName: `Test ${uid}`,
    email: `${uid}@expresopunata.com`,
    ...extra,
  })
}

async function createTestShipment(id, trackingCode, originBranchId, destinationBranchId, status, paymentTiming = 'origin_paid', paymentStatus = 'paid', finalAmountCents = 2500, extra = {}) {
  await db.collection('shipments').doc(id).set({
    id,
    trackingCode,
    originBranchId,
    destinationBranchId,
    status,
    paymentTiming,
    paymentStatus,
    finalAmountCents,
    totalWeightKg: 5,
    packageCount: extra.packageCount || extra.itemsCount || 1,
    itemsCount: extra.itemsCount || 1,
    declaredValueBob: 100,
    sender: { name: 'Remitente Test', phone: '70000001' },
    recipient: { name: 'Destinatario Test', phone: '70000002', docType: 'CI', docNumber: '1234567' },
    createdAt: FieldValue.serverTimestamp(),
    ...extra,
  })
}

beforeEach(async () => {
  await clearCollections()
})

test('1. A3 & A2: Custodia estricta del conductor y supervisión documentada en manifiesto', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-titular', 'conductor', 'punata', ['punata', 'cochabamba'])
  await createTestUser('chofer-impostor', 'conductor', 'punata', ['punata', 'cochabamba'])
  await createTestUser('enc-punata', 'encargado_agencia', 'punata')

  const vRes = await manageVehicle.run({
    auth: { uid: 'enc-punata' },
    data: {
      action: 'create',
      vehicleData: {
        plate: '2849-XYZ',
        mobileNumber: '19',
        brand: 'Toyota Coaster',
        capacityKg: 3500,
        assignedDriverUid: 'chofer-titular',
        assignedDriverName: 'Test chofer-titular',
      },
    },
  })

  await createTestShipment('ship-1', 'PUN-2026-0001', 'punata', 'cochabamba', 'received')

  const manRes = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: vRes.vehicleId,
      driverUid: 'chofer-titular',
      shipmentIds: ['ship-1'],
    },
  })
  const manifestId = manRes.manifestId

  await assert.rejects(async () => {
    await driverConfirmCustody.run({
      auth: { uid: 'chofer-impostor' },
      data: { manifestId },
    })
  }, (err) => err.code === 'permission-denied')

  const custRes = await driverConfirmCustody.run({
    auth: { uid: 'chofer-titular' },
    data: { manifestId },
  })
  assert.equal(custRes.success, true)
  assert.equal(custRes.driverCustodyStatus, 'accepted')
})

test('2. A2: Validación bulto a bulto en recepción; partially_received no marca pérdida total', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('enc-punata', 'encargado_agencia', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata', ['punata', 'cochabamba'])
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')

  const vehRes = await manageVehicle.run({
    auth: { uid: 'enc-punata' },
    data: {
      action: 'create',
      vehicleData: {
        plate: '1122-EXP',
        mobileNumber: '05',
        brand: 'Mercedes',
        capacityKg: 4000,
        assignedDriverUid: 'chofer-1',
        assignedDriverName: 'Test chofer-1',
      },
    },
  })

  await createTestShipment('ship-p1', 'PUN-2026-P001', 'punata', 'cochabamba', 'received', 'origin_paid', 'paid', 2000, { itemsCount: 3 })
  await createTestShipment('ship-p2', 'PUN-2026-P002', 'punata', 'cochabamba', 'received', 'origin_paid', 'paid', 2000, { itemsCount: 1 })

  const manRes = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: vehRes.vehicleId,
      driverUid: 'chofer-1',
      shipmentIds: ['ship-p1', 'ship-p2'],
    },
  })
  const manifestId = manRes.manifestId

  await driverConfirmCustody.run({
    auth: { uid: 'chofer-1' },
    data: { manifestId },
  })

  const recRes = await receiveDispatchManifest.run({
    auth: { uid: 'sec-cbba' },
    data: {
      manifestId,
      receptionNotes: 'Recepción con faltante en paquete 1',
      receivedShipments: [
        {
          shipmentId: 'ship-p1',
          receivedPackages: 2,
          condition: 'missing',
          discrepancyType: 'missing_package',
          notes: 'Llegaron 2 de 3 bultos; falta caja de cartón',
        },
        {
          shipmentId: 'ship-p2',
          receivedPackages: 1,
          discrepancyType: 'none',
        },
      ],
    },
  })

  assert.equal(recRes.success, true)
  assert.equal(recRes.totalDiscrepancies, 1)

  const s1 = await db.collection('shipments').doc('ship-p1').get()
  assert.equal(s1.data().status, 'partially_received')
  assert.notEqual(s1.data().status, 'lost')

  const s2 = await db.collection('shipments').doc('ship-p2').get()
  assert.equal(s2.data().status, 'received_at_dest')
})

test('3. A4: listActiveDrivers sincroniza /driver_directory protegiendo la privacidad', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-activo', 'conductor', 'punata', ['punata'], true, {
    ci: '5566778 Cbba',
    phone: '77788990',
    assignedVehiclePlate: '1234-ABC',
    assignedMobileNumber: '08',
  })
  await createTestUser('chofer-inactivo', 'conductor', 'punata', ['punata'], false)

  const res = await listActiveDrivers.run({
    auth: { uid: 'sec-punata' },
  })

  assert.equal(res.success, true)
  assert.equal(res.drivers.length, 1)
  assert.equal(res.drivers[0].uid, 'chofer-activo')
  assert.equal(res.drivers[0].assignedVehiclePlate, '1234-ABC')
  assert.equal(res.drivers[0].ci, undefined)

  const dirDoc = await db.collection('driver_directory').doc('chofer-activo').get()
  assert.equal(dirDoc.exists, true)
  assert.equal(dirDoc.data().fullName, 'Test chofer-activo')
})

test('4. A5: manageShelf auto-inicializa estantes dinámicos y permite personalización', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestUser('enc-cbba', 'encargado_agencia', 'cochabamba')

  const seedRes = await manageShelf.run({
    auth: { uid: 'sec-cbba' },
    data: { branchId: 'cochabamba', action: 'get_or_seed' },
  })

  assert.equal(seedRes.success, true)
  assert.equal(seedRes.shelves.length, 3)
  assert.equal(seedRes.shelves[0].id, 'ESTANTE-A')

  const customRes = await manageShelf.run({
    auth: { uid: 'enc-cbba' },
    data: {
      branchId: 'cochabamba',
      action: 'create_or_update',
      shelfData: {
        id: 'ESTANTE-D',
        name: 'Estante D - Encomiendas Especiales',
        moduleCount: 8,
      },
    },
  })

  assert.equal(customRes.success, true)
  assert.equal(customRes.shelf.moduleCount, 8)
})

test('5. ENTREGA FINAL (B1): Entrega conforme de encomienda pagada en origen con firma en Storage y liberación de almacén', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestShipment('ship-deliv-1', 'PUN-2026-D001', 'punata', 'cochabamba', 'stored')

  await db.collection('shipments').doc('ship-deliv-1').update({
    storageLocation: {
      shelfId: 'ESTANTE-A',
      shelfName: 'Estante A',
      moduleId: 'MOD-2',
      moduleNumber: 2,
    },
  })

  // Firma válida PNG base64
  const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzUAAIpCA/54h55cAAAAAElFTkSuQmCC'

  const delivRes = await deliverShipment.run({
    auth: { uid: 'sec-cbba' },
    data: {
      shipmentId: 'ship-deliv-1',
      receivedByName: 'Ana María Torrico',
      receivedByDocType: 'CI',
      receivedByDocNumber: '4839201 Cbba',
      recipientRelationship: 'titular',
      signatureDataUrl: testPng,
    },
  })

  assert.equal(delivRes.success, true)
  assert.equal(delivRes.status, 'delivered')
  assert.equal(delivRes.paymentCollected, false)

  const updatedShip = await db.collection('shipments').doc('ship-deliv-1').get()
  const sData = updatedShip.data()
  assert.equal(sData.status, 'delivered')
  assert.equal(sData.storageLocation, null)
  assert.equal(sData.deliveryRecord.receivedByName, 'Ana María Torrico')
  // Confirma que NO se guarda Base64 en Firestore, sino metadatos y referencia a Firebase Storage
  assert.equal(sData.deliveryRecord.signatureDataUrl, undefined)
  assert.ok(sData.deliveryRecord.signature.storagePath.includes('signatures/signature_'))
  assert.equal(sData.deliveryRecord.signature.mimeType, 'image/png')
  assert.equal(sData.deliveryRecord.signature.verified, true)
})

test('6. ENTREGA FINAL Y COBRO COD (B1): Cobro contraentrega en ventanilla vinculado a turno de caja', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestShipment('ship-cod-1', 'PUN-2026-COD1', 'punata', 'cochabamba', 'received_at_dest', 'destination_cod', 'pending', 3500)

  const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzUAAIpCA/54h55cAAAAAElFTkSuQmCC'

  // 1. Intento de entrega y cobro en ventanilla SIN turno de caja abierto -> DEBE FALLAR
  await assert.rejects(async () => {
    await deliverShipment.run({
      auth: { uid: 'sec-cbba' },
      data: {
        shipmentId: 'ship-cod-1',
        receivedByName: 'Carlos Pérez',
        receivedByDocType: 'CI',
        receivedByDocNumber: '6789123',
        recipientRelationship: 'titular',
        signatureDataUrl: testPng,
        paymentMethod: 'cash',
      },
    })
  }, (err) => err.code === 'failed-precondition')

  // 2. Secretaria abre turno de caja con Bs 100
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-cbba' },
    data: { branchId: 'cochabamba', initialCashCents: 10000, idempotencyKey: 'idemp-shift-cbba-1' },
  })
  const shiftId = shiftRes.shift.id

  // 3. Realizar entrega y cobro en ventanilla
  const delivRes = await deliverShipment.run({
    auth: { uid: 'sec-cbba' },
    data: {
      shipmentId: 'ship-cod-1',
      receivedByName: 'Carlos Pérez',
      receivedByDocType: 'CI',
      receivedByDocNumber: '6789123',
      recipientRelationship: 'titular',
      signatureDataUrl: testPng,
      paymentMethod: 'cash',
    },
  })

  assert.equal(delivRes.success, true)
  assert.equal(delivRes.paymentCollected, true)

  const updatedShip = await db.collection('shipments').doc('ship-cod-1').get()
  assert.equal(updatedShip.data().status, 'delivered')
  assert.equal(updatedShip.data().paymentStatus, 'paid')
  assert.equal(updatedShip.data().paidShiftId, shiftId)

  const updatedShift = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(updatedShift.data().breakdown.codIncomeCents, 3500)
  assert.equal(updatedShift.data().expectedCashCents, 13500) // 10000 + 3500
})

test('7. COBRO EN RUTA POR CONDUCTOR (B2): Conductor entrega encomienda COD en ruta, actualiza custodia y no toca caja de ventanilla', async () => {
  await createTestUser('chofer-ruta', 'conductor', 'punata', ['punata', 'cochabamba'])
  await createTestShipment('ship-ruta-1', 'PUN-2026-RUTA1', 'punata', 'cochabamba', 'in_transit', 'destination_cod', 'pending', 4000, {
    assignedVehicle: { driverUid: 'chofer-ruta', plate: '3344-XYZ' }
  })

  const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzUAAIpCA/54h55cAAAAAElFTkSuQmCC'

  // Conductor completa entrega en ruta con cobro COD de Bs 40.00
  const delivRes = await deliverShipment.run({
    auth: { uid: 'chofer-ruta' },
    data: {
      shipmentId: 'ship-ruta-1',
      receivedByName: 'Pedro Rojas',
      receivedByDocType: 'CI',
      receivedByDocNumber: '5566778',
      recipientRelationship: 'titular',
      signatureDataUrl: testPng,
      paymentMethod: 'cash',
    },
  })

  assert.equal(delivRes.success, true)
  assert.equal(delivRes.deliveryChannel, 'route_delivery')
  assert.equal(delivRes.paymentCollected, true)

  // Encomienda entregada y cobrada por el conductor
  const sDoc = await db.collection('shipments').doc('ship-ruta-1').get()
  assert.equal(sDoc.data().status, 'delivered')
  assert.equal(sDoc.data().paymentStatus, 'paid')
  assert.equal(sDoc.data().collectedByDriverUid, 'chofer-ruta')
  assert.equal(sDoc.data().driverCustody.inCustody, true)
  assert.equal(sDoc.data().driverCustody.reconciled, false)

  // Libro de custodia del conductor actualizado con Bs 40.00
  const custodyDoc = await db.collection('driver_custody_accounts').doc('chofer-ruta').get()
  assert.equal(custodyDoc.exists, true)
  assert.equal(custodyDoc.data().pendingRemittanceCents, 4000)
  assert.equal(custodyDoc.data().cashUnderCustodyCents, 4000)

  // Asiento registrado en driver_custody_records
  const recSnap = await db.collection('driver_custody_records').where('driverUid', '==', 'chofer-ruta').get()
  assert.equal(recSnap.empty, false)
  assert.equal(recSnap.docs[0].data().amountCents, 4000)
  assert.equal(recSnap.docs[0].data().status, 'pending_remittance')

  // Movimiento financiero de custodia de conductor
  const finSnap = await db.collection('financial_movements').where('driverUid', '==', 'chofer-ruta').get()
  assert.equal(finSnap.empty, false)
  assert.equal(finSnap.docs[0].data().type, 'driver_route_cod_collected')
  assert.equal(finSnap.docs[0].data().amountCents, 4000)
})

test('8. RENDICIÓN DE CONDUCTOR (C1): Transferencia interna de custodia en caja con validación estricta de saldo', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestUser('chofer-2', 'conductor', 'punata')

  // Configurar custodia previa de Bs 30.00 en la cuenta del conductor
  await db.collection('driver_custody_accounts').doc('chofer-2').set({
    driverUid: 'chofer-2',
    driverName: 'Test chofer-2',
    cashUnderCustodyCents: 3000,
    pendingRemittanceCents: 3000,
    totalCollectedCents: 3000,
    totalRemittedCents: 0,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await db.collection('driver_custody_records').doc('REC-TEST-1').set({
    id: 'REC-TEST-1',
    driverUid: 'chofer-2',
    driverName: 'Test chofer-2',
    type: 'route_collection',
    amountCents: 3000,
    remittedAmountCents: 0,
    status: 'pending_remittance',
    settlementIds: [],
    createdAt: FieldValue.serverTimestamp(),
  })

  await createTestShipment('ship-cust-2', 'PUN-2026-CUST2', 'punata', 'cochabamba', 'delivered', 'destination_cod', 'paid', 3000, {
    collectedByDriverUid: 'chofer-2',
    driverCustody: { inCustody: true, reconciled: false },
  })

  // Turno de caja abierto en Cochabamba con Bs 50
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-cbba' },
    data: { branchId: 'cochabamba', initialCashCents: 5000, idempotencyKey: 'idemp-shift-cbba-2' },
  })
  const shiftId = shiftRes.shift.id

  // Intento de rendir más de lo disponible (Bs 50 > Bs 30) -> DEBE FALLAR
  await assert.rejects(async () => {
    await settleDriverCash.run({
      auth: { uid: 'sec-cbba' },
      data: {
        driverUid: 'chofer-2',
        amountCents: 5000,
        shipmentIds: ['ship-cust-2'],
      },
    })
  }, (err) => err.code === 'failed-precondition')

  // Rendición legítima de Bs 30.00
  const settlRes = await settleDriverCash.run({
    auth: { uid: 'sec-cbba' },
    data: {
      driverUid: 'chofer-2',
      amountCents: 3000,
      shipmentIds: ['ship-cust-2'],
      notes: 'Rendición conforme de cobros en ruta',
    },
  })

  assert.equal(settlRes.success, true)
  assert.equal(settlRes.amountCents, 3000)
  assert.equal(settlRes.remainingDriverBalanceCents, 0)

  // Saldo de custodia del conductor actualizado a 0
  const updatedCustody = await db.collection('driver_custody_accounts').doc('chofer-2').get()
  assert.equal(updatedCustody.data().pendingRemittanceCents, 0)
  assert.equal(updatedCustody.data().totalRemittedCents, 3000)

  // Encomienda marcada formalmente como conciliada
  const updatedShip = await db.collection('shipments').doc('ship-cust-2').get()
  assert.equal(updatedShip.data().driverCustody.reconciled, true)
  assert.equal(updatedShip.data().driverCustody.settlementId, settlRes.settlementId)

  // Turno de caja: aumenta efectivo en gaveta (5000 + 3000 = 8000), pero NO duplica totalIncomeCents
  const updatedShift = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(updatedShift.data().expectedCashCents, 8000)
  assert.equal(updatedShift.data().breakdown.driverRemittanceCents, 3000)
  assert.equal(updatedShift.data().breakdown.totalIncomeCents, 0) // No duplica ventas comerciales
})

test('9. CONSULTA DE CUSTODIA (getDriverCustodyBalance): Conductor y cajero consultan estado en tiempo real', async () => {
  await createTestUser('chofer-3', 'conductor', 'punata')
  await createTestUser('sec-punata', 'secretaria', 'punata')

  await db.collection('driver_custody_accounts').doc('chofer-3').set({
    driverUid: 'chofer-3',
    driverName: 'Test chofer-3',
    cashUnderCustodyCents: 1500,
    pendingRemittanceCents: 1500,
    totalCollectedCents: 1500,
    totalRemittedCents: 0,
    updatedAt: FieldValue.serverTimestamp(),
  })

  // Conductor consulta su propio saldo
  const balanceRes = await getDriverCustodyBalance.run({
    auth: { uid: 'chofer-3' },
    data: {},
  })
  assert.equal(balanceRes.account.pendingRemittanceCents, 1500)

  // Cajera consulta saldo del conductor
  const cashierView = await getDriverCustodyBalance.run({
    auth: { uid: 'sec-punata' },
    data: { driverUid: 'chofer-3' },
  })
  assert.equal(cashierView.account.pendingRemittanceCents, 1500)
})
