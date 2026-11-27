import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const projectId = process.env.GCLOUD_PROJECT
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || ''
const emulator = /^127\.0\.0\.1:(\d+)$/.exec(firestoreHost)
if (projectId !== 'demo-expreso-punata-finalization' || !emulator) {
  throw new Error('affiliateRules requiere el lanzador aislado y Firestore Emulator en loopback.')
}
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: Number(emulator[1]) },
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
// El afiliado normal obtiene su propia cuenta mediante getMyUnionAccount; las
// lecturas directas de documentos financieros/personales quedan cerradas.
await assertFails(getDoc(doc(db, 'union_members', 'member-own')))
await assertFails(getDoc(doc(db, 'union_members', 'member-other')))
await assertFails(getDoc(doc(db, 'union_dues', 'due-own')))
await assertFails(getDoc(doc(db, 'union_loans', 'loan-own')))
await assertFails(getDoc(doc(db, 'union_fines', 'fine-own')))
await assertFails(setDoc(doc(db, 'union_dues', 'due-own'), { balanceCents: 0 }))
await env.cleanup()
console.log('afiliado Firestore Rules: 6/6 comprobaciones aprobadas')
