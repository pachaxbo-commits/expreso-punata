import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
const projectId = process.env.GCLOUD_PROJECT || 'demo-expreso-punata-performance'
if (!getApps().length) initializeApp({ projectId })
const db = getFirestore()
const authAdmin = getAuth()
const { getUnionMembersRoster, getMemberAccountStatement, getSystemReport, listUnionDebtAlerts, listPhysicalInventoryDocuments } = await import('../../functions/index.js')
const functionsRequire = createRequire(new URL('../../functions/index.js', import.meta.url))
const { Query, DocumentReference } = functionsRequire('firebase-admin/firestore')

const stamp = '2026-11-10T12:00:00.000Z'
const startDate = '2026-01-01'
const endDate = '2026-12-31'
const stats = { queryCalls: 0, documentReads: 0 }
const queryGet = Query.prototype.get
const documentGet = DocumentReference.prototype.get
Query.prototype.get = async function (...args) {
  const snapshot = await queryGet.apply(this, args)
  stats.queryCalls += 1
  stats.documentReads += snapshot.size
  return snapshot
}
DocumentReference.prototype.get = async function (...args) {
  const snapshot = await documentGet.apply(this, args)
  stats.queryCalls += 1
  stats.documentReads += snapshot.exists ? 1 : 0
  return snapshot
}

async function commitOperations(operations) {
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = db.batch()
    for (const operation of operations.slice(offset, offset + 450)) batch.set(operation.ref, operation.data)
    await batch.commit()
  }
}

async function measure(name, action, validate = () => {}) {
  stats.queryCalls = 0
  stats.documentReads = 0
  const heapUsedBeforeBytes = process.memoryUsage().heapUsed
  const started = performance.now()
  const result = await action()
  const elapsedMs = Number((performance.now() - started).toFixed(1))
  const heapUsedAfterBytes = process.memoryUsage().heapUsed
  validate(result)
  const row = { name, elapsedMs, firestoreCalls: stats.queryCalls, documentsRead: stats.documentReads, heapUsedBeforeBytes, heapUsedAfterBytes, heapUsedDeltaBytes: heapUsedAfterBytes - heapUsedBeforeBytes }
  console.log(JSON.stringify(row))
  return row
}

const operations = []
operations.push({ ref: db.collection('users').doc('audit-perf-admin'), data: { uid: 'audit-perf-admin', role: 'directiva_admin', fullName: 'Admin Auditoría Sintética', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] } })
operations.push({ ref: db.collection('users').doc('audit-perf-affiliate'), data: { uid: 'audit-perf-affiliate', role: 'afiliado', fullName: 'Afiliado Auditoría Sintética', isActive: true, unionMemberId: 'perf-member-0000', primaryBranchId: 'punata', allowedBranchIds: ['punata'] } })

for (let i = 0; i < 500; i += 1) {
  const id = `perf-member-${String(i).padStart(4, '0')}`
  const branchId = i % 2 ? 'cochabamba' : 'punata'
  const driverUid = `perf-driver-${String(i % 50).padStart(3, '0')}`
  operations.push({ ref: db.collection('union_members').doc(id), data: { id, memberNumber: `SOC-${String(i + 1).padStart(4, '0')}`, fullName: `Afiliado Ficticio ${String(i + 1).padStart(4, '0')}`, ci: String(1000000 + i), phone: `700${String(i).padStart(5, '0')}`, branchId, status: 'active', category: 'titular', monthlyFeeCents: 5000, primaryDriverUid: driverUid, primaryDriverName: `Conductor Ficticio ${i % 50}`, createdAtIso: stamp, joinedAt: '2020-01-01' } })
  operations.push({ ref: db.collection('union_members').doc(id).collection('children').doc(`child-${i}`), data: { id: `child-${i}`, memberId: id, fullName: `Hijo Ficticio ${String(i + 1).padStart(4, '0')}`, driverUid, driverName: `Conductor Ficticio ${i % 50}`, birthDate: '2010-03-15' } })
  operations.push({ ref: db.collection('union_dues').doc(`perf-due-${i}`), data: { id: `perf-due-${i}`, memberId: id, memberNumber: `SOC-${String(i + 1).padStart(4, '0')}`, memberName: `Afiliado Ficticio ${String(i + 1).padStart(4, '0')}`, branchId, period: '2026-10', dueDate: '2026-10-15', status: 'pending', amountCents: 5000, balanceCents: 5000, createdAtIso: stamp } })
  operations.push({ ref: db.collection('union_fines').doc(`perf-fine-${i}`), data: { id: `perf-fine-${i}`, memberId: id, memberNumber: `SOC-${String(i + 1).padStart(4, '0')}`, memberName: `Afiliado Ficticio ${String(i + 1).padStart(4, '0')}`, branchId, category: i % 3 ? 'transporte' : 'deportes', reason: 'Multa de prueba sintética', status: 'pending', amountCents: 2500, balanceCents: 2500, createdAtIso: stamp } })
}

