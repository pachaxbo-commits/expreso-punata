import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDocumentTemplateHtml } from '../../src/adapters/printing/documentTemplateRenderer.ts'
import { buildDocumentHtml } from '../../src/adapters/printing/browserDialogPrinterAdapter.ts'
import { createDefaultDocumentTemplate, normalizeDocumentTemplate } from '../../src/services/printing/documentTemplates.ts'
import { DOCUMENT_PRINT_CATALOG } from '../../src/services/printing/printCatalog.ts'
import { buildPassengerTicketPairHtml } from '../../src/services/passengerTicketPrintService.ts'
import { buildEscPosTemplateDocument } from '../../src/adapters/printing/rawbtPrinterAdapter.ts'
import type { DocumentPrintType, UnifiedDocumentPayload } from '../../src/types/printing.ts'

const sample = (documentType: DocumentPrintType): UnifiedDocumentPayload => ({
  documentType, title: 'COMPROBANTE DE PRUEBA', subtitle: 'Punata → Cochabamba', branchId: 'punata', branchName: 'Agencia Punata',
  companyName: 'EXPRESO PUNATA', branchAddress: 'Dirección de prueba', branchPhone: '00000000', documentNumber: 'EP-TEST-001', trackingCode: 'EP-TEST-001',
  qrContent: 'EXPRESO-PUNATA:EP-TEST-001', timestampIso: '2026-11-24T12:00:00.000Z', operatorName: 'Operadora sintética',
  sender: { name: 'Remitente de prueba' }, recipient: { name: 'Destinatario de prueba' }, items: [{ description: 'Bulto sintético', quantity: 2 }],
  financials: { subtotalBob: 20, totalBob: 20, amountCents: 2000, paymentTiming: 'origin_paid', paymentStatus: 'paid' },
  footerNotes: ['EJEMPLO SINTÉTICO'], metadata: { packageCount: 2 },
})

test('catalog contains only actual thermal print paths and does not advertise reports as thermal', () => {
  assert.ok(DOCUMENT_PRINT_CATALOG.some(item => item.type === 'passenger_ticket'))
  assert.ok(DOCUMENT_PRINT_CATALOG.some(item => item.type === 'shipment_guide'))
  assert.ok(!DOCUMENT_PRINT_CATALOG.some(item => item.type === 'financial_report'))
  assert.ok(!DOCUMENT_PRINT_CATALOG.some(item => item.type === 'discrepancy_act'))
})

