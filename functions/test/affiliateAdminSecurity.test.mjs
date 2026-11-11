import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import {
  manageUnionMember,
  listUnionLoans,
  listUnionFines,
  createUnionLoan,
  createUnionFine,
  collectUnionLoanPayment,
  collectMemberDue,
  openCashShift,
  adminProvisionUser,
} from '../index.js'

if (getApps().length === 0) initializeApp({ projectId: 'demo-affiliate-admin-security' })
const db = getFirestore()
const auth = getAuth()
const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function clear() {
  for (const collection of ['users', 'union_members', 'union_loans', 'union_fines', 'union_dues', 'audit_logs', 'counters', 'idempotency_keys', 'cash_shifts']) {
    const snapshot = await db.collection(collection).get()
    if (snapshot.empty) continue
    const batch = db.batch()
    snapshot.docs.forEach((item) => batch.delete(item.ref))
    await batch.commit()
  }
}

async function user(uid, role, allowedBranchIds = ['punata']) {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId: allowedBranchIds[0], allowedBranchIds, fullName: uid, isActive: true })
}

beforeEach(clear)

test('adminProvisionUser: vincula afiliado_admin a un afiliado activo de su sucursal y rechaza vínculos inválidos', async () => {
  const suffix = runId()
  const adminUid = `directiva-link-${suffix}`
  await user(adminUid, 'directiva_admin', ['punata', 'cochabamba'])

  const activeMemberId = `member-link-${suffix}`
  await db.collection('union_members').doc(activeMemberId).set({
    id: activeMemberId,
    memberNumber: `LINK-${suffix}`,
    fullName: 'Afiliado Admin de Prueba',
    branchId: 'punata',
    status: 'active',
  })

  const targetUid = `affiliate-admin-link-${suffix}`
  await auth.createUser({ uid: targetUid, email: `${targetUid}@example.com` })
  const result = await adminProvisionUser.run({
    auth: { uid: adminUid, token: { email: `${adminUid}@example.com` } },
    data: {
      targetUid,
      fullName: 'Cuenta Afiliado Admin',
      phone: '70000001',
      role: 'afiliado_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      unionMemberId: activeMemberId,
      isActive: true,
    },
  })
  assert.equal(result.success, true)
  assert.equal(result.profile.role, 'afiliado_admin')
  assert.equal(result.profile.unionMemberId, activeMemberId)
  assert.deepEqual(result.profile.allowedBranchIds, ['punata'])

  const invalidCases = [
    { id: `missing-${suffix}`, expected: 'invalid-argument', label: 'sin afiliado' },
    { id: `inactive-${suffix}`, expected: 'failed-precondition', label: 'inactivo', member: { id: `inactive-${suffix}`, branchId: 'punata', status: 'inactive' } },
    { id: `wrong-branch-${suffix}`, expected: 'permission-denied', label: 'otra sucursal', member: { id: `wrong-branch-${suffix}`, branchId: 'cochabamba', status: 'active' } },
  ]
  for (const item of invalidCases) {
    if (item.member) await db.collection('union_members').doc(item.member.id).set(item.member)
    const invalidUid = `invalid-link-${item.id}`
    await auth.createUser({ uid: invalidUid, email: `${invalidUid}@example.com` })
    await assert.rejects(
      () => adminProvisionUser.run({
        auth: { uid: adminUid, token: { email: `${adminUid}@example.com` } },
        data: {
          targetUid: invalidUid,
          fullName: 'Cuenta inválida',
          phone: '70000002',
          role: 'afiliado_admin',
          primaryBranchId: 'punata',
          allowedBranchIds: ['punata'],
          unionMemberId: item.member?.id,
          isActive: true,
        },
      }),
      (error) => error.code === item.expected,
      item.label,
    )
  }

  const duplicateUid = `duplicate-link-${suffix}`
  await auth.createUser({ uid: duplicateUid, email: `${duplicateUid}@example.com` })
  await assert.rejects(
    () => adminProvisionUser.run({
      auth: { uid: adminUid, token: { email: `${adminUid}@example.com` } },
      data: {
        targetUid: duplicateUid,
        fullName: 'Cuenta duplicada',
        phone: '70000003',
        role: 'afiliado_admin',
        primaryBranchId: 'punata',
        allowedBranchIds: ['punata'],
        unionMemberId: activeMemberId,
        isActive: true,
      },
    }),
    (error) => error.code === 'already-exists',
  )
  assert.equal((await db.collection('users').doc(duplicateUid).get()).exists, false)
})

