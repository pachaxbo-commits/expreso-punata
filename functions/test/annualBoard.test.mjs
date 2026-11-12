import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { listAnnualBoards, saveAnnualBoard } from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
if (getApps().length === 0) initializeApp({ projectId: 'demo-expreso-punata-annual-board' })
const db = getFirestore()

async function user(uid, role) {
  await db.collection('users').doc(uid).set({ uid, role, primaryBranchId: 'punata', allowedBranchIds: ['punata'], fullName: `Prueba ${role}`, isActive: true })
}

test('Directiva anual: selección de afiliados, historial por período, edición con revisiones, duplicados y autorización', async () => {
  const suffix = Date.now().toString(36)
  const adminUid = `board-admin-${suffix}`
  const treasuryUid = `board-treasury-${suffix}`
  const secretaryUid = `board-secretary-${suffix}`
  const member1 = `board-affiliate-1-${suffix}`
  const member2 = `board-affiliate-2-${suffix}`
  const notFoundMember = `board-missing-${suffix}`
  const firstYear = 1900 + (Number.parseInt(suffix, 36) % 290)
  const boardInput = (year, overrides = {}) => ({
    year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, electedAt: `${year - 1}-12-15`, status: 'active', observations: '',
    members: [{ memberId: member1, position: 'Presidencia (cargo configurable)' }, { memberId: member2, position: 'Secretaría' }], ...overrides,
  })
  await user(adminUid, 'directiva_admin')
  await user(treasuryUid, 'tesoreria')
  await user(secretaryUid, 'secretaria')
  await db.collection('union_members').doc(member1).set({ id: member1, memberNumber: `SOC-1-${suffix}`, fullName: 'Afiliada Uno', status: 'active', branchId: 'punata' })
  await db.collection('union_members').doc(member2).set({ id: member2, memberNumber: `SOC-2-${suffix}`, fullName: 'Afiliado Dos', status: 'active', branchId: 'punata' })
  await assert.rejects(() => listAnnualBoards.run({ auth: { uid: secretaryUid }, data: {} }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => listAnnualBoards.run({ data: {} }), (error) => error.code === 'unauthenticated')

  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: adminUid }, data: boardInput(firstYear, { members: [{ memberId: member1, position: 'Presidente' }, { memberId: member1, position: 'Vocal' }] }) }), (error) => error.code === 'invalid-argument')
  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: adminUid }, data: boardInput(firstYear, { members: [{ memberId: notFoundMember, position: 'Presidente' }] }) }), (error) => error.code === 'not-found')
  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: adminUid }, data: boardInput(firstYear, { startDate: `${firstYear}-02-30` }) }), (error) => error.code === 'invalid-argument')

  const first = await saveAnnualBoard.run({ auth: { uid: adminUid }, data: boardInput(firstYear, { status: 'completed' }) })
  assert.equal(first.board.id, String(firstYear))
  assert.equal(first.board.members[0].fullName, 'Afiliada Uno')
  assert.equal(first.board.members[0].position, 'Presidencia (cargo configurable)')
  assert.equal((await db.collection('users').doc(member1).get()).exists, false, 'registrar a un integrante no crea cuenta de usuario')
  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: adminUid }, data: boardInput(firstYear) }), (error) => error.code === 'already-exists')

  const next = await saveAnnualBoard.run({ auth: { uid: treasuryUid }, data: boardInput(firstYear + 1) })
  assert.equal(next.board.year, firstYear + 1)
  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: adminUid }, data: boardInput(firstYear + 2, { startDate: `${firstYear + 1}-06-01`, endDate: `${firstYear + 2}-05-31` }) }), (error) => error.code === 'already-exists')
  const updated = await saveAnnualBoard.run({ auth: { uid: adminUid }, data: { ...boardInput(firstYear, { status: 'completed', observations: 'Acta aprobada' }), id: first.board.id } })
  assert.equal(updated.board.observations, 'Acta aprobada')
  assert.equal((await db.collection('union_boards').doc(String(firstYear)).collection('revisions').get()).size, 1, 'la versión anterior se conserva al editar')
  const listed = await listAnnualBoards.run({ auth: { uid: adminUid }, data: {} })
  assert.deepEqual(listed.boards.map((entry) => entry.year), [firstYear + 1, firstYear])
  assert.equal((await db.collection('union_boards').doc(String(firstYear)).get()).data().members.length, 2)
  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: secretaryUid }, data: boardInput(firstYear + 2) }), (error) => error.code === 'permission-denied')
  await assert.rejects(() => saveAnnualBoard.run({ auth: { uid: adminUid }, data: { ...boardInput(firstYear), id: String(firstYear + 1) } }), (error) => error.code === 'invalid-argument')
  assert.equal((await db.collection('union_members').doc(member1).get()).data().fullName, 'Afiliada Uno', 'la directiva no modifica los registros del padrón')
  assert.equal((await db.collection('users').doc(member1).get()).exists, false)
  assert.equal((await db.collection('users').doc(member2).get()).exists, false)
})