test('default shipment presentation is centered and the agency copy is compact and institutionally minimal', async () => {
  const template = createDefaultDocumentTemplate('shipment_guide')
  const html = await buildDocumentTemplateHtml(sample('shipment_guide'), '80mm', template)
  assert.match(html, /text-align:center/)
  assert.match(html, /COPIA AGENCIA/)
  assert.equal((html.match(/class="copy /g) || []).length, 2)
  assert.match(html, /Remitente de prueba/)
  assert.match(html, /Destinatario de prueba/)
  assert.doesNotMatch(html, /Dirección de prueba/)
  const agencySection = html.split('class="copy agency"')[1]
  assert.ok(agencySection)
  assert.doesNotMatch(agencySection, /Dirección de prueba|Teléfono institucional/)
  assert.equal(await buildDocumentHtml(sample('shipment_guide'), '80mm', { documentTemplate: template }), html)
})

test('field allowlist, required fields, financial alignment, 58/80 mm and optional omissions are safe', async () => {
  const sparse = sample('payment_receipt')
  sparse.sender = undefined; sparse.items = undefined; sparse.financials = undefined
  const template = normalizeDocumentTemplate('payment_receipt', {
    ...createDefaultDocumentTemplate('payment_receipt'), paperFormat: '58mm', marginsMm: 30,
    copies: [{ label: '', visibleFields: ['number', 'unknown'], fieldStyles: {}, compact: false }, { visibleFields: [], fieldStyles: {}, compact: true }],
  })
  assert.equal(template.marginsMm, 6)
  assert.ok(template.copies[0].visibleFields.includes('timestamp'))
  const html = await buildDocumentTemplateHtml(sparse, '58mm', template, { includeQr: false })
  assert.match(html, /size:58mm auto/)
  assert.match(html, /EP-TEST-001/)
  assert.doesNotMatch(html, /NaN|undefined|null|class="qr"/)
  const wide = await buildDocumentTemplateHtml(sample('payment_receipt'), '80mm', template)
  assert.match(wide, /size:80mm auto/)
  const same = await buildDocumentHtml(sample('payment_receipt'), '58mm', { documentTemplate: template, includeQr: false })
  assert.equal(same, html)
})

test('passenger ticket fields are operation-specific and keep its two distinct presentation copies', () => {
  const template = createDefaultDocumentTemplate('passenger_ticket')
  assert.equal(template.secondCopyEnabled, true)
  assert.ok(template.copies[0].visibleFields.includes('passenger'))
  assert.ok(template.copies[1].visibleFields.includes('fare'))
  assert.deepEqual(template.copies[0].visibleFields.filter(field => ['sender', 'recipient', 'tracking'].includes(field)), [])
})

test('the passenger-ticket print path uses its saved template only after server-verified payment', async () => {
  const operation = {
    id: 'synthetic-id', operationNumber: 'PAS-TEST-001', ticketCode: 'PAS-QRA-001', branchId: 'punata', originBranchId: 'punata', destinationBranchId: 'cochabamba',
    travelDate: '2026-11-25', driverUid: 'synthetic-driver', driverName: 'Conductor de prueba', vehiclePlate: 'TEST-001', vehicleMobileNumber: '99', passengerName: 'Pasajera sintética',
    quantity: 2, unitAmountCents: 2500, totalAmountCents: 5000, paymentMethod: 'qr', paymentStatus: 'paid_verified', paymentVerificationStatus: 'verified', paymentVerifiedAtIso: '2026-11-24T12:00:00.000Z',
    settlementStatus: 'pending_delivery', pendingSettlementCents: 5000, useStatus: 'pending_boarding', usedCount: 0, createdAtIso: '2026-11-24T12:00:00.000Z', createdByUid: 'synthetic-user', createdByName: 'Operadora sintética', updatedAtIso: '2026-11-24T12:00:00.000Z',
  } as const
  const template = createDefaultDocumentTemplate('passenger_ticket')
  const html = await buildPassengerTicketPairHtml(operation, { paperWidth: 58, documentTemplate: template })
  assert.match(html, /size:58mm auto/)
  assert.match(html, /Pasajera sintética/)
  assert.match(html, /PASAJE DEL CHOFER/)
  assert.match(html, /QR VERIFICADO/)
  assert.equal((html.match(/class="copy /g) || []).length, 2)
  await assert.rejects(() => buildPassengerTicketPairHtml({ ...operation, paymentStatus: 'pending_verification' }, { documentTemplate: template }))
})

test('RawBT applies both configured copies in one ESC/POS job and encodes selected partial/full cuts', () => {
  const template = createDefaultDocumentTemplate('shipment_guide')
  template.cutBetweenCopies = 'page_break'
  template.cutAtEnd = 'driver'
  template.cutPreference = 'full'
  const bytes = buildEscPosTemplateDocument(sample('shipment_guide'), '80mm', template).toBytes()
  const cuts = Array.from(bytes).filter((value, index, all) => value === 0x1d && all[index + 1] === 0x56)
  assert.equal(cuts.length, 2)
  assert.ok(Array.from(bytes).some((value, index, all) => value === 0x1d && all[index + 1] === 0x56 && all[index + 2] === 0x00))
})

test('guide blocks follow saved field order and omit disabled or empty content at both widths', async () => {
  const doc = sample('shipment_guide')
  const template = createDefaultDocumentTemplate('shipment_guide')
  for (const width of ['58mm', '80mm'] as const) {
    const options = { copyIndex: 0 as const }
    const client = await buildDocumentTemplateHtml(doc, width, template, options)
    assert.match(client, /class="ticket-block block-reference"/)
    assert.match(client, /class="ticket-block block-payment"/)
    assert.doesNotMatch(client, /class="qr"|field-senderPhone/)
    assert.equal(client, await buildDocumentHtml(doc, width, { ...options, documentTemplate: template }))
    const agency = await buildDocumentTemplateHtml(doc, width, template, { copyIndex: 1 })
    assert.match(agency, /COPIA AGENCIA/)
    for (const html of [client, agency]) {
      assert.equal((html.match(/class="copy /g) || []).length, 1)
      assert.match(html, /EP-TEST-001/)
      assert.match(html, /Bs 20\.00/)
    }
    const edited = structuredClone(template)
    edited.copies[0].visibleFields = edited.copies[0].visibleFields.filter(id => !['sender', 'recipient', 'items', 'financials', 'payment'].includes(id))
    const compact = await buildDocumentTemplateHtml(doc, width, edited, options)
    assert.doesNotMatch(compact, /class="ticket-block block-payment"|field-sender\b|field-items\b/)
    edited.copies[0].visibleFields.push('qr')
    edited.copies[0].order.push('qr')
    assert.match(await buildDocumentTemplateHtml(doc, width, edited, options), /class="qr"/)
  }
})

test('guide prints both official addresses before a single notice in each copy', async () => {
  const doc = sample('shipment_guide')
  doc.guideAgencyAddresses = [{ name: 'Agencia Punata', address: 'Dirección PUN' }, { name: 'Agencia Cochabamba', address: 'Dirección CBB' }]
  doc.footerNotes = ['DOCUMENTO OPERATIVO INTERNO', 'DOCUMENTO OPERATIVO INTERNO']
  doc.items = [{ description: 'Cajas', quantity: 2 }]
  const template = createDefaultDocumentTemplate('shipment_guide')
  for (const width of ['58mm', '80mm'] as const) {
    for (const copyIndex of [0, 1] as const) {
      const html = await buildDocumentHtml(doc, width, { documentTemplate: template, copyIndex })
      assert.doesNotMatch(html, /<header>[^]*?Dirección[^]*?<\/header>|Detalle \/ bultos|Condición de pago|PAGADO EN ORIGEN/)
      assert.match(html, /Detalle<\/span>.*Cajas <b>\(2\)<\/b>/)
      assert.match(html, /Dirección PUN.*Dirección CBB[^]*?block-notice[^]*?No constituye una factura fiscal<\/div><\/div>\s*<\/section>/)
      assert.equal((html.match(/AVISOS OFICIALES/g) || []).length, 1)
      assert.match(html, />Pagado</)
    }
  }
  assert.match(await buildDocumentTemplateHtml(doc, '58mm', template, { copyIndex: 0 }), />Pagado</)
  doc.financials = { ...doc.financials!, paymentTiming: 'destination_cod', paymentStatus: 'pending' }
  assert.match(await buildDocumentTemplateHtml(doc, '58mm', template, { copyIndex: 0 }), />Por pagar en destino</)
})
