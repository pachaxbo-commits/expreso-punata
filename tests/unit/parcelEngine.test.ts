import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateParcelPricing,
  canTransitionParcelStatus,
  validateParcelDelivery,
  formatCurrencyBob,
  parseBobToCents,
  validateAgreedPrice,
  ALLOWED_STATUS_TRANSITIONS,
  type ParcelTariffConfig,
} from '../../src/domain/parcelEngine.ts'
import {
  EXPRESO_PUNATA_COMPANY,
  INITIAL_BRANCHES,
} from '../../src/domain/expresoPunataConfig.ts'
import type { Shipment } from '../../src/types/index.ts'

test('Importes financieros en Bs conservan centavos y separadores locales', () => {
  assert.equal(parseBobToCents('10'), 1000)
  assert.equal(parseBobToCents('100'), 10000)
  assert.equal(parseBobToCents('100,50'), 10050)
  assert.equal(parseBobToCents('1.000'), 100000)
  assert.equal(parseBobToCents('1.000,50'), 100050)
})

test('1. Tarifa de encomienda: cálculo exacto con centavos enteros', () => {
  // Paquete chico hasta 3kg en agencia sin descuento: 15.00 Bs (1500 centavos)
  const p1 = calculateParcelPricing(2.5, 'agency', 0)
  assert.equal(p1.baseFeeBob, 15)
  assert.equal(p1.baseFeeCents, 1500)
  assert.equal(p1.chargeableExcessWeightKg, 0)
  assert.equal(p1.weightSurchargeBob, 0)
  assert.equal(p1.finalAmountBob, 15)
  assert.equal(p1.finalAmountCents, 1500)

  // Paquete de 5kg (2kg exceso a 2 Bs/kg = 4 Bs recargo) con entrega a domicilio (+12 Bs): 15 + 4 + 12 = 31 Bs
  const p2 = calculateParcelPricing(5, 'home', 0)
  assert.equal(p2.chargeableExcessWeightKg, 2)
  assert.equal(p2.weightSurchargeBob, 4)
  assert.equal(p2.weightSurchargeCents, 400)
  assert.equal(p2.homeDeliveryFeeBob, 12)
  assert.equal(p2.subtotalBob, 31)
  assert.equal(p2.finalAmountBob, 31)
  assert.equal(p2.finalAmountCents, 3100)

  // Descuento de 5 Bs sobre 31 Bs: 26 Bs
  const p3 = calculateParcelPricing(5, 'home', 5)
  assert.equal(p3.discountBob, 5)
  assert.equal(p3.finalAmountBob, 26)
  assert.equal(p3.finalAmountCents, 2600)
})

test('2. Transiciones de estado de encomienda y terminales', () => {
  // Transiciones válidas
  assert.equal(canTransitionParcelStatus('received', 'pending_dispatch'), true)
  assert.equal(canTransitionParcelStatus('dispatched', 'in_transit'), true)
  assert.equal(canTransitionParcelStatus('received_at_dest', 'stored'), true)
  assert.equal(canTransitionParcelStatus('stored', 'ready_for_pickup'), true)
  assert.equal(canTransitionParcelStatus('ready_for_pickup', 'delivered'), true)

  // Estados terminales no deben permitir transiciones
  assert.equal(ALLOWED_STATUS_TRANSITIONS.delivered.length, 0)
  assert.equal(canTransitionParcelStatus('delivered', 'received'), false)
  assert.equal(canTransitionParcelStatus('delivered', 'ready_for_pickup'), false)

  assert.equal(ALLOWED_STATUS_TRANSITIONS.returned.length, 0)
  assert.equal(canTransitionParcelStatus('returned', 'in_transit'), false)

  assert.equal(ALLOWED_STATUS_TRANSITIONS.cancelled.length, 0)
  assert.equal(canTransitionParcelStatus('cancelled', 'delivered'), false)
})

test('3. Validación estricta de entregas y cobro contraentrega (COD)', () => {
  const dummyShipment: Shipment = {
    id: 'test-1',
    trackingCode: 'PUN-2026-00001',
    createdAt: new Date().toISOString(),
    registeredByUid: 'uid-1',
    registeredByName: 'Sec',
    originBranchId: 'punata',
    originCity: 'Punata',
    destinationBranchId: 'cochabamba',
    destinationCity: 'Cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Juan', phone: '71111111', docType: 'CI' },
    recipient: { name: 'Pedro', phone: '72222222', docType: 'CI' },
    items: [],
    packageCount: 1,
    totalWeightKg: 1,
    declaredValueTotal: 100,
    prohibitedGoodsNoticeAccepted: true,
    shippingFeeCents: 1500,
    weightSurchargeCents: 0,
    homeDeliveryFeeCents: 0,
    discountCents: 0,
    finalAmountCents: 1500,
    finalAmountBob: 15,
    paymentTiming: 'destination_cod',
    paymentStatus: 'pending',
    status: 'ready_for_pickup',
  }

  // Rechazar entrega sin pago si es contraentrega pendiente
  const v1 = validateParcelDelivery(dummyShipment, 'Pedro', '1234567', 'titular', false)
  assert.equal(v1.canDeliver, false)
  assert.ok(v1.error?.includes('contraentrega pendiente'))

  // Permitir entrega si se abona en ventanilla
  const v2 = validateParcelDelivery(dummyShipment, 'Pedro', '1234567', 'titular', true)
  assert.equal(v2.canDeliver, true)

  // Rechazar entrega a un tercero sin justificación / autorización
  const v3 = validateParcelDelivery(dummyShipment, 'María (Hermana)', '7654321', 'familiar', true, '')
  assert.equal(v3.canDeliver, false)
  assert.ok(v3.error?.includes('justificación'))

  // Permitir entrega a tercero con autorización registrada
  const v4 = validateParcelDelivery(dummyShipment, 'María (Hermana)', '7654321', 'familiar', true, 'Autorización telefónica confirmada por el titular')
  assert.equal(v4.canDeliver, true)
})

