import type { DocumentPrintType, PaperFormat, UnifiedDocumentPayload } from '../../types/printing.ts'

export type TemplateFieldId = 'title' | 'subtitle' | 'number' | 'tracking' | 'timestamp' | 'branch' | 'sender' | 'senderPhone' | 'recipient' | 'recipientPhone' | 'route' | 'items' | 'financials' | 'paidAmount' | 'balanceDue' | 'paymentMethod' | 'payment' | 'operator' | 'driver' | 'dispatch' | 'signatures' | 'footer' | 'qr' | 'passenger' | 'travelDate' | 'vehicle' | 'quantity' | 'fare' | 'settlement' | 'paymentVerification'
export interface DocumentTemplateCopy {
  label: string
  visibleFields: TemplateFieldId[]
  order: TemplateFieldId[]
  showBranchContact: boolean
  showLogo: boolean
  fieldStyles: Partial<Record<TemplateFieldId, { bold: boolean; alignment: 'left' | 'center' | 'right' }>>
  compact: boolean
}
export interface DocumentPrintTemplate {
  documentType: DocumentPrintType
  version: number
  paperFormat: Extract<PaperFormat, '58mm' | '80mm'>
  marginsMm: number
  fontSize: 'compact' | 'normal' | 'large'
  separator: 'solid' | 'dashed' | 'none'
  secondCopyEnabled: boolean
  cutBetweenCopies: 'continuous' | 'page_break'
  cutAtEnd: 'driver' | 'none'
  cutPreference: 'partial' | 'full'
  copies: [DocumentTemplateCopy, DocumentTemplateCopy]
}

export const TEMPLATE_FIELD_CATALOG: Array<{ id: TemplateFieldId; label: string }> = [
  { id: 'title', label: 'Título' }, { id: 'subtitle', label: 'Concepto / referencia' }, { id: 'number', label: 'Número del comprobante' }, { id: 'tracking', label: 'Número de guía' },
  { id: 'timestamp', label: 'Fecha y hora' }, { id: 'branch', label: 'Agencia' }, { id: 'sender', label: 'Remitente' },
  { id: 'recipient', label: 'Destinatario' }, { id: 'route', label: 'Origen y destino' }, { id: 'items', label: 'Detalle / bultos' },
  { id: 'senderPhone', label: 'Teléfono del remitente' }, { id: 'recipientPhone', label: 'Teléfono del destinatario' },
  { id: 'financials', label: 'Importes y totales' }, { id: 'payment', label: 'Condición de pago' }, { id: 'operator', label: 'Operador' },
  { id: 'driver', label: 'Conductor' }, { id: 'dispatch', label: 'Datos de despacho' }, { id: 'signatures', label: 'Firmas' },
  { id: 'footer', label: 'Avisos oficiales' }, { id: 'qr', label: 'QR' }, { id: 'passenger', label: 'Pasajero' },
  { id: 'travelDate', label: 'Fecha de viaje' }, { id: 'vehicle', label: 'Vehículo y móvil' }, { id: 'quantity', label: 'Cantidad de pasajes' },
  { id: 'fare', label: 'Tarifa y total' }, { id: 'settlement', label: 'Entrega al conductor' }, { id: 'paymentVerification', label: 'Verificación de pago' },
]

