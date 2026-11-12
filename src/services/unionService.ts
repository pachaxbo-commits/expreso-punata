import { httpsCallable } from 'firebase/functions'
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDoc,
  doc,
} from 'firebase/firestore'
import { functions, db, auth } from '../firebase/config.ts'
import type { AnnualBoard, DriverDirectoryEntry, UnionMember, UnionMonthlyDue, UnionSportsAttendance, UnionSportsEvent } from '../types/index.ts'
import { listActiveDriversThroughBackend } from './dispatchService.ts'

export interface ManageUnionMemberInput {
  id?: string
  memberNumber: string
  fullName: string
  ci?: string
  ciComplement?: string
  phone?: string
  alternatePhone?: string
  address?: string
  locality?: string
  birthDate?: string
  joinedAt?: string
  retiredAt?: string
  status?: 'active' | 'inactive' | 'suspended' | 'honorary' | 'retired'
  category?: 'propietario_transporte' | 'conductor' | 'socio_general'
  vehiclePlate?: string
  assignedMobileNumber?: string
  monthlyFeeBob?: number
  monthlyFeeCents?: number
  notes?: string
}

export interface AddUnionMemberChildInput {
  memberId: string
  child: {
    fullName: string
    ci?: string
    birthDate?: string
    phone?: string
    address?: string
    notes?: string
  }
}

export interface AddUnionMemberChildResult {
  success: boolean
  child: {
    id: string
    memberId: string
    fullName: string
    ci: string
    birthDate: string | null
    phone: string
    address: string
    notes: string
    createdAtIso: string
    createdByUid: string
    createdByName: string
  }
}

export interface UnionMemberChild {
  id: string
  memberId: string
  fullName: string
  ci?: string
  birthDate?: string | null
  phone?: string
  address?: string
  notes?: string
  createdAtIso?: string
  createdByUid?: string
  createdByName?: string
  updatedAtIso?: string
  updatedByUid?: string
  updatedByName?: string
  driverUid?: string | null
  driverName?: string | null
  driverLinkedAtIso?: string
}

export type SaveAnnualBoardInput = Pick<AnnualBoard, 'year' | 'startDate' | 'endDate' | 'electedAt' | 'observations' | 'status'> & {
  id?: string
  members: Array<{ memberId: string; position: string }>
}

export async function listAnnualBoardsThroughBackend(): Promise<{ boards: AnnualBoard[]; truncated: boolean }> {
  const call = httpsCallable<void, { success: boolean; boards: AnnualBoard[]; truncated: boolean }>(functions, 'listAnnualBoards')
  const response = await call()
  return { boards: response.data.boards || [], truncated: response.data.truncated }
}

export async function saveAnnualBoardThroughBackend(input: SaveAnnualBoardInput): Promise<AnnualBoard> {
  const call = httpsCallable<SaveAnnualBoardInput, { success: boolean; board: AnnualBoard }>(functions, 'saveAnnualBoard')
  const response = await call(input)
  return response.data.board
}

export interface UnionRosterMember extends UnionMember {
  ciComplement?: string
  alternatePhone?: string
  locality?: string
  primaryDriverName?: string | null
  children: UnionMemberChild[]
}

