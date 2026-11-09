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
} from '../index.js'

// Configurar conexión a emuladores locales
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-manifest-test' })
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

async function createTestUser(uid, role, primaryBranchId, allowedBranchIds = [primaryBranchId], isActive = true) {
  await db.collection('users').doc(uid).set({
    uid,
    fullName: `Test ${uid}`,
    email: `${uid}@expresopunata.com`,
    phone: '71234567',
    role,
    primaryBranchId,
    allowedBranchIds,
    isActive,
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

async function createTestShipment(id, trackingCode, originBranchId, destinationBranchId, status = 'received', paymentTiming = 'origin_paid', paymentStatus = 'paid', finalAmountCents = 1500) {
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

test('1. DESPACHO: Secretaria de Punata crea manifiesto de despacho atómico con correlativo MAN-PUN', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  await createTestShipment('ship-01', 'PUN-2026-00001', 'punata', 'cochabamba', 'received')
  await createTestShipment('ship-02', 'PUN-2026-00002', 'punata', 'cochabamba', 'pending_dispatch', 'destination_cod', 'pending', 3500)

  const res = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: 'veh-01',
      driverUid: 'chofer-1',
      shipmentIds: ['ship-01', 'ship-02'],
      departureNotes: 'Salida turno mañana sin novedad',
    },
  })

  assert.equal(res.success, true)
  assert.match(res.manifestNumber, /^MAN-PUN-\d{4}-\d{4}$/)
  assert.equal(res.totalShipments, 2)
  assert.equal(res.totalPackages, 2)
  assert.equal(res.totalWeightKg, 5)
  assert.equal(res.totalCodAmountCents, 3500)

  // Verificar estado del manifiesto en Firestore
  const manifestDoc = await db.collection('manifests').doc(res.manifestId).get()
  assert.equal(manifestDoc.exists, true)
  const mData = manifestDoc.data()
  assert.equal(mData.status, 'dispatched')
  assert.equal(mData.driverCustodyStatus, 'pending')
  assert.equal(mData.driverUid, 'chofer-1')
  assert.equal(mData.vehiclePlate, '4589-KLP')

  // Verificar encomiendas en tránsito
  const s1Doc = await db.collection('shipments').doc('ship-01').get()
  assert.equal(s1Doc.data().status, 'in_transit')
  assert.equal(s1Doc.data().manifestId, res.manifestId)
  assert.equal(s1Doc.data().assignedVehicle.vehiclePlate, '4589-KLP')

  const s2Doc = await db.collection('shipments').doc('ship-02').get()
  assert.equal(s2Doc.data().status, 'in_transit')
  assert.equal(s2Doc.data().manifestId, res.manifestId)

  // Verificar logs de estado
  const logs1 = await db.collection('shipments').doc('ship-01').collection('status_logs').get()
  assert.equal(logs1.empty, false)
  assert.equal(logs1.docs[0].data().status, 'in_transit')
})

test('2. SEGURIDAD DE DESPACHO: Chofer o secretaria ajena NO pueden emitir manifiesto', async () => {
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  await createTestShipment('ship-01', 'PUN-2026-00001', 'punata', 'cochabamba', 'received')

  // Conductor intenta despachar
  await assert.rejects(async () => {
    await createDispatchManifest.run({
      auth: { uid: 'chofer-1' },
      data: {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        vehicleId: 'veh-01',
        driverUid: 'chofer-1',
        shipmentIds: ['ship-01'],
      },
    })
  }, (err) => err.code === 'permission-denied')

  // Secretaria de Cochabamba intenta despachar desde Punata
  await assert.rejects(async () => {
    await createDispatchManifest.run({
      auth: { uid: 'sec-cbba' },
      data: {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        vehicleId: 'veh-01',
        driverUid: 'chofer-1',
        shipmentIds: ['ship-01'],
      },
    })
  }, (err) => err.code === 'permission-denied')
})

test('3. INTEGRIDAD: No permite despachar encomienda de destino diferente ni en estado inválido', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  // Encomienda ya entregada
  await createTestShipment('ship-delivered', 'PUN-2026-00099', 'punata', 'cochabamba', 'delivered')

  await assert.rejects(async () => {
    await createDispatchManifest.run({
      auth: { uid: 'sec-punata' },
      data: {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        vehicleId: 'veh-01',
        driverUid: 'chofer-1',
        shipmentIds: ['ship-delivered'],
      },
    })
  }, (err) => err.code === 'failed-precondition')
})

