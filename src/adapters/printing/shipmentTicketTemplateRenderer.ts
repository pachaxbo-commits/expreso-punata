import QRCode from 'qrcode'
import type { UnifiedDocumentPayload, PaperFormat } from '../../types/printing.ts'
import { resolvePaymentConditionLabel } from '../../types/printing.ts'
import { normalizeShipmentTicketTemplate, SHIPMENT_TICKET_FIELDS, type ShipmentTicketCopy, type ShipmentTicketFieldId, type ShipmentTicketTemplate } from '../../services/printing/ticketTemplates.ts'

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const formatDate = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
  : 'No registrado'

function fieldValue(id: ShipmentTicketFieldId, doc: UnifiedDocumentPayload): string {
  const metadata = doc.metadata || {}
  const packageCount = metadata.packageCount ?? doc.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const totalWeight = metadata.totalWeightKg ?? doc.items?.reduce((max, item) => Math.max(max, Number(item.weightKg) || 0), 0)
  const origin = metadata.originCity || metadata.origin || ''
  const destination = metadata.destinationCity || metadata.destination || doc.subtitle?.split('➔').at(-1)?.trim() || ''
  const description = doc.items?.map(item => `${Number(item.quantity) || 1} × ${item.description}`).filter(Boolean).join(' · ')
  const amount = doc.financials?.totalBob ?? (Number.isFinite(doc.financials?.amountCents) ? Number(doc.financials?.amountCents) / 100 : null)
  const values: Record<ShipmentTicketFieldId, string> = {
    sender: doc.sender?.name || 'No registrado',
    senderPhone: doc.sender?.phone || 'No registrado',
    recipient: doc.recipient?.name || 'No registrado',
    recipientPhone: doc.recipient?.phone || 'No registrado',
    origin: origin || doc.branchName || 'No registrado',
    destination: destination || 'No registrado',
    createdAt: formatDate(doc.timestampIso),
    description: description || 'No registrado',
    packageCount: Number.isFinite(Number(packageCount)) && Number(packageCount) > 0 ? String(packageCount) : 'No registrado',
    weight: Number.isFinite(Number(totalWeight)) && Number(totalWeight) > 0 ? `${Number(totalWeight).toFixed(2).replace(/\.00$/, '')} kg` : 'No registrado',
    amount: amount !== null ? `Bs ${Number(amount).toFixed(2)}` : 'No registrado',
    paymentCondition: resolvePaymentConditionLabel(doc.financials),
    operator: doc.operatorName || 'No registrado',
    driver: metadata.driverName || doc.dispatch?.driverName || 'No asignado',
    deliveryType: metadata.deliveryType || 'No registrado',
    status: metadata.shipmentStatus || 'No registrado',
    qr: '',
  }
  return values[id]
}

const separatorCss = (kind: ShipmentTicketTemplate['separator']) => kind === 'none' ? 'border:0' : kind === 'solid' ? 'border-top:1px solid #111' : 'border-top:1px dashed #444'
const fontSizePx = (size: ShipmentTicketTemplate['fontSize']) => size === 'compact' ? 10.5 : size === 'large' ? 13.5 : 12
const lineGapPx = (spacing: ShipmentTicketTemplate['spacing']) => spacing === 'compact' ? 1 : spacing === 'wide' ? 5 : 3

function renderField(id: ShipmentTicketFieldId, copy: ShipmentTicketCopy, doc: UnifiedDocumentPayload, qrDataUrl: string, template: ShipmentTicketTemplate): string {
  const descriptor = SHIPMENT_TICKET_FIELDS.find(field => field.id === id)
  const style = copy.fieldStyles[id]
  const align = style?.alignment || 'left'
  const bold = style?.bold ? 'font-weight:700;' : ''
  const spacing = lineGapPx(template.spacing)
  if (id === 'qr') return qrDataUrl ? `<div class="qr-field"><img src="${qrDataUrl}" alt="QR de seguimiento"><div>Escanee para seguimiento</div></div>` : ''
  return `<div class="field" style="text-align:${align};margin-top:${spacing}px;${bold}"><span class="label">${escapeHtml(descriptor?.label)}:</span> ${escapeHtml(fieldValue(id, doc))}</div>`
}

