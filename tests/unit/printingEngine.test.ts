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
import {
  resolvePaymentConditionLabel,
  type UnifiedDocumentPayload,
} from '../../src/types/printing.ts'
import type { DispatchManifest } from '../../src/types/index.ts'

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

test('2. MOTOR DE IMPRESIÓN: Generación de HTML térmico con identidad oficial EXPRESO PUNATA (sin S.M.T.)', async () => {
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
    operatorName: 'Nelson Secretaria',
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
      paymentStatus: 'paid',
      paymentMethod: 'cash',
    },
    footerNotes: ['Validez de recojo 30 días.'],
  }

  const html80 = await buildDocumentHtml(sampleDoc, '80mm')
  // Identidad oficial estricta
  assert.ok(html80.includes('EXPRESO PUNATA'))
  assert.ok(!html80.includes('S.M.T.'))
  assert.ok(!html80.includes('Sindicato Mixto'))
  assert.ok(!html80.includes('40 años'))
  assert.ok(html80.includes('GUÍA DE ENCOMIENDA OFICIAL'))
  assert.ok(html80.includes('PUN-2026-00100'))
  assert.ok(html80.includes('Mario Torrico'))
  assert.ok(html80.includes('Gonzalo Claros'))
  assert.ok(html80.includes('Repuestos de tractor'))
  assert.ok(html80.includes('TOTAL:'))
  assert.ok(html80.includes('Bs 29.00'))
  assert.ok(html80.includes('PAGADO EN ORIGEN'))
  assert.ok(html80.includes('DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL'))
  assert.ok(html80.includes('page-break-inside: avoid;')) // Prevención de páginas en blanco

  // Formato 58mm
  const html58 = await buildDocumentHtml(sampleDoc, '58mm')
  assert.ok(html58.includes('width: 48mm;'))
  assert.ok(html58.includes('EXPRESO PUNATA'))
})

test('3. MOTOR DE IMPRESIÓN: Matriz exhaustiva de condiciones de pago', () => {
  // 1. Origen pagado
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 20,
      totalBob: 20,
      amountCents: 2000,
      paymentTiming: 'origin_paid',
      paymentStatus: 'paid',
    }),
    'PAGADO EN ORIGEN'
  )

  // 2. Origen pendiente
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 20,
      totalBob: 20,
      amountCents: 2000,
      paymentTiming: 'origin_pending',
      paymentStatus: 'pending',
    }),
    'PENDIENTE DE COBRO EN ORIGEN'
  )

  // 3. Contraentrega pendiente
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 25,
      totalBob: 25,
      amountCents: 2500,
      paymentTiming: 'destination_cod',
      paymentStatus: 'pending',
    }),
    'CONTRAENTREGA PENDIENTE DE COBRO'
  )

  // 4. Contraentrega cobrada en ventanilla destino
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 25,
      totalBob: 25,
      amountCents: 2500,
      paymentTiming: 'destination_cod',
      paymentStatus: 'paid',
    }),
    'CONTRAENTREGA COBRADA EN DESTINO'
  )

  // 5. Cobrado en ruta por chofer pero pendiente de rendición
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 30,
      totalBob: 30,
      amountCents: 3000,
      paymentTiming: 'destination_cod',
      paymentStatus: 'paid',
      collectedByDriverUid: 'driver-123',
      driverBalanceRemainingBob: 30,
    }),
    'COBRADO EN RUTA POR CONDUCTOR (PENDIENTE DE RENDICIÓN)'
  )

  // 6. Rendición en caja parcial
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 50,
      totalBob: 50,
      amountCents: 5000,
      remittanceType: 'partial',
    }),
    'RENDICIÓN PARCIAL EN CAJA'
  )

  // 7. Rendición en caja completa
  assert.equal(
    resolvePaymentConditionLabel({
      subtotalBob: 50,
      totalBob: 50,
      amountCents: 5000,
      remittanceType: 'full',
    }),
    'RENDICIÓN COMPLETA EN CAJA'
  )
})

