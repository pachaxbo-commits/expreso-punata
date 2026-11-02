import type {
  ParcelShipmentStatus,
  Shipment,
} from '../types/index.ts'
import { EXPRESO_PUNATA_TARIFFS } from './expresoPunataConfig.ts'

export const ALLOWED_STATUS_TRANSITIONS: Record<ParcelShipmentStatus, readonly ParcelShipmentStatus[]> = {
  received: ['pending_dispatch', 'dispatched', 'cancelled', 'returned'],
  pending_dispatch: ['dispatched', 'received', 'cancelled'],
  dispatched: ['in_transit', 'received_at_dest', 'lost'],
  in_transit: ['received_at_dest', 'in_delivery', 'lost'],
  received_at_dest: ['stored', 'ready_for_pickup', 'in_delivery', 'returned', 'lost'],
  stored: ['ready_for_pickup', 'in_delivery', 'uncollected', 'returned'],
  ready_for_pickup: ['delivered', 'uncollected', 'returned', 'lost'],
  in_delivery: ['delivered', 'received_at_dest', 'uncollected', 'returned'],
  delivered: [], // Terminal
  uncollected: ['final_disposition_authorized', 'returned', 'ready_for_pickup'],
  returned: [], // Terminal
  lost: ['final_disposition_authorized'],
  cancelled: [], // Terminal
  final_disposition_authorized: [], // Terminal
}

export function canTransitionParcelStatus(
  currentStatus: ParcelShipmentStatus,
  targetStatus: ParcelShipmentStatus
): boolean {
  if (currentStatus === targetStatus) return true
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] || []
  return allowed.includes(targetStatus)
}

export interface ParcelPricingResult {
  baseFeeBob: number
  baseFeeCents: number
  freeWeightKg: number
  chargeableExcessWeightKg: number
  weightSurchargeBob: number
  weightSurchargeCents: number
  homeDeliveryFeeBob: number
  homeDeliveryFeeCents: number
  subtotalBob: number
  subtotalCents: number
  discountBob: number
  discountCents: number
  finalAmountBob: number
  finalAmountCents: number
}

/**
 * Cálculo del costo de envío garantizando precisión en centavos enteros para evitar errores flotantes
 */
export function calculateParcelPricing(
  weightKg = 0,
  deliveryType: 'agency' | 'home' | 'direct_driver' = 'agency',
  discountBob = 0
): ParcelPricingResult {
  const safeWeight = Math.max(0, weightKg)
  const freeWeight = EXPRESO_PUNATA_TARIFFS.freeWeightKg
  const chargeableExcessWeightKg = Math.max(0, Math.round((safeWeight - freeWeight) * 100) / 100)

  const baseFeeCents = EXPRESO_PUNATA_TARIFFS.baseFeeCents
  const weightSurchargeCents = Math.round(chargeableExcessWeightKg * EXPRESO_PUNATA_TARIFFS.extraKgRateCents)
  const homeDeliveryFeeCents = deliveryType === 'home' ? EXPRESO_PUNATA_TARIFFS.homeDeliveryFeeCents : 0

  const subtotalCents = baseFeeCents + weightSurchargeCents + homeDeliveryFeeCents
  const safeDiscountCents = Math.min(subtotalCents, Math.max(0, Math.round(discountBob * 100)))
  const finalAmountCents = subtotalCents - safeDiscountCents

  return {
    baseFeeBob: baseFeeCents / 100,
    baseFeeCents,
    freeWeightKg: freeWeight,
    chargeableExcessWeightKg,
    weightSurchargeBob: weightSurchargeCents / 100,
    weightSurchargeCents,
    homeDeliveryFeeBob: homeDeliveryFeeCents / 100,
    homeDeliveryFeeCents,
    subtotalBob: subtotalCents / 100,
    subtotalCents,
    discountBob: safeDiscountCents / 100,
    discountCents: safeDiscountCents,
    finalAmountBob: finalAmountCents / 100,
    finalAmountCents,
  }
}

/**
 * Validador de entrega de encomiendas
 */
export function validateParcelDelivery(
  shipment: Shipment,
  receiverName: string,
  _receiverDoc: string,
  recipientRelationship: 'titular' | 'familiar' | 'apoderado' | 'empleado' | 'otro' = 'titular',
  isPayingNow = false,
  authorizedChangeReason?: string
): { canDeliver: boolean; error?: string } {
  if (shipment.status === 'delivered') {
    return { canDeliver: false, error: 'La encomienda ya fue entregada anteriormente.' }
  }

  if (!receiverName || receiverName.trim().length < 2) {
    return { canDeliver: false, error: 'Debe ingresar el nombre legible de quien recibe.' }
  }

  if (recipientRelationship !== 'titular' && (!authorizedChangeReason || authorizedChangeReason.trim().length < 3)) {
    return { canDeliver: false, error: 'Debe registrar la justificación o autorización para entregar a un tercero.' }
  }

  if (shipment.paymentTiming === 'destination_cod' && shipment.paymentStatus === 'pending' && !isPayingNow) {
    return { canDeliver: false, error: 'La encomienda tiene cobro contraentrega pendiente. Debe registrar el pago antes de entregar.' }
  }

  return { canDeliver: true }
}

/**
 * Formateador de moneda boliviana consistente
 */
export function formatCurrencyBob(centsOrBob: number, isCents = false): string {
  const amount = isCents ? centsOrBob / 100 : centsOrBob
  return `Bs. ${amount.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
