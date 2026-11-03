import type {
  ParcelShipmentStatus,
  Shipment,
} from '../types/index.ts'
import { EXPRESO_PUNATA_TARIFFS } from './expresoPunataConfig.ts'

export const ALLOWED_STATUS_TRANSITIONS: Record<ParcelShipmentStatus, readonly ParcelShipmentStatus[]> = {
  received: ['pending_dispatch', 'dispatched', 'cancelled', 'returned'],
  pending_dispatch: ['dispatched', 'received', 'cancelled'],
  dispatched: ['in_transit', 'received_at_dest', 'lost'],
  in_transit: ['received_at_dest', 'partially_received', 'incident_investigation', 'in_delivery', 'lost'],
  received_at_dest: ['stored', 'ready_for_pickup', 'in_delivery', 'delivered', 'returned', 'lost'],
  partially_received: ['stored', 'ready_for_pickup', 'in_delivery', 'delivered', 'lost', 'incident_investigation'],
  incident_investigation: ['received_at_dest', 'lost', 'returned', 'final_disposition_authorized'],
  stored: ['ready_for_pickup', 'in_delivery', 'delivered', 'uncollected', 'returned'],
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
export interface ParcelTariffConfig {
  baseFeeCents: number
  freeWeightKg: number
  extraKgRateCents: number
  homeDeliveryFeeCents: number
}

/**
 * Cálculo del costo de envío garantizando precisión en centavos enteros para evitar errores flotantes.
 * Permite inyectar la configuración oficial aprobada o utiliza las tarifas referenciales de desarrollo.
 */
export function calculateParcelPricing(
  weightKg = 0,
  deliveryType: 'agency' | 'home' | 'direct_driver' = 'agency',
  discountBob = 0,
  tariffsConfig?: Partial<ParcelTariffConfig>
): ParcelPricingResult {
  const safeWeight = Math.max(0, weightKg)
  const freeWeight = tariffsConfig?.freeWeightKg !== undefined ? tariffsConfig.freeWeightKg : EXPRESO_PUNATA_TARIFFS.freeWeightKg
  const chargeableExcessWeightKg = Math.max(0, Math.round((safeWeight - freeWeight) * 100) / 100)

  const baseFeeCents = tariffsConfig?.baseFeeCents !== undefined ? tariffsConfig.baseFeeCents : EXPRESO_PUNATA_TARIFFS.baseFeeCents
  const extraKgRateCents = tariffsConfig?.extraKgRateCents !== undefined ? tariffsConfig.extraKgRateCents : EXPRESO_PUNATA_TARIFFS.extraKgRateCents
  const weightSurchargeCents = Math.round(chargeableExcessWeightKg * extraKgRateCents)
  const homeDeliveryFeeCents = deliveryType === 'home'
    ? (tariffsConfig?.homeDeliveryFeeCents !== undefined ? tariffsConfig.homeDeliveryFeeCents : EXPRESO_PUNATA_TARIFFS.homeDeliveryFeeCents)
    : 0

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


/**
 * Valida un precio acordado en ventanilla en Bolivianos o centavos.
 * Asegura que no sea NaN, negativo ni inconsistente.
 * Si el precio es 0, exige motivo formal.
 */
export function validateAgreedPrice(
  agreedPriceBob: number | string,
  reason?: string
): { isValid: boolean; agreedCents: number; error?: string } {
  const numeric = typeof agreedPriceBob === 'string' ? parseFloat(agreedPriceBob) : agreedPriceBob
  if (isNaN(numeric) || numeric < 0) {
    return { isValid: false, agreedCents: 0, error: 'El precio del envío debe ser un monto numérico válido y no negativo.' }
  }
  const agreedCents = Math.round(numeric * 100)
  if (agreedCents === 0 && (!reason || reason.trim().length < 3)) {
    return { isValid: false, agreedCents: 0, error: 'Para tarifas Bs 0.00 es obligatorio registrar el motivo del acuerdo comercial o cortesía.' }
  }
  return { isValid: true, agreedCents }
}