test('4. INTEGRIDAD: Previene que una encomienda sea asignada a dos viajes activos simultáneos', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  // Encomienda ya en tránsito
  await createTestShipment('ship-transit', 'PUN-2026-00088', 'punata', 'cochabamba', 'in_transit')
  await db.collection('shipments').doc('ship-transit').update({ manifestId: 'MAN-PREVIO' })

  await assert.rejects(async () => {
    await createDispatchManifest.run({
      auth: { uid: 'sec-punata' },
      data: {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        vehicleId: 'veh-01',
        driverUid: 'chofer-1',
        shipmentIds: ['ship-transit'],
      },
    })
  }, (err) => err.code === 'failed-precondition')
})

test('5. CUSTODIA DEL CONDUCTOR: Chofer asignado confirma recepción de carga en tránsito', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestUser('chofer-intruso', 'conductor', 'punata')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  await createTestShipment('ship-01', 'PUN-2026-00001', 'punata', 'cochabamba', 'received')

  const manifest = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: 'veh-01',
      driverUid: 'chofer-1',
      shipmentIds: ['ship-01'],
    },
  })

  // Chofer intruso intenta aceptar la custodia ajena
  await assert.rejects(async () => {
    await driverConfirmCustody.run({
      auth: { uid: 'chofer-intruso' },
      data: { manifestId: manifest.manifestId },
    })
  }, (err) => err.code === 'permission-denied')

  // Chofer asignado acepta la custodia conforme
  const custodyRes = await driverConfirmCustody.run({
    auth: { uid: 'chofer-1' },
    data: {
      manifestId: manifest.manifestId,
      notes: 'Bultos contados y asegurados en el móvil',
    },
  })

  assert.equal(custodyRes.success, true)
  assert.equal(custodyRes.driverCustodyStatus, 'accepted')

  const updatedM = await db.collection('manifests').doc(manifest.manifestId).get()
  assert.equal(updatedM.data().driverCustodyStatus, 'accepted')
  assert.equal(updatedM.data().driverCustodyNotes, 'Bultos contados y asegurados en el móvil')
})

test('6. RECEPCIÓN EN DESTINO: Secretaria de Cochabamba recibe manifiesto y actualiza estado de encomiendas', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  await createTestShipment('ship-01', 'PUN-2026-00001', 'punata', 'cochabamba', 'received')

  const manifest = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: 'veh-01',
      driverUid: 'chofer-1',
      shipmentIds: ['ship-01'],
    },
  })

  // Chofer confirma custodia
  await driverConfirmCustody.run({
    auth: { uid: 'chofer-1' },
    data: { manifestId: manifest.manifestId },
  })

  // CONTROL CRÍTICO: Chofer NO puede auto-firmar la recepción en destino
  await assert.rejects(async () => {
    await receiveDispatchManifest.run({
      auth: { uid: 'chofer-1' },
      data: {
        manifestId: manifest.manifestId,
        receivedShipments: [{ shipmentId: 'ship-01', receivedPackages: 1, condition: 'good' }],
      },
    })
  }, (err) => err.code === 'permission-denied')

  // Secretaria de Cochabamba recibe la carga conforme
  const recRes = await receiveDispatchManifest.run({
    auth: { uid: 'sec-cbba' },
    data: {
      manifestId: manifest.manifestId,
      receptionNotes: 'Llegada puntual en ventanilla Cochabamba',
      receivedShipments: [{ shipmentId: 'ship-01', receivedPackages: 1, condition: 'good' }],
    },
  })

  assert.equal(recRes.success, true)
  assert.equal(recRes.discrepanciesCount, 0)

  // Verificar encomienda en destino
  const sDoc = await db.collection('shipments').doc('ship-01').get()
  assert.equal(sDoc.data().status, 'received_at_dest')
  assert.equal(sDoc.data().currentLocation, 'cochabamba')

  // Verificar manifiesto cerrado
  const mDoc = await db.collection('manifests').doc(manifest.manifestId).get()
  assert.equal(mDoc.data().status, 'received')
  assert.equal(mDoc.data().receivedByUid, 'sec-cbba')
})

