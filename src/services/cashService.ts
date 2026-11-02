import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  limit,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions, auth } from '../firebase/config.ts'
import type { CashShift, FinancialMovement, PaymentMethod } from '../types/index.ts'

export interface OpenCashShiftInput {
  branchId: string
  initialCashCents: number
  initialCashBreakdown?: Record<string, number>
  notes?: string
}

export interface CloseCashShiftInput {
  shiftId: string
  actualCashCents: number
  actualCashBreakdown?: Record<string, number>
  notes?: string
}

export interface RegisterExpenseInput {
  branchId: string
  amountCents: number
  concept: string
  category?: string
  voucherNumber?: string
}

export interface CollectShipmentPaymentInput {
  trackingCode: string
  paymentMethod: PaymentMethod
  branchId: string
}

/**
 * Abre un turno de caja de forma transaccional mediante Cloud Function segura.
 */
export async function openCashShiftThroughBackend(input: OpenCashShiftInput): Promise<{ success: boolean; shift: CashShift }> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para abrir un turno de caja.')
  }

  const callable = httpsCallable<OpenCashShiftInput, { success: boolean; shift: CashShift }>(
    functions,
    'openCashShift'
  )

  try {
    const res = await callable(input)
    return res.data
  } catch (err: unknown) {
    console.error('[cashService] Error al abrir turno de caja:', err)
    const errorObj = err as { code?: string; message?: string }
    const msg = errorObj.message || 'Error al comunicarse con el servidor de turnos de caja.'
    throw new Error(msg)
  }
}

/**
 * Cierra un turno de caja con arqueo y cálculo de diferencias en servidor mediante Cloud Function segura.
 */
export async function closeCashShiftThroughBackend(input: CloseCashShiftInput): Promise<{ success: boolean; shift: CashShift }> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para cerrar un turno de caja.')
  }

  const callable = httpsCallable<CloseCashShiftInput, { success: boolean; shift: CashShift }>(
    functions,
    'closeCashShift'
  )

  try {
    const res = await callable(input)
    return res.data
  } catch (err: unknown) {
    console.error('[cashService] Error al cerrar turno de caja:', err)
    const errorObj = err as { code?: string; message?: string }
    const msg = errorObj.message || 'Error al cerrar el turno de caja.'
    throw new Error(msg)
  }
}

/**
 * Registra un egreso autorizado descontándolo del efectivo en caja en tiempo real.
 */
export async function registerCashExpenseThroughBackend(input: RegisterExpenseInput): Promise<{ success: boolean; movementId: string; newExpectedCashCents: number }> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para registrar un egreso de caja.')
  }

  const callable = httpsCallable<RegisterExpenseInput, { success: boolean; movementId: string; newExpectedCashCents: number }>(
    functions,
    'registerCashExpense'
  )

  try {
    const res = await callable(input)
    return res.data
  } catch (err: unknown) {
    console.error('[cashService] Error al registrar egreso:', err)
    const errorObj = err as { code?: string; message?: string }
    const msg = errorObj.message || 'Error al registrar el egreso de caja.'
    throw new Error(msg)
  }
}

/**
 * Registra el cobro en ventanilla de una encomienda pendiente o COD.
 */
export async function collectShipmentPaymentThroughBackend(input: CollectShipmentPaymentInput): Promise<{ success: boolean; trackingCode: string; amountCents: number }> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para cobrar una encomienda.')
  }

  const callable = httpsCallable<CollectShipmentPaymentInput, { success: boolean; trackingCode: string; amountCents: number }>(
    functions,
    'collectShipmentPayment'
  )

  try {
    const res = await callable(input)
    return res.data
  } catch (err: unknown) {
    console.error('[cashService] Error al cobrar encomienda:', err)
    const errorObj = err as { code?: string; message?: string }
    const msg = errorObj.message || 'Error al procesar el cobro de la encomienda.'
    throw new Error(msg)
  }
}

/**
 * Suscribe reactivamente al turno de caja activo del usuario en la sucursal seleccionada.
 */