test('4. MOTOR DE IMPRESIÓN: Constructor ESC/POS con corte de papel y gaveta', () => {
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

test('5. MOTOR DE IMPRESIÓN: Documento ESC/POS completo para RawBT con CodePage 1252 y QR nativo', () => {
  const doc: UnifiedDocumentPayload = {
    documentType: 'payment_receipt',
    title: 'RECIBO DE COBRO',
    branchId: 'cochabamba',
    branchName: 'Agencia Cochabamba',
    documentNumber: 'REC-CBB-0001',
    timestampIso: '2026-11-02T19:30:00.000Z',
    operatorName: 'Cajero Central',
    qrContent: 'EXPRESO-PUNATA:REC-CBB-0001',
    financials: {
      subtotalBob: 50,
      totalBob: 50,
      amountCents: 5000,
      paymentMethod: 'cash',
      driverBalanceBeforeBob: 80,
      driverRemittanceBob: 50,
      driverBalanceRemainingBob: 30,
      remittanceType: 'partial',
    },
    items: [
      { description: 'Cancelación envío encomienda con acento y eñe: Ñandú', quantity: 1, totalBob: 50 },
    ],
  }

  const escpos = buildEscPosDocument(doc, '80mm', { cutPaper: true, kickDrawer: true })
  const bytes = escpos.toBytes()
  assert.ok(bytes.length > 60)
  assert.ok(escpos.toBase64().length > 0)

  // Verifica que incluye la selección de CodePage 1252: ESC t 16 ([0x1B, 0x74, 0x10])
  let hasCp1252 = false
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x1b && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x10) {
      hasCp1252 = true
      break
    }
  }
  assert.ok(hasCp1252, 'Debe configurar CodePage 1252 para impresión de caracteres en español')
})

test('6. MOTOR DE IMPRESIÓN: Generación de Manifiesto de Despacho unificado', () => {
  const sampleManifest: DispatchManifest = {
    id: 'man-001',
    manifestNumber: 'MAN-PUN-2026-0001',
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    vehicleId: 'veh-1',
    vehiclePlate: '4055-XYZ',
    mobileNumber: '12',
    driverUid: 'driver-juan',
    driverName: 'Juan Chofer',
    driverPhone: '71009988',
    shipmentIds: ['PUN-001', 'PUN-002'],
    shipmentSummaries: [
      {
        shipmentId: 's-1',
        trackingCode: 'PUN-001',
        senderName: 'Mario',
        recipientName: 'Gonzalo',
        packageCount: 2,
        totalWeightKg: 5,
        paymentTiming: 'destination_cod',
        paymentStatus: 'pending',
        finalAmountCents: 3500,
        deliveryType: 'agency',
      },
      {
        shipmentId: 's-2',
        trackingCode: 'PUN-002',
        senderName: 'Carlos',
        recipientName: 'Ana',
        packageCount: 1,
        totalWeightKg: 3,
        paymentTiming: 'origin_paid',
        paymentStatus: 'paid',
        finalAmountCents: 2000,
        deliveryType: 'agency',
      },
    ],
    totalShipments: 2,
    totalPackages: 3,
    totalWeightKg: 8,
    totalCodAmountCents: 3500,
    status: 'dispatched',
    departureNotes: 'Salida puntual',
    dispatchedAt: '2026-11-02T19:00:00.000Z',
    dispatchedAtIso: '2026-11-02T19:00:00.000Z',
    dispatchedByUid: 'op-1',
    dispatchedByName: 'Doña Nelson',
    driverCustodyStatus: 'pending',
  }

  const doc = printEngine.buildFromDispatchManifest(sampleManifest, 'Doña Nelson')
  assert.equal(doc.documentType, 'dispatch_manifest')
  assert.equal(doc.documentNumber, 'MAN-PUN-2026-0001')
  assert.equal(doc.dispatch?.vehiclePlate, '4055-XYZ')
  assert.equal(doc.dispatch?.mobileNumber, '12')
  assert.equal(doc.dispatch?.totalPackages, 3)
  assert.equal(doc.financials?.amountCents, 3500)
  assert.equal(doc.items?.length, 2)
  assert.ok(doc.signatures?.driverSignatureName)
})

test('7. MOTOR DE IMPRESIÓN: Autodiagnóstico de estación', () => {
  const diag = printEngine.runDiagnostics('punata')
  assert.ok(diag.platform)
  assert.ok(diag.defaultPrinterName)
  assert.equal(diag.defaultFormat, '80mm')
})