const COMMON: TemplateFieldId[] = ['title', 'subtitle', 'number', 'timestamp', 'branch', 'operator', 'footer']
const SCHEMAS: Record<DocumentPrintType, TemplateFieldId[]> = {
  shipment_guide: [...COMMON, 'tracking', 'sender', 'senderPhone', 'recipient', 'recipientPhone', 'route', 'items', 'financials', 'paidAmount', 'balanceDue', 'paymentMethod', 'payment', 'driver', 'qr'],
  package_label: ['title', 'number', 'tracking', 'branch', 'items', 'qr'],
  dispatch_manifest: [...COMMON, 'route', 'items', 'financials', 'driver', 'dispatch'],
  delivery_proof: [...COMMON, 'tracking', 'sender', 'senderPhone', 'recipient', 'recipientPhone', 'route', 'items', 'signatures', 'qr'],
  payment_receipt: [...COMMON, 'recipient', 'items', 'financials', 'payment'],
  cash_shift_close: [...COMMON, 'financials', 'payment', 'signatures'],
  driver_settlement: [...COMMON, 'driver', 'items', 'financials', 'payment', 'signatures'],
  financial_report: [...COMMON, 'items', 'financials'],
  discrepancy_act: [...COMMON, 'tracking', 'sender', 'recipient', 'items', 'signatures'],
  member_due_receipt: [...COMMON, 'sender', 'financials', 'payment'],
  worker_payroll_receipt: [...COMMON, 'recipient', 'items', 'financials', 'payment', 'signatures'],
  general_expense_voucher: [...COMMON, 'recipient', 'items', 'financials', 'payment', 'signatures'],
  commission_voucher: [...COMMON, 'recipient', 'items', 'financials', 'payment', 'signatures'],
  fixed_asset_label: ['title', 'subtitle', 'number', 'branch', 'items', 'qr', 'footer'],
  test_page: [...COMMON, 'items'],
  passenger_ticket: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'passenger', 'travelDate', 'route', 'driver', 'vehicle', 'quantity', 'fare', 'paymentVerification', 'settlement', 'qr', 'footer'],
}
const REQUIRED: Partial<Record<DocumentPrintType, TemplateFieldId[]>> = {
  shipment_guide: ['title', 'tracking', 'timestamp', 'route', 'footer'],
  package_label: ['title', 'number'], dispatch_manifest: ['title', 'number', 'timestamp', 'footer'], delivery_proof: ['title', 'number', 'timestamp', 'footer'],
  payment_receipt: ['title', 'number', 'timestamp', 'footer'], cash_shift_close: ['title', 'number', 'timestamp', 'footer'], driver_settlement: ['title', 'number', 'timestamp', 'footer'],
  financial_report: ['title', 'number', 'timestamp', 'footer'], discrepancy_act: ['title', 'number', 'timestamp', 'footer'], member_due_receipt: ['title', 'number', 'timestamp', 'footer'],
  worker_payroll_receipt: ['title', 'number', 'timestamp', 'footer'], general_expense_voucher: ['title', 'number', 'timestamp', 'footer'], commission_voucher: ['title', 'number', 'timestamp', 'footer'],
  fixed_asset_label: ['title', 'number', 'footer'], test_page: ['title', 'number', 'footer'],
  passenger_ticket: ['title', 'number', 'travelDate', 'route', 'quantity', 'fare', 'paymentVerification', 'footer'],
}

const DEFAULT_CLIENT_RECEIPT: TemplateFieldId[] = ['title', 'tracking', 'timestamp', 'route', 'sender', 'recipient', 'items', 'paidAmount', 'balanceDue', 'paymentMethod', 'footer']
export const getTemplateFields = (type: DocumentPrintType) => TEMPLATE_FIELD_CATALOG.filter(field => SCHEMAS[type]?.includes(field.id))
export const getRequiredTemplateFields = (type: DocumentPrintType) => REQUIRED[type] || ['title', 'number']
export function createDefaultDocumentTemplate(type: DocumentPrintType): DocumentPrintTemplate {
  const fields = SCHEMAS[type] || COMMON
  const customerFields = fields.filter(id => (id !== 'qr' || type === 'package_label' || type === 'passenger_ticket') && !(type === 'shipment_guide' && id === 'number'))
  const agencyFields = type === 'shipment_guide' ? DEFAULT_CLIENT_RECEIPT : type === 'passenger_ticket' ? fields.filter(id => ['title', 'number', 'travelDate', 'route', 'driver', 'vehicle', 'quantity', 'fare', 'paymentVerification', 'settlement', 'qr'].includes(id)) : fields.filter(id => ['title', 'number', 'timestamp', 'items'].includes(id))
  return {
    documentType: type, version: 0, paperFormat: '80mm', marginsMm: 2, fontSize: 'normal', separator: 'dashed',
    secondCopyEnabled: type === 'shipment_guide' || type === 'passenger_ticket', cutBetweenCopies: 'page_break', cutAtEnd: 'driver', cutPreference: 'partial',
    copies: [
      { label: type === 'passenger_ticket' ? 'COMPROBANTE DE OFICINA' : 'CLIENTE', visibleFields: [...customerFields], order: [...customerFields], showBranchContact: true, showLogo: true, fieldStyles: { title: { bold: true, alignment: 'center' }, number: { bold: true, alignment: 'center' }, tracking: { bold: true, alignment: 'center' }, qr: { bold: false, alignment: 'center' }, financials: { bold: true, alignment: 'right' }, fare: { bold: true, alignment: 'right' } }, compact: false },
      { label: type === 'shipment_guide' ? 'COPIA CLIENTE' : type === 'passenger_ticket' ? 'PASAJE DEL CHOFER' : 'COPIA 2', visibleFields: [...agencyFields], order: [...agencyFields], showBranchContact: false, showLogo: false, fieldStyles: { title: { bold: true, alignment: 'center' }, number: { bold: true, alignment: 'center' }, paidAmount: { bold: true, alignment: 'right' }, balanceDue: { bold: true, alignment: 'right' } }, compact: true },
    ],
  }
}

