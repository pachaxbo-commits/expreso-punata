import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase/config.ts'
import type { PassengerTicketOperation, UserProfile } from '../types/index.ts'

export interface CreatePassengerTicketInput {
  branchId: string
  originBranchId: string
  destinationBranchId: string
  travelDate: string
  driverUid: string
  vehicleId?: string | null
  passengerName?: string
  quantity: number
  unitAmountCents: number
  idempotencyKey: string
}

export interface PassengerTicketOperationResult {
  success: boolean
  operation: PassengerTicketOperation
  cached?: boolean
}

export async function createPassengerTicketThroughBackend(input: CreatePassengerTicketInput) {
  if (!auth.currentUser) throw new Error('Inicia sesión para registrar un pasaje.')
  const call = httpsCallable<CreatePassengerTicketInput, PassengerTicketOperationResult>(functions, 'createPassengerTicket')
  return (await call(input)).data
}

export async function verifyPassengerTicketPaymentThroughBackend(input: {
  operationId: string
  confirmedAmountCents: number
  paymentReference?: string
  idempotencyKey: string
}) {
  if (!auth.currentUser) throw new Error('Inicia sesión para verificar el pago.')
  const call = httpsCallable<typeof input, PassengerTicketOperationResult>(functions, 'verifyPassengerTicketPayment')
  return (await call(input)).data
}

export async function cancelPassengerTicketThroughBackend(input: {
  operationId: string
  reason: string
  idempotencyKey: string
}) {
  if (!auth.currentUser) throw new Error('Inicia sesión para anular la operación.')
  const call = httpsCallable<typeof input, PassengerTicketOperationResult>(functions, 'cancelPassengerTicketOperation')
  return (await call(input)).data
}

export async function validatePassengerTicketThroughBackend(input: {
  ticketCode: string
  idempotencyKey: string
}) {
  if (!auth.currentUser) throw new Error('Inicia sesión para validar el pasaje.')
  const call = httpsCallable<typeof input, {
    success: boolean
    operationNumber: string
    driverName: string
    travelDate: string
    routeLabel: string
    quantity: number
    usedCount: number
    remainingCount: number
    useStatus: PassengerTicketOperation['useStatus']
    duplicate?: boolean
  }>(functions, 'validatePassengerTicket')
  return (await call(input)).data
}

export async function deliverPassengerTicketToDriverThroughBackend(input: {
  operationId: string
  idempotencyKey: string
  authorizationCode?: string
}) {
  if (!auth.currentUser) throw new Error('Inicia sesión para registrar la entrega de efectivo.')
  const call = httpsCallable<typeof input, {
    success: boolean
    movementId: string
    operation: PassengerTicketOperation
    newExpectedCashCents: number
    cached?: boolean
  }>(functions, 'deliverPassengerTicketToDriver')
  return (await call(input)).data
}

export function subscribePassengerTicketOperations(
  currentUser: UserProfile,
  branchId: string,
  onUpdate: (operations: PassengerTicketOperation[]) => void,
  onError?: (error: Error) => void,
) {
  const base = collection(db, 'passenger_ticket_operations')
  const isDriver = currentUser.role === 'conductor'
  const q = isDriver
    ? query(base, where('driverUid', '==', currentUser.uid), orderBy('createdAtIso', 'desc'))
    : query(base, where('branchId', '==', branchId), orderBy('createdAtIso', 'desc'))

  return onSnapshot(q, (snapshot) => {
    onUpdate(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PassengerTicketOperation))
  }, (error) => {
    console.error('[passengerTicketService] No se pudieron consultar los pasajes:', error)
    onError?.(error)
  })
}
