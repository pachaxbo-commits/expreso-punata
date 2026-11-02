import {
  collection,
  doc,
  getDoc,
  query,
  where,
  onSnapshot,
  limit,
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
  prohibitedGoodsNoticeAccepted: boolean
  idempotencyKey?: string
}

export interface CreateShipmentResult {
  success: boolean
  trackingCode: string
  isDuplicate: boolean
  shipment: Shipment
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
 * Suscribe reactivamente a los envíos de una sucursal en Firestore con onSnapshot.
 */
export function subscribeShipmentsByBranch(
  branchId: string,
  onUpdate: (shipments: Shipment[]) => void,
  onError?: (err: Error) => void
): () => void {
  const shipmentsRef = collection(db, 'shipments')

  // Consulta por sucursal de origen o destino
  let q
  if (branchId === 'all') {
    q = query(shipmentsRef, limit(100))
  } else {
    q = query(shipmentsRef, where('originBranchId', '==', branchId), limit(100))
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
 */
export async function fetchShipmentByTrackingCode(
  trackingCode: string
): Promise<Shipment | null> {
  const cleanCode = trackingCode.trim().toUpperCase()
  if (!cleanCode) return null

  const docSnap = await getDoc(doc(db, 'shipments', cleanCode))
  if (!docSnap.exists()) {
    return null
  }

  const data = docSnap.data() as Shipment
  return {
    ...data,
    id: docSnap.id,
    trackingCode: data.trackingCode || docSnap.id,
  }
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