test('8. MOTOR DE IMPRESIÓN: Generación de Recibo de Nómina para Trabajador (buildFromWorkerPayment)', () => {
  const samplePayment = {
    paymentNumber: 'REC-TRA-2026-00001',
    workerId: 'worker-1',
    workerCode: 'TRA-005',
    workerName: 'Juan Carlos Mamani',
    workerRole: 'estibador',
    workerCi: '4532189-CB',
    amountBob: 2500,
    amountCents: 250000,
    concept: 'Salario mensual Octubre 2026',
    period: '2026-10',
    paymentMethod: 'cash',
    paidAtIso: '2026-11-02T18:00:00.000Z',
    registeredByName: 'Nelson Admin',
  }

  const doc = printEngine.buildFromWorkerPayment(samplePayment, 'punata', 'Nelson Admin')
  assert.equal(doc.documentType, 'worker_payroll_receipt')
  assert.equal(doc.documentNumber, 'REC-TRA-2026-00001')
  assert.equal(doc.title, 'RECIBO DE PAGO DE PERSONAL')
  assert.equal(doc.financials?.amountCents, 250000)
  assert.equal(doc.financials?.totalBob, 2500)
  assert.ok(doc.qrContent?.includes('EXPRESO-PUNATA:PAGO-TRA:REC-TRA-2026-00001'))
  assert.equal(doc.signatures?.clientSignatureName, 'Juan Carlos Mamani')
})

test('9. MOTOR DE IMPRESIÓN: Generación de Comprobante de Egreso Operativo (buildFromGeneralExpense)', () => {
  const sampleExpense = {
    voucherNumber: 'EGR-2026-00001',
    category: 'servicios_basicos',
    branchId: 'cochabamba',
    concept: 'Servicio de energía eléctrica ANDE Cochabamba',
    amountBob: 340.5,
    amountCents: 34050,
    supplier: 'ENDE Cochabamba',
    invoiceOrReceiptNumber: 'FAC-987654',
    paymentMethod: 'cash',
    createdAtIso: '2026-11-02T18:30:00.000Z',
    createdByName: 'Nelson Admin',
  }

  const doc = printEngine.buildFromGeneralExpense(sampleExpense, 'cochabamba', 'Nelson Admin')
  assert.equal(doc.documentType, 'general_expense_voucher')
  assert.equal(doc.documentNumber, 'EGR-2026-00001')
  assert.equal(doc.title, 'COMPROBANTE DE EGRESO OPERATIVO')
  assert.equal(doc.financials?.amountCents, 34050)
  assert.equal(doc.financials?.totalBob, 340.5)
  assert.ok(doc.qrContent?.includes('EXPRESO-PUNATA:EGRESO:EGR-2026-00001'))
})

test('10. MOTOR DE IMPRESIÓN: Generación de Etiqueta Térmica de Activo Fijo (buildFromFixedAssetLabel)', () => {
  const sampleAsset = {
    id: 'asset-1',
    assetCode: 'ACT-PUN-0001',
    name: 'Impresora Térmica Xprinter 80mm',
    category: 'computacion',
    branchId: 'punata',
    physicalLocation: 'Ventanilla 1 - Recepción',
    responsiblePersonName: 'María Rodríguez',
    status: 'in_use',
  }

  const doc = printEngine.buildFromFixedAssetLabel(sampleAsset, 'punata')
  assert.equal(doc.documentType, 'fixed_asset_label')
  assert.equal(doc.documentNumber, 'ACT-PUN-0001')
  assert.ok(doc.title?.includes('ACTIVO FIJO'))
  assert.ok(doc.qrContent?.includes('EXPRESO-PUNATA:ACTIVO:ACT-PUN-0001'))
  assert.equal(doc.items?.[0]?.description, 'Impresora Térmica Xprinter 80mm')
})

