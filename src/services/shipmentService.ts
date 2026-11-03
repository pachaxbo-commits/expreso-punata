import {
  collection,
  doc,
  getDoc,
  query,
  where,
  or,
  onSnapshot,
  limit,
  getDocs,
  orderBy,
  startAfter,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions, auth } from '../firebase/config.ts'
import type { Shipment, ParcelCustomer, ParcelItem, PaymentTiming, PaymentMethod } from '../types/index.ts'

export interface CreateShipmentInput {
  originBranchId: string
  destinationBranchId: string
  deliveryType: 'agency' | 'home' | 'direct_driver'
  deliveryAddress?: string
  sender: ParcelCustomer
  recipient: ParcelCustomer
  items: ParcelItem[]
  declaredValueTotal?: number
  paymentTiming: PaymentTiming
  paymentMethod?: PaymentMethod
  discountCents?: number
  suggestedAmountCents?: number
  agreedAmountCents?: number
  priceAdjustmentReason?: string
  cashShiftId?: string
  allowPendingFallback?: boolean
  prohibitedGoodsNoticeAccepted: boolean
  idempotencyKey?: string
}

export interface CreateShipmentResult {
  success: boolean
  trackingCode: string
  isDuplicate: boolean
  shipment: Shipment
}

export interface UpdateShipmentInput {
  trackingCode: string
  sender?: {
    name?: string
    phone?: string
    docNumber?: string
  }
  recipient?: {
    name?: string
    phone?: string
    docNumber?: string
  }
  deliveryAddress?: string
  handlingNotes?: string
  agreedAmountCents?: number
  priceAdjustmentReason?: string
  rectificationReason?: string
}

export interface UpdateShipmentResult {
  success: boolean
  trackingCode: string
  shipment: Shipment
  message?: string
}

/**
 * Invoca la Cloud Function transaccional `createShipment` utilizando Firebase Functions.
 * Garantiza validación de roles en backend, asignación segura de guía e idempotencia.
 */
