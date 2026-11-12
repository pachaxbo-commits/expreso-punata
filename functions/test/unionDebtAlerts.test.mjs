import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { collectUnionFinePayment, createUnionFine, listUnionDebtAlerts, openCashShift } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-debt-alerts' })
const db = getFirestore()

test('Alertas de deudas: cuotas, préstamo desembolsado, multas, sucursal, saldo vigente y consulta sin escrituras financieras', async () => {
  const suffix = Date.now().toString(36)
  const memberId = `alert-member-${suffix}`
  const otherId = `alert-other-${suffix}`
  const managerUid = `alert-manager-${suffix}`
  const secretaryUid = `alert-secretary-${suffix}`
  const affiliateUid = `alert-affiliate-${suffix}`
  const affiliateAdminUid = `alert-admin-${suffix}`
  const deniedUid = `alert-denied-${suffix}`
  await Promise.all([
    db.collection('users').doc(managerUid).set({ role: 'tesoreria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] }),
    db.collection('users').doc(secretaryUid).set({ role: 'secretaria', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] }),
    db.collection('users').doc(affiliateUid).set({ role: 'afiliado', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'], unionMemberId: memberId }),
    db.collection('users').doc(affiliateAdminUid).set({ role: 'afiliado_admin', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] }),
    db.collection('users').doc(deniedUid).set({ role: 'conductor', isActive: true, primaryBranchId: 'punata', allowedBranchIds: ['punata'] }),
    db.collection('union_members').doc(memberId).set({ id: memberId, fullName: 'Afiliado Alertas', memberNumber: 'ALT-01', branchId: 'punata', status: 'active' }),
    db.collection('union_members').doc(otherId).set({ id: otherId, fullName: 'Afiliado Otra Sucursal', memberNumber: 'ALT-02', branchId: 'cochabamba', status: 'active' }),
  ])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
  const overdueDate = new Date(`${today}T00:00:00Z`); overdueDate.setUTCDate(overdueDate.getUTCDate() - 1)
  const overdue = overdueDate.toISOString().slice(0, 10)
  await Promise.all([
    db.collection('union_dues').doc(`alert-due-${suffix}`).set({ memberId, memberName: 'Afiliado Alertas', period: '2026-01', amountCents: 12000, balanceCents: 8000, dueDate: overdue }),
    db.collection('union_dues').doc(`alert-dueno-date-${suffix}`).set({ memberId, memberName: 'Afiliado Alertas', period: '2026-02', amountCents: 4000, balanceCents: 4000 }),
    db.collection('union_dues').doc(`alert-other-due-${suffix}`).set({ memberId: otherId, period: '2026-01', amountCents: 7000, balanceCents: 7000, dueDate: overdue }),
    db.collection('union_loans').doc(`alert-loan-${suffix}`).set({ memberId, memberName: 'Afiliado Alertas', loanNumber: 'PRE-ALERT', principalCents: 15000, balanceCents: 9000, disbursementStatus: 'disbursed' }),
    db.collection('union_loans').doc(`alert-undisbursed-${suffix}`).set({ memberId, loanNumber: 'PRE-PENDING', balanceCents: 5000, disbursementStatus: 'pending' }),
    db.collection('union_loans').doc(`alert-legacy-${suffix}`).set({ memberId, loanNumber: 'PRE-LEGACY', balanceCents: 6000, disbursementStatus: 'legacy_unknown' }),
    db.collection('union_fines').doc(`alert-general-fine-${suffix}`).set({ memberId, memberName: 'Afiliado Alertas', category: 'transporte', reason: 'General', amountCents: 3000, balanceCents: 3000, status: 'pending' }),
    db.collection('union_fines').doc(`alert-sports-fine-${suffix}`).set({ memberId, memberName: 'Afiliado Alertas', category: 'deportes', reason: 'Tardanza', amountCents: 10000, balanceCents: 6000, paidCents: 4000, status: 'partial', financialReviewRequired: true }),
    db.collection('union_fines').doc(`alert-paid-${suffix}`).set({ memberId, category: 'deportes', balanceCents: 0, status: 'paid' }),
    db.collection('union_fines').doc(`alert-void-${suffix}`).set({ memberId, category: 'deportes', balanceCents: 500, status: 'voided' }),
    db.collection('union_loans').doc(`alert-loan-${suffix}`).collection('installments').doc('01').set({ loanId: `alert-loan-${suffix}`, balanceCents: 3000, dueDate: overdue }),
    db.collection('union_loans').doc(`alert-loan-${suffix}`).collection('installments').doc('02').set({ loanId: `alert-loan-${suffix}`, balanceCents: 6000, dueDate: '2099-12-31' }),
  ])
  const beforeMovements = (await db.collection('financial_movements').get()).size
  const beforeFine = (await db.collection('union_fines').doc(`alert-sports-fine-${suffix}`).get()).data()
  const manager = await listUnionDebtAlerts.run({ auth: { uid: managerUid }, data: { memberId } })
  assert.equal(manager.alerts.reduce((sum, item) => sum + item.amountCents, 0), 30000)
  assert.equal(manager.alerts.find((item) => item.type === 'due' && item.period === '2026-01').status, 'overdue')
  assert.equal(manager.alerts.find((item) => item.type === 'due' && item.period === '2026-02').status, 'pending')
  assert.equal(manager.alerts.find((item) => item.type === 'loan').overdueAmountCents, 3000)
  assert.equal(manager.alerts.find((item) => item.type === 'fine' && item.category === 'deportes').amountCents, 6000)
  assert.equal(manager.alerts.some((item) => item.label === 'PRE-PENDING' || item.label === 'PRE-LEGACY'), false)
  const secretary = await listUnionDebtAlerts.run({ auth: { uid: secretaryUid }, data: { memberId } })
  assert.equal(secretary.alerts.some((item) => item.type === 'fine' && item.category !== 'deportes'), false)
  const affiliate = await listUnionDebtAlerts.run({ auth: { uid: affiliateUid }, data: {} })
  assert.equal(affiliate.alerts.every((item) => item.memberId === memberId), true)
  await assert.rejects(() => listUnionDebtAlerts.run({ auth: { uid: affiliateUid }, data: { memberId: otherId } }), (error) => error.code === 'permission-denied')
  const affiliateAdmin = await listUnionDebtAlerts.run({ auth: { uid: affiliateAdminUid }, data: {} })
  assert.equal(affiliateAdmin.alerts.every((item) => item.memberId !== otherId), true)
  await assert.rejects(() => listUnionDebtAlerts.run({ auth: { uid: deniedUid }, data: {} }), (error) => error.code === 'permission-denied')
  const unauth = await listUnionDebtAlerts.run({ data: {} }).then(() => null, (error) => error)
  assert.equal(unauth?.code, 'unauthenticated')
  const fine = await createUnionFine.run({ auth: { uid: managerUid }, data: { memberId, category: 'deportes', reason: 'Prueba alertas sin Caja', date: today, amountCents: 100, notes: '' } })
  const afterCreateAlerts = await listUnionDebtAlerts.run({ auth: { uid: managerUid }, data: { memberId } })
  assert.ok(afterCreateAlerts.alerts.some((item) => item.id === fine.fine.id && item.amountCents === 100))
  assert.equal((await db.collection('financial_movements').get()).size, beforeMovements, 'la consulta/creación de multa sin cobro no genera movimiento de Caja')
  assert.deepEqual((await db.collection('union_fines').doc(`alert-sports-fine-${suffix}`).get()).data(), beforeFine, 'consultar alertas no cambia la multa')
  const shift = await openCashShift.run({ auth: { uid: secretaryUid }, data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: `alert-shift-${suffix}` } })
  await collectUnionFinePayment.run({ auth: { uid: secretaryUid }, data: { fineId: fine.fine.id, amountCents: 40, shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `alert-fine-partial-${suffix}` } })
  const partialAlerts = await listUnionDebtAlerts.run({ auth: { uid: managerUid }, data: { memberId } })
  assert.equal(partialAlerts.alerts.find((item) => item.id === fine.fine.id)?.amountCents, 60, 'la consulta refleja el saldo real tras un pago parcial')
  const movementCountAfterPayment = (await db.collection('financial_movements').get()).size
  await collectUnionFinePayment.run({ auth: { uid: secretaryUid }, data: { fineId: fine.fine.id, amountCents: 60, shiftId: shift.shift.id, branchId: 'punata', idempotencyKey: `alert-fine-final-${suffix}` } })
  const movementCountAfterSettlement = (await db.collection('financial_movements').get()).size
  const settledAlerts = await listUnionDebtAlerts.run({ auth: { uid: managerUid }, data: { memberId } })
  assert.equal(settledAlerts.alerts.some((item) => item.id === fine.fine.id), false, 'la deuda desaparece al liquidar el saldo')
  assert.equal(movementCountAfterSettlement, movementCountAfterPayment + 1, 'el pago final crea únicamente su movimiento financiero esperado')
  assert.equal((await db.collection('financial_movements').get()).size, movementCountAfterSettlement, 'consultar las alertas tras el cobro no genera movimientos financieros duplicados')

  const batch = db.batch()
  for (let index = 0; index < 255; index += 1) {
    const loadMemberId = `alert-load-${suffix}-${index}`
    batch.set(db.collection('union_members').doc(loadMemberId), { fullName: `Afiliado carga ${index}`, memberNumber: `LOAD-${index}`, branchId: 'punata', status: 'active' })
    batch.set(db.collection('union_dues').doc(`alert-load-due-${suffix}-${index}`), { memberId: loadMemberId, period: '2026-01', amountCents: 100, balanceCents: 100 })
  }
  await batch.commit()
  const loaded = await listUnionDebtAlerts.run({ auth: { uid: managerUid }, data: {} })
  assert.equal(loaded.truncated, true, 'la consulta global anuncia que alcanzó su límite en vez de leer sin tope')
  assert.ok(loaded.alerts.length <= 260, 'las alertas cargadas permanecen acotadas cerca del límite configurado')
})
