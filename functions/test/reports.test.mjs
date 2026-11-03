import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getSystemReport } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-reports-test' })
}

const db = getFirestore()

async function clearCollections() {
  const collections = [
    'users',
    'shipments',
    'financial_movements',
    'cash_shifts',
    'manifests',
    'driver_custody_accounts',
    'union_members',
    'union_dues',
    'union_workers',
    'union_worker_payments',
    'union_expenses',
    'fixed_assets',
    'audit_logs',
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
})

test('1. Permisos: Conductor solo puede consultar reporte de conductores', async () => {
  await createTestUser('driver-1', 'conductor')

  // Intentar consultar encomiendas -> error
  await assert.rejects(
    () => getSystemReport.run({
      auth: { uid: 'driver-1' },
      data: { reportType: 'shipments' },
    }),
    { code: 'permission-denied' }
  )

  // Consultar drivers -> permitido
  const res = await getSystemReport.run({
    auth: { uid: 'driver-1' },
    data: { reportType: 'drivers', driverUid: 'driver-1' },
  })
  assert.equal(res.success, true)
  assert.equal(res.reportType, 'drivers')
})

test('2. Permisos: Secretaria solo puede consultar encomiendas y finanzas de sucursal', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')

  // Intentar consultar nómina -> error
  await assert.rejects(
    () => getSystemReport.run({
      auth: { uid: 'sec-punata' },
      data: { reportType: 'payroll_expenses' },
    }),
    { code: 'permission-denied' }
  )

  // Intentar consultar mensualidades -> error
  await assert.rejects(
    () => getSystemReport.run({
      auth: { uid: 'sec-punata' },
      data: { reportType: 'dues' },
    }),
    { code: 'permission-denied' }
  )

  // Consultar encomiendas -> permitido
  const resShipments = await getSystemReport.run({
    auth: { uid: 'sec-punata' },
    data: { reportType: 'shipments' },
  })
  assert.equal(resShipments.success, true)
  assert.equal(resShipments.branchId, 'punata') // Scoped a su sucursal

  // Consultar caja/finanzas -> permitido
  const resCash = await getSystemReport.run({
    auth: { uid: 'sec-punata' },
    data: { reportType: 'cash_financial' },
  })
  assert.equal(resCash.success, true)
  assert.equal(resCash.branchId, 'punata')
})

test('3. Reporte B1: Encomiendas con métricas de bultos, peso, facturado, cobrado y rutas', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const nowIso = new Date().toISOString()
  const yesterdayIso = new Date(Date.now() - 3600000 * 2).toISOString()

  // Encomienda 1: Pagada en origen, entregada
  await db.collection('shipments').doc('SHP-001').set({
    trackingCode: 'PUN-001',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    status: 'delivered',
    paymentTiming: 'origin_paid',
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    finalAmountCents: 5000,
    amountBob: 50,
    totalPackages: 2,
    totalWeightKg: 10,
    items: [{ quantity: 2 }],
    createdAt: yesterdayIso,
    deliveredAt: nowIso,
  })

  // Encomienda 2: Contraentrega pendiente
  await db.collection('shipments').doc('SHP-002').set({
    trackingCode: 'CBB-002',
    originBranchId: 'cochabamba',
    destinationBranchId: 'punata',
    status: 'in_transit',
    paymentTiming: 'destination_cod',
    paymentStatus: 'pending',
    paymentMethod: null,
    finalAmountCents: 3500,
    amountBob: 35,
    totalPackages: 1,
    totalWeightKg: 5,
    items: [{ quantity: 1 }],
    createdAt: nowIso,
  })

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'shipments', branchId: 'all' },
  })

  assert.equal(res.success, true)
  assert.equal(res.summary.totalShipments, 2)
  assert.equal(res.summary.totalPackages, 3)
  assert.equal(res.summary.totalWeightKg, 15)
  assert.equal(res.summary.totalBilledCents, 8500)
  assert.equal(res.summary.totalCollectedCents, 5000)
  assert.equal(res.summary.totalPendingCodCents, 3500)
  assert.equal(res.summary.byStatus.delivered, 1)
  assert.equal(res.summary.byStatus.in_transit, 1)
  assert.equal(res.summary.byRoute.punata_to_cochabamba.count, 1)
  assert.equal(res.summary.byRoute.cochabamba_to_punata.count, 1)
  assert.ok(res.summary.averageTurnaroundHours > 0)
  assert.equal(res.records.length, 2)
})

