import { httpsCallable } from 'firebase/functions'
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { UnionMember, UnionMonthlyDue } from '../types/index.ts'

export interface ManageUnionMemberInput {
  id?: string
  memberNumber: string
  fullName: string
  ci?: string
  phone?: string
  joinedAt?: string
  status?: 'active' | 'inactive' | 'suspended' | 'honorary'
  category?: 'propietario_transporte' | 'conductor' | 'socio_general'
  vehiclePlate?: string
  assignedMobileNumber?: string
  monthlyFeeBob?: number
  monthlyFeeCents?: number
  notes?: string
}

export interface CollectMemberDueInput {
  dueId: string
  amountCents?: number
  amountBob?: number
  paymentMethod?: 'cash' | 'qr' | 'transfer'
  shiftId?: string | null
  branchId?: string
  notes?: string
  idempotencyKey: string
}

export interface CollectMemberDueResult {
  success: boolean
  receiptNumber: string
  paymentId: string
  dueId: string
  memberNumber: string
  memberName: string
  period: string
  periodLabel: string
  amountCents: number
  amountBob: number
  remainingBalanceCents: number
  remainingBalanceBob: number
  status: 'paid' | 'partial'
  paymentMethod: string
  paidAtIso: string
  collectedByName: string
}

export interface MemberAccountStatementResult {
  member: UnionMember
  dues: UnionMonthlyDue[]
  summary: {
    totalDuesCount: number
    totalBilledCents: number
    totalBilledBob: number
    totalPaidCents: number
    totalPaidBob: number
    totalBalanceCents: number
    totalBalanceBob: number
    overdueCount: number
    isUpToDate: boolean
  }
}

/**
 * Registra o edita un socio en el padrón mediante Cloud Function autenticada.
 */
export async function manageUnionMemberThroughBackend(
  input: ManageUnionMemberInput
): Promise<{ success: boolean; isNew: boolean; member: UnionMember }> {
  const callFn = httpsCallable<ManageUnionMemberInput, { success: boolean; isNew: boolean; member: UnionMember }>(
    functions,
    'manageUnionMember'
  )
  const res = await callFn(input)
  return res.data
}

/**
 * Emite cuotas ordinarias para todos los socios activos en un período (ej. '2026-11').
 */
export async function generateMonthlyDuesThroughBackend(input: {
  period: string
  dueDate?: string
  notes?: string
}): Promise<{
  success: boolean
  period: string
  periodLabel: string
  generatedCount: number
  skippedCount: number
  totalAmountCents: number
  totalAmountBob: number
}> {
  const callFn = httpsCallable<any, any>(functions, 'generateMonthlyDues')
  const res = await callFn(input)
  return res.data
}

/**
 * Registra el cobro transaccional de una cuota de socio, vinculándolo a caja si aplica.
 */
export async function collectMemberDueThroughBackend(
  input: CollectMemberDueInput
): Promise<CollectMemberDueResult> {
  const callFn = httpsCallable<CollectMemberDueInput, CollectMemberDueResult>(
    functions,
    'collectMemberDue'
  )
  const res = await callFn(input)
  return res.data
}

/**
 * Obtiene el extracto de cuenta y balance histórico de un socio.
 */
export async function getMemberAccountStatementThroughBackend(
  memberId: string
): Promise<MemberAccountStatementResult> {
  const callFn = httpsCallable<{ memberId: string }, MemberAccountStatementResult>(
    functions,
    'getMemberAccountStatement'
  )
  const res = await callFn({ memberId })
  return res.data
}

/**
 * Suscripción en tiempo real al padrón de socios.
 */
export function subscribeUnionMembers(
  onData: (members: UnionMember[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'union_members'), orderBy('memberNumber', 'asc'))
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as UnionMember[]
      onData(list)
    },
    (err) => {
      console.warn('[unionService] Error al suscribir a socios:', err)
      if (onError) onError(err)
    }
  )
}

/**
 * Suscripción en tiempo real a cuotas sindicales por período.
 */
export function subscribeUnionDues(
  period: string,
  onData: (dues: UnionMonthlyDue[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'union_dues'),
    where('period', '==', period),
    orderBy('memberNumber', 'asc')
  )
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as UnionMonthlyDue[]
      onData(list)
    },
    (err) => {
      console.warn('[unionService] Error al suscribir a cuotas:', err)
      if (onError) onError(err)
    }
  )
}
