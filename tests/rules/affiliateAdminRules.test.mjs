import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const port = Number(process.env.FIRESTORE_RULES_PORT || 16080)
const env = await initializeTestEnvironment({
  projectId: 'demo-affiliate-admin-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port },
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'users', 'affiliate-admin'), { role: 'afiliado_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
  await setDoc(doc(db, 'union_members', 'member-punata'), { branchId: 'punata', memberId: 'member-punata', memberNumber: 'PUN-001' })
  await setDoc(doc(db, 'union_members', 'member-cbba'), { branchId: 'cochabamba', memberId: 'member-cbba', memberNumber: 'CBB-001' })
  await setDoc(doc(db, 'union_loans', 'loan-punata'), { memberId: 'member-punata', branchId: 'punata' })
  await setDoc(doc(db, 'union_loans', 'loan-cbba'), { memberId: 'member-cbba', branchId: 'cochabamba' })
  await setDoc(doc(db, 'union_dues', 'due-punata'), { memberId: 'member-punata', branchId: 'punata' })
})

const db = env.authenticatedContext('affiliate-admin').firestore()
assert.equal((await getDoc(doc(db, 'union_members', 'member-punata'))).exists(), true)
assert.equal((await getDoc(doc(db, 'union_loans', 'loan-punata'))).exists(), true)
assert.equal((await getDoc(doc(db, 'union_dues', 'due-punata'))).exists(), true)
await assertFails(getDoc(doc(db, 'union_members', 'member-cbba')))
await assertFails(getDoc(doc(db, 'union_loans', 'loan-cbba')))
await assertFails(setDoc(doc(db, 'union_members', 'member-new'), { branchId: 'punata' }))
await env.cleanup()
console.log('affiliate_admin Firestore Rules: 6/6 comprobaciones aprobadas')