function renderCopy(copyKey: 'customer' | 'agency', copy: ShipmentTicketCopy, doc: UnifiedDocumentPayload, qrDataUrl: string, template: ShipmentTicketTemplate, includeLogo: boolean): string {
  const fields = copy.order.filter(id => copy.visibleFields.includes(id))
  return `<section class="ticket-copy ${copyKey}">
    <header class="institution">
      ${includeLogo && doc.logoUrl?.startsWith('https://') ? `<img class="logo" src="${escapeHtml(doc.logoUrl)}" alt="Logo institucional">` : ''}
      <div class="company">${escapeHtml(doc.companyName || 'EXPRESO PUNATA')}</div>
      <div>${escapeHtml(doc.branchName || doc.branchId)}</div>
      ${doc.branchAddress ? `<div>${escapeHtml(doc.branchAddress)}</div>` : ''}
      ${doc.branchPhone ? `<div>Teléfono: ${escapeHtml(doc.branchPhone)}</div>` : ''}
      ${copy.headerText ? `<div class="custom-text">${escapeHtml(copy.headerText)}</div>` : ''}
    </header>
    <div class="separator"></div>
    <div class="guide-title">${escapeHtml(doc.title || 'GUÍA DE ENCOMIENDA')}</div>
    <div class="tracking">GUÍA ${escapeHtml(doc.trackingCode || doc.documentNumber)}</div>
    ${doc.subtitle ? `<div class="route">${escapeHtml(doc.subtitle)}</div>` : ''}
    ${fields.map(id => renderField(id, copy, doc, qrDataUrl, template)).join('')}
    <div class="separator bottom"></div>
    <footer>
      <div class="legal">DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL</div>
      ${(doc.footerNotes || []).map(note => `<div>${escapeHtml(note)}</div>`).join('')}
      ${copy.footerText ? `<div class="custom-text">${escapeHtml(copy.footerText)}</div>` : ''}
    </footer>
  </section>`
}

export async function buildShipmentTicketTemplateHtml(
  doc: UnifiedDocumentPayload,
  paperFormat: Extract<PaperFormat, '58mm' | '80mm'>,
  templateInput: ShipmentTicketTemplate,
  options: { includeQr?: boolean; includeLogo?: boolean } = {},
): Promise<string> {
  const template = normalizeShipmentTicketTemplate(templateInput)
  const qrContent = doc.qrContent || (doc.trackingCode ? `EXPRESO-PUNATA:${doc.trackingCode}` : '')
  let qrDataUrl = ''
  if (template.customer.visibleFields.includes('qr') || (template.secondCopyEnabled && template.agency.visibleFields.includes('qr'))) {
    if (options.includeQr !== false && qrContent) {
      try { qrDataUrl = await QRCode.toDataURL(qrContent, { width: 180, margin: 1, errorCorrectionLevel: 'M' }) } catch { qrDataUrl = '' }
    }
  }
  const paperWidth = paperFormat === '58mm' ? 58 : 80
  const customer = renderCopy('customer', template.customer, doc, qrDataUrl, template, options.includeLogo !== false)
  const agency = template.secondCopyEnabled
    ? renderCopy('agency', template.agency, doc, qrDataUrl, template, options.includeLogo !== false)
    : ''
  const agencyClass = template.betweenCopies === 'page_break' ? 'page-break' : 'continuous'
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(doc.title)} · ${escapeHtml(doc.documentNumber)}</title>
  <style>
    @page{size:${paperWidth}mm auto;margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:${paperWidth}mm;background:#fff;color:#000;font-family:Arial,"Segoe UI",sans-serif;font-size:${fontSizePx(template.fontSize)}px;line-height:1.25}
    .ticket-copy{width:${paperWidth}mm;padding:${template.marginsMm}mm;overflow-wrap:anywhere}
    .page-break{break-before:page;page-break-before:always}
    .continuous{border-top:1px dashed #555}
    .institution{text-align:center;margin-bottom:${lineGapPx(template.spacing)}px}
    .company{font-weight:800;font-size:1.25em;letter-spacing:.2px}
    .logo{display:block;max-width:35mm;max-height:14mm;object-fit:contain;margin:0 auto 2px}
    .guide-title{text-align:center;font-weight:700;margin-top:4px}
    .tracking{text-align:center;font-size:1.08em;font-weight:800;margin-top:3px}
    .route{text-align:center;margin-top:3px}
    .field{display:block;line-height:1.3}
    .label{font-weight:600}
    .separator{${separatorCss(template.separator)};margin:${lineGapPx(template.spacing) + 1}px 0}
    .qr-field{text-align:center;margin:${lineGapPx(template.spacing) + 2}px 0}
    .qr-field img{width:29mm;height:29mm;object-fit:contain}
    footer{text-align:center;font-size:.84em;line-height:1.3}
    .legal{font-weight:700}
    .custom-text{white-space:pre-wrap;margin-top:2px}
    @media screen{body{margin:0 auto;background:#fff}.ticket-copy{min-height:80mm;border:1px solid #ddd}}
  </style></head><body>${customer}${agency ? agency.replace('class="ticket-copy agency"', `class="ticket-copy agency ${agencyClass}"`) : ''}</body></html>`
}