for (let i = 0; i < 200; i += 1) {
  const id = `perf-loan-${String(i).padStart(4, '0')}`
  operations.push({ ref: db.collection('union_loans').doc(id), data: { id, loanNumber: `PRE-${String(i + 1).padStart(4, '0')}`, memberId: `perf-member-${String(i).padStart(4, '0')}`, branchId: i % 2 ? 'cochabamba' : 'punata', amountCents: 100000, balanceCents: 75000, disbursementStatus: 'disbursed', status: 'active', createdAtIso: stamp } })
  for (let installment = 0; installment < 3; installment += 1) {
    operations.push({ ref: db.collection('union_loans').doc(id).collection('installments').doc(`inst-${installment + 1}`), data: { loanId: id, installmentNumber: installment + 1, dueDate: `2026-${String(9 + installment).padStart(2, '0')}-15`, amountCents: 25000, balanceCents: 25000, status: 'pending' } })
  }
}

for (let i = 0; i < 2000; i += 1) {
  const id = `PUNPERF${String(i).padStart(6, '0')}`
  const branchId = i % 2 ? 'cochabamba' : 'punata'
  operations.push({ ref: db.collection('shipments').doc(id), data: { id, trackingCode: id, status: 'delivered', originBranchId: branchId, destinationBranchId: branchId === 'punata' ? 'cochabamba' : 'punata', sender: { name: `Remitente ${i}`, phone: '70000000' }, recipient: { name: `Destinatario ${i}`, phone: '70000001' }, originCity: 'Punata', destinationCity: 'Cochabamba', amountBob: 20, finalAmountCents: 2000, paymentStatus: 'paid', paymentTiming: 'origin_paid', paymentMethod: 'cash', createdAtIso: stamp, createdAt: new Date(stamp), deliveredAt: stamp } })
}

for (let i = 0; i < 5000; i += 1) {
  operations.push({ ref: db.collection('financial_movements').doc(`perf-movement-${String(i).padStart(5, '0')}`), data: { id: `perf-movement-${i}`, type: i % 4 === 0 ? 'contribution_income' : 'shipment_income', amountCents: 1000 + (i % 100), paymentMethod: i % 3 ? 'cash' : 'qr', branchId: i % 2 ? 'cochabamba' : 'punata', timestamp: stamp, createdAtIso: stamp, createdAt: new Date(stamp) } })
}

for (let i = 0; i < 100; i += 1) operations.push({ ref: db.collection('union_sports_events').doc(`perf-sports-${i}`), data: { id: `perf-sports-${i}`, eventNumber: `DEP-${i}`, title: `Jornada ficticia ${i}`, activityName: 'Fútbol', activityType: 'futbol', date: '2026-11-10', status: 'completed', createdAtIso: stamp } })
for (let i = 0; i < 200; i += 1) {
  operations.push({ ref: db.collection('fixed_assets').doc(`perf-asset-${i}`), data: { id: `perf-asset-${i}`, assetCode: `ACT-PERF-${String(i).padStart(4, '0')}`, name: `Silla sintética ${i}`, category: 'muebles', status: 'available', branchId: i % 2 ? 'cochabamba' : 'punata', acquisitionDate: '2026-01-15', createdAtIso: stamp, qrPayload: `EXPRESO-PUNATA:ACTIVO:perf-asset-${i}` } })
  operations.push({ ref: db.collection('physical_inventory_documents').doc(`perf-doc-${i}`), data: { id: `perf-doc-${i}`, title: `Documento sintético ${String(i).padStart(4, '0')}`, documentType: 'acta', description: 'Documento ficticio para benchmark', patrimonialLocationId: i % 2 ? 'oficina_cochabamba' : 'sede_punata', sheetCount: 10 + i % 20, documentDate: '2026-11-01', status: 'active', createdAtIso: stamp } })
}
for (let i = 0; i < 50; i += 1) operations.push({ ref: db.collection('cash_shifts').doc(`perf-shift-${i}`), data: { id: `perf-shift-${i}`, shiftNumber: `TUR-${i}`, branchId: i % 2 ? 'cochabamba' : 'punata', status: 'closed', openedAt: stamp, openingFloatCents: 10000 } })