test('afiliado_admin: gestiona afiliados de su sucursal y consulta información financiera', async () => {
  const suffix = runId()
  const uid = `affiliate-admin-${suffix}`
  await user(uid, 'afiliado_admin', ['punata'])
  const memberId = `member-${suffix}`

  const created = await manageUnionMember.run({ auth: { uid }, data: { id: memberId, memberNumber: `AFF-${suffix}`, fullName: 'Afiliado Permitido', phone: '70000001', monthlyFeeBob: 50 } })
  assert.equal(created.success, true)
  assert.equal(created.member.branchId, 'punata')

  const edited = await manageUnionMember.run({ auth: { uid }, data: { id: memberId, memberNumber: `AFF-${suffix}`, fullName: 'Afiliado Editado', phone: '70000002', monthlyFeeBob: 50 } })
  assert.equal(edited.member.fullName, 'Afiliado Editado')

  await db.collection('union_members').doc(`member-cbba-${suffix}`).set({ id: `member-cbba-${suffix}`, memberNumber: `CBB-${suffix}`, fullName: 'Afiliado Cochabamba', branchId: 'cochabamba', status: 'active' })
  await assert.rejects(() => manageUnionMember.run({ auth: { uid }, data: { id: `member-cbba-${suffix}`, memberNumber: `CBB-${suffix}`, fullName: 'Intento no autorizado' } }), (error) => error.code === 'permission-denied')

  await db.collection('union_loans').doc(`loan-${suffix}`).set({ id: `loan-${suffix}`, memberId, loanNumber: `PRE-${suffix}`, createdAtIso: new Date().toISOString(), status: 'active', balanceCents: 1000 })
  await db.collection('union_fines').doc(`fine-${suffix}`).set({ id: `fine-${suffix}`, memberId, fineNumber: `MUL-${suffix}`, createdAtIso: new Date().toISOString(), status: 'pending', balanceCents: 500 })
  assert.equal((await listUnionLoans.run({ auth: { uid }, data: {} })).loans.length, 1)
  assert.equal((await listUnionFines.run({ auth: { uid }, data: {} })).fines.length, 1)
})

test('afiliado_admin: no crea, cobra ni administra usuarios o Caja', async () => {
  const suffix = runId()
  const uid = `affiliate-admin-denied-${suffix}`
  await user(uid, 'afiliado_admin', ['punata'])
  const memberId = `member-denied-${suffix}`
  await db.collection('union_members').doc(memberId).set({ id: memberId, memberNumber: `DEN-${suffix}`, fullName: 'Afiliado', branchId: 'punata', status: 'active' })
  const loanInput = { memberId, principalCents: 1000, installmentCount: 1, firstDueDate: '2026-12-15' }
  const fineInput = { memberId, category: 'otros', reason: 'Prueba', description: 'Prueba', date: '2026-11-10', amountCents: 500 }

  await assert.rejects(() => createUnionLoan.run({ auth: { uid }, data: loanInput }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => createUnionFine.run({ auth: { uid }, data: fineInput }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => collectUnionLoanPayment.run({ auth: { uid }, data: { loanId: 'missing', amountCents: 100, paymentMethod: 'transfer', idempotencyKey: `deny-${suffix}` } }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => collectMemberDue.run({ auth: { uid }, data: { dueId: 'missing', amountCents: 100, paymentMethod: 'transfer', idempotencyKey: `due-${suffix}` } }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => openCashShift.run({ auth: { uid }, data: { branchId: 'punata', initialCashCents: 1000 } }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => adminProvisionUser.run({ auth: { uid, token: { email: `affiliate-${suffix}@example.com` } }, data: { fullName: 'No', email: `x-${suffix}@example.com`, phone: '70000000', role: 'secretaria', primaryBranchId: 'punata' } }), (error) => error.code === 'permission-denied')
})
