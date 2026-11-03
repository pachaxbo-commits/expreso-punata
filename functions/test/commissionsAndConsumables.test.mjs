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
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'

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
  await createTestUser('admin-1', 'directiva_admin')
  await createTestUser('manager-1', 'encargado_agencia')
  await createTestUser('cashier-1', 'secretaria')
  await createTestUser('driver-1', 'conductor')
})

test('1. FASE 5A: accrueDriverCommission devenga comisión acumulada al conductor', async () => {
  const req = {
    auth: { uid: 'manager-1' },
    data: {
      driverUid: 'driver-1',
      shipmentId: 'ship-101',
      trackingCode: 'PUN202600001',
      manifestId: 'MAN-01',
      shippingAmountCents: 2500, // Bs 25.00
      ruleType: 'percentage',
      ruleValue: 10, // 10% = Bs 2.50 = 250 centavos
    },
  }

  const res = await accrueDriverCommission.run(req)
  assert.strictEqual(res.success, true)
  assert.strictEqual(res.commissionAmountCents, 250)
  assert.strictEqual(res.commissionAmountBob, 2.5)

  // Verificar cuenta de comisión
  const accDoc = await db.collection('driver_commission_accounts').doc('driver-1').get()
  assert.strictEqual(accDoc.exists, true)
  assert.strictEqual(accDoc.data().accruedCents, 250)
  assert.strictEqual(accDoc.data().pendingCents, 250)
  assert.strictEqual(accDoc.data().paidCents, 0)

  // Devengar una segunda encomienda
  const req2 = {
    auth: { uid: 'manager-1' },
    data: {
      driverUid: 'driver-1',
      shipmentId: 'ship-102',
      trackingCode: 'PUN202600002',
      shippingAmountCents: 5000,
      ruleType: 'percentage',
      ruleValue: 10, // Bs 5.00 = 500 centavos
    },
  }
  await accrueDriverCommission.run(req2)

  const accDoc2 = await db.collection('driver_commission_accounts').doc('driver-1').get()
  assert.strictEqual(accDoc2.data().accruedCents, 750) // 250 + 500 = 750
  assert.strictEqual(accDoc2.data().pendingCents, 750)
})

test('2. FASE 5A: settleDriverCommission liquida comisiones con egreso de caja y vale oficial', async () => {
  // 1. Abrir turno de caja
  await openCashShift.run({
    auth: { uid: 'cashier-1' },
    data: { branchId: 'punata', initialCashCents: 50000 },
  })

  // 2. Devengar comisiones por Bs 10.00
  await accrueDriverCommission.run({
    auth: { uid: 'manager-1' },
    data: {
      driverUid: 'driver-1',
      shipmentId: 'ship-201',
      trackingCode: 'PUN202600010',
      shippingAmountCents: 10000,
      ruleType: 'percentage',
      ruleValue: 10, // Bs 10.00 = 1000 centavos
    },
  })

  // 3. Liquidar Bs 6.00 (pago parcial)
  const settleReq = {
    auth: { uid: 'cashier-1' },
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
        auth: { uid: 'cashier-1' },
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
    auth: { uid: 'manager-1' },
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
    auth: { uid: 'cashier-1' },
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
    auth: { uid: 'manager-1' },
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
        auth: { uid: 'cashier-1' },
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
})

test('5. FASE 7: updateSystemConfig y getSystemConfig gestionan configuración oficial', async () => {
  // 1. Obtener inicial (defaults)
  const initial = await getSystemConfig.run({})
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
  const verified = await getSystemConfig.run({})
  assert.strictEqual(verified.isDefault, false)
  assert.strictEqual(verified.config.company.tradeName, 'EXPRESO PUNATA OFICIAL')
})
