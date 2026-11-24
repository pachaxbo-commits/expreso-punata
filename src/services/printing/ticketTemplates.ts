import type { PaperFormat } from '../../types/printing.ts'

export const SHIPMENT_TICKET_FIELDS = [
  { id: 'sender', label: 'Remitente' },
  { id: 'senderPhone', label: 'Teléfono del remitente' },
  { id: 'recipient', label: 'Destinatario' },
  { id: 'recipientPhone', label: 'Teléfono del destinatario' },
  { id: 'origin', label: 'Origen' },
  { id: 'destination', label: 'Destino' },
  { id: 'createdAt', label: 'Fecha y hora', required: true },
  { id: 'description', label: 'Descripción' },
  { id: 'packageCount', label: 'Cantidad de bultos' },
  { id: 'weight', label: 'Peso' },
  { id: 'amount', label: 'Importe' },
  { id: 'paymentCondition', label: 'Condición de pago' },
  { id: 'operator', label: 'Operador' },
  { id: 'driver', label: 'Conductor' },
  { id: 'deliveryType', label: 'Tipo de entrega' },
  { id: 'status', label: 'Estado de guía' },
  { id: 'qr', label: 'QR de seguimiento' },
] as const

export type ShipmentTicketFieldId = typeof SHIPMENT_TICKET_FIELDS[number]['id']
export type TicketCopyKey = 'customer' | 'agency'
export type TicketAlignment = 'left' | 'center' | 'right'
export type TicketSeparator = 'solid' | 'dashed' | 'none'

export interface TicketFieldStyle {
  bold: boolean
  alignment: TicketAlignment
}

export interface ShipmentTicketCopy {
  visibleFields: ShipmentTicketFieldId[]
  order: ShipmentTicketFieldId[]
  fieldStyles: Partial<Record<ShipmentTicketFieldId, TicketFieldStyle>>
  headerText: string
  footerText: string
}

export interface ShipmentTicketTemplate {
  documentType: 'shipment_guide'
  version: number
  paperFormat: Extract<PaperFormat, '58mm' | '80mm'>
  marginsMm: number
  fontSize: 'compact' | 'normal' | 'large'
  separator: TicketSeparator
  spacing: 'compact' | 'normal' | 'wide'
  secondCopyEnabled: boolean
  betweenCopies: 'page_break' | 'continuous'
  customer: ShipmentTicketCopy
  agency: ShipmentTicketCopy
}

export const REQUIRED_SHIPMENT_TICKET_FIELDS: ShipmentTicketFieldId[] = ['createdAt', 'destination']

const customerFields: ShipmentTicketFieldId[] = [
  'sender', 'senderPhone', 'recipient', 'recipientPhone', 'origin', 'destination', 'createdAt',
  'description', 'packageCount', 'weight', 'amount', 'paymentCondition', 'operator', 'driver',
  'deliveryType', 'status', 'qr',
]

const agencyFields: ShipmentTicketFieldId[] = [
  'sender', 'recipient', 'destination', 'createdAt', 'description', 'packageCount', 'weight', 'qr',
]

const copy = (visibleFields: ShipmentTicketFieldId[]): ShipmentTicketCopy => ({
  visibleFields: [...visibleFields],
  order: [...visibleFields],
  fieldStyles: {},
  headerText: '',
  footerText: '',
})

export const DEFAULT_SHIPMENT_TICKET_TEMPLATE: ShipmentTicketTemplate = {
  documentType: 'shipment_guide',
  version: 0,
  paperFormat: '80mm',
  marginsMm: 2,
  fontSize: 'normal',
  separator: 'dashed',
  spacing: 'normal',
  secondCopyEnabled: false,
  betweenCopies: 'page_break',
  customer: copy(customerFields),
  agency: copy(agencyFields),
}

const fieldIdSet = new Set<string>(SHIPMENT_TICKET_FIELDS.map(field => field.id))
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function normalizeShipmentTicketTemplate(input: unknown): ShipmentTicketTemplate {
  const source = input && typeof input === 'object' ? input as Partial<ShipmentTicketTemplate> : {}
  const normalizeCopy = (value: unknown, fallback: ShipmentTicketCopy): ShipmentTicketCopy => {
    const item = value && typeof value === 'object' ? value as Partial<ShipmentTicketCopy> : {}
    const visible = Array.isArray(item.visibleFields) ? item.visibleFields.filter((id): id is ShipmentTicketFieldId => typeof id === 'string' && fieldIdSet.has(id)) : fallback.visibleFields
    const visibleFields = [...new Set([...visible, ...REQUIRED_SHIPMENT_TICKET_FIELDS])]
    const orderInput = Array.isArray(item.order) ? item.order.filter((id): id is ShipmentTicketFieldId => typeof id === 'string' && fieldIdSet.has(id)) : fallback.order
    const order = [...new Set([...orderInput.filter(id => visibleFields.includes(id)), ...visibleFields])]
    const fieldStyles: ShipmentTicketCopy['fieldStyles'] = {}
    if (item.fieldStyles && typeof item.fieldStyles === 'object') {
      for (const [id, style] of Object.entries(item.fieldStyles)) {
        if (!fieldIdSet.has(id) || !style || typeof style !== 'object') continue
        const raw = style as Partial<TicketFieldStyle>
        fieldStyles[id as ShipmentTicketFieldId] = {
          bold: raw.bold === true,
          alignment: raw.alignment === 'center' || raw.alignment === 'right' ? raw.alignment : 'left',
        }
      }
    }
    const shortText = (text: unknown, max: number) => typeof text === 'string' ? text.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, max) : ''
    return {
      visibleFields,
      order,
      fieldStyles,
      headerText: shortText(item.headerText, 120),
      footerText: shortText(item.footerText, 180),
    }
  }

  const paperFormat = source.paperFormat === '58mm' ? '58mm' : '80mm'
  return {
    documentType: 'shipment_guide',
    version: Number.isSafeInteger(source.version) && Number(source.version) >= 0 ? Number(source.version) : 0,
    paperFormat,
    marginsMm: clamp(Number.isFinite(source.marginsMm) ? Number(source.marginsMm) : 2, 0, 6),
    fontSize: source.fontSize === 'compact' || source.fontSize === 'large' ? source.fontSize : 'normal',
    separator: source.separator === 'solid' || source.separator === 'none' ? source.separator : 'dashed',
    spacing: source.spacing === 'compact' || source.spacing === 'wide' ? source.spacing : 'normal',
    secondCopyEnabled: source.secondCopyEnabled === true,
    betweenCopies: source.betweenCopies === 'continuous' ? 'continuous' : 'page_break',
    customer: normalizeCopy(source.customer, DEFAULT_SHIPMENT_TICKET_TEMPLATE.customer),
    agency: normalizeCopy(source.agency, DEFAULT_SHIPMENT_TICKET_TEMPLATE.agency),
  }
}

export function duplicateTicketCopy(copyToDuplicate: ShipmentTicketCopy): ShipmentTicketCopy {
  return structuredClone(copyToDuplicate)
}
