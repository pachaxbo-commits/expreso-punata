import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const port = Number(process.env.FIRESTORE_RULES_PORT || 16080)
const env = await initializeTestEnvironment({
  projectId: 'demo-affiliate-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port },
})

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, 'users', 'affiliate'), { role: 'afiliado', primaryBranchId: 'punata', allowedBranchIds: ['punata'], unionMemberId: 'member-own', isActive: true })
  await setDoc(doc(db, 'union_members', 'member-own'), { memberId: 'member-own', branchId: 'punata', status: 'active' })
  await setDoc(doc(db, 'union_members', 'member-other'), { memberId: 'member-other', branchId: 'cochabamba', status: 'active' })
  await setDoc(doc(db, 'union_dues', 'due-own'), { memberId: 'member-own', branchId: 'punata', balanceCents: 100 })
  await setDoc(doc(db, 'union_dues', 'due-other'), { memberId: 'member-other', branchId: 'cochabamba', balanceCents: 100 })
  await setDoc(doc(db, 'union_loans', 'loan-own'), { memberId: 'member-own', branchId: 'punata' })
  await setDoc(doc(db, 'union_fines', 'fine-own'), { memberId: 'member-own', branchId: 'punata' })
})

const db = env.authenticatedContext('affiliate').firestore()
assert.equal((await getDoc(doc(db, 'union_members', 'member-own'))).exists(), true)
await assertFails(getDoc(doc(db, 'union_members', 'member-other')))
await assertSucceeds(getDoc(doc(db, 'union_dues', 'due-own')))
await assertSucceeds(getDoc(doc(db, 'union_loans', 'loan-own')))
await assertSucceeds(getDoc(doc(db, 'union_fines', 'fine-own')))
await assertFails(setDoc(doc(db, 'union_dues', 'due-own'), { balanceCents: 0 }))
await env.cleanup()
console.log('afiliado Firestore Rules: 6/6 comprobaciones aprobadas')
