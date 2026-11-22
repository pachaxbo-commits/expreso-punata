import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  accrueDriverCommission,
  settleDriverCommission,
  manageConsumable,
  registerShipmentIncident,
  updateSystemConfig,
  getSystemConfig,
  openCashShift,
  getSystemReport,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST ||= 'http://127.0.0.1:9199'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-commissions-test' })
}

const db = getFirestore()

async function clearCollections() {
  const collections = [
    'users',
    'driver_commission_accounts',
    'driver_commission_records',
    'driver_commission_vouchers',
    'branch_consumables',
    'consumable_movements',
    'shipment_incidents',
    'shipments',
    'system_config',
    'audit_logs',
    'idempotency_keys',
    'cash_shifts',
    'cash_shift_active_locks',
    'financial_movements',
    'counters',
  ]
  for (const coll of collections) {
    const snap = await db.collection(coll).get()
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

async function createTestUser(uid, role, primaryBranchId = 'punata') {
  await db.collection('users').doc(uid).set({
    uid,
    role,
    primaryBranchId,
    allowedBranchIds: ['punata', 'cochabamba'],
    fullName: `Usuario Test ${role}`,
    isActive: true,
    email: `${uid}@expresopunata.com`,
  })
}

before(async () => {
  await clearCollections()
})

beforeEach(async () => {
  await clearCollections()
  await createTestUser('admin-1', 'afiliado_admin')
  await createTestUser('manager-1', 'encargado_agencia')
  await createTestUser('cashier-1', 'secretaria')
  await createTestUser('driver-1', 'conductor')
})

async function seedCommissionEvent(shipmentId, manifestId, shippingFeeCents) {
  await db.collection('system_config').doc('expreso_punata').set({ status: 'configured', isOfficial: true, commissions: { defaultType: 'percentage', defaultValue: 10 } })
  await db.collection('shipments').doc(shipmentId).set({ trackingCode: shipmentId, manifestId, status: 'delivered', shippingFeeCents })
  await db.collection('manifests').doc(manifestId).set({ driverUid: 'driver-1', shipmentIds: [shipmentId], status: 'received' })
}

test('1. accrueDriverCommission usa la regla oficial y es idempotente', async () => {
  await seedCommissionEvent('ship-101', 'MAN-01', 2500)
  const req = { auth: { uid: 'admin-1' }, data: { driverUid: 'driver-1', shipmentId: 'ship-101', manifestId: 'MAN-01' } }
  const first = await accrueDriverCommission.run(req)
  const retry = await accrueDriverCommission.run(req)
  assert.equal(first.success, true)
  assert.equal(first.commissionAmountCents, 250)
  assert.equal(retry.recordId, first.recordId)
  assert.equal(retry.commissionAmountCents, 250)
  const acc = (await db.collection('driver_commission_accounts').doc('driver-1').get()).data()
  assert.equal(acc.accruedCents, 250)
  assert.equal(acc.pendingCents, 250)
  assert.equal((await db.collection('driver_commission_records').get()).size, 1)
  assert.equal((await db.collection('audit_logs').where('action', '==', 'accrue_driver_commission').get()).size, 1)
  await assert.rejects(accrueDriverCommission.run({ ...req, data: { ...req.data, shippingAmountCents: 250000, ruleValue: 1000 } }), (err) => err.code === 'invalid-argument')
  assert.equal((await db.collection('driver_commission_records').get()).size, 1)
  assert.equal((await db.collection('driver_commission_accounts').doc('driver-1').get()).data().accruedCents, 250)
  await seedCommissionEvent('ship-102', 'MAN-02', 5000)
  const second = await accrueDriverCommission.run({ auth: { uid: 'admin-1' }, data: { shipmentId: 'ship-102', manifestId: 'MAN-02' } })
  assert.equal(second.commissionAmountCents, 500)
  assert.equal((await db.collection('driver_commission_accounts').doc('driver-1').get()).data().accruedCents, 750)
  await assert.rejects(accrueDriverCommission.run({ auth: { uid: 'manager-1' }, data: { shipmentId: 'ship-102', manifestId: 'MAN-02' } }), (err) => err.code === 'permission-denied')
})

test('2. FASE 5A: settleDriverCommission liquida comisiones con egreso de caja y vale oficial', async () => {
  // 1. Abrir turno de caja
  await openCashShift.run({
    auth: { uid: 'admin-1' },
    data: { branchId: 'punata', initialCashCents: 50000 },
  })

  // 2. Devengar comisiones por Bs 10.00
  await seedCommissionEvent('ship-201', 'MAN-201', 10000)
  await accrueDriverCommission.run({
    auth: { uid: 'admin-1' },
    data: { driverUid: 'driver-1', shipmentId: 'ship-201', manifestId: 'MAN-201' },
  })

  // 3. Liquidar Bs 6.00 (pago parcial)
  const settleReq = {
    auth: { uid: 'admin-1' },
    data: {
      driverUid: 'driver-1',
      amountCents: 600,
      branchId: 'punata',
      notes: 'Pago de comisiones parcial',
    },
  }

  const settleRes = await settleDriverCommission.run(settleReq)
  assert.strictEqual(settleRes.success, true)
  assert.strictEqual(settleRes.voucher.settledAmountCents, 600)
  assert.strictEqual(settleRes.voucher.remainingPendingCents, 400) // 1000 - 600 = 400 restantes
  assert.ok(settleRes.voucher.voucherNumber.startsWith('COM-'))

  // 4. Comprobar cuenta del chofer
  const accDoc = await db.collection('driver_commission_accounts').doc('driver-1').get()
  assert.strictEqual(accDoc.data().paidCents, 600)
  assert.strictEqual(accDoc.data().pendingCents, 400)

  // 5. Intentar liquidar más del saldo pendiente debe fallar
  await assert.rejects(
    async () => {
      await settleDriverCommission.run({
        auth: { uid: 'admin-1' },
        data: {
          driverUid: 'driver-1',
          amountCents: 500, // Supera los 400 restantes
          branchId: 'punata',
        },
      })
    },
    (err) => err.code === 'failed-precondition'
  )
})

test('3. FASE 5B: manageConsumable gestiona catálogo, entradas, consumos y alertas de stock', async () => {
  // 1. Crear insumo
  const createRes = await manageConsumable.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create_item',
      code: 'ROL-80MM',
      name: 'Rollo Térmico 80mm',
      category: 'thermal_rolls',
      branchId: 'punata',
      unit: 'rollos',
      currentStock: 10,
      minStockAlert: 5,
      costPerUnitCents: 850,
    },
  })
  assert.strictEqual(createRes.success, true)
  const itemId = createRes.item.id

  // 2. Registrar consumo de 6 rollos (queda en 4 <= minStockAlert 5 -> activa alerta)
  const consRes = await manageConsumable.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'record_consumption',
      id: itemId,
      quantity: 6,
      reason: 'Uso en ventanilla 1',
    },
  })
  assert.strictEqual(consRes.success, true)
  assert.strictEqual(consRes.nextStock, 4)

  const itemSnap1 = await db.collection('branch_consumables').doc(itemId).get()
  assert.strictEqual(itemSnap1.data().currentStock, 4)
  assert.strictEqual(itemSnap1.data().isLowStock, true)

  // 3. Registrar entrada de 20 rollos (queda en 24 -> desactiva alerta)
  const entryRes = await manageConsumable.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'record_entry',
      id: itemId,
      quantity: 20,
      reason: 'Compra mayorista',
    },
  })
  assert.strictEqual(entryRes.success, true)
  assert.strictEqual(entryRes.nextStock, 24)

  const itemSnap2 = await db.collection('branch_consumables').doc(itemId).get()
  assert.strictEqual(itemSnap2.data().currentStock, 24)
  assert.strictEqual(itemSnap2.data().isLowStock, false)

  // 4. Consumo mayor al stock disponible debe fallar
  await assert.rejects(
    async () => {
      await manageConsumable.run({
        auth: { uid: 'admin-1' },
        data: {
          action: 'record_consumption',
          id: itemId,
          quantity: 100, // Supera los 24 disponibles
        },
      })
    },
    (err) => err.code === 'failed-precondition'
  )
})

