import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getFirestore } from 'firebase-admin/firestore'
import * as operations from '../index.js'

const db = getFirestore()
import { prefix, sample } from '../../tests/fixtures/affiliateOperations.mjs'

test('proyección de los 15 módulos, filtros, búsqueda, agencia y campos privados', async () => {
  const uid = prefix + '-affiliate'
  await db.collection('users').doc(uid).set({ role: 'afiliado', isActive: true, primaryBranchId: 'punata' })
  for (const [, collection, values] of sample) {
    await db.collection(collection).doc(prefix).set({
      ...values, branchId: 'punata', createdAtIso: '2026-11-18T18:00:00Z',
      ci: 'privado', phone: 'privado', fullName: 'privado', notes: 'privado',
      childName: 'privado', paymentReference: 'privado', ticketCode: 'privado',
    })
  }
  for (const [module, , values] of sample) {
    const search = String(Object.entries(values).filter(([key]) => !['originBranchId', 'destinationBranchId', 'memberId'].includes(key)).at(-1)[1])
    const data = { module, branchId: 'punata', search, from: '2026-11-18', to: '2026-11-18' }
    const page = await operations.listAffiliateOperations.run({ auth: { uid }, data })
    assert.equal(page.rows.length, 1, module)
    assert.ok(Object.values(page.rows[0].values).map(String).includes(search), module)
    assert.ok(!JSON.stringify(page).includes('privado'), module)
    assert.equal((await operations.listAffiliateOperations.run({ auth: { uid }, data: { ...data, from: '2026-11-19', to: '' } })).rows.length, 0, module)
    await assert.rejects(operations.listAffiliateOperations.run({ auth: { uid }, data: { ...data, branchId: 'cochabamba' } }), { code: 'permission-denied' })
  }
  for (const module of ['users', 'configuration', 'audit_logs', 'toString']) {
    await assert.rejects(operations.listAffiliateOperations.run({ auth: { uid }, data: { module, branchId: 'punata' } }), { code: 'invalid-argument' })
  }
})

test('mutaciones administrativas rechazan afiliado, secretaría y soporte aunque el token declare administración', async () => {
  const administrativeActions = [
    'disburseUnionLoan', 'createUnionLoan', 'collectUnionLoanPayment', 'createUnionFine',
    'collectUnionFinePayment', 'manageUnionMember', 'generateMonthlyDues',
    'manageWorker', 'registerWorkerPayment', 'registerGeneralExpense', 'registerCashExpense',
    'manageFixedAsset', 'manageConsumable', 'managePhysicalInventoryDocument', 'settleDriverCommission',
    'settleDriverCash', 'accrueDriverCommission', 'createExpenseAuthorization', 'adminProvisionUser', 'adminSendPasswordReset', 'updateSystemConfig',
  ]
  const secretaryAuthorizedActions = new Set([
    'disburseUnionLoan', 'createUnionLoan', 'collectUnionLoanPayment', 'createUnionFine', 'collectUnionFinePayment',
    'registerCashExpense',
  ])
  for (const role of ['afiliado', 'secretaria', 'soporte_pachax']) {
    const uid = prefix + '-' + role
    await db.collection('users').doc(uid).set({ role, isActive: true, primaryBranchId: 'punata' })
    const request = {
      auth: { uid, token: { role: 'directiva_admin' } },
      data: {
        branchId: 'punata', idempotencyKey: 'denied-role-phase-one',
        originBranchId: 'punata', destinationBranchId: 'cochabamba',
        travelDate: '2026-12-01', driverUid: 'synthetic-driver', quantity: 1, unitAmountCents: 1000,
      },
    }
    const forbiddenActions = role === 'secretaria'
      ? administrativeActions.filter((action) => !secretaryAuthorizedActions.has(action))
      : administrativeActions
    for (const action of forbiddenActions) {
      await assert.rejects(operations[action].run(request), { code: 'permission-denied' }, role + ' / ' + action)
    }
    if (role !== 'secretaria') {
      for (const action of ['createShipment', 'createPassengerTicket', 'openCashShift', 'closeCashShift', 'getSystemReport', 'getSystemConfig']) {
        await assert.rejects(operations[action].run(request), { code: 'permission-denied' }, role + ' / ' + action)
      }
    }
  }
})
