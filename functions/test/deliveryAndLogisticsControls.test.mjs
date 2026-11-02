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
  openCashShift,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

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
    'branches',
  ]
  for (const col of collections) {
    const snapshot = await db.collection(col).get()
    const batch = db.batch()
    snapshot.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

before(async () => {
  await clearCollections()
})

beforeEach(async () => {
  await clearCollections()
})

async function createTestUser(uid, role, primaryBranchId, allowedBranchIds = [primaryBranchId], isActive = true, extra = {}) {
  await db.collection('users').doc(uid).set({
    uid,
    fullName: `Test ${uid}`,
    email: `${uid}@expresopunata.com`,
    phone: '71234567',
    role,
    primaryBranchId,
    allowedBranchIds,
    isActive,
    ...extra,
    createdAt: new Date().toISOString(),
  })
}

async function createTestVehicle(id, mobileNumber, plate, branchId = 'punata', status = 'active', assignedDriverUid = null) {
  await db.collection('vehicles').doc(id).set({
    id,
    mobileNumber,
    plate,
    branchId,
    status,
    assignedDriverUid,
    capacityKg: 1500,
    createdAt: new Date().toISOString(),
  })
}

async function createTestShipment(id, trackingCode, originBranchId, destinationBranchId, status = 'received_at_dest', paymentTiming = 'origin_paid', paymentStatus = 'paid', finalAmountCents = 1500) {
  await db.collection('shipments').doc(id).set({
    id,
    trackingCode,
    originBranchId,
    originCity: originBranchId === 'punata' ? 'Punata' : 'Cochabamba',
    destinationBranchId,
    destinationCity: destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Remitente Test', phone: '70000001', docType: 'CI' },
    recipient: { name: 'Destinatario Test', phone: '70000002', docType: 'CI' },
    items: [{ description: 'Caja con repuestos', quantity: 1, packaging: 'caja' }],
    packageCount: 1,
    totalWeightKg: 2.5,
    finalAmountCents,
    paymentTiming,
    paymentStatus,
    status,
    prohibitedGoodsNoticeAccepted: true,
    registeredByUid: 'operador-test',
    createdAt: new Date().toISOString(),
  })
}

test('1. A3 & A2: Custodia estricta del conductor y supervisión documentada en manifiesto', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestUser('chofer-2', 'conductor', 'punata')
  await createTestUser('enc-punata', 'encargado_agencia', 'punata')
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  await createTestShipment('ship-m1', 'PUN-2026-M001', 'punata', 'cochabamba', 'received')

  const manifest = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: 'veh-01',
      driverUid: 'chofer-1',
      shipmentIds: ['ship-m1'],
    },
  })

  // Intento de recepción en destino sin que el chofer haya aceptado custodia
  await assert.rejects(async () => {
    await receiveDispatchManifest.run({
      auth: { uid: 'sec-cbba' },
      data: {
        manifestId: manifest.manifestId,
        receivedShipments: [{ shipmentId: 'ship-m1', receivedPackages: 1, condition: 'good' }],
      },
    })
  }, (err) => err.code === 'failed-precondition')

  // Intento de chofer-2 de aceptar custodia ajena sin override
  await assert.rejects(async () => {
    await driverConfirmCustody.run({
      auth: { uid: 'chofer-2' },
      data: { manifestId: manifest.manifestId },
    })
  }, (err) => err.code === 'permission-denied')

  // Supervisor override con justificación insuficiente (< 10 chars)
  await assert.rejects(async () => {
    await driverConfirmCustody.run({
      auth: { uid: 'enc-punata' },
      data: {
        manifestId: manifest.manifestId,
        supervisorOverride: { reason: 'Corto' },
      },
    })
  }, (err) => err.code === 'permission-denied')

  // Supervisor override con justificación válida (>= 10 chars)
  const custRes = await driverConfirmCustody.run({
    auth: { uid: 'enc-punata' },
    data: {
      manifestId: manifest.manifestId,
      supervisorOverride: { reason: 'Chofer sin batería en celular, verificado en persona en andén.' },
    },
  })
  assert.equal(custRes.success, true)
  assert.equal(custRes.overrideApplied, true)
})