test('4. Reporte B2: Caja y finanzas distingue ingresos comerciales, aportes, remesas de conductor y gastos', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const nowIso = new Date().toISOString()

  // Movimiento comercial
  await db.collection('financial_movements').doc('mov-1').set({
    branchId: 'punata',
    type: 'shipment_income',
    amountCents: 6000,
    amountBob: 60,
    paymentMethod: 'cash',
    timestamp: nowIso,
  })

  // Aporte / Mensualidad
  await db.collection('financial_movements').doc('mov-2').set({
    branchId: 'punata',
    type: 'contribution_income',
    amountCents: 5000,
    amountBob: 50,
    paymentMethod: 'cash',
    timestamp: nowIso,
  })

  // Remesa custodia conductor
  await db.collection('financial_movements').doc('mov-3').set({
    branchId: 'cochabamba',
    type: 'driver_remittance',
    amountCents: 4000,
    amountBob: 40,
    paymentMethod: 'cash',
    timestamp: nowIso,
  })

  // Gasto operativo
  await db.collection('financial_movements').doc('mov-4').set({
    branchId: 'punata',
    type: 'expense',
    amountCents: 1500,
    amountBob: 15,
    paymentMethod: 'cash',
    timestamp: nowIso,
  })

  // Turno de caja
  await db.collection('cash_shifts').doc('shift-1').set({
    branchId: 'punata',
    status: 'closed',
    openedAt: nowIso,
    initialCashCents: 10000,
    differenceCents: 0,
  })

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'cash_financial' },
  })

  assert.equal(res.success, true)
  assert.equal(res.summary.commercialIncomeCents, 6000)
  assert.equal(res.summary.contributionsIncomeCents, 5000)
  assert.equal(res.summary.driverRemittancesCents, 4000)
  assert.equal(res.summary.expensesCents, 1500)
  // Operativo neto: (6000 + 5000 + 4000) - 1500 = 13500
  assert.equal(res.summary.netOperatingCents, 13500)
  assert.equal(res.summary.initialCashTotalCents, 10000)
  assert.equal(res.summary.shiftsSummary.conformityCount, 1)
})

test('5. Reporte B3: Rendición de conductores con viajes y saldo en custodia', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const nowIso = new Date().toISOString()

  await db.collection('manifests').doc('MAN-1').set({
    driverUid: 'driver-test-1',
    driverName: 'Zenón Vallejos',
    vehiclePlate: '1234-XYZ',
    status: 'received',
    createdAtIso: nowIso,
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    shipmentSummaries: [{ id: '1' }, { id: '2' }],
    discrepancies: [],
  })

  await db.collection('driver_custody_accounts').doc('driver-test-1').set({
    driverUid: 'driver-test-1',
    totalRemittedCents: 10000,
    pendingRemittanceCents: 2500,
  })

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'drivers' },
  })

  assert.equal(res.success, true)
  assert.equal(res.summary.totalManifests, 1)
  assert.equal(res.summary.totalTripsCompleted, 1)
  assert.equal(res.summary.totalShipmentsTransported, 2)
  assert.equal(res.summary.activeDriversWithCustody, 1)

  const driverSummary = res.driverSummaries.find(d => d.driverUid === 'driver-test-1')
  assert.ok(driverSummary)
  assert.equal(driverSummary.pendingCustodyCents, 2500)
  assert.equal(driverSummary.totalRemittedCents, 10000)
})