test('4. FASE 5C: registerShipmentIncident reporta novedad, actualiza encomienda e indemniza', async () => {
  // Crear encomienda de prueba
  await db.collection('shipments').doc('ship-inc-1').set({
    id: 'ship-inc-1',
    trackingCode: 'PUN202600099',
    status: 'in_transit',
    destinationBranchId: 'cochabamba',
    amountBob: 20,
  })

  // 1. Reportar daño de encomienda
  const incRes = await registerShipmentIncident.run({
    auth: { uid: 'cashier-1' },
    data: {
      action: 'report_incident',
      shipmentId: 'ship-inc-1',
      incidentType: 'damaged',
      description: 'Caja recibida con rasgadura lateral y rotura de embalaje interno',
      responsiblePerson: 'Conductor Móvil 10',
    },
  })

  assert.strictEqual(incRes.success, true)
  assert.ok(incRes.incident.incidentNumber.startsWith('INC-'))
  assert.strictEqual(incRes.incident.status, 'open')

  // Verificar estado de la encomienda actualizado a 'damaged'
  const sSnap = await db.collection('shipments').doc('ship-inc-1').get()
  assert.strictEqual(sSnap.data().status, 'damaged')
  assert.strictEqual(sSnap.data().hasIncident, true)

  // 2. Resolver incidencia
  const resolveRes = await registerShipmentIncident.run({
    auth: { uid: 'manager-1' },
    data: {
      action: 'resolve_incident',
      incidentId: incRes.incident.id,
      resolutionNotes: 'Se verificó con el conductor y se acuerda reposición de contenido',
    },
  })
  assert.strictEqual(resolveRes.success, true)

  // 3. Indemnizar desde fondo sindical
  const indRes = await registerShipmentIncident.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'indemnify_incident',
      incidentId: incRes.incident.id,
      compensationAmountCents: 8000, // Bs 80.00
      paymentSource: 'union_reserve',
    },
  })
  assert.strictEqual(indRes.success, true)
  assert.strictEqual(indRes.compensationAmountBob, 80)

  const incDoc = await db.collection('shipment_incidents').doc(incRes.incident.id).get()
  assert.strictEqual(incDoc.data().status, 'compensated')
  assert.strictEqual(incDoc.data().financialConsequence, 'union_reserve_indemnity')

  await db.collection('shipments').doc('ship-inc-delivered').set({
    id: 'ship-inc-delivered', trackingCode: 'PUN-DELIVERED-01', status: 'delivered',
    originBranchId: 'punata', destinationBranchId: 'cochabamba', createdAt: new Date(), createdAtIso: new Date().toISOString(),
  })
  const postDeliveryIncident = await registerShipmentIncident.run({
    auth: { uid: 'cashier-1' },
    data: { shipmentId: 'ship-inc-delivered', incidentType: 'damaged', description: 'El destinatario reporta daño menor tras recibir su envío.', branchId: 'cochabamba' },
  })
  const deliveredAfterIncident = await db.collection('shipments').doc('ship-inc-delivered').get()
  assert.equal(deliveredAfterIncident.data().status, 'delivered', 'registrar una incidencia posterior no revierte el estado terminal de entrega')
  assert.equal(deliveredAfterIncident.data().hasIncident, true, 'la incidencia posterior sí queda asociada')
  const deliveredAudit = await deliveredAfterIncident.ref.collection('audit_logs').where('incidentNumber', '==', postDeliveryIncident.incident.incidentNumber).get()
  assert.equal(deliveredAudit.docs[0].data().previousStatus, 'delivered')
  assert.equal(deliveredAudit.docs[0].data().newStatus, 'delivered')
  const repeatedPostDeliveryIncident = await registerShipmentIncident.run({
    auth: { uid: 'cashier-1' },
    data: { shipmentId: 'ship-inc-delivered', incidentType: 'damaged', description: 'Se registra una segunda observación separada.', branchId: 'cochabamba' },
  })
  assert.notEqual(repeatedPostDeliveryIncident.incident.id, postDeliveryIncident.incident.id)
  const repeatedIncidents = await db.collection('shipment_incidents').where('shipmentId', '==', 'ship-inc-delivered').get()
  assert.equal(repeatedIncidents.size, 2, 'cada reporte explícito conserva su registro individual')
  const deliveredAfterRepeat = await db.collection('shipments').doc('ship-inc-delivered').get()
  assert.equal(deliveredAfterRepeat.data().status, 'delivered')
  assert.equal(deliveredAfterRepeat.data().incidentHistory.length, 2)
  assert.equal((await deliveredAfterRepeat.ref.collection('audit_logs').where('action', '==', 'incident_registered').get()).size, 2)
  assert.equal((await db.collection('financial_movements').get()).size, 0, 'registrar la incidencia no genera movimientos de Caja')
  const shipmentReport = await getSystemReport.run({ auth: { uid: 'admin-1' }, data: { reportType: 'shipments', branchId: 'all' } })
  assert.equal(shipmentReport.summary.totalShipments, 1)
  assert.equal(shipmentReport.summary.byStatus.delivered, 1)
  assert.equal(shipmentReport.summary.byStatus.damaged, 0)
})

