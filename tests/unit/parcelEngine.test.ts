import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateParcelPricing,
  canTransitionParcelStatus,
  validateParcelDelivery,
  formatCurrencyBob,
  ALLOWED_STATUS_TRANSITIONS,
} from '../../src/domain/parcelEngine.ts'
import {
  EXPRESO_PUNATA_COMPANY,
  INITIAL_BRANCHES,
} from '../../src/domain/expresoPunataConfig.ts'
import type { Shipment } from '../../src/types/index.ts'

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
  assert.equal(EXPRESO_PUNATA_COMPANY.taxId, 'DEMO — DATOS FICTICIOS / SIN VALIDEZ FISCAL')
})
