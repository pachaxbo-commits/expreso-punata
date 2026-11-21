import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPassengerTicketPairHtml } from '../../src/services/passengerTicketPrintService.ts'
import type { PassengerTicketOperation } from '../../src/types/index.ts'

const paidOperation: PassengerTicketOperation = {
  id: 'PJE-0123456789ABCDEF0123',
  operationNumber: 'PAS-PUN-2026-000001',
  ticketCode: 'PJE-0123456789ABCDEF0123',
  branchId: 'punata', originBranchId: 'punata', destinationBranchId: 'cochabamba',
  travelDate: '2026-12-15', driverUid: 'driver-demo', driverName: 'Chofer Ficticio',
  vehicleId: null, vehiclePlate: null, vehicleMobileNumber: null, passengerName: 'Pasajero Ficticio',
  quantity: 2, unitAmountCents: 1250, totalAmountCents: 2500,
  paymentMethod: 'qr', paymentStatus: 'paid_verified', paymentVerificationStatus: 'verified',
  paymentReference: null, paymentConfirmedAmountCents: 2500, paymentVerifiedAtIso: '2026-11-21T12:00:00.000Z',
  paymentVerifiedByUid: 'office-demo', paymentVerifiedByName: 'Secretaría', paymentShiftId: 'shift-demo',
  paymentMovementId: 'movement-demo', settlementStatus: 'pending_delivery', pendingSettlementCents: 2500,
  expectedDeliveryDate: '2026-11-22', deliveredAtIso: null, deliveredByUid: null, deliveredByName: null,
  deliveryMovementId: null, useStatus: 'pending_boarding', usedCount: 0,
  createdAtIso: '2026-11-21T11:00:00.000Z', updatedAtIso: '2026-11-21T11:00:00.000Z', createdByUid: 'office-demo', createdByName: 'Secretaría',
}

test('La impresión genera exactamente los dos comprobantes y marca las reimpresiones', async () => {
  const html = await buildPassengerTicketPairHtml(paidOperation, { paperWidth: 58 })
  assert.equal((html.match(/data-ticket-copy=/g) || []).length, 2)
  const officeCopy = html.match(/<article class="ticket" data-ticket-copy="office">([\s\S]*?)<\/article>/)?.[1] || ''
  const driverCopy = html.match(/<article class="ticket" data-ticket-copy="driver">([\s\S]*?)<\/article>/)?.[1] || ''
  assert.ok(officeCopy)
  assert.ok(driverCopy)
  assert.match(html, /@page\{size:58mm auto/)
  for (const value of ['PAS-PUN-2026-000001', '2026-12-15', 'Punata → Cochabamba', 'Chofer Ficticio', 'QR VERIFICADO']) {
    assert.ok(officeCopy.includes(value), `El comprobante de oficina debe incluir ${value}`)
    assert.ok(driverCopy.includes(value), `El comprobante del chofer debe incluir ${value}`)
  }
  assert.match(officeCopy, /PENDIENTE DE ENTREGA AL CHOFER/)
  assert.match(driverCopy, /PAGO VERIFICADO · PRESENTAR AL CHOFER/)
  assert.match(driverCopy, /src="data:image\/png;base64,/)
  const wideHtml = await buildPassengerTicketPairHtml(paidOperation, { paperWidth: 80 })
  assert.match(wideHtml, /@page\{size:80mm auto/)
  const duplicate = await buildPassengerTicketPairHtml(paidOperation, { reprint: true })
  assert.equal((duplicate.match(/DUPLICADO · REIMPRESIÓN/g) || []).length, 2)
})

test('La impresión rechaza operaciones no verificadas', async () => {
  await assert.rejects(
    () => buildPassengerTicketPairHtml({ ...paidOperation, paymentStatus: 'pending_verification' }),
    /Solo se imprimen pasajes con pago verificado/,
  )
})