type ManageUnionMemberChildResponse = {
  success: boolean
  child?: UnionMemberChild
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
  children: UnionMemberChild[]
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

export interface UnionLoanInstallment {
  id: string
  sequence: number
  amountCents: number
  paidAmountCents: number
  balanceCents: number
  dueDate: string
  status: 'pending' | 'partial' | 'paid' | 'overdue'
  paidAtIso?: string | null
}

export interface UnionLoanPayment {
  id: string
  receiptNumber: string
  amountCents: number
  amountBob: number
  paymentMethod: 'cash' | 'qr' | 'transfer'
  paidAtIso: string
  collectedByName: string
  notes?: string | null
  allocations: Array<{ installmentId: string; sequence: number; amountCents: number }>
}
export interface UnionLoanDisbursement {
  id: string
  loanId: string
  loanNumber: string
  amountCents: number
  paymentMethod: 'cash' | 'qr' | 'transfer'
  branchId: string
  shiftId?: string | null
  receiptNumber: string
  disbursedAtIso: string
  disbursedByUid: string
  disbursedByName: string
  notes?: string | null
}

export interface UnionLoan {
  id: string
  loanNumber: string
  memberId: string
  memberNumber: string
  memberName: string
  grantDate: string
  principalCents: number
  principalBob: number
  installmentCount: number
  installmentAmountCents: number
  firstDueDate: string
  notes: string
  status: 'active' | 'overdue' | 'paid'
  disbursementStatus?: 'pending' | 'disbursed' | 'legacy_unknown'
  disbursedCents?: number
  disbursedAtIso?: string | null
  paidCents: number
  balanceCents: number
  balanceBob: number
  overdueBalanceCents?: number
  installments: UnionLoanInstallment[]
  payments: UnionLoanPayment[]
  createdAtIso: string
}

export type UnionFineCategory = 'transporte' | 'conflictos' | 'deportes' | 'otros'
export interface UnionFine {
  id: string
  fineNumber: string
  memberId: string
  memberNumber: string
  memberName: string
  category: UnionFineCategory
  reason: string
  description: string
  date: string
  amountCents: number
  balanceCents: number
  paidCents: number
  status: 'pending' | 'partial' | 'paid' | 'voided'
  notes: string
  createdAtIso: string
  createdByName: string
  payments: UnionFinePayment[]
  source?: 'sports_attendance' | string
  eventId?: string
  attendanceStatus?: 'late' | 'absent'
  financialReviewRequired?: boolean
}
export interface UnionFinePayment {
  id: string
  fineId: string
  receiptNumber: string
  amountCents: number
  amountBob: number
  paymentMethod: 'cash' | 'qr' | 'transfer'
  shiftId: string
  branchId: string
  paidAtIso: string
  collectedByUid: string
  collectedByName: string
  notes?: string | null
}

export interface UnionDebtAlert {
  id: string
  memberId: string
  memberName: string
  memberNumber: string
  type: 'due' | 'loan' | 'fine'
  category: string
  label: string
  amountCents: number
  overdueAmountCents?: number
  status: 'pending' | 'overdue'
  dueDate: string | null
  period: string | null
  reviewRequired: boolean
}

export interface UnionDebtAlertsResult {
  alerts: UnionDebtAlert[]
  truncated: boolean
  installmentScanTruncated: boolean
  asOfDate: string
}
export interface CreateUnionFineInput {
  memberId: string
  category: UnionFineCategory
  reason: string
  description: string
  date: string
  amountCents: number
  notes?: string
}

export interface CreateUnionLoanInput {
  memberId: string
  principalCents: number
  installmentCount: number
  firstDueDate: string
  grantDate?: string
  notes?: string
}

export interface CollectUnionLoanPaymentInput {
  loanId: string
  amountCents: number
  paymentMethod: 'cash' | 'qr' | 'transfer'
  shiftId?: string | null
  branchId?: string
  notes?: string
  idempotencyKey: string
}

export interface DisburseUnionLoanInput {
  loanId: string
  paymentMethod: 'cash' | 'qr' | 'transfer'
  shiftId?: string | null
  branchId?: string
  notes?: string
  idempotencyKey: string
}

export async function createUnionLoanThroughBackend(input: CreateUnionLoanInput): Promise<{ success: boolean; loan: UnionLoan; installments: UnionLoanInstallment[] }> {
  const callable = httpsCallable<CreateUnionLoanInput, { success: boolean; loan: UnionLoan; installments: UnionLoanInstallment[] }>(functions, 'createUnionLoan')
  return (await callable(input)).data
}

export async function collectUnionLoanPaymentThroughBackend(input: CollectUnionLoanPaymentInput): Promise<{ success: boolean; payment: UnionLoanPayment; balanceCents: number; status: UnionLoan['status'] }> {
  const callable = httpsCallable<CollectUnionLoanPaymentInput, { success: boolean; payment: UnionLoanPayment; balanceCents: number; status: UnionLoan['status'] }>(functions, 'collectUnionLoanPayment')
  return (await callable(input)).data
}

export async function disburseUnionLoanThroughBackend(input: DisburseUnionLoanInput): Promise<{ success: boolean; disbursement: UnionLoanDisbursement; receiptNumber: string }> {
  const callable = httpsCallable<DisburseUnionLoanInput, { success: boolean; disbursement: UnionLoanDisbursement; receiptNumber: string }>(functions, 'disburseUnionLoan')
  return (await callable(input)).data
}

export async function listUnionLoansThroughBackend(memberId?: string): Promise<UnionLoan[]> {
  const callable = httpsCallable<{ memberId?: string }, { success: boolean; loans: UnionLoan[] }>(functions, 'listUnionLoans')
  return (await callable(memberId ? { memberId } : {})).data.loans || []
}

export interface AffiliateAccountResult {
  success: boolean
  member: UnionMember
  dues: UnionMonthlyDue[]
  loans: UnionLoan[]
  fines: UnionFine[]
}

export async function getMyUnionAccountThroughBackend(): Promise<AffiliateAccountResult> {
  const callable = httpsCallable<void, AffiliateAccountResult>(functions, 'getMyUnionAccount')
  return (await callable()).data
}

export async function createUnionFineThroughBackend(input: CreateUnionFineInput): Promise<UnionFine> {
  const callable = httpsCallable<CreateUnionFineInput, { success: boolean; fine: UnionFine }>(functions, 'createUnionFine')
  return (await callable(input)).data.fine
}

export async function listUnionFinesThroughBackend(filters: { memberId?: string; category?: UnionFineCategory; status?: UnionFine['status'] } = {}): Promise<UnionFine[]> {
  const callable = httpsCallable<typeof filters, { success: boolean; fines: UnionFine[] }>(functions, 'listUnionFines')
  return (await callable(filters)).data.fines || []
}

export async function listUnionDebtAlertsThroughBackend(memberId?: string): Promise<UnionDebtAlertsResult> {
  const callable = httpsCallable<{ memberId?: string }, { success: boolean } & UnionDebtAlertsResult>(functions, 'listUnionDebtAlerts')
  const result = await callable(memberId ? { memberId } : {})
  return { alerts: result.data.alerts || [], truncated: result.data.truncated, installmentScanTruncated: result.data.installmentScanTruncated, asOfDate: result.data.asOfDate }
}

export interface CollectUnionFinePaymentInput {
  fineId: string
  amountCents: number
  paymentMethod: 'cash' | 'qr' | 'transfer'
  shiftId: string
  branchId: string
  notes?: string
  idempotencyKey: string
}
export async function collectUnionFinePaymentThroughBackend(input: CollectUnionFinePaymentInput): Promise<{ success: boolean; payment: UnionFinePayment; paidCents: number; balanceCents: number; status: UnionFine['status'] }> {
  const callable = httpsCallable<CollectUnionFinePaymentInput, { success: boolean; payment: UnionFinePayment; paidCents: number; balanceCents: number; status: UnionFine['status'] }>(functions, 'collectUnionFinePayment')
  return (await callable(input)).data
}

export interface CreateUnionSportsEventInput {
  date: string
  scheduledTime: string
  activityName: string
  place?: string
  notes?: string
  memberIds: string[]
  idempotencyKey: string
}
export async function createUnionSportsEventThroughBackend(input: CreateUnionSportsEventInput): Promise<{ success: boolean; eventId: string }> {
  const callable = httpsCallable<CreateUnionSportsEventInput, { success: boolean; eventId: string }>(functions, 'createUnionSportsEvent')
  return (await callable(input)).data
}
export async function listUnionSportsEventsThroughBackend(filters: { eventId?: string; memberId?: string; startDate?: string; endDate?: string; status?: 'scheduled' | 'completed' } = {}): Promise<UnionSportsEvent[]> {
  const callable = httpsCallable<typeof filters, { success: boolean; events: UnionSportsEvent[] }>(functions, 'listUnionSportsEvents')
  return (await callable(filters)).data.events || []
}
export async function setUnionSportsAttendanceThroughBackend(input: { eventId: string; memberId: string; attendance: UnionSportsAttendance; reason?: string; idempotencyKey: string }): Promise<{ success: boolean; attendance: UnionSportsAttendance; fineId: string | null; financialReviewRequired: boolean }> {
  const callable = httpsCallable<typeof input, { success: boolean; attendance: UnionSportsAttendance; fineId: string | null; financialReviewRequired: boolean }>(functions, 'setUnionSportsAttendance')
  return (await callable(input)).data
}
export async function requestUnionSportsJustificationThroughBackend(input: { eventId: string; memberId: string; reason: string; requestDate: string; idempotencyKey: string }): Promise<{ success: boolean; justificationId: string }> {
  const callable = httpsCallable<typeof input, { success: boolean; justificationId: string }>(functions, 'requestUnionSportsJustification')
  return (await callable(input)).data
}
export async function decideUnionSportsJustificationThroughBackend(input: { eventId: string; memberId: string; justificationId: string; decision: 'approved' | 'rejected'; decisionNotes?: string; idempotencyKey: string }): Promise<{ success: boolean; attendance: UnionSportsAttendance; financialReviewRequired: boolean }> {
  const callable = httpsCallable<typeof input, { success: boolean; attendance: UnionSportsAttendance; financialReviewRequired: boolean }>(functions, 'decideUnionSportsJustification')
  return (await callable(input)).data
}
export async function completeUnionSportsEventThroughBackend(input: { eventId: string; idempotencyKey: string }): Promise<{ success: boolean }> {
  const callable = httpsCallable<typeof input, { success: boolean }>(functions, 'completeUnionSportsEvent')
  return (await callable(input)).data
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

/** Registra un hijo en la subcolección del afiliado mediante la callable autorizada. */
export async function addUnionMemberChildThroughBackend(
  input: AddUnionMemberChildInput
): Promise<AddUnionMemberChildResult> {
  const callFn = httpsCallable<AddUnionMemberChildInput & { action: 'addChild' }, AddUnionMemberChildResult>(
    functions,
    'manageUnionMember'
  )
  const res = await callFn({
    memberId: input.memberId,
    action: 'addChild',
    child: input.child,
  })
  return res.data
}

/** Actualiza únicamente los campos enviados del hijo, conservando el resto. */
export async function updateUnionMemberChildThroughBackend(input: {
  memberId: string
  childId: string
  child: Partial<Pick<UnionMemberChild, 'fullName' | 'ci' | 'birthDate' | 'phone' | 'address' | 'notes'>>
}): Promise<UnionMemberChild> {
  const callFn = httpsCallable<{
    action: 'updateChild'
    memberId: string
    childId: string
    child: typeof input.child
  }, ManageUnionMemberChildResponse>(functions, 'manageUnionMember')
  const result = await callFn({ action: 'updateChild', ...input })
  if (!result.data.child) throw new Error('La respuesta del servidor no incluyó el hijo actualizado.')
  return result.data.child
}

/** Carga el directorio vigente de conductores mediante la callable ya existente. */
export async function listDriversForUnionLinksThroughBackend(): Promise<DriverDirectoryEntry[]> {
  const result = await listActiveDriversThroughBackend()
  return (result.drivers || []).filter((driver: DriverDirectoryEntry) => driver.isActive)
}

/** Actualiza el vínculo administrativo de chofer principal o de un hijo. */
export async function setUnionMemberDriverLinkThroughBackend(input: {
  memberId: string
  driverUid: string | null
  childId?: string
}): Promise<{ success: boolean; relation: {
  driverUid?: string | null
  driverName?: string | null
  primaryDriverUid?: string | null
  primaryDriverName?: string | null
  driverLinkedAtIso?: string
  primaryDriverLinkedAtIso?: string
  driver: { uid: string; fullName: string } | null
} }> {
  const callFn = httpsCallable<{
    action: 'setDriverLink'
    memberId: string
    driverUid: string | null
    childId?: string
  }, {
    success: boolean
    relation: {
      driverUid?: string | null
      driverName?: string | null
      primaryDriverUid?: string | null
      primaryDriverName?: string | null
      driverLinkedAtIso?: string
      primaryDriverLinkedAtIso?: string
      driver: { uid: string; fullName: string } | null
    }
  }>(functions, 'manageUnionMember')
  const result = await callFn({ action: 'setDriverLink', ...input })
  return result.data
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

/** Lee el padrón y los hijos agrupados mediante una callable con los permisos de lectura existentes. */
export async function getUnionMembersRosterThroughBackend(memberIds?: string[]): Promise<UnionRosterMember[]> {
  const callFn = httpsCallable<{ memberIds?: string[] }, { success: boolean; members: UnionRosterMember[] }>(
    functions,
    'getUnionMembersRoster'
  )
  if (!memberIds) {
    const response = await callFn({})
    return response.data.members || []
  }
  const chunks: string[][] = []
  for (let index = 0; index < memberIds.length; index += 500) chunks.push(memberIds.slice(index, index + 500))
  const responses = await Promise.all(chunks.map((chunk) => callFn({ memberIds: chunk })))
  return responses.flatMap((response) => response.data.members || [])
}

/**
 * Suscripción en tiempo real al padrón de socios.
 */
export function subscribeUnionMembers(
  onData: (members: UnionMember[]) => void,
  onError?: (err: Error) => void
): () => void {
  let unsubscribe = () => {}
  void (async () => {
    const profile = auth.currentUser ? (await getDoc(doc(db, 'users', auth.currentUser.uid))).data() : null
    const base = collection(db, 'union_members')
    const q = profile?.role === 'afiliado_admin'
      ? query(base, where('branchId', 'in', profile.allowedBranchIds || [profile.primaryBranchId]), orderBy('memberNumber', 'asc'))
      : query(base, orderBy('memberNumber', 'asc'))
    unsubscribe = onSnapshot(q, (snapshot) => {
      onData(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() })) as UnionMember[])
    }, (err) => { console.warn('[unionService] Error al suscribir a socios:', err); onError?.(err) })
  })().catch((err) => onError?.(err as Error))
  return () => unsubscribe()
}

/**
 * Suscripción en tiempo real a cuotas sindicales por período.
 */
export function subscribeUnionDues(
  period: string,
  onData: (dues: UnionMonthlyDue[]) => void,
  onError?: (err: Error) => void
): () => void {
  let unsubscribe = () => {}
  void (async () => {
    const profile = auth.currentUser ? (await getDoc(doc(db, 'users', auth.currentUser.uid))).data() : null
    const base = collection(db, 'union_dues')
    const q = profile?.role === 'afiliado_admin'
      ? query(base, where('period', '==', period), where('branchId', 'in', profile.allowedBranchIds || [profile.primaryBranchId]), orderBy('memberNumber', 'asc'))
      : query(base, where('period', '==', period), orderBy('memberNumber', 'asc'))
    unsubscribe = onSnapshot(q, (snapshot) => {
      onData(snapshot.docs.map((dueDoc) => ({ id: dueDoc.id, ...dueDoc.data() })) as UnionMonthlyDue[])
    }, (err) => { console.warn('[unionService] Error al suscribir a cuotas:', err); onError?.(err) })
  })().catch((err) => onError?.(err as Error))
  return () => unsubscribe()
}
