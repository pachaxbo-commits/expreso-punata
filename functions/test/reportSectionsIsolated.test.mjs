import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getSystemReport } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.GCLOUD_PROJECT ||= 'demo-expreso-punata-report-sections-test'
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()

async function clearIsolatedProject() {
  const collections = await db.listCollections()
  for (const collection of collections) {
    const snapshot = await collection.get()
    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const batch = db.batch()
      snapshot.docs.slice(index, index + 400).forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
    }
  }
}

test('Reportes por secciones: filtros, obligaciones separadas, deportes, inventario, autorización y solo lectura', async () => {
  await clearIsolatedProject()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  const financialDay = String((Number(suffix.replace(/\D/g, '').slice(-2)) % 28) + 1).padStart(2, '0')
  const financialDate = `2099-12-${financialDay}`
  const financialRange = { startDate: financialDate, endDate: financialDate }
  const financialIso = `${financialDate}T12:00:00.000Z`
  const memberId = `report-member-${suffix}`
  const adminUid = `report-admin-${suffix}`
  const secretaryUid = `report-secretary-${suffix}`
  const eventId = `report-event-${suffix}`
  const patrimonialLocationId = `report-location-${suffix}`
  await Promise.all([
    db.collection('users').doc(adminUid).set({ uid: adminUid, role: 'directiva_admin', fullName: 'Admin Reportes Fixture', isActive: true }),
    db.collection('users').doc(secretaryUid).set({ uid: secretaryUid, role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true }),
    db.collection('union_members').doc(memberId).set({ memberNumber: `SOC-${suffix.slice(-5)}`, fullName: 'Afiliado Fixture', status: 'active', category: 'socio_general', joinedAt: date, createdAtIso: now }),
    db.collection('union_dues').doc(`due-${suffix}`).set({ memberId, memberNumber: `SOC-${suffix.slice(-5)}`, memberName: 'Afiliado Fixture', period: date.slice(0, 7), amountCents: 2400, paidAmountCents: 1600, balanceCents: 800, status: 'partial', createdAtIso: now }),
    db.collection('union_loans').doc(`loan-${suffix}`).set({ memberId, memberNumber: `SOC-${suffix.slice(-5)}`, memberName: 'Afiliado Fixture', loanNumber: `PRE-${suffix}`, grantDate: date, createdAtIso: now, principalCents: 35000, paidCents: 5000, balanceCents: 30000, status: 'active' }),
    db.collection('union_fines').doc(`fine-${suffix}`).set({ memberId, memberNumber: `SOC-${suffix.slice(-5)}`, memberName: 'Afiliado Fixture', fineNumber: `MUL-${suffix}`, category: 'deportes', date, createdAtIso: now, amountCents: 2400, paidCents: 400, balanceCents: 2000, status: 'partial' }),
    db.collection('union_sports_events').doc(eventId).set({ date, scheduledTime: '10:00', activityName: 'Jornada Fixture', status: 'completed', createdAtIso: now }),
    db.collection('fixed_assets').doc(`asset-${suffix}`).set({ assetCode: `ACT-${suffix}`, name: 'Activo Fixture', category: 'oficina', branchId: 'punata', patrimonialLocationId, physicalLocation: 'Sede de prueba', acquisitionDate: date, quantity: 3, acquisitionCostCents: 12000, status: 'in_use', createdAtIso: now }),
    db.collection('physical_inventory_documents').doc(`document-${suffix}`).set({ title: `Documento ${suffix}`, documentType: 'Acta', patrimonialLocationId, documentDate: date, sheetCount: 12, status: 'active' }),
    ...[
      ['shipment_income', 10000], ['driver_route_cod_collected', 3000], ['contribution_income', 1600], ['fine_income', 400],
      ['loan_repayment', 5000], ['driver_remittance', 7000], ['expense', 2000],
    ].map(([type, amountCents], index) => db.collection('financial_movements').doc(`report-movement-${suffix}-${index}`).set({ id: `report-movement-${suffix}-${index}`, branchId: 'punata', type, category: type, amountCents, paymentMethod: 'cash', timestamp: financialIso, createdAtIso: financialIso })),
  ])
  const financialBefore = await db.collection('financial_movements').get()
  const participants = [
    ['present', false], ['late', true], ['absent', true], ['exempt', false],
  ]
  for (let index = 0; index < participants.length; index++) {
    const [attendance, hasFine] = participants[index]
    await db.collection('union_sports_events').doc(eventId).collection('participants').doc(`participant-${index}`).set({ memberId: `${memberId}-${index}`, memberName: `Participante ${index}`, attendance, fineId: hasFine ? `fine-${index}` : null, justifications: attendance === 'exempt' ? [{ id: 'approved-fixture', status: 'approved' }] : [] })
  }

  const auth = { auth: { uid: adminUid } }
  const range = { startDate: date, endDate: date, pageSize: 500 }
  const [members, loans, fines, sports, inventory] = await Promise.all([
    getSystemReport.run({ ...auth, data: { ...range, reportType: 'members', memberId } }),
    getSystemReport.run({ ...auth, data: { ...range, reportType: 'loans', memberId } }),
    getSystemReport.run({ ...auth, data: { ...range, reportType: 'fines', memberId, category: 'deportes', status: 'partial' } }),
    getSystemReport.run({ ...auth, data: { ...range, reportType: 'sports', status: 'completed' } }),
    getSystemReport.run({ ...auth, data: { ...range, reportType: 'physical_inventory', patrimonialLocationId } }),
  ])
  assert.equal(members.summary.totalMembers, 1)
  assert.equal(members.summary.duesPaidCents, 1600)
  assert.equal(members.summary.duesPendingCents, 800)
  assert.equal(members.summary.loanPendingCents, 30000)
  assert.equal(members.summary.finesPendingCents, 2000)
  assert.equal(loans.summary.principalCents, 35000)
  assert.equal(loans.summary.recoveredCents, 5000)
  assert.equal(loans.summary.pendingCents, 30000)
  assert.equal(loans.summary.isOperatingIncome, false)
  assert.equal(fines.records.length, 1)
  assert.equal(fines.summary.collectedCents, 400)
  assert.equal(fines.summary.pendingCents, 2000)
  assert.deepEqual({ events: sports.summary.events, present: sports.summary.present, late: sports.summary.late, absent: sports.summary.absent, exempt: sports.summary.exempt, requests: sports.summary.exemptionRequests, authorized: sports.summary.authorizedExemptions, sanctioned: sports.summary.sanctioned }, { events: 1, present: 1, late: 1, absent: 1, exempt: 1, requests: 1, authorized: 1, sanctioned: 2 })
  assert.equal(sports.attendanceRecords.length, 4)
  assert.equal(sports.attendanceRecords.find((record) => record.attendance === 'exempt').authorizedExemption, true)
  assert.equal(inventory.summary.assetCount, 1)
  assert.equal(inventory.summary.totalQuantity, 3)
  assert.equal(inventory.summary.totalValueCents, 12000)
  assert.equal(inventory.summary.documentCount, 1)
  assert.equal(inventory.summary.documentSheets, 12)
  const [cash, general] = await Promise.all([
    getSystemReport.run({ ...auth, data: { ...financialRange, reportType: 'cash_financial' } }),
    getSystemReport.run({ ...auth, data: { ...financialRange, reportType: 'consolidated_dashboard', branchId: 'punata' } }),
  ])
  assert.equal(cash.summary.commercialIncomeCents, 13000, 'el COD cobrado en ruta es ingreso comercial, la rendición posterior no se suma otra vez')
  assert.equal(cash.summary.contributionsIncomeCents, 1600)
  assert.equal(cash.summary.fineIncomeCents, 400)
  assert.equal(cash.summary.loanRepaymentsCents, 5000)
  assert.equal(cash.summary.driverRemittancesCents, 7000)
  assert.equal(cash.summary.expensesCents, 2000)
  assert.equal(cash.summary.netOperatingCents, 13000, 'la recuperación de capital no se suma al ingreso operativo')
  assert.equal(general.dashboard.loans.capitalRecoveredCents, 5000)
  assert.equal(general.dashboard.loans.operatingIncomeCents, 0)
  assert.equal(general.dashboard.fines.collectedCents, 400)
  assert.equal(general.dashboard.finances.loanRepaymentsCents, 5000)
  assert.equal(general.dashboard.finances.driverRemittancesCents, 7000)
  assert.equal(general.dashboard.finances.netOperatingCents, 13000)
  await assert.rejects(() => getSystemReport.run({ auth: { uid: secretaryUid }, data: { reportType: 'fines' } }), (error) => error.code === 'permission-denied')
  assert.equal((await db.collection('financial_movements').get()).size, financialBefore.size, 'consultar reportes no crea movimientos de Caja')
  assert.equal((await db.collection('union_loans').doc(`loan-${suffix}`).get()).data().balanceCents, 30000, 'la lectura de reportes no modifica préstamos')
})