export function subscribeActiveCashShift(
  userUid: string,
  branchId: string,
  onUpdate: (shift: CashShift | null) => void,
  onError?: (err: Error) => void
): () => void {
  if (!userUid || !branchId) {
    onUpdate(null)
    return () => {}
  }

  const lockDocRef = doc(db, 'cash_shift_active_locks', `${userUid}_${branchId}`)
  let unsubscribeShift: (() => void) | null = null

  const unsubscribeLock = onSnapshot(
    lockDocRef,
    (lockSnap) => {
      if (!lockSnap.exists()) {
        if (unsubscribeShift) {
          unsubscribeShift()
          unsubscribeShift = null
        }
        onUpdate(null)
        return
      }

      const lockData = lockSnap.data()
      if (lockData.status !== 'open' || !lockData.shiftId) {
        if (unsubscribeShift) {
          unsubscribeShift()
          unsubscribeShift = null
        }
        onUpdate(null)
        return
      }

      const activeShiftId = lockData.shiftId
      const shiftDocRef = doc(db, 'cash_shifts', activeShiftId)

      if (unsubscribeShift) {
        unsubscribeShift()
      }

      unsubscribeShift = onSnapshot(
        shiftDocRef,
        (shiftSnap) => {
          if (!shiftSnap.exists()) {
            onUpdate(null)
            return
          }
          const data = shiftSnap.data() as CashShift
          if (data.status !== 'open') {
            onUpdate(null)
            return
          }
          onUpdate({
            ...data,
            id: shiftSnap.id,
            shiftNumber: data.shiftNumber || shiftSnap.id,
          })
        },
        (shiftErr) => {
          console.warn('[cashService] Error al suscribir al documento del turno:', shiftErr)
          if (onError) onError(shiftErr)
        }
      )
    },
    (lockErr) => {
      console.warn('[cashService] Error al suscribir al candado de caja:', lockErr)
      if (onError) onError(lockErr)
    }
  )

  return () => {
    unsubscribeLock()
    if (unsubscribeShift) {
      unsubscribeShift()
    }
  }
}

/**
 * Suscribe reactivamente a los movimientos financieros de un turno de caja específico.
 */
export function subscribeShiftMovements(
  shiftId: string,
  onUpdate: (movements: FinancialMovement[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!shiftId) {
    onUpdate([])
    return () => {}
  }

  const movementsRef = collection(db, 'financial_movements')
  const q = query(
    movementsRef,
    where('shiftId', '==', shiftId),
    limit(200)
  )

  return onSnapshot(
    q,
    (snapshot) => {
      const list: FinancialMovement[] = []
      snapshot.forEach((d) => {
        const data = d.data() as FinancialMovement
        list.push({
          ...data,
          id: d.id,
        })
      })

      // Ordenar cronológico inverso por timestamp
      list.sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0
        return timeB - timeA
      })

      onUpdate(list)
    },
    (err) => {
      console.warn('[cashService] Error al suscribir a movimientos del turno:', err)
      if (onError) onError(err)
    }
  )
}

/**
 * Suscribe reactivamente al historial de turnos de una sucursal o global (para administración y tesorería).
 */
export function subscribeBranchShiftHistory(
  branchId: string,
  onUpdate: (shifts: CashShift[]) => void,
  onError?: (err: Error) => void
): () => void {
  const shiftsRef = collection(db, 'cash_shifts')
  let q

  if (branchId === 'all') {
    q = query(shiftsRef, limit(60))
  } else {
    q = query(
      shiftsRef,
      where('branchId', '==', branchId),
      limit(60)
    )
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CashShift[] = []
      snapshot.forEach((d) => {
        const data = d.data() as CashShift
        list.push({
          ...data,
          id: d.id,
          shiftNumber: data.shiftNumber || d.id,
        })
      })

      // Ordenar por openedAt descendente
      list.sort((a, b) => {
        const timeA = a.openedAt ? new Date(a.openedAt).getTime() : 0
        const timeB = b.openedAt ? new Date(b.openedAt).getTime() : 0
        return timeB - timeA
      })

      onUpdate(list)
    },
    (err) => {
      console.warn('[cashService] Error al suscribir a historial de turnos:', err)
      if (onError) onError(err)
    }
  )
}