test('11. MOTOR DE IMPRESIÓN: buildFromCashMovement genera títulos y condiciones de pago precisas', () => {
  // Movimiento de aporte social
  const mContribution = {
    id: 'MOV-01',
    branchId: 'punata',
    type: 'contribution_income',
    amountCents: 5000,
    amountBob: 50,
    paymentMethod: 'cash',
    concept: 'Aporte mensual noviembre',
  } as any

  const docContrib = printEngine.buildFromCashMovement(mContribution, 'Doña Nelson')
  assert.equal(docContrib.title, 'RECIBO DE APORTE / CUOTA SOCIAL')
  assert.equal(docContrib.financials?.paymentConditionLabel, 'APORTE / CUOTA SOCIAL')
  assert.equal(docContrib.financials?.totalBob, 50)

  // Movimiento de egreso operativo
  const mExpense = {
    id: 'MOV-02',
    branchId: 'cochabamba',
    type: 'expense',
    amountCents: 15000,
    amountBob: 150,
    paymentMethod: 'cash',
    concept: 'Pago de alquiler',
  } as any

  const docExpense = printEngine.buildFromCashMovement(mExpense, 'Doña Nelson')
  assert.equal(docExpense.title, 'COMPROBANTE DE EGRESO OPERATIVO')
  assert.equal(docExpense.financials?.paymentConditionLabel, 'EGRESO OPERATIVO AUTORIZADO')

  // Movimiento de nómina
  const mPayroll = {
    id: 'MOV-03',
    branchId: 'punata',
    type: 'worker_payroll',
    amountCents: 200000,
    amountBob: 2000,
    paymentMethod: 'cash',
    concept: 'Salario estibador',
  } as any

  const docPayroll = printEngine.buildFromCashMovement(mPayroll, 'Doña Nelson')
  assert.equal(docPayroll.title, 'RECIBO DE PAGO DE PERSONAL')
  assert.equal(docPayroll.financials?.paymentConditionLabel, 'PAGO DE HABERES PERSONAL')
})

test('12. MOTOR DE IMPRESIÓN: buildFromCashShift incluye aportes de socios y remesas de conductores', () => {
  const sampleShift = {
    id: 'shift-cbba-001',
    branchId: 'cochabamba',
    initialCashCents: 20000,
    expectedCashCents: 45000,
    actualCashCents: 45000,
    differenceCents: 0,
    operatorName: 'Nelson Secretaria',
    closedByName: 'Nelson Secretaria',
    status: 'closed',
    breakdown: {
      initialCashCents: 20000,
      shipmentsIncomeCents: 10000,
      codIncomeCents: 5000,
      driverRemittanceCents: 8000,
      contributionsIncomeCents: 7000,
      expensesCents: 5000,
    },
  } as any

  const doc = printEngine.buildFromCashShift(sampleShift, 'Nelson Secretaria')
  assert.equal(doc.documentType, 'cash_shift_close')
  assert.equal(doc.documentNumber, 'shift-cbba-001')

  const items = doc.items || []
  const remesasItem = items.find(i => i.description.includes('Remesas Rendidas por Choferes'))
  assert.ok(remesasItem)
  assert.equal(remesasItem?.totalBob, 80) // 8000 cents / 100

  const aportesItem = items.find(i => i.description.includes('Aportes y Cuotas de Socios'))
  assert.ok(aportesItem)
  assert.equal(aportesItem?.totalBob, 70) // 7000 cents / 100
})

test('13. MOTOR DE IMPRESIÓN: buildFromDriverSettlement no duplica monto de rendición por cada guía', () => {
  const settlement = {
    id: 'SETTL-001',
    settlementNumber: 'ACTA-REM-2026-0005',
    branchId: 'punata',
    amountCents: 15000, // Bs 150 total remitted
    remainingDriverBalanceCents: 0,
    driverName: 'Walter Céspedes',
    shipmentIds: ['PUN-2026-00010', 'PUN-2026-00011', 'PUN-2026-00012'],
  }

  const doc = printEngine.buildFromDriverSettlement(settlement, 'Nelson Secretaria')
  assert.equal(doc.documentType, 'driver_settlement')
  assert.equal(doc.financials?.totalBob, 150)
  assert.equal(doc.items?.length, 3)

  // Ninguna fila individual de guía debe asignar totalBob = 150
  for (const it of doc.items || []) {
    assert.equal(it.totalBob, undefined)
    assert.ok(it.description.startsWith('Guía conciliada: PUN-2026-'))
  }
})