export function normalizeDocumentTemplate(type: DocumentPrintType, input: unknown): DocumentPrintTemplate {
  const fallback = createDefaultDocumentTemplate(type)
  const source = input && typeof input === 'object' ? input as Partial<DocumentPrintTemplate> : {}
  const normalizeCopy = (copy: unknown, index: 0 | 1) => {
    const raw = copy && typeof copy === 'object' ? copy as Partial<DocumentTemplateCopy> : {}
    const allowed = new Set(SCHEMAS[type] || COMMON)
    const configuredFields = Array.isArray(raw.visibleFields) ? raw.visibleFields.filter((id): id is TemplateFieldId => allowed.has(id)) : fallback.copies[index].visibleFields
    // Migrate legacy shipment templates whose client copy predates the financial summary.
    // The payer receipt must always expose the real paid amount, balance and payment method.
    const legacyClientFields: TemplateFieldId[] = type === 'shipment_guide' && index === 1
      ? ['paidAmount', 'balanceDue', 'paymentMethod']
      : []
    const visible = [...configuredFields, ...legacyClientFields]
    const visibleFields = [...new Set([...visible, ...getRequiredTemplateFields(type)])]
    const rawOrder = Array.isArray(raw.order) ? raw.order.filter((id): id is TemplateFieldId => allowed.has(id) && visibleFields.includes(id)) : fallback.copies[index].order
    const order = [...new Set([...rawOrder, ...visibleFields])]
    const styleEntries = raw.fieldStyles && typeof raw.fieldStyles === 'object' ? Object.entries(raw.fieldStyles) : []
    const fieldStyles: DocumentTemplateCopy['fieldStyles'] = {}
    for (const [id, value] of styleEntries) if (allowed.has(id as TemplateFieldId) && value && typeof value === 'object') {
      const style = value as DocumentTemplateCopy['fieldStyles'][TemplateFieldId]
      fieldStyles[id as TemplateFieldId] = { bold: style?.bold === true, alignment: style?.alignment === 'center' || style?.alignment === 'right' ? style.alignment : 'left' }
    }
    return { label: index === 1 ? (type === 'shipment_guide' ? 'COPIA CLIENTE' : type === 'passenger_ticket' ? 'PASAJE DEL CHOFER' : 'COPIA 2') : type === 'passenger_ticket' ? 'COMPROBANTE DE OFICINA' : 'CLIENTE', visibleFields, order, showBranchContact: raw.showBranchContact === true, showLogo: raw.showLogo === true, fieldStyles, compact: index === 1 || raw.compact === true }
  }
  return {
    documentType: type, version: Number.isSafeInteger(source.version) && Number(source.version) >= 0 ? Number(source.version) : 0,
    paperFormat: source.paperFormat === '58mm' ? '58mm' : '80mm', marginsMm: Math.max(0, Math.min(6, Number.isFinite(source.marginsMm) ? Number(source.marginsMm) : 2)),
    fontSize: source.fontSize === 'compact' || source.fontSize === 'large' ? source.fontSize : 'normal',
    separator: source.separator === 'solid' || source.separator === 'none' ? source.separator : 'dashed',
    secondCopyEnabled: source.secondCopyEnabled === true, cutBetweenCopies: source.cutBetweenCopies === 'continuous' ? 'continuous' : 'page_break',
    cutAtEnd: source.cutAtEnd === 'none' ? 'none' : 'driver', cutPreference: source.cutPreference === 'full' ? 'full' : 'partial',
    copies: [normalizeCopy(source.copies?.[0], 0), normalizeCopy(source.copies?.[1], 1)],
  }
}

