process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

const projectId = process.env.GCLOUD_PROJECT || 'expreso-punata-dev'
process.env.GCLOUD_PROJECT = projectId

import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) {
  initializeApp({ projectId })
}

const db = getFirestore()

// Import dinámico de funciones
const {
  openCashShift,
  createShipment,
  manageVehicle,
  createDispatchManifest,
  driverConfirmCustody,
  receiveDispatchManifest,
  assignShipmentStorage,
} = await import('../../functions/index.js')

async function runLogisticsLifecycle() {
  console.log('=================================================================')
  console.log('   PRUEBA INTEGRAL DE CICLO DE VIDA LOGÍSTICO (ENTREGA 2)        ')
  console.log('   Recorrido: Punata ➔ En Ruta ➔ Cochabamba                      ')
  console.log('=================================================================\n')

  // 0. Crear usuarios con roles verdaderos y sucursales
  console.log('0. Configurando usuarios autorizados de desarrollo...')
  await db.collection('users').doc('sec-punata-e2e').set({
    uid: 'sec-punata-e2e',
    fullName: 'Ana María Secretaria (Punata)',
    email: 'sec.punata@expresopunata.com',
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    isActive: true,
  })

  await db.collection('users').doc('chofer-e2e').set({
    uid: 'chofer-e2e',
    fullName: 'Don Juan Conductor',
    email: 'chofer.juan@expresopunata.com',
    phone: '71458923',
    role: 'conductor',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
  })

  await db.collection('users').doc('sec-cbba-e2e').set({
    uid: 'sec-cbba-e2e',
    fullName: 'Carla Secretaria (Cochabamba)',
    email: 'sec.cbba@expresopunata.com',
    role: 'secretaria',
    primaryBranchId: 'cochabamba',
    allowedBranchIds: ['cochabamba'],
    isActive: true,
  })

  await db.collection('users').doc('enc-punata-e2e').set({
    uid: 'enc-punata-e2e',
    fullName: 'Roberto Encargado (Punata)',
    email: 'encargado.punata@expresopunata.com',
    role: 'encargado_agencia',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    isActive: true,
  })
  console.log('   ✓ Usuarios creados: Secretaria Punata, Conductor, Secretaria Cochabamba, Encargado.\n')

  // 1. Secretaria Punata abre turno de caja
  console.log('1. Secretaria Punata abre turno de caja con Bs 100 de fondo...')
  const openRes = await openCashShift.run({
    auth: { uid: 'sec-punata-e2e' },
    data: {
      branchId: 'punata',
      initialCashCents: 10000,
      initialCashBreakdown: { '100': 1 },
      notes: 'Turno mañana logística e2e',
    },
  })
  assert.equal(openRes.success, true)
  const shiftId = openRes.shift.id
  console.log(`   ✓ Turno de caja abierto: ${shiftId}\n`)

  // 2. Secretaria Punata registra 2 encomiendas en ventanilla
  console.log('2. Registrando encomiendas en ventanilla Punata...')
  const ship1Res = await createShipment.run({
    auth: { uid: 'sec-punata-e2e' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Mario Flores', phone: '71234567', docType: 'CI', docNumber: '4567890' },
      recipient: { name: 'Elena Quispe', phone: '79876543', docType: 'CI', docNumber: '9876543' },
      items: [{ description: 'Caja con repuestos de motor', quantity: 1, packaging: 'caja', weightKg: 4.5, isFragile: false, category: 'parts' }],
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      cashShiftId: shiftId,
      idempotencyKey: 'idemp_ship1_' + Date.now(),
    },
  })
  assert.equal(ship1Res.success, true)
  console.log(`   ✓ Encomienda 1 creada: ${ship1Res.trackingCode} (PAGADA en efectivo, Bs ${(ship1Res.shipment.finalAmountCents / 100).toFixed(2)})`)

  const ship2Res = await createShipment.run({
    auth: { uid: 'sec-punata-e2e' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: 'Rosmery Claros', phone: '72345678', docType: 'CI' },
      recipient: { name: 'Víctor Morales', phone: '78765432', docType: 'CI' },
      items: [{ description: 'Fardo de ropa tradicional', quantity: 2, packaging: 'fardo', weightKg: 8.0, isFragile: false, category: 'clothing' }],
      paymentTiming: 'destination_cod',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      cashShiftId: shiftId,
      idempotencyKey: 'idemp_ship2_' + Date.now(),
    },
  })
  assert.equal(ship2Res.success, true)
  console.log(`   ✓ Encomienda 2 creada: ${ship2Res.trackingCode} (CONTRAENTREGA COD, Bs ${(ship2Res.shipment.finalAmountCents / 100).toFixed(2)})\n`)

  // 3. Encargado registra Móvil 07 en el padrón de flota
  console.log('3. Registrando vehículo Móvil 07 en el padrón de flota...')
  const vehicleRes = await manageVehicle.run({
    auth: { uid: 'enc-punata-e2e' },
    data: {
      action: 'create',
      vehicleData: {
        mobileNumber: '07',
        plate: '3142-EXP',
        branchId: 'punata',
        brand: 'Toyota',
        model: 'HiAce',
        capacityKg: 1600,
        assignedDriverUid: 'chofer-e2e',
        assignedDriverName: 'Don Juan Conductor',
      },
    },
  })
  assert.equal(vehicleRes.success, true)
  const vehicleId = vehicleRes.vehicleId
  console.log(`   ✓ Vehículo registrado: Móvil ${vehicleRes.mobileNumber} (${vehicleRes.plate}), ID: ${vehicleId}\n`)

  // 4. Secretaria Punata genera manifiesto de despacho
  console.log('4. Secretaria Punata crea y despacha el manifiesto oficial...')
  const manifestRes = await createDispatchManifest.run({
    auth: { uid: 'sec-punata-e2e' },
    data: {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      vehicleId,
      driverUid: 'chofer-e2e',
      shipmentIds: [ship1Res.shipment.id, ship2Res.shipment.id],
      departureNotes: 'Salida de la tarde 15:30 conforme',
    },
  })
  assert.equal(manifestRes.success, true)
  const manifestId = manifestRes.manifestId
  console.log(`   ✓ Manifiesto generado: ${manifestRes.manifestNumber}`)
  console.log(`   ✓ Carga: ${manifestRes.totalShipments} encomiendas, ${manifestRes.totalPackages} bultos, ${manifestRes.totalWeightKg} kg`)
  console.log(`   ✓ COD a cobrar en destino: Bs ${(manifestRes.totalCodAmountCents / 100).toFixed(2)}\n`)

  // Verificar que ambas encomiendas pasaron a in_transit
  const s1Doc = await db.collection('shipments').doc(ship1Res.shipment.id).get()
  const s2Doc = await db.collection('shipments').doc(ship2Res.shipment.id).get()
  assert.equal(s1Doc.data().status, 'in_transit')
  assert.equal(s2Doc.data().status, 'in_transit')
  console.log('   ✓ Encomiendas actualizadas atómicamente a estado in_transit.\n')

  // 5. Conductor accede a sus viajes y confirma custodia
  console.log('5. Don Juan Conductor toma custodia formal de la carga...')
  const custodyRes = await driverConfirmCustody.run({
    auth: { uid: 'chofer-e2e' },
    data: {
      manifestId,
      notes: 'Carga contada y asegurada con toldo en parrilla',
    },
  })
  assert.equal(custodyRes.success, true)
  assert.equal(custodyRes.driverCustodyStatus, 'accepted')
  console.log(`   ✓ Conductor confirmó custodia del manifiesto ${custodyRes.manifestNumber}.\n`)

  // 6. Prueba negativa de seguridad: Chofer intenta auto-recibir la carga en destino
  console.log('6. Validando seguridad: Chofer intenta auto-recibir la carga en Cochabamba (debe fallar)...')
  await assert.rejects(async () => {
    await receiveDispatchManifest.run({
      auth: { uid: 'chofer-e2e' },
      data: {
        manifestId,
        receivedShipments: [
          { shipmentId: ship1Res.shipment.id, receivedPackages: 1, condition: 'good' },
          { shipmentId: ship2Res.shipment.id, receivedPackages: 2, condition: 'good' },
        ],
      },
    })
  }, (err) => {
    assert.equal(err.code, 'permission-denied')
    console.log(`   ✓ Rechazado correctamente: "${err.message}"\n`)
    return true
  })

  // 7. Secretaria de Cochabamba recibe formalmente el manifiesto
  console.log('7. Secretaria Cochabamba recibe formalmente el manifiesto en destino...')
  const receiveRes = await receiveDispatchManifest.run({
    auth: { uid: 'sec-cbba-e2e' },
    data: {
      manifestId,
      receptionNotes: 'Llegada 16:45 a agencia Cochabamba sin novedades',
      receivedShipments: [
        { shipmentId: ship1Res.shipment.id, receivedPackages: 1, condition: 'good' },
        { shipmentId: ship2Res.shipment.id, receivedPackages: 2, condition: 'good' },
      ],
    },
  })
  assert.equal(receiveRes.success, true)
  assert.equal(receiveRes.discrepanciesCount, 0)
  console.log(`   ✓ Manifiesto recibido en destino conforme. Discrepancias: 0.\n`)

  // 8. Secretaria de Cochabamba ubica físicamente las encomiendas en estantes
  console.log('8. Ubicando encomiendas físicamente en almacén de Cochabamba...')
  const storage1 = await assignShipmentStorage.run({
    auth: { uid: 'sec-cbba-e2e' },
    data: {
      shipmentId: ship1Res.shipment.id,
      shelfId: 'ESTANTE-A',
      shelfName: 'Estante A — Carga General',
      moduleId: 'MOD-2',
      moduleNumber: 2,
      position: 'Fila intermedia 3',
    },
  })
  assert.equal(storage1.success, true)
  console.log(`   ✓ Encomienda ${ship1Res.trackingCode} guardada en Estante A / Módulo 2`)

  const storage2 = await assignShipmentStorage.run({
    auth: { uid: 'sec-cbba-e2e' },
    data: {
      shipmentId: ship2Res.shipment.id,
      shelfId: 'ESTANTE-C',
      shelfName: 'Estante C — Bultos Grandes',
      moduleId: 'MOD-1',
      moduleNumber: 1,
      position: 'Piso base',
    },
  })
  assert.equal(storage2.success, true)
  console.log(`   ✓ Encomienda ${ship2Res.trackingCode} guardada en Estante C / Módulo 1\n`)

  // 9. Punata consulta estado actualizado y confirma trazabilidad de extremo a extremo
  console.log('9. Verificando trazabilidad completa desde la perspectiva de origen...')
  const finalShip1 = await db.collection('shipments').doc(ship1Res.shipment.id).get()
  const data1 = finalShip1.data()
  assert.equal(data1.status, 'stored')
  assert.equal(data1.currentLocation, 'cochabamba')
  assert.equal(data1.storageLocation.shelfId, 'ESTANTE-A')
  assert.equal(data1.storageLocation.moduleNumber, 2)
  console.log(`   ✓ Estado Encomienda 1: ${data1.status}, Ubicación: ${data1.storageLocation.shelfName} M-${data1.storageLocation.moduleNumber}`)

  const finalShip2 = await db.collection('shipments').doc(ship2Res.shipment.id).get()
  const data2 = finalShip2.data()
  assert.equal(data2.status, 'stored')
  assert.equal(data2.currentLocation, 'cochabamba')
  assert.equal(data2.storageLocation.shelfId, 'ESTANTE-C')
  assert.equal(data2.storageLocation.moduleNumber, 1)
  console.log(`   ✓ Estado Encomienda 2: ${data2.status}, Ubicación: ${data2.storageLocation.shelfName} M-${data2.storageLocation.moduleNumber}`)

  console.log('\n=================================================================')
  console.log('   ¡RECORRIDO LOGÍSTICO COMPLETO VERIFICADO EXITOSAMENTE!        ')
  console.log('=================================================================\n')
}

runLogisticsLifecycle().catch((err) => {
  console.error('ERROR EN PRUEBA DE CICLO LOGÍSTICO:', err)
  process.exit(1)
})