test('2. A2: Validación bulto a bulto en recepción; partially_received no marca pérdida total', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')

  // Encomienda con 3 bultos
  await db.collection('shipments').doc('ship-partial').set({
    id: 'ship-partial',
    trackingCode: 'PUN-2026-PARTIAL',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    packageCount: 3,
    status: 'received',
  })

  const manifest = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: 'veh-01',
      driverUid: 'chofer-1',
      shipmentIds: ['ship-partial'],
    },
  })

  await driverConfirmCustody.run({
    auth: { uid: 'chofer-1' },
    data: { manifestId: manifest.manifestId },
  })

  // Falta nota explicativa en discrepancia de bultos
  await assert.rejects(async () => {
    await receiveDispatchManifest.run({
      auth: { uid: 'sec-cbba' },
      data: {
        manifestId: manifest.manifestId,
        receivedShipments: [{ shipmentId: 'ship-partial', receivedPackages: 2, condition: 'good', notes: 'abc' }],
      },
    })
  }, (err) => err.code === 'invalid-argument')

  // Recepción parcial con nota explicativa conforme
  const recRes = await receiveDispatchManifest.run({
    auth: { uid: 'sec-cbba' },
    data: {
      manifestId: manifest.manifestId,
      receivedShipments: [{
        shipmentId: 'ship-partial',
        receivedPackages: 2,
        condition: 'good',
        notes: 'Llegaron 2 de 3 bultos, 1 rezagado en origen',
      }],
    },
  })

  assert.equal(recRes.success, true)
  const updatedShip = await db.collection('shipments').doc('ship-partial').get()
  assert.equal(updatedShip.data().status, 'partially_received')
  assert.equal(updatedShip.data().arrivedPackages, 2)
})

test('3. A4: listActiveDrivers sincroniza /driver_directory protegiendo la privacidad', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-activo', 'conductor', 'punata', ['punata'], true, {
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
  // Confidencialidad: no debe exponer contraseñas, CIs ni roles internos
  assert.equal(res.drivers[0].ci, undefined)

  // Comprobar colección sincronizada
  const dirDoc = await db.collection('driver_directory').doc('chofer-activo').get()
  assert.equal(dirDoc.exists, true)
  assert.equal(dirDoc.data().fullName, 'Test chofer-activo')
})

test('4. A5: manageShelf auto-inicializa estantes dinámicos y permite personalización', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestUser('enc-cbba', 'encargado_agencia', 'cochabamba')

  // Auto-seed al consultar por primera vez
  const seedRes = await manageShelf.run({
    auth: { uid: 'sec-cbba' },
    data: { branchId: 'cochabamba', action: 'get_or_seed' },
  })

  assert.equal(seedRes.success, true)
  assert.equal(seedRes.shelves.length, 3)
  assert.equal(seedRes.shelves[0].id, 'ESTANTE-A')

  // Encargado agrega estante D personalizado con 8 módulos
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

  const shelfDoc = await db.collection('branches').doc('cochabamba').collection('shelves').doc('ESTANTE-D').get()
  assert.equal(shelfDoc.exists, true)
  assert.equal(shelfDoc.data().name, 'Estante D - Encomiendas Especiales')
})

test('5. ENTREGA FINAL (B1): Entrega conforme de encomienda pagada en origen con firma y liberación de almacén', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestShipment('ship-deliv-1', 'PUN-2026-D001', 'punata', 'cochabamba', 'stored')

  // Ubicación previa en almacén
  await db.collection('shipments').doc('ship-deliv-1').update({
    storageLocation: {
      shelfId: 'ESTANTE-A',
      shelfName: 'Estante A',
      moduleId: 'MOD-2',
      moduleNumber: 2,
    },
  })

  const delivRes = await deliverShipment.run({
    auth: { uid: 'sec-cbba' },
    data: {
      shipmentId: 'ship-deliv-1',
      receivedByName: 'Ana María Torrico',
      receivedByDocType: 'CI',
      receivedByDocNumber: '4839201 Cbba',
      recipientRelationship: 'titular',
      signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    },
  })

  assert.equal(delivRes.success, true)
  assert.equal(delivRes.status, 'delivered')
  assert.equal(delivRes.paymentCollected, false)

  const updatedShip = await db.collection('shipments').doc('ship-deliv-1').get()
  assert.equal(updatedShip.data().status, 'delivered')
  assert.equal(updatedShip.data().storageLocation, null) // Almacén liberado
  assert.equal(updatedShip.data().deliveryRecord.receivedByName, 'Ana María Torrico')
  assert.equal(updatedShip.data().deliveryRecord.receivedByDocNumber, '4839201 Cbba')

  // Subcolección storage_moves registra salida por entrega
  const movesSnap = await db.collection('shipments').doc('ship-deliv-1').collection('storage_moves').get()
  assert.equal(movesSnap.empty, false)
  assert.equal(movesSnap.docs[0].data().type, 'exit_delivery')
})