test('6. Reporte B4: Padrón de socios, recaudación de mensualidades y morosidad', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  await db.collection('union_members').doc('MEM-01').set({
    memberNumber: 'SOC-001',
    fullName: 'Nelson Rivera',
    status: 'active',
  })

  await db.collection('union_dues').doc('DUE-01').set({
    memberId: 'MEM-01',
    memberNumber: 'SOC-001',
    memberName: 'Nelson Rivera',
    period: '2026-11',
    amountCents: 5000,
    paidAmountCents: 2000,
    balanceCents: 3000,
    status: 'partial',
    dueDate: '2026-11-01',
  })

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'dues', period: '2026-11' },
  })

  assert.equal(res.success, true)
  assert.equal(res.summary.membersCount.active, 1)
  assert.equal(res.summary.totalDuesIssuedCents, 5000)
  assert.equal(res.summary.totalCollectedCents, 2000)
  assert.equal(res.summary.totalOutstandingCents, 3000)
  assert.equal(res.debtors.length, 1)
  assert.equal(res.debtors[0].totalDebtCents, 3000)
})

test('7. Reporte B5: Nómina de personal y gastos operativos por categoría', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const nowIso = new Date().toISOString()

  await db.collection('union_workers').doc('WRK-01').set({
    fullName: 'Javier Morales',
    role: 'secretaria',
    status: 'active',
  })

  await db.collection('union_worker_payments').doc('PAY-01').set({
    workerId: 'WRK-01',
    workerName: 'Javier Morales',
    amountCents: 250000,
    amountBob: 2500,
    paymentType: 'salary',
    branchId: 'punata',
    paidAtIso: nowIso,
  })

  await db.collection('union_expenses').doc('EXP-01').set({
    branchId: 'punata',
    category: 'combustible',
    amountCents: 15000,
    amountBob: 150,
    supplier: 'Surtidor Punata',
    createdAtIso: nowIso,
  })

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'payroll_expenses', branchId: 'all' },
  })

  assert.equal(res.success, true)
  assert.equal(res.summary.activeWorkersCount, 1)
  assert.equal(res.summary.totalPayrollPaidCents, 250000)
  assert.equal(res.summary.totalOperatingExpensesCents, 15000)
  assert.equal(res.summary.totalDisbursedCents, 265000)
  assert.equal(res.summary.byExpenseCategory.combustible, 15000)
  assert.equal(res.summary.topSuppliers[0].supplier, 'Surtidor Punata')
})

test('8. Reporte B6: Inventario de bienes fijos, valoración y bajas', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  await db.collection('fixed_assets').doc('AST-01').set({
    assetCode: 'ACT-PUN-0001',
    name: 'Balanza Digital 300kg',
    category: 'balanzas_pesaje',
    branchId: 'punata',
    acquisitionCostCents: 120000,
    acquisitionCostBob: 1200,
    status: 'in_use',
  })

  await db.collection('fixed_assets').doc('AST-02').set({
    assetCode: 'ACT-CBB-0002',
    name: 'Impresora Térmica Antigua',
    category: 'computacion',
    branchId: 'cochabamba',
    acquisitionCostCents: 80000,
    acquisitionCostBob: 800,
    status: 'disposed',
    disposedReason: 'Obsolescencia y falla de cabezal irreparable',
    disposedAtIso: new Date().toISOString(),
    disposedByName: 'Nelson Rivera',
  })

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'fixed_assets', branchId: 'all' },
  })

  assert.equal(res.success, true)
  assert.equal(res.summary.totalAssetsCount, 2)
  assert.equal(res.summary.totalAcquisitionValueCents, 200000)
  assert.equal(res.summary.byStatus.in_use, 1)
  assert.equal(res.summary.byStatus.disposed, 1)
  assert.equal(res.summary.disposedCount, 1)
  assert.equal(res.disposedAssets[0].assetCode, 'ACT-CBB-0002')
})

test('9. Reporte Consolidado Ejecutivo: Resume cross-module', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const res = await getSystemReport.run({
    auth: { uid: 'admin-1' },
    data: { reportType: 'consolidated_dashboard' },
  })

  assert.equal(res.success, true)
  assert.equal(res.reportType, 'consolidated_dashboard')
  assert.ok(res.dashboard.shipments)
  assert.ok(res.dashboard.finances)
  assert.ok(res.dashboard.drivers)
  assert.ok(res.dashboard.fixedAssets)
})