export async function createShipmentThroughBackend(
  input: CreateShipmentInput
): Promise<CreateShipmentResult> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para registrar una encomienda.')
  }

  // Clave de idempotencia única para prevenir doble envío por red
  const idempotencyKey =
    input.idempotencyKey ||
    `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  const callable = httpsCallable<Record<string, unknown>, CreateShipmentResult>(
    functions,
    'createShipment'
  )

  try {
    const res = await callable({
      ...input,
      idempotencyKey,
    })

    return res.data
  } catch (err: unknown) {
    console.error('[shipmentService] Error al invocar createShipment:', err)
    const errorObj = err as { code?: string; message?: string }
    const msg = errorObj.message || 'Error al comunicarse con el servidor de encomiendas.'

    if (errorObj.code === 'permission-denied' || msg.includes('permission-denied')) {
      throw new Error(`Acceso denegado: ${msg}`)
    }
    if (errorObj.code === 'unauthenticated' || msg.includes('unauthenticated')) {
      throw new Error('Sesión expirada o no autenticada. Inicie sesión nuevamente.')
    }
    if (errorObj.code === 'invalid-argument' || msg.includes('invalid-argument')) {
      throw new Error(`Datos inválidos: ${msg}`)
    }

    throw new Error(msg)
  }
}

/**
 * Invoca la Cloud Function transaccional `updateShipment` para editar o rectificar datos
 * de una encomienda autorizadamente y con trazabilidad de auditoría.
 */
export async function updateShipmentThroughBackend(
  input: UpdateShipmentInput
): Promise<UpdateShipmentResult> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para modificar una encomienda.')
  }

  const callable = httpsCallable<UpdateShipmentInput, UpdateShipmentResult>(
    functions,
    'updateShipment'
  )

  try {
    const res = await callable(input)
    return res.data
  } catch (err: unknown) {
    console.error('[shipmentService] Error al invocar updateShipment:', err)
    const errorObj = err as { code?: string; message?: string }
    const msg = errorObj.message || 'Error al actualizar la encomienda.'
    throw new Error(msg)
  }
}

/**
 * Suscribe reactivamente a los envíos de una sucursal en Firestore con onSnapshot.
 */
export function subscribeShipmentsByBranch(
  branchId: string,
  onUpdate: (shipments: Shipment[]) => void,
  onError?: (err: Error) => void,
  maxDocs: number = 500
): () => void {
  const shipmentsRef = collection(db, 'shipments')

  // Consulta por sucursal de origen o de llegada/destino (multisucursal compatible con Firestore Rules)
  let q
  if (branchId === 'all') {
    q = query(shipmentsRef, limit(maxDocs))
  } else {
    q = query(
      shipmentsRef,
      or(
        where('originBranchId', '==', branchId),
        where('destinationBranchId', '==', branchId)
      ),
      limit(maxDocs)
    )
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const list: Shipment[] = []
      snapshot.forEach((d) => {
        const data = d.data() as Shipment
        list.push({
          ...data,
          id: d.id,
          trackingCode: data.trackingCode || d.id,
        })
      })

      // Ordenar descendente por fecha de registro
      list.sort((a, b) => {
        const timeA = a.createdAtIso ? new Date(a.createdAtIso).getTime() : 0
        const timeB = b.createdAtIso ? new Date(b.createdAtIso).getTime() : 0
        return timeB - timeA
      })

      onUpdate(list)
    },
    (error) => {
      console.warn('[shipmentService] Error en suscripción reactiva:', error)
      if (onError) onError(error)
    }
  )
}

/**
 * Busca una encomienda por su código de guía único exacto en Firestore.
 * Brinda compatibilidad retroactiva completa con guías antiguas con guiones (PUN-2026-00042)
 * y el nuevo formato alfanumérico limpio sin símbolos (PUN202600042).
 */
export async function fetchShipmentByTrackingCode(
  trackingCode: string
): Promise<Shipment | null> {
  const cleanCode = trackingCode.trim().toUpperCase()
  if (!cleanCode) return null

  // 1. Búsqueda directa por el código ingresado
  let docSnap = await getDoc(doc(db, 'shipments', cleanCode))
  if (docSnap.exists()) {
    const data = docSnap.data() as Shipment
    return {
      ...data,
      id: docSnap.id,
      trackingCode: data.trackingCode || docSnap.id,
    }
  }

  // 2. Si contenía guiones, buscar en formato limpio sin guiones
  if (cleanCode.includes('-')) {
    const noDashes = cleanCode.replace(/-/g, '')
    docSnap = await getDoc(doc(db, 'shipments', noDashes))
    if (docSnap.exists()) {
      const data = docSnap.data() as Shipment
      return {
        ...data,
        id: docSnap.id,
        trackingCode: data.trackingCode || docSnap.id,
      }
    }
  } else if (/^[A-Z]{3}\d{9}$/.test(cleanCode)) {
    // 3. Si no contenía guiones pero tiene formato PUN202600001, buscar en formato antiguo con guiones
    const withDashes = `${cleanCode.slice(0, 3)}-${cleanCode.slice(3, 7)}-${cleanCode.slice(7)}`
    docSnap = await getDoc(doc(db, 'shipments', withDashes))
    if (docSnap.exists()) {
      const data = docSnap.data() as Shipment
      return {
        ...data,
        id: docSnap.id,
        trackingCode: data.trackingCode || docSnap.id,
      }
    }
  }

  return null
}

/**
 * Extrae sugerencias de clientes (remitentes/destinatarios habituales)
 * a partir del historial cargado para acelerar la atención en ventanilla.
 */
export function extractCustomerSuggestions(shipments: Shipment[]): ParcelCustomer[] {
  const map = new Map<string, ParcelCustomer>()

  for (const s of shipments) {
    if (s.sender?.name && s.sender?.phone) {
      const key = `${s.sender.name.toLowerCase().trim()}_${s.sender.phone.trim()}`
      if (!map.has(key)) {
        map.set(key, s.sender)
      }
    }
    if (s.recipient?.name && s.recipient?.phone) {
      const key = `${s.recipient.name.toLowerCase().trim()}_${s.recipient.phone.trim()}`
      if (!map.has(key)) {
        map.set(key, s.recipient)
      }
    }
  }

  return Array.from(map.values()).slice(0, 50)
}

export interface QueryShipmentsFilter {
  branchId?: string
  status?: string
  startDate?: string
  endDate?: string
  limitCount?: number
}

/**
 * Consulta directa del servidor para obtener histórico de encomiendas sin limitación de memoria local.
 */
export async function fetchShipmentsQuery(
  filters: QueryShipmentsFilter = {}
): Promise<Shipment[]> {
  const { branchId = 'all', status = 'all', startDate, endDate, limitCount = 500 } = filters
  const shipmentsRef = collection(db, 'shipments')

  let q = query(shipmentsRef)

  if (branchId !== 'all') {
    q = query(
      shipmentsRef,
      or(
        where('originBranchId', '==', branchId),
        where('destinationBranchId', '==', branchId)
      )
    )
  }

  if (status !== 'all') {
    q = query(q, where('status', '==', status))
  }

  if (startDate) {
    q = query(q, where('createdAtIso', '>=', startDate))
  }

  if (endDate) {
    q = query(q, where('createdAtIso', '<=', endDate))
  }

  q = query(q, limit(limitCount))

  const snap = await getDocs(q)
  const list: Shipment[] = []
  snap.forEach((d) => {
    const data = d.data() as Shipment
    list.push({
      ...data,
      id: d.id,
      trackingCode: data.trackingCode || d.id,
    })
  })

  list.sort((a, b) => {
    const timeA = a.createdAtIso ? new Date(a.createdAtIso).getTime() : 0
    const timeB = b.createdAtIso ? new Date(b.createdAtIso).getTime() : 0
    return timeB - timeA
  })

  return list
}

/**
 * Búsqueda autoritativa del lado del servidor:
 * 1. O(1) por Tracking Code directo (ej. PUN202600001 o PUN-2026-00001).
 * 2. Por teléfono de remitente o destinatario si contiene dígitos.
 * 3. Filtrado por sucursal si branchId !== 'all'.
 */
export async function searchShipmentsServer(
  term: string,
  branchId: string = 'all'
): Promise<Shipment[]> {
  const cleanTerm = term.trim()
  if (!cleanTerm) return []

  const resultsMap = new Map<string, Shipment>()

  // 1. Intento O(1) por tracking code directo
  try {
    const directShipment = await fetchShipmentByTrackingCode(cleanTerm)
    if (directShipment) {
      if (
        branchId === 'all' ||
        directShipment.originBranchId === branchId ||
        directShipment.destinationBranchId === branchId
      ) {
        resultsMap.set(directShipment.id, directShipment)
      }
    }
  } catch (err) {
    console.warn('[searchShipmentsServer] Error buscando por tracking code:', err)
  }

  // 2. Búsqueda por teléfono si contiene al menos 5 dígitos
  const phoneDigits = cleanTerm.replace(/\D/g, '')
  if (phoneDigits.length >= 5) {
    const shipmentsRef = collection(db, 'shipments')
    try {
      const senderQ = query(shipmentsRef, where('sender.phone', '==', cleanTerm), limit(25))
      const senderSnap = await getDocs(senderQ)
      senderSnap.forEach((d) => {
        const data = d.data() as Shipment
        if (
          branchId === 'all' ||
          data.originBranchId === branchId ||
          data.destinationBranchId === branchId
        ) {
          resultsMap.set(d.id, { ...data, id: d.id, trackingCode: data.trackingCode || d.id })
        }
      })

      const recipientQ = query(shipmentsRef, where('recipient.phone', '==', cleanTerm), limit(25))
      const recipientSnap = await getDocs(recipientQ)
      recipientSnap.forEach((d) => {
        const data = d.data() as Shipment
        if (
          branchId === 'all' ||
          data.originBranchId === branchId ||
          data.destinationBranchId === branchId
        ) {
          resultsMap.set(d.id, { ...data, id: d.id, trackingCode: data.trackingCode || d.id })
        }
      })
    } catch (err) {
      console.warn('[searchShipmentsServer] Error buscando por teléfono:', err)
    }
  }

  const list = Array.from(resultsMap.values())
  list.sort((a, b) => {
    const timeA = a.createdAtIso ? new Date(a.createdAtIso).getTime() : 0
    const timeB = b.createdAtIso ? new Date(b.createdAtIso).getTime() : 0
    return timeB - timeA
  })
  return list
}

export interface FetchShipmentsPageOptions {
  branchId?: string
  pageSize?: number
  lastVisibleDoc?: any
}

export interface FetchShipmentsPageResult {
  shipments: Shipment[]
  lastDoc: any | null
  hasMore: boolean
}

/**
 * Paginación autoritativa basada en cursores Firestore.
 */
export async function fetchShipmentsPage(
  options: FetchShipmentsPageOptions = {}
): Promise<FetchShipmentsPageResult> {
  const { branchId = 'all', pageSize = 20, lastVisibleDoc = null } = options
  const shipmentsRef = collection(db, 'shipments')

  const constraints: any[] = [
    orderBy('createdAtIso', 'desc'),
    limit(pageSize),
  ]

  if (lastVisibleDoc) {
    constraints.push(startAfter(lastVisibleDoc))
  }

  let q
  if (branchId !== 'all') {
    q = query(
      shipmentsRef,
      or(
        where('originBranchId', '==', branchId),
        where('destinationBranchId', '==', branchId)
      ),
      ...constraints
    )
  } else {
    q = query(shipmentsRef, ...constraints)
  }

  const snap = await getDocs(q)
  const shipments: Shipment[] = []
  snap.forEach((d) => {
    const data = d.data() as Shipment
    shipments.push({
      ...data,
      id: d.id,
      trackingCode: data.trackingCode || d.id,
    })
  })

  const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null
  const hasMore = snap.docs.length === pageSize

  return { shipments, lastDoc, hasMore }
}