test('5. FASE 7: updateSystemConfig y getSystemConfig gestionan configuración oficial', async () => {
  // 1. Obtener inicial (defaults)
  const initial = await getSystemConfig.run({ auth: { uid: 'admin-1' } })
  assert.strictEqual(initial.success, true)
  assert.strictEqual(initial.status, 'unconfigured')
  assert.strictEqual(initial.config, null)

  // 2. Secretaria no puede modificar la configuración
  await assert.rejects(
    async () => {
      await updateSystemConfig.run({
        auth: { uid: 'cashier-1' },
        data: { company: { tradeName: 'OTRO NOMBRE' } },
      })
    },
    (err) => err.code === 'permission-denied'
  )

  // 3. Admin actualiza tarifas y datos de agencias
  const updateRes = await updateSystemConfig.run({
    auth: { uid: 'admin-1' },
    data: {
      company: {
        legalName: 'Sindicato Mixto de Transportes Expreso Punata',
        tradeName: 'EXPRESO PUNATA OFICIAL',
      },
      tariffs: {
        baseFeeBob: 18,
        baseFeeCents: 1800,
        freeWeightKg: 4,
        extraKgRateBob: 2.5,
        extraKgRateCents: 250,
      },
      commissions: {
        defaultType: 'percentage',
        defaultValue: 12,
      },
    },
  })
  assert.strictEqual(updateRes.success, true)
  assert.strictEqual(updateRes.config.company.tradeName, 'EXPRESO PUNATA OFICIAL')
  assert.strictEqual(updateRes.config.tariffs.baseFeeBob, 18)
  assert.strictEqual(updateRes.config.tariffs.baseFeeCents, 1800)
  assert.strictEqual(updateRes.config.commissions.defaultValue, 12)

  // 4. Consultar de nuevo
  const verified = await getSystemConfig.run({ auth: { uid: 'admin-1' } })
  assert.strictEqual(verified.isDefault, false)
  assert.strictEqual(verified.config.company.tradeName, 'EXPRESO PUNATA OFICIAL')
})

