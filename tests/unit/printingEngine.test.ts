import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getDefaultPrinterProfiles,
  getPrinterStorageKey,
} from '../../src/services/printing/printerProfiles.ts'
import {
  buildDocumentHtml,
} from '../../src/adapters/printing/browserDialogPrinterAdapter.ts'
import {
  buildEscPosDocument,
  EscPosBuilder,
} from '../../src/adapters/printing/rawbtPrinterAdapter.ts'
import { printEngine } from '../../src/services/printing/printEngineService.ts'
import type { UnifiedDocumentPayload } from '../../src/types/printing.ts'

test('1. MOTOR DE IMPRESIÓN: Perfiles predeterminados por sucursal', () => {
  const punataProfiles = getDefaultPrinterProfiles('punata')
  assert.equal(punataProfiles.length, 3)
  assert.equal(punataProfiles[0].paperFormat, '80mm')
  assert.equal(punataProfiles[0].isDefault, true)
  assert.equal(punataProfiles[1].paperFormat, '58mm')
  assert.equal(punataProfiles[2].paperFormat, 'letter')

  const cbbaProfiles = getDefaultPrinterProfiles('cochabamba')
  assert.equal(cbbaProfiles.length, 3)
  assert.equal(cbbaProfiles[0].branchId, 'cochabamba')

  const key = getPrinterStorageKey('punata')
  assert.equal(key, 'pachax:printers:expreso-punata:punata')
})

test('2. MOTOR DE IMPRESIÓN: Generación de HTML térmico 80mm con QR y disclaimer', async () => {
  const sampleDoc: UnifiedDocumentPayload = {
    documentType: 'shipment_guide',
    title: 'GUÍA DE ENCOMIENDA OFICIAL',
    branchId: 'punata',
    branchName: 'Agencia Punata',
    branchAddress: 'Calle Sucre s/n',
    branchPhone: '4-5771234',
    documentNumber: 'PUN-2026-00100',
    trackingCode: 'PUN-2026-00100',
    timestampIso: '2026-11-02T19:00:00.000Z',
    operatorName: 'Doña Nelson Secretaria',
    sender: { name: 'Mario Torrico', phone: '71002233' },
    recipient: { name: 'Gonzalo Claros', phone: '72004455' },
    items: [
      { description: 'Repuestos de tractor', quantity: 2, weightKg: 10, totalBob: 29 },
    ],
    financials: {
      subtotalBob: 29,
      totalBob: 29,
      amountCents: 2900,
      paymentTiming: 'origin_paid',
      paymentMethod: 'cash',
    },
    footerNotes: ['Validez de recojo 30 días.'],
  }

  const html = await buildDocumentHtml(sampleDoc, '80mm')
  assert.ok(html.includes('S.M.T. EXPRESO PUNATA'))
  assert.ok(html.includes('GUÍA DE ENCOMIENDA OFICIAL'))
  assert.ok(html.includes('PUN-2026-00100'))
  assert.ok(html.includes('Mario Torrico'))
  assert.ok(html.includes('Gonzalo Claros'))
  assert.ok(html.includes('Repuestos de tractor'))
  assert.ok(html.includes('TOTAL:'))
  assert.ok(html.includes('Bs 29.00'))
  assert.ok(html.includes('DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL'))
  assert.ok(html.includes('data:image/png;base64')) // Código QR generado
})

test('3. MOTOR DE IMPRESIÓN: Constructor ESC/POS con corte de papel y gaveta', () => {
  const builder = new EscPosBuilder()
  builder.init()
  builder.align('center')
  builder.bold(true)
  builder.line('EXPRESO PUNATA')
  builder.kickDrawer()
  builder.cut()

  const bytes = builder.toBytes()
  assert.ok(bytes.length > 10)

  // ESC @ = [0x1B, 0x40]
  assert.equal(bytes[0], 0x1b)
  assert.equal(bytes[1], 0x40)

  const b64 = builder.toBase64()
  assert.ok(typeof b64 === 'string')
  assert.ok(b64.length > 0)
})

test('4. MOTOR DE IMPRESIÓN: Documento ESC/POS completo para RawBT', () => {
  const doc: UnifiedDocumentPayload = {
    documentType: 'payment_receipt',
    title: 'RECIBO DE COBRO',
    branchId: 'cochabamba',
    branchName: 'Agencia Cochabamba',
    documentNumber: 'REC-CBB-0001',
    timestampIso: '2026-11-02T19:30:00.000Z',
    operatorName: 'Cajero Central',
    financials: {
      subtotalBob: 50,
      totalBob: 50,
      amountCents: 5000,
      paymentMethod: 'cash',
      driverBalanceBeforeBob: 80,
      driverRemittanceBob: 50,
      driverBalanceRemainingBob: 30,
    },
  }

  const escpos = buildEscPosDocument(doc, '80mm', { cutPaper: true, kickDrawer: true })
  const bytes = escpos.toBytes()
  assert.ok(bytes.length > 50)
  assert.ok(escpos.toBase64().length > 0)
})

test('5. MOTOR DE IMPRESIÓN: Autodiagnóstico de estación', () => {
  const diag = printEngine.runDiagnostics('punata')
  assert.ok(diag.platform)
  assert.ok(diag.defaultPrinterName)
  assert.equal(diag.defaultFormat, '80mm')
})
