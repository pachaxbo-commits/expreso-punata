import { httpsCallable } from 'firebase/functions'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { GeneralExpense, ExpenseCategory } from '../types/index.ts'

export interface RegisterGeneralExpenseInput {
  category: ExpenseCategory
  branchId: 'punata' | 'cochabamba' | 'general'
  concept: string
  amountCents?: number
  amountBob?: number
  supplier?: string
  invoiceOrReceiptNumber?: string
  paymentMethod?: 'cash' | 'transfer' | 'qr'
  shiftId?: string | null
  notes?: string
  idempotencyKey?: string
}

export interface GeneralExpenseResult {
  success: boolean
  voucherNumber: string
  expenseId: string
  category: string
  concept: string
  amountCents: number
  amountBob: number
  supplier: string
  paymentMethod: string
  createdAtIso: string
  registeredByName: string
  message: string
}

export async function registerGeneralExpense(input: RegisterGeneralExpenseInput): Promise<GeneralExpenseResult> {
  const fn = httpsCallable<RegisterGeneralExpenseInput, GeneralExpenseResult>(functions, 'registerGeneralExpense')
  const res = await fn(input)
  return res.data
}

export function subscribeGeneralExpenses(
  onUpdate: (expenses: GeneralExpense[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'union_expenses'), orderBy('createdAtIso', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const expenses = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as GeneralExpense[]
      onUpdate(expenses)
    },
    (err) => {
      console.error('Error suscribiendo egresos operativos:', err)
      if (onError) onError(err)
    }
  )
}
