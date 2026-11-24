import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShipmentTicketTemplateHtml } from '../../src/adapters/printing/shipmentTicketTemplateRenderer.ts'
import { createSyntheticShipmentTicket } from '../../src/services/printing/syntheticShipmentTicket.ts'
import { DEFAULT_SHIPMENT_TICKET_TEMPLATE, normalizeShipmentTicketTemplate } from '../../src/services/printing/ticketTemplates.ts'
import { printEngine } from '../../src/services/printing/printEngineService.ts'
import type { Shipment } from '../../src/types/index.ts'

test('template normalization preserves required fields and allowlists field IDs', () => {
  const template = normalizeShipmentTicketTemplate({
    ...DEFAULT_SHIPMENT_TICKET_TEMPLATE,
    marginsMm: 99,
    paperFormat: 'letter',
    customer: { ...DEFAULT_SHIPMENT_TICKET_TEMPLATE.customer, visibleFields: ['sender', 'unknown'] },
  })
  assert.equal(template.marginsMm, 6)
  assert.equal(template.paperFormat, '80mm')
  assert.deepEqual(template.customer.visibleFields, ['sender', 'createdAt', 'destination'])
})

test('preview renderer escapes custom text and synthetic content, keeps legal and institution copy', async () => {
  const doc = createSyntheticShipmentTicket('punata', '2026-11-24T12:00:00.000Z')
  doc.sender = { name: '<script>alert(1)</script>', phone: '70000001' }
  doc.title = '<img src=x onerror=alert(1)>'
  const template = normalizeShipmentTicketTemplate({
    ...DEFAULT_SHIPMENT_TICKET_TEMPLATE,
    secondCopyEnabled: true,
    customer: { ...DEFAULT_SHIPMENT_TICKET_TEMPLATE.customer, headerText: '<b>custom</b>' },
  })
  const html = await buildShipmentTicketTemplateHtml(doc, '58mm', template)
  assert.match(html, /@page\{size:58mm auto/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;b&gt;custom&lt;\/b&gt;/)
  assert.match(html, /DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL/)
  assert.match(html, /Agencia Punata/)
  assert.equal((html.match(/class="ticket-copy/g) || []).length, 2)
  assert.equal((html.match(/GUÍA TEST-SINTETICO-0001/g) || []).length, 2)
  assert.equal((html.match(/Teléfono del remitente:/g) || []).length, 1)
  assert.match(html, /page-break-before:always/)
  assert.match(html, /data:image\/png;base64,/)
})

test('preview honors field visibility, order, no-QR setting, and 80 mm paper', async () => {
  const template = normalizeShipmentTicketTemplate({
    ...DEFAULT_SHIPMENT_TICKET_TEMPLATE,
    customer: { ...DEFAULT_SHIPMENT_TICKET_TEMPLATE.customer, visibleFields: ['createdAt', 'destination', 'sender'], order: ['createdAt', 'destination', 'sender'] },
  })
  const html = await buildShipmentTicketTemplateHtml(createSyntheticShipmentTicket(), '80mm', template, { includeQr: false })
  assert.match(html, /@page\{size:80mm auto/)
  assert.doesNotMatch(html, /class="qr-field"/)
  assert.ok(html.indexOf('Remitente de prueba') > html.indexOf('Destino:'))
  assert.doesNotMatch(html, /Teléfono del remitente/)
})

test('shipment guide fields come from the operation and tolerate absent optional data', async () => {
  const operation = {
    trackingCode: 'PUN-REAL-00421', createdAtIso: '2026-11-24T12:00:00.000Z',
    sender: { name: 'Remitente operación', phone: '70123456' },
    recipient: { name: 'Destinatario operación', phone: '70987654' },
    items: [{ description: 'Bulto operativo', quantity: 3, packaging: 'Saco' }],
    packageCount: 3, totalWeightKg: 7.25, finalAmountCents: 2450,
    paymentTiming: 'origin_paid', paymentStatus: 'paid', originBranchId: 'punata',
    originCity: 'Punata real', destinationBranchId: 'cochabamba', destinationCity: 'Cochabamba real',
    deliveryType: 'home', status: 'in_transit', assignedVehicle: { driverName: 'Chofer operación' },
  } as unknown as Shipment
  const payload = printEngine.buildFromShipment(operation, 'Operadora real')
  const html = await buildShipmentTicketTemplateHtml(payload, '80mm', DEFAULT_SHIPMENT_TICKET_TEMPLATE)
  for (const value of ['PUN-REAL-00421', 'Remitente operación', 'Destinatario operación', 'Punata real', 'Cochabamba real', '3', '7.25 kg', 'Bs 24.50', 'Chofer operación', 'Entrega a domicilio', 'in_transit']) {
    assert.ok(html.includes(value), `expected operation value ${value}`)
  }

  const sparse = await buildShipmentTicketTemplateHtml({
    documentType: 'shipment_guide', title: 'Guía sintética', branchId: 'punata', branchName: 'Agencia Punata',
    documentNumber: 'SPARSE-1', timestampIso: '', operatorName: 'Operadora',
  }, '58mm', DEFAULT_SHIPMENT_TICKET_TEMPLATE)
  assert.match(sparse, /@page\{size:58mm auto/)
  assert.match(sparse, /No registrado/)
  assert.doesNotMatch(sparse, /NaN|undefined|null/)
})