test('7. RECEPCIÓN CON DISCREPANCIAS: Registra faltantes y daños con auditoría inmutable', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('chofer-1', 'conductor', 'punata')
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestVehicle('veh-01', '12', '4589-KLP', 'punata', 'active', 'chofer-1')
  await createTestShipment('ship-good', 'PUN-2026-00010', 'punata', 'cochabamba', 'received')
  await createTestShipment('ship-damaged', 'PUN-2026-00011', 'punata', 'cochabamba', 'received')
  await createTestShipment('ship-missing', 'PUN-2026-00012', 'punata', 'cochabamba', 'received')

  const manifest = await createDispatchManifest.run({
    auth: { uid: 'sec-punata' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: 'veh-01',
      driverUid: 'chofer-1',
      shipmentIds: ['ship-good', 'ship-damaged', 'ship-missing'],
    },
  })

  await driverConfirmCustody.run({
    auth: { uid: 'chofer-1' },
    data: { manifestId: manifest.manifestId },
  })

  const recRes = await receiveDispatchManifest.run({
    auth: { uid: 'sec-cbba' },
    data: {
      manifestId: manifest.manifestId,
      receptionNotes: 'Recepción con observaciones',
      receivedShipments: [
        { shipmentId: 'ship-good', receivedPackages: 1, condition: 'good' },
        { shipmentId: 'ship-damaged', receivedPackages: 1, condition: 'damaged', notes: 'Caja abollada por traslado' },
        { shipmentId: 'ship-missing', receivedPackages: 0, condition: 'missing', notes: 'No bajó del vehículo' },
      ],
    },
  })

  assert.equal(recRes.success, true)
  assert.equal(recRes.discrepanciesCount, 2)

  // Encomienda con daño
  const damagedDoc = await db.collection('shipments').doc('ship-damaged').get()
  assert.equal(damagedDoc.data().status, 'received_at_dest')
  assert.match(damagedDoc.data().incidentNotes, /abollada/)

  // Encomienda faltante
  const missingDoc = await db.collection('shipments').doc('ship-missing').get()
  assert.equal(missingDoc.data().status, 'lost')

  // Discrepancias en manifiesto
  const mDoc = await db.collection('manifests').doc(manifest.manifestId).get()
  assert.equal(mDoc.data().discrepancies.length, 2)
})

test('8. ALMACÉN REAL: Asigna físicamente encomienda a estante y módulo en sucursal destino', async () => {
  await createTestUser('sec-cbba', 'secretaria', 'cochabamba')
  await createTestShipment('ship-01', 'PUN-2026-00001', 'punata', 'cochabamba', 'received_at_dest')

  const res = await assignShipmentStorage.run({
    auth: { uid: 'sec-cbba' },
    data: {
      shipmentId: 'ship-01',
      shelfId: 'ESTANTE-A',
      shelfName: 'Estante A - General',
      moduleId: 'MOD-2',
      moduleNumber: 2,
      position: 'Fila intermedia',
    },
  })

  assert.equal(res.success, true)
  assert.equal(res.storageLocation.shelfId, 'ESTANTE-A')
  assert.equal(res.storageLocation.moduleNumber, 2)

  // Verificar en base de datos
  const sDoc = await db.collection('shipments').doc('ship-01').get()
  assert.equal(sDoc.data().status, 'stored')
  assert.equal(sDoc.data().storageLocation.shelfId, 'ESTANTE-A')
  assert.equal(sDoc.data().storageLocation.moduleNumber, 2)

  // Verificar subcolección storage_moves
  const moves = await db.collection('shipments').doc('ship-01').collection('storage_moves').get()
  assert.equal(moves.empty, false)
  assert.equal(moves.docs[0].data().shelfId, 'ESTANTE-A')
})

test('9. GESTIÓN DE FLOTA: manageVehicle crea móvil y valida unicidad de placa y número interno', async () => {
  await createTestUser('enc-punata', 'encargado_agencia', 'punata')

  const createRes = await manageVehicle.run({
    auth: { uid: 'enc-punata' },
    data: {
      action: 'create',
      vehicleData: {
        mobileNumber: '05',
        plate: '2890-XYZ',
        branchId: 'punata',
        brand: 'Toyota',
        model: 'HiAce',
        capacityKg: 1200,
      },
    },
  })

  assert.equal(createRes.success, true)
  assert.equal(createRes.mobileNumber, '05')
  assert.equal(createRes.plate, '2890-XYZ')

  // Intento de duplicar placa
  await assert.rejects(async () => {
    await manageVehicle.run({
      auth: { uid: 'enc-punata' },
      data: {
        action: 'create',
        vehicleData: {
          mobileNumber: '06',
          plate: '2890-XYZ', // Misma placa
          branchId: 'punata',
        },
      },
    })
  }, (err) => err.code === 'already-exists')

  // Intento de duplicar número interno
  await assert.rejects(async () => {
    await manageVehicle.run({
      auth: { uid: 'enc-punata' },
      data: {
        action: 'create',
        vehicleData: {
          mobileNumber: '05', // Mismo móvil
          plate: '3000-ABC',
          branchId: 'punata',
        },
      },
    })
  }, (err) => err.code === 'already-exists')
})