test('6. ENTREGA FINAL Y COBRO COD (B1): Cobro contraentrega en efectivo vinculado transaccionalmente a turno de caja', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  // Encomienda contraentrega (destination_cod, pending, Bs 35.00 = 3500 cts)
  await createTestShipment('ship-cod-1', 'PUN-2026-COD1', 'punata', 'cochabamba', 'received_at_dest', 'destination_cod', 'pending', 3500)

  // 1. Intento de entrega y cobro en efectivo SIN turno de caja abierto -> DEBE FALLAR
  await assert.rejects(async () => {
    await deliverShipment.run({
      auth: { uid: 'sec-cbba' },
      data: {
        shipmentId: 'ship-cod-1',
        receivedByName: 'Carlos Pérez',
        receivedByDocType: 'CI',
        receivedByDocNumber: '6789123',
        recipientRelationship: 'titular',
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        paymentMethod: 'cash',
      },
    })
  }, (err) => err.code === 'failed-precondition')

  // 2. Secretaria abre turno de caja con Bs 100
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-cbba' },
    data: { branchId: 'cochabamba', initialCashCents: 10000, idempotencyKey: 'idemp-shift-cbba-1' },
  })
  assert.equal(shiftRes.success, true)
  const shiftId = shiftRes.shift.id

  // 3. Ahora realiza la entrega y cobro contraentrega (COD)
  const delivRes = await deliverShipment.run({
    auth: { uid: 'sec-cbba' },
    data: {
      shipmentId: 'ship-cod-1',
      receivedByName: 'Carlos Pérez',
      receivedByDocType: 'CI',
      receivedByDocNumber: '6789123',
      recipientRelationship: 'titular',
      signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      paymentMethod: 'cash',
    },
  })

  assert.equal(delivRes.success, true)
  assert.equal(delivRes.status, 'delivered')
  assert.equal(delivRes.paymentCollected, true)

  // Verificar encomienda marcada como pagada
  const updatedShip = await db.collection('shipments').doc('ship-cod-1').get()
  assert.equal(updatedShip.data().status, 'delivered')
  assert.equal(updatedShip.data().paymentStatus, 'paid')
  assert.equal(updatedShip.data().paidShiftId, shiftId)

  // Verificar turno de caja actualizado con el ingreso COD
  const updatedShift = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(updatedShift.data().breakdown.codIncomeCents, 3500)
  assert.equal(updatedShift.data().breakdown.cashIncomeCents, 3500)
  assert.equal(updatedShift.data().expectedCashCents, 13500) // 10000 apertura + 3500 COD
  assert.equal(updatedShift.data().breakdown.netCashCents, 13500)

  // Verificar movimiento financiero auditable
  const finSnap = await db.collection('financial_movements')
    .where('shiftId', '==', shiftId)
    .where('type', '==', 'cod_income')
    .get()
  assert.equal(finSnap.empty, false)
  assert.equal(finSnap.docs[0].data().amountCents, 3500)
})

test('7. RENDICIÓN DE CONDUCTOR (C1): settleDriverCash ingresa fondos a caja y concilia encomiendas sin duplicar ventas', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestShipment('ship-cust-1', 'PUN-2026-CUST1', 'punata', 'cochabamba', 'delivered', 'destination_cod', 'paid', 2500)

  // Turno de caja abierto en Cochabamba
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-cbba' },
    data: { branchId: 'cochabamba', initialCashCents: 5000, idempotencyKey: 'idemp-shift-cbba-2' },
  })
  const shiftId = shiftRes.shift.id

  // Conductor rinde Bs 25.00 cobrados en ruta
  const settlRes = await settleDriverCash.run({
    auth: { uid: 'sec-cbba' },
    data: {
      driverUid: 'chofer-1',
      amountCents: 2500,
      shipmentIds: ['ship-cust-1'],
      notes: 'Rendición de cobro en ruta Cochabamba',
    },
  })

  assert.equal(settlRes.success, true)
  assert.equal(settlRes.amountCents, 2500)

  // Verificar liquidación registrada
  const settlDoc = await db.collection('driver_settlements').doc(settlRes.settlementId).get()
  assert.equal(settlDoc.exists, true)
  assert.equal(settlDoc.data().driverUid, 'chofer-1')
  assert.equal(settlDoc.data().amountCents, 2500)

  // Verificar que la encomienda quedó conciliada
  const updatedShip = await db.collection('shipments').doc('ship-cust-1').get()
  assert.equal(updatedShip.data().driverCustody.reconciled, true)
  assert.equal(updatedShip.data().driverCustody.settlementId, settlRes.settlementId)

  // Verificar turno de caja con ingreso de remesa de chofer
  const updatedShift = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(updatedShift.data().breakdown.cashIncomeCents, 2500)
  assert.equal(updatedShift.data().expectedCashCents, 7500) // 5000 + 2500
})