const val = (value: unknown, fallback = 'No registrado') => value == null || value === '' ? fallback : String(value)
export function templateFieldValue(id: TemplateFieldId, doc: UnifiedDocumentPayload): string {
  const meta = doc.metadata || {}
  switch (id) {
    case 'title': return val(doc.title)
    case 'subtitle': return val(doc.subtitle)
    case 'number': return val(doc.documentNumber)
    case 'tracking': return val(doc.trackingCode)
    case 'timestamp': return doc.timestampIso && Number.isFinite(Date.parse(doc.timestampIso)) ? new Date(doc.timestampIso).toLocaleString('es-BO') : 'No registrado'
    case 'branch': return `${val(doc.branchName || doc.branchId)}${doc.branchAddress ? ` · ${doc.branchAddress}` : ''}${doc.branchPhone ? ` · ${doc.branchPhone}` : ''}`
    case 'sender': return val(doc.sender?.name)
    case 'senderPhone': return val(doc.sender?.phone)
    case 'recipient': return val(doc.recipient?.name)
    case 'recipientPhone': return val(doc.recipient?.phone)
    case 'route': return val(doc.subtitle || [meta.origin, meta.destination].filter(Boolean).join(' → '))
    case 'items': return doc.items?.length ? doc.items.map(item => `${item.quantity} × ${item.description}`).join(' · ') : val(meta.description || meta.packageCount && `${meta.packageCount} bultos`)
    case 'financials': return doc.financials ? `Bs ${Number(doc.financials.totalBob ?? Number(doc.financials.amountCents || 0) / 100).toFixed(2)}` : val(meta.totalLabel || meta.amountBob && `Bs ${Number(meta.amountBob).toFixed(2)}`)
    case 'paidAmount': return `Bs ${((Number(meta.paidAmountCents) || 0) / 100).toFixed(2)}`
    case 'balanceDue': return `Bs ${((Number(meta.balanceDueCents) || 0) / 100).toFixed(2)}`
    case 'paymentMethod': return val(meta.paymentMethodLabel || doc.financials?.paymentMethod)
    case 'payment': return resolvePaymentConditionLabel(doc.financials)
    case 'operator': return val(doc.operatorName)
    case 'driver': return val(doc.dispatch?.driverName || meta.driverName || doc.signatures?.driverSignatureName || doc.recipient?.name)
    case 'dispatch': return doc.dispatch ? `${doc.dispatch.originBranchName} → ${doc.dispatch.destinationBranchName} · ${doc.dispatch.totalPackages} bultos · ${doc.dispatch.totalWeightKg} kg` : val(meta.dispatchSummary)
    case 'signatures': return val(doc.signatures?.clientSignatureName || doc.signatures?.operatorSignatureName || doc.signatures?.driverSignatureName)
    case 'footer': return val([...(doc.footerNotes || []), 'DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL'].join(' · '))
    case 'qr': return ''
    case 'passenger': return val(meta.passengerName)
    case 'travelDate': return val(meta.travelDate)
    case 'vehicle': return val(meta.vehicle)
    case 'quantity': return val(meta.quantity)
    case 'fare': return val(meta.fare)
    case 'settlement': return val(meta.settlement)
    case 'paymentVerification': return val(meta.paymentVerification)
  }
}

import { resolvePaymentConditionLabel } from '../../types/printing.ts'