test('4. Formateador de moneda boliviana', () => {
  assert.equal(formatCurrencyBob(15), 'Bs. 15,00')
  assert.equal(formatCurrencyBob(1500, true), 'Bs. 15,00')
  assert.equal(formatCurrencyBob(1250, true), 'Bs. 12,50')
})

test('5. Sucursales de Expreso Punata y transparencia fiscal', () => {
  assert.equal(INITIAL_BRANCHES.length, 2)
  assert.equal(INITIAL_BRANCHES[0].code, 'PUN')
  assert.equal(INITIAL_BRANCHES[1].code, 'CBB')
  assert.equal(EXPRESO_PUNATA_COMPANY.name, 'EXPRESO PUNATA')
  assert.equal(EXPRESO_PUNATA_COMPANY.legalNotice, 'DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL')
})

test('6. FASE 1: Validación de precio acordado en ventanilla (Precio Editable)', () => {
  // Precio acordado válido superior al sugerido
  const pSuperior = validateAgreedPrice(25.50)
  assert.equal(pSuperior.isValid, true)
  assert.equal(pSuperior.agreedCents, 2550)

  // Precio acordado válido inferior al sugerido
  const pInferior = validateAgreedPrice(10.00)
  assert.equal(pInferior.isValid, true)
  assert.equal(pInferior.agreedCents, 1000)

  // Precio cero con motivo comercial / cortesía (Permitido)
  const pCeroConMotivo = validateAgreedPrice(0, 'Cortesía institucional autorizada por directiva')
  assert.equal(pCeroConMotivo.isValid, true)
  assert.equal(pCeroConMotivo.agreedCents, 0)

  // Precio cero sin motivo (Rechazado)
  const pCeroSinMotivo = validateAgreedPrice(0, '')
  assert.equal(pCeroSinMotivo.isValid, false)
  assert.ok(pCeroSinMotivo.error?.includes('motivo del acuerdo comercial'))

  // Precio inválido negativo o NaN
  const pNegativo = validateAgreedPrice(-5)
  assert.equal(pNegativo.isValid, false)
  const pNaN = validateAgreedPrice('abc')
  assert.equal(pNaN.isValid, false)
})

test('7. FASE 4: Formato alfanumérico de guías sin símbolos y compatibilidad retroactiva', () => {
  const newGuideRegex = /^[A-Z]{3}\d{4}\d{5}$/
  const flexibleGuideRegex = /^[A-Z]{3}-?\d{4}-?\d{5}$/

  // Nuevo formato alfanumérico limpio (sin guiones, barras ni símbolos)
  const newGuidePun = 'PUN202600042'
  const newGuideCbb = 'CBB202600001'
  assert.ok(newGuideRegex.test(newGuidePun))
  assert.ok(newGuideRegex.test(newGuideCbb))
  assert.ok(flexibleGuideRegex.test(newGuidePun))
  assert.ok(flexibleGuideRegex.test(newGuideCbb))

  // Compatibilidad con guías históricas emitidas previamente con guiones
  const legacyGuide = 'PUN-2026-00042'
  assert.equal(newGuideRegex.test(legacyGuide), false)
  assert.ok(flexibleGuideRegex.test(legacyGuide))

  // Normalización bidireccional
  const cleanedFromLegacy = legacyGuide.replace(/-/g, '')
  assert.equal(cleanedFromLegacy, 'PUN202600042')
  const formattedWithDashes = `${newGuidePun.slice(0, 3)}-${newGuidePun.slice(3, 7)}-${newGuidePun.slice(7)}`
  assert.equal(formattedWithDashes, 'PUN-2026-00042')
})


test('8. FASE 7: Tarifas dinámicas desde configuración oficial del sistema', () => {
  const customTariffs: ParcelTariffConfig = {
    baseFeeCents: 2000,
    freeWeightKg: 5,
    extraKgRateCents: 300,
    homeDeliveryFeeCents: 1500,
  }

  // Paquete de 4kg en agencia -> base 20 Bs
  const p1 = calculateParcelPricing(4, 'agency', 0, customTariffs)
  assert.equal(p1.baseFeeBob, 20)
  assert.equal(p1.chargeableExcessWeightKg, 0)
  assert.equal(p1.finalAmountBob, 20)
  assert.equal(p1.finalAmountCents, 2000)

  // Paquete de 7kg a domicilio -> 20 base + (2kg exceso * 3 Bs = 6) + 15 domicilio = 41 Bs
  const p2 = calculateParcelPricing(7, 'home', 0, customTariffs)
  assert.equal(p2.chargeableExcessWeightKg, 2)
  assert.equal(p2.weightSurchargeBob, 6)
  assert.equal(p2.homeDeliveryFeeBob, 15)
  assert.equal(p2.finalAmountBob, 41)
  assert.equal(p2.finalAmountCents, 4100)
})
