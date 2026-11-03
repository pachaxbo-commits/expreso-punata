process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'

const projectId = process.env.GCLOUD_PROJECT || 'expreso-punata-dev'
process.env.GCLOUD_PROJECT = projectId

import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) {
  initializeApp({ projectId })
}

const db = getFirestore()

// Import dinámico de funciones de backend
const {
  openCashShift,
  createShipment,
  manageVehicle,
  createDispatchManifest,
  driverConfirmCustody,
  receiveDispatchManifest,
  assignShipmentStorage,
  deliverShipment,
  settleDriverCash,
  getDriverCustodyBalance,
  listActiveDrivers,
  manageShelf,
} = await import('../../functions/index.js')

async function runDeliveryLifecycle() {
  console.log('=================================================================')
  console.log('   PRUEBA INTEGRAL DE ENTREGA 3: ENTREGA FINAL, COD Y CUSTODIA   ')
  console.log('   Recorrido: Punata ➔ Manifiesto ➔ Recepción ➔ Entrega y Cobro  ')
  console.log('=================================================================\n')

  // 0. Configurar operadores
  console.log('0. Configurando usuarios autorizados...')
  await db.collection('users').doc('sec-punata-deliv').set({
    uid: 'sec-punata-deliv',
    fullName: 'Ana Secretaria (Punata)',
    email: 'ana.punata@expresopunata.com',
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    isActive: true,
  })

  await db.collection('users').doc('chofer-deliv').set({
    uid: 'chofer-deliv',
    fullName: 'Don Juan Chofer Titular',
    email: 'chofer.deliv@expresopunata.com',
    phone: '71458923',
    role: 'conductor',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    assignedVehiclePlate: '3142-EXP',
    assignedMobileNumber: '07',
    isActive: true,
  })

  await db.collection('users').doc('sec-cbba-deliv').set({
    uid: 'sec-cbba-deliv',
    fullName: 'Carla Secretaria (Cochabamba)',
    email: 'carla.cbba@expresopunata.com',
    role: 'secretaria',
    primaryBranchId: 'cochabamba',
    allowedBranchIds: ['cochabamba'],
    isActive: true,
  })

  await db.collection('users').doc('enc-cbba-deliv').set({
    uid: 'enc-cbba-deliv',
    fullName: 'Mario Encargado (Cochabamba)',
    email: 'mario.cbba@expresopunata.com',
    role: 'encargado_agencia',
    primaryBranchId: 'cochabamba',
    allowedBranchIds: ['cochabamba'],
    isActive: true,
  })
  console.log('   ✓ Usuarios creados.\n')

  // 1. Secretaria Punata abre caja
  console.log('1. Secretaria Punata abre turno de caja con Bs 100...')
  const punShift = await openCashShift.run({
    auth: { uid: 'sec-punata-deliv' },
    data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: `idemp-pun-${Date.now()}` },
  })
  assert.equal(punShift.success, true)
  console.log(`   ✓ Turno Punata: ${punShift.shift.id}\n`)

  // 2. Registrar tres encomiendas: 1 Pagada en origen, 1 Contraentrega ventanilla y 1 Contraentrega en ruta
  console.log('2. Registrando encomiendas en ventanilla Punata...')
  const ship1 = await createShipment.run({
    auth: { uid: 'sec-punata-deliv' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'María Flores', phone: '71000001', docType: 'CI', docNumber: '3456789' },
      recipient: { name: 'Julia Zambrana', phone: '72000002', docType: 'CI', docNumber: '4567890' },
      items: [{ description: 'Documentos legales y ropa', quantity: 1, packaging: 'sobre' }],
      packageCount: 1,
      totalWeightKg: 1.5,
      paymentTiming: 'origin_paid',
      cashShiftId: punShift.shift.id,
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `idemp-s1-${Date.now()}`,
    },
  })
  console.log(`   ✓ Encomienda 1: ${ship1.trackingCode} (Pagada en origen Bs 15.00)`)

  const ship2 = await createShipment.run({
    auth: { uid: 'sec-punata-deliv' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Taller Punata Mecánica', phone: '73000003', docType: 'NIT', docNumber: '102938475' },
      recipient: { name: 'Auto Repuestos Cochabamba', phone: '74000004', docType: 'NIT', docNumber: '987654321' },
      items: [{ description: 'Tambores de freno rectificados', quantity: 2, packaging: 'caja' }],
      packageCount: 2,
      totalWeightKg: 15.0,
      paymentTiming: 'destination_cod',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `idemp-s2-${Date.now()}`,
    },
  })
  console.log(`   ✓ Encomienda 2: ${ship2.trackingCode} (COD contraentrega ventanilla Bs 39.00)`)

  const ship3 = await createShipment.run({
    auth: { uid: 'sec-punata-deliv' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Ferretería Valle Central', phone: '75000005', docType: 'NIT', docNumber: '33445566' },
      recipient: { name: 'Ing. Gonzalo Morales', phone: '76000006', docType: 'CI', docNumber: '55443322' },
      items: [{ description: 'Válvula de presión hidráulica', quantity: 1, packaging: 'caja' }],
      packageCount: 1,
      totalWeightKg: 5.0,
      paymentTiming: 'destination_cod',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `idemp-s3-${Date.now()}`,
    },
  })
  console.log(`   ✓ Encomienda 3: ${ship3.trackingCode} (COD contraentrega en ruta Bs 30.00)\n`)

  // 3. Crear vehículo y despachar manifiesto
  console.log('3. Creando vehículo y despachando manifiesto oficial...')
  const vehRes = await manageVehicle.run({
    auth: { uid: 'enc-cbba-deliv' },
    data: {
      action: 'create',
      vehicleData: {
        mobileNumber: '09',
        plate: '4500-EPX',
        branchId: 'punata',
        brand: 'Mercedes',
        model: 'Sprinter',
        capacityKg: 2000,
        assignedDriverUid: 'chofer-deliv',
        assignedDriverName: 'Don Juan Chofer Titular',
      },
    },
  })

  const manifestRes = await createDispatchManifest.run({
    auth: { uid: 'sec-punata-deliv' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId: vehRes.vehicleId,
      driverUid: 'chofer-deliv',
      shipmentIds: [ship1.shipment.id, ship2.shipment.id, ship3.shipment.id],
      departureNotes: 'Salida con carga consolidada',
    },
  })
  console.log(`   ✓ Manifiesto emitido: ${manifestRes.manifestNumber}\n`)

  // 4. Chofer confirma custodia
  console.log('4. Don Juan Chofer confirma custodia formal de la carga...')
  const custRes = await driverConfirmCustody.run({
    auth: { uid: 'chofer-deliv' },
    data: {
      manifestId: manifestRes.manifestId,
      notes: '4 bultos verificados y asegurados en cabina',
    },
  })
  assert.equal(custRes.driverCustodyStatus, 'accepted')
  console.log(`   ✓ Custodia aceptada por el chofer titular.\n`)

  const testSignaturePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzUAAIpCA/54h55cAAAAAElFTkSuQmCC'

  // 4b. Don Juan entrega Encomienda 3 en ruta y cobra COD de Bs 30.00 en efectivo
  console.log('4b. Don Juan entrega Encomienda 3 en ruta al Ing. Gonzalo Morales y cobra COD...')
  const routeDeliv = await deliverShipment.run({
    auth: { uid: 'chofer-deliv' },
    data: {
      shipmentId: ship3.shipment.id,
      receivedByName: 'Ing. Gonzalo Morales',
      receivedByDocType: 'CI',
      receivedByDocNumber: '55443322',
      recipientRelationship: 'titular',
      signatureDataUrl: testSignaturePng,
      paymentMethod: 'cash',
    },
  })
  assert.equal(routeDeliv.success, true)
  assert.equal(routeDeliv.deliveryChannel, 'route_delivery')
  assert.equal(routeDeliv.paymentCollected, true)

  const custodyCheck = await getDriverCustodyBalance.run({
    auth: { uid: 'chofer-deliv' },
    data: {},
  })
  assert.equal(custodyCheck.account.pendingRemittanceCents, ship3.shipment.finalAmountCents)
  console.log(`   ✓ Encomienda 3 entregada en ruta. Saldo bajo custodia del chofer: Bs ${custodyCheck.account.pendingRemittanceCents / 100}.00\n`)

  // 5. Recepción formal en Cochabamba de las encomiendas 1 y 2
  console.log('5. Secretaria Cochabamba recibe manifiesto en destino...')
  const recRes = await receiveDispatchManifest.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      manifestId: manifestRes.manifestId,
      receptionNotes: 'Arribo a Cochabamba conforme',
      receivedShipments: [
        { shipmentId: ship1.shipment.id, receivedPackages: 1, verifiedPackages: 1, discrepancyType: 'none' },
        { shipmentId: ship2.shipment.id, receivedPackages: 2, verifiedPackages: 2, discrepancyType: 'none' },
        { shipmentId: ship3.shipment.id, receivedPackages: 1, verifiedPackages: 1, discrepancyType: 'none' },
      ],
    },
  })
  assert.equal(recRes.success, true)
  console.log(`   ✓ Manifiesto recibido conforme en Cochabamba.\n`)

  // 6. Almacenamiento dinámico de encomiendas recibidas en ventanilla
  console.log('6. Ubicando encomiendas físicamente en almacén dinámico...')
  const st1 = await assignShipmentStorage.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      shipmentId: ship1.shipment.id,
      shelfId: 'ESTANTE-A',
      shelfName: 'Estante A',
      moduleId: 'MOD-3',
      moduleNumber: 3,
    },
  })
  assert.equal(st1.success, true)

  const st2 = await assignShipmentStorage.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      shipmentId: ship2.shipment.id,
      shelfId: 'ESTANTE-C',
      shelfName: 'Estante C',
      moduleId: 'MOD-1',
      moduleNumber: 1,
    },
  })
  assert.equal(st2.success, true)
  console.log('   ✓ Encomienda 1 guardada en Estante A / Módulo 3')
  console.log('   ✓ Encomienda 2 guardada en Estante C / Módulo 1\n')

  // 7. Entrega final de Encomienda 1 (Pagada en origen)
  console.log('7. Entregando Encomienda 1 a doña Julia Zambrana con firma manuscrita...')
  const deliv1 = await deliverShipment.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      shipmentId: ship1.shipment.id,
      receivedByName: 'Julia Zambrana',
      receivedByDocType: 'CI',
      receivedByDocNumber: '4567890',
      recipientRelationship: 'titular',
      signatureDataUrl: testSignaturePng,
    },
  })
  assert.equal(deliv1.success, true)
  assert.equal(deliv1.paymentCollected, false)

  const postDeliv1 = await db.collection('shipments').doc(ship1.shipment.id).get()
  assert.equal(postDeliv1.data().status, 'delivered')
  assert.equal(postDeliv1.data().storageLocation, null)
  assert.ok(postDeliv1.data().deliveryRecord.signature.storagePath.includes('signatures/signature_'))
  console.log('   ✓ Encomienda 1 entregada conforme. Almacén liberado y firma resguardada en Storage.\n')

  // 8. Intentar entregar Encomienda 2 (COD) SIN turno de caja en destino
  console.log('8. Intentando entregar Encomienda 2 (COD) SIN turno de caja en destino (debe fallar)...')
  await assert.rejects(async () => {
    await deliverShipment.run({
      auth: { uid: 'sec-cbba-deliv' },
      data: {
        shipmentId: ship2.shipment.id,
        receivedByName: 'Carlos Fernández',
        receivedByDocType: 'CI',
        receivedByDocNumber: '5890123',
        recipientRelationship: 'empleado',
        authorizationNote: 'Chofer de Auto Repuestos Cochabamba con autorización',
        signatureDataUrl: testSignaturePng,
        paymentMethod: 'cash',
      },
    })
  }, (err) => {
    assert.equal(err.code, 'failed-precondition')
    console.log(`   ✓ Bloqueado correctamente: "${err.message}"`)
    return true
  })

  // Abrir turno de caja en Cochabamba
  console.log('   Abriendo turno de caja en Cochabamba con Bs 50.00...')
  const cbbaShift = await openCashShift.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: { branchId: 'cochabamba', initialCashCents: 5000, idempotencyKey: `idemp-cbba-${Date.now()}` },
  })
  const cbbaShiftId = cbbaShift.shift.id
  console.log(`   ✓ Turno Cochabamba abierto: ${cbbaShiftId}`)

  // Ahora entrega y cobro contraentrega (COD)
  console.log('   Cobrando COD en efectivo y entregando Encomienda 2...')
  const deliv2 = await deliverShipment.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      shipmentId: ship2.shipment.id,
      receivedByName: 'Carlos Fernández',
      receivedByDocType: 'CI',
      receivedByDocNumber: '5890123',
      recipientRelationship: 'empleado',
      authorizationNote: 'Chofer de Auto Repuestos Cochabamba con autorización',
      signatureDataUrl: testSignaturePng,
      paymentMethod: 'cash',
    },
  })
  assert.equal(deliv2.success, true)
  assert.equal(deliv2.paymentCollected, true)

  const postDeliv2 = await db.collection('shipments').doc(ship2.shipment.id).get()
  assert.equal(postDeliv2.data().status, 'delivered')
  assert.equal(postDeliv2.data().paymentStatus, 'paid')
  assert.equal(postDeliv2.data().paidShiftId, cbbaShiftId)

  const updatedCbbaShift = await db.collection('cash_shifts').doc(cbbaShiftId).get()
  assert.equal(updatedCbbaShift.data().breakdown.codIncomeCents, ship2.shipment.finalAmountCents)
  assert.equal(updatedCbbaShift.data().expectedCashCents, 5000 + ship2.shipment.finalAmountCents)
  console.log(`   ✓ Encomienda 2 entregada. COD de Bs 39.00 ingresado a caja. Total esperado: Bs ${(5000 + ship2.shipment.finalAmountCents) / 100}.00\n`)

  // 9. RENDICIÓN DE CONDUCTOR: Don Juan rinde en caja de Cochabamba con rendición parcial y completa
  console.log('9. Don Juan Conductor realiza rendición parcial de Bs 10.00 en caja de Cochabamba...')
  const settlRes1 = await settleDriverCash.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      driverUid: 'chofer-deliv',
      amountCents: 1000,
      shipmentIds: [ship3.shipment.id],
      notes: 'Rendición parcial de cobro de ruta',
      idempotencyKey: `idemp-settl-part-${Date.now()}`,
    },
  })
  assert.equal(settlRes1.success, true)
  assert.equal(settlRes1.settlementType, 'partial')
  assert.equal(settlRes1.remainingDriverBalanceCents, 500)
  console.log(`   ✓ Rendición parcial completada: Bs ${settlRes1.amountCents / 100}.00. Saldo restante bajo custodia: Bs ${settlRes1.remainingDriverBalanceCents / 100}.00`)

  console.log('   Don Juan completa la rendición con los restantes Bs 5.00...')
  const settlRes2 = await settleDriverCash.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: {
      driverUid: 'chofer-deliv',
      amountCents: 500,
      shipmentIds: [ship3.shipment.id],
      notes: 'Rendición completa final de cobro de ruta',
      idempotencyKey: `idemp-settl-full-${Date.now()}`,
    },
  })
  assert.equal(settlRes2.success, true)
  assert.equal(settlRes2.settlementType, 'full')
  assert.equal(settlRes2.remainingDriverBalanceCents, 0)
  console.log(`   ✓ Transferencia de custodia completada: ${settlRes2.settlementNumber} por Bs ${settlRes2.amountCents / 100}.00`)
  console.log(`   ✓ Saldo restante bajo custodia de Don Juan: Bs ${settlRes2.remainingDriverBalanceCents}.00`)

  const finalCbbaShift = await db.collection('cash_shifts').doc(cbbaShiftId).get()
  const expectedTotal = 5000 + ship2.shipment.finalAmountCents + ship3.shipment.finalAmountCents
  assert.equal(finalCbbaShift.data().expectedCashCents, expectedTotal)
  assert.equal(finalCbbaShift.data().breakdown.driverRemittanceCents, ship3.shipment.finalAmountCents)
  console.log(`   ✓ Caja Cochabamba actualizada con remesa de conductor. Total esperado: Bs ${expectedTotal / 100}.00\n`)

  // 10. Directorio de conductores y estantes
  console.log('10. Verificando directorio privado de conductores y catálogo de estantes...')
  const driversRes = await listActiveDrivers.run({
    auth: { uid: 'sec-cbba-deliv' },
  })
  assert.equal(driversRes.success, true)
  const dirEntry = await db.collection('driver_directory').doc('chofer-deliv').get()
  assert.equal(dirEntry.exists, true)
  assert.equal(dirEntry.data().assignedMobileNumber, '07')

  const shelvesRes = await manageShelf.run({
    auth: { uid: 'sec-cbba-deliv' },
    data: { branchId: 'cochabamba', action: 'list' },
  })
  assert.equal(shelvesRes.success, true)
  assert.equal(shelvesRes.shelves.length, 3)
  console.log(`   ✓ Directorio operativo de conductores verificado: ${driversRes.drivers.length} activos`)
  console.log(`   ✓ Catálogo dinámico de estantes verificado: ${shelvesRes.shelves.length} estantes en Cochabamba\n`)

  console.log('=================================================================')
  console.log('   ¡ESTABILIZACIÓN DE ENTREGA 3 Y CUSTODIA 100% VERIFICADA!       ')
  console.log('=================================================================')
}

runDeliveryLifecycle()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERROR EN PRUEBA DE ENTREGA Y COD:', err)
    process.exit(1)
  })