await commitOperations(operations)
await authAdmin.createUser({ uid: 'audit-perf-admin', email: 'auditoria.rendimiento@expresopunata.local', password: 'AuditLocal!2026', displayName: 'Admin Auditoría Sintética' })
const counts = {
  unionMembers: 500, children: 500, linkedDrivers: 500,
  financialMovements: 5000, shipments: 2000, dues: 500, loans: 200,
  installments: 600, fines: 500, sportsEvents: 100, fixedAssets: 200,
  physicalDocuments: 200, cashShifts: 50,
}
console.log(JSON.stringify({ seeded: counts, totalDocuments: Object.values(counts).reduce((sum, value) => sum + value, 0) }))

const results = []
results.push(await measure('roster_all_500_with_children', () => getUnionMembersRoster.run({ auth: { uid: 'audit-perf-admin' }, data: {} }), (result) => {
  assert.equal(result.members.length, 500)
  assert.equal(stats.queryCalls, 3, 'el padrón completo usa consulta de perfil, afiliados y colección agrupada de hijos')
  assert.equal(stats.documentReads, 1001)
}))
results.push(await measure('member_statement_with_due_and_child', () => getMemberAccountStatement.run({ auth: { uid: 'audit-perf-admin' }, data: { memberId: 'perf-member-0000' } }), (result) => assert.equal(result.member.id, 'perf-member-0000')))
results.push(await measure('shipments_report_2000', () => getSystemReport.run({ auth: { uid: 'audit-perf-admin' }, data: { reportType: 'shipments', startDate, endDate, branchId: 'all', pageSize: 500 } }), (result) => assert.equal(result.summary.totalShipments, 2000)))
results.push(await measure('cash_report_5000_movements', () => getSystemReport.run({ auth: { uid: 'audit-perf-admin' }, data: { reportType: 'cash_financial', startDate, endDate, branchId: 'all' } }), (result) => {
  assert.equal(result.pagination.totalRecords, 5000)
  assert.equal(result.summary.contributionsIncomeCents, 1310000)
  assert.equal(result.summary.commercialIncomeCents, 3937500)
  assert.equal(result.summary.netOperatingCents, 5247500)
  assert.equal(stats.queryCalls, 4, 'el reporte conserva una consulta por cada campo histórico de fecha, además de perfil y turnos')
  assert.equal(stats.documentReads, 10051, 'cada campo histórico coincide con la muestra; se deduplica en memoria')
}))
for (const reportType of ['members', 'loans', 'fines', 'sports', 'physical_inventory']) {
  results.push(await measure(`section_report_${reportType}`, () => getSystemReport.run({ auth: { uid: 'audit-perf-admin' }, data: { reportType, startDate, endDate, branchId: 'all' } }), (result) => assert.equal(result.success, true)))
}
results.push(await measure('debt_alerts_all', () => listUnionDebtAlerts.run({ auth: { uid: 'audit-perf-admin' }, data: {} }), (result) => assert.equal(result.success, true)))
results.push(await measure('physical_documents_list', () => listPhysicalInventoryDocuments.run({ auth: { uid: 'audit-perf-admin' }, data: {} }), (result) => assert.equal(result.documents.length, 200)))

mkdirSync('tmp/performance-audit', { recursive: true })
writeFileSync('tmp/performance-audit/firebase-large-dataset-results.json', JSON.stringify({ projectId, counts, results }, null, 2))
console.log(`RESULTS_FILE=tmp/performance-audit/firebase-large-dataset-results.json`)