test('afiliado_admin devenga y liquida Bs 2 una sola vez para un conductor de directorio', async () => {
  const driverUid = 'directorio-sin-cuenta'
  await db.collection('driver_directory').doc(driverUid).set({ uid: driverUid, fullName: 'Conductor sintético', isActive: true })
  await seedCommissionEvent('ship-fixed', 'MAN-FIXED', 2500)
  await db.collection('system_config').doc('expreso_punata').update({ commissions: { defaultType: 'fixed_per_shipment', defaultValue: 2 } })
  await db.collection('shipments').doc('ship-fixed').update({ originBranchId: 'punata' })
  await db.collection('manifests').doc('MAN-FIXED').update({ driverUid, originBranchId: 'punata' })
  await createTestUser('limited-admin', 'afiliado_admin', 'cochabamba')
  await db.collection('users').doc('limited-admin').update({ allowedBranchIds: ['cochabamba'], commissionAdministrationApproved: true })
  await createTestUser('technical', 'soporte_pachax')
  const auth = { uid: 'admin-1' }
  const data = { shipmentId: 'ship-fixed', manifestId: 'MAN-FIXED' }
  await assert.rejects(accrueDriverCommission.run({ auth: { uid: 'limited-admin' }, data }), { code: 'permission-denied' })
  await assert.rejects(accrueDriverCommission.run({ auth: { uid: 'technical' }, data }), { code: 'permission-denied' })
  const [first, retry] = await Promise.all([accrueDriverCommission.run({ auth, data }), accrueDriverCommission.run({ auth, data })])
  assert.equal(first.commissionAmountCents, 200)
  assert.equal(first.recordId, retry.recordId)
  assert.equal((await db.collection('driver_commission_records').get()).size, 1)
  const account = db.collection('driver_commission_accounts').doc(driverUid)
  assert.equal((await account.get()).data().pendingCents, 200)
  const { shift } = await openCashShift.run({ auth, data: { branchId: 'punata', initialCashCents: 1000 } })
  const payment = { driverUid, amountCents: 200, branchId: 'punata' }
  for (const uid of ['limited-admin', 'technical']) {
    await assert.rejects(settleDriverCommission.run({ auth: { uid }, data: payment }), { code: 'permission-denied' })
  }
  await assert.rejects(settleDriverCommission.run({ auth, data: { ...payment, branchId: 'cochabamba' } }), { code: 'failed-precondition' })
  const results = await Promise.allSettled([settleDriverCommission.run({ auth, data: payment }), settleDriverCommission.run({ auth, data: payment })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'failed-precondition')
  const vouchers = await db.collection('driver_commission_vouchers').where('driverUid', '==', driverUid).get()
  assert.equal(vouchers.size, 1)
  const ledger = await db.collection('financial_movements').where('category', '==', 'driver_commission').get()
  assert.equal(ledger.size, 1)
  assert.equal(ledger.docs[0].data().amountCents, 200)
  assert.equal((await db.collection('cash_shifts').doc(shift.id).get()).data().expectedCashCents, 800)
  const record = (await db.collection('driver_commission_records').doc(first.recordId).get()).data()
  assert.equal(record.status, 'paid')
  assert.equal(record.paidAmountCents, 200)
  assert.equal((await account.get()).data().pendingCents, 0)
  const day = first.createdAtIso?.slice(0, 10) || record.createdAtIso.slice(0, 10)
  const report = await getSystemReport.run({ auth, data: { reportType: 'commissions', startDate: day, endDate: day } })
  assert.equal(report.summary.totalPaidCents, 200)
  assert.equal(report.summary.totalPendingCents, 0)
  assert.equal(report.records[0].id, first.recordId)
})
