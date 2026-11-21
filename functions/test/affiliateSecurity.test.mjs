import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getMyUnionAccount, adminProvisionUser, listAffiliateShipments, createShipment, listAffiliatePassengerTickets, validatePassengerTicket } from '../index.js'

const db = getFirestore()
const auth = getAuth()
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

beforeEach(async () => {
  const docs = await db.collection('users').get()
  const batch = db.batch()
  docs.docs.forEach((doc) => batch.delete(doc.ref))
  await batch.commit()
})

test('afiliado consulta únicamente su cuenta vinculada', async () => {
  const id = suffix()
  const uid = `affiliate-${id}`
  await db.collection('users').doc(uid).set({ uid, role: 'afiliado', fullName: 'Afiliado Prueba', primaryBranchId: 'punata', allowedBranchIds: ['punata'], unionMemberId: `member-${id}`, isActive: true })
  await db.collection('union_members').doc(`member-${id}`).set({ memberNumber: `PUN-${id}`, fullName: 'Afiliado Prueba', branchId: 'punata', status: 'active' })
  await db.collection('union_members').doc(`member-other-${id}`).set({ memberNumber: `CBB-${id}`, fullName: 'Otro Afiliado', branchId: 'cochabamba', status: 'active' })
  await db.collection('union_dues').doc(`due-${id}`).set({ memberId: `member-${id}`, amountCents: 1000, balanceCents: 1000, status: 'pending' })
  await db.collection('union_dues').doc(`due-other-${id}`).set({ memberId: `member-other-${id}`, amountCents: 2000, balanceCents: 2000, status: 'pending' })

  const result = await getMyUnionAccount.run({ auth: { uid }, data: {} })
  assert.equal(result.member.memberNumber, `PUN-${id}`)
  assert.equal(result.dues.length, 1)
  assert.equal(result.dues[0].memberId, `member-${id}`)
})

