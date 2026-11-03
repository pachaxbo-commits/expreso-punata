import { httpsCallable } from 'firebase/functions'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { Worker, WorkerPayment, WorkerRole, WorkerStatus } from '../types/index.ts'

export interface ManageWorkerInput {
  id?: string
  workerCode?: string
  fullName: string
  ci: string
  phone?: string
  role: WorkerRole
  roleLabel?: string
  branchId: 'punata' | 'cochabamba' | 'ambas'
  salaryType?: 'monthly' | 'daily' | 'per_task'
  baseSalaryBob?: number
  baseSalaryCents?: number
  status?: WorkerStatus
  joinedAt?: string
  notes?: string
  action?: 'create' | 'update'
}

export interface RegisterWorkerPaymentInput {
  workerId: string
  amountCents?: number
  amountBob?: number
  concept: string
  period?: string
  paymentMethod?: 'cash' | 'transfer' | 'check'
  shiftId?: string | null
  branchId?: string
  notes?: string
  idempotencyKey?: string
}

export interface WorkerPaymentResult {
  success: boolean
  receiptNumber: string
  paymentId: string
  workerName: string
  workerCode: string
  amountCents: number
  amountBob: number
  concept: string
  paymentMethod: string
  paidAtIso: string
  paidByName: string
  message: string
}

export async function manageWorker(input: ManageWorkerInput): Promise<{ success: boolean; worker?: Worker; workerId?: string; message: string }> {
  const fn = httpsCallable<ManageWorkerInput, { success: boolean; worker?: Worker; workerId?: string; message: string }>(functions, 'manageWorker')
  const res = await fn(input)
  return res.data
}

export async function registerWorkerPayment(input: RegisterWorkerPaymentInput): Promise<WorkerPaymentResult> {
  const fn = httpsCallable<RegisterWorkerPaymentInput, WorkerPaymentResult>(functions, 'registerWorkerPayment')
  const res = await fn(input)
  return res.data
}

export function subscribeWorkers(
  onUpdate: (workers: Worker[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'union_workers'), orderBy('fullName', 'asc'))
  return onSnapshot(
    q,
    (snap) => {
      const workers = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Worker[]
      onUpdate(workers)
    },
    (err) => {
      console.error('Error suscribiendo trabajadores:', err)
      if (onError) onError(err)
    }
  )
}

export function subscribeWorkerPayments(
  onUpdate: (payments: WorkerPayment[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'union_worker_payments'), orderBy('paidAtIso', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const payments = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as WorkerPayment[]
      onUpdate(payments)
    },
    (err) => {
      console.error('Error suscribiendo pagos de personal:', err)
      if (onError) onError(err)
    }
  )
}