test('adminProvisionUser valida vínculo activo, sucursal y duplicación', async () => {
  const id = suffix()
  const adminUid = `admin-${id}`
  await db.collection('users').doc(adminUid).set({ uid: adminUid, role: 'directiva_admin', fullName: 'Admin Prueba', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'], isActive: true })
  const memberId = `member-${id}`
  const testPassword = `Local-${id}!A9`
  await db.collection('union_members').doc(memberId).set({ memberNumber: `PUN-${id}`, fullName: 'Afiliado Vinculable', branchId: 'punata', status: 'active' })
  const target = await auth.createUser({ email: `affiliate-${id}@example.test`, password: testPassword })
  const result = await adminProvisionUser.run({ auth: { uid: adminUid, token: { email: `admin-${id}@example.test` } }, data: { targetUid: target.uid, fullName: 'Afiliado Vinculable', email: target.email, phone: '70000000', role: 'afiliado', primaryBranchId: 'punata', unionMemberId: memberId, commissionAdministrationApproved: true } })
  assert.equal(result.profile.role, 'afiliado')
  assert.equal(result.profile.commissionAdministrationApproved, false)
  assert.equal(result.profile.unionMemberId, memberId)
  const duplicate = await auth.createUser({ email: `duplicate-${id}@example.test`, password: testPassword })
  await assert.rejects(() => adminProvisionUser.run({ auth: { uid: adminUid, token: { email: `admin-${id}@example.test` } }, data: { targetUid: duplicate.uid, fullName: 'Duplicado', email: duplicate.email, phone: '70000002', role: 'afiliado', primaryBranchId: 'punata', unionMemberId: memberId, commissionAdministrationApproved: true } }), (error) => error.code === 'already-exists')
  await assert.rejects(() => adminProvisionUser.run({ auth: { uid: adminUid, token: { email: `admin-${id}@example.test` } }, data: { fullName: 'Sin vínculo', email: `missing-${id}@example.test`, phone: '70000001', role: 'afiliado', primaryBranchId: 'punata' } }), (error) => error.code === 'invalid-argument')
  await auth.deleteUser(target.uid)
  await auth.deleteUser(duplicate.uid)
})

test('Mi cuenta handles missing links and legacy branch lists without an internal error', async () => {
  const id = suffix()
  const uid = 'legacy-' + id
  const memberId = 'member-' + id
  const profile = db.collection('users').doc(uid)
  const request = { auth: { uid }, data: {} }
  await profile.set({ uid, role: 'afiliado', isActive: true, primaryBranchId: 'punata', allowedBranchIds: 7 })
  await assert.rejects(getMyUnionAccount.run(request), { code: 'failed-precondition' })
  await profile.update({ unionMemberId: memberId })
  await db.collection('union_members').doc(memberId).set({ fullName: 'Cuenta histórica', branchId: 'punata', status: 'active' })
  assert.equal((await getMyUnionAccount.run(request)).member.id, memberId)
  await profile.update({ primaryBranchId: 'cochabamba' })
  await assert.rejects(getMyUnionAccount.run(request), { code: 'permission-denied' })
})

test('company administrator cannot grant technical support or change a technical account', async () => {
  const id = suffix()
  const uid = 'admin-support-test-' + id
  await db.collection('users').doc(uid).set({ uid, role: 'directiva_admin', isActive: true })
  const email = 'support-' + id + '@example.test'
  const target = await auth.createUser({ email, password: 'Synthetic-Local!789' })
  try {
    const request = { auth: { uid, token: { email: 'admin@example.test' } }, data: { fullName: 'Cuenta técnica', phone: '70000000', email } }
    await assert.rejects(adminProvisionUser.run({ ...request, data: { ...request.data, role: 'soporte_pachax' } }), { code: 'invalid-argument' })
    await db.collection('users').doc(target.uid).set({ role: 'soporte_pachax', isActive: true })
    for (const selector of [{ targetUid: target.uid }, {}]) {
      await assert.rejects(adminProvisionUser.run({ ...request, data: { ...request.data, ...selector, role: 'secretaria', isActive: false } }), { code: 'permission-denied' })
    }
    assert.equal((await auth.getUser(target.uid)).disabled, false)
    assert.equal((await db.collection('users').doc(target.uid).get()).data().role, 'soporte_pachax')
  } finally {
    await auth.deleteUser(target.uid)
  }
})

test('affiliate shipment projection omits private fields and rejects foreign agencies and writes', async () => {
  const uid = 'shipment-affiliate-' + suffix()
  await db.collection('users').doc(uid).set({ uid, role: 'afiliado', isActive: true, primaryBranchId: 'punata' })
  const code = 'PUN202599999'
  await db.collection('shipments').doc(code).set({
    trackingCode: code, originBranchId: 'punata', destinationBranchId: 'cochabamba',
    status: 'delivered', createdAtIso: '2025-06-10T14:00:00.000Z', packageCount: 1,
    sender: { name: 'Sintético', phone: '70000001' }, recipient: { name: 'Sintético' },
    deliveryRecord: { receivedByDocNumber: '1234567' }, finalAmountCents: 2500,
  })
  const auth = { uid }
  const result = await listAffiliateShipments.run({ auth, data: { branchId: 'punata', trackingCode: code } })
  assert.deepEqual(result.shipments, [{ trackingCode: code, originBranchId: 'punata', destinationBranchId: 'cochabamba',
    status: 'delivered', createdAtIso: '2025-06-10T14:00:00.000Z', packageCount: 1 }])
  await assert.rejects(listAffiliateShipments.run({ auth, data: { branchId: 'cochabamba' } }), { code: 'permission-denied' })
  await assert.rejects(createShipment.run({ auth, data: {} }), { code: 'permission-denied' })
})

test('affiliate ticket searches omit QR and personal fields and cannot validate boarding', async () => {
  const uid = 'ticket-affiliate-' + suffix()
  await db.collection('users').doc(uid).set({ uid, role: 'afiliado', isActive: true, primaryBranchId: 'punata' })
  const privateCode = 'PJE-0123456789ABCDEF0123'
  const summary = { operationNumber: 'PAS-PUN-2025-999999', originBranchId: 'punata',
    destinationBranchId: 'cochabamba', travelDate: '2025-06-11', quantity: 2, usedCount: 0, paymentStatus: 'paid_verified' }
  await db.collection('passenger_ticket_operations').doc(privateCode).set({
    ...summary, branchId: 'punata', createdAtIso: '2025-06-10T14:00:00Z',
    ticketCode: privateCode, passengerName: 'Dato privado', paymentReference: 'DATO-PRIVADO',
  })
  const auth = { uid }
  const result = await listAffiliatePassengerTickets.run({ auth, data: { branchId: 'punata', travelDate: summary.travelDate, operationNumber: summary.operationNumber } })
  assert.deepEqual(result.operations, [summary])
  await assert.rejects(listAffiliatePassengerTickets.run({ auth, data: { branchId: 'cochabamba' } }), { code: 'permission-denied' })
  await assert.rejects(validatePassengerTicket.run({ auth, data: { ticketCode: privateCode, idempotencyKey: 'affiliate-denied-ticket' } }), { code: 'permission-denied' })
})
