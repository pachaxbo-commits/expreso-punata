import QRCode from 'qrcode'
import type { PaperFormat, UnifiedDocumentPayload } from '../../types/printing.ts'
import { getRequiredTemplateFields, normalizeDocumentTemplate, templateFieldValue, TEMPLATE_FIELD_CATALOG, type DocumentPrintTemplate, type TemplateFieldId } from '../../services/printing/documentTemplates.ts'

const e = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const labels = new Map(TEMPLATE_FIELD_CATALOG.map(field => [field.id, field.label]))

export async function buildDocumentTemplateHtml(doc: UnifiedDocumentPayload, paper: Extract<PaperFormat, '58mm' | '80mm'>, input: DocumentPrintTemplate, options: { includeQr?: boolean; includeLogo?: boolean; copyIndex?: 0 | 1 } = {}): Promise<string> {
  const template = normalizeDocumentTemplate(doc.documentType, input)
  const qrContent = doc.qrContent || (doc.trackingCode ? `EXPRESO-PUNATA:${doc.trackingCode}` : '')
  let qr = ''
  if (options.includeQr !== false && qrContent && template.copies.some(copy => copy.visibleFields.includes('qr'))) {
    try { qr = await QRCode.toDataURL(qrContent, { width: 180, margin: 1, errorCorrectionLevel: 'M' }) } catch {}
  }
  const width = paper === '58mm' ? 58 : 80
  const font = template.fontSize === 'compact' ? '10.5px' : template.fontSize === 'large' ? '13px' : '12px'
  const separator = template.separator === 'none' ? 'none' : template.separator === 'solid' ? '1px solid #555' : '1px dashed #777'
  const isGuide = doc.documentType === 'shipment_guide'
  const requiredGuideFields = new Set(getRequiredTemplateFields('shipment_guide'))
  const renderGuideFields = (copy: DocumentPrintTemplate['copies'][number], fields: TemplateFieldId[]) => {
    const groups: { name: string; rows: string[] }[] = []
    for (const id of fields) {
      const value = id === 'qr' ? qr : templateFieldValue(id, doc).trim()
      if (!value || (value === 'No registrado' && !requiredGuideFields.has(id))) continue
      const name = id === 'title' || id === 'subtitle' ? 'heading'
        : id === 'tracking' || id === 'number' || id === 'route' ? 'reference'
          : id === 'financials' || id === 'payment' ? 'payment'
            : id === 'footer' ? 'notice' : id === 'qr' ? 'code' : 'details'
      let group = groups.at(-1)
      if (group?.name !== name) {
        group = { name, rows: [] }
        groups.push(group)
      }
      const style = copy.fieldStyles[id]
      const alignment = style?.alignment ?? (name === 'heading' || name === 'reference' ? 'center' : id === 'financials' ? 'right' : 'left')
      const label = id === 'financials' ? 'Total' : labels.get(id) || id
      group.rows.push(id === 'qr'
        ? `<div class="qr"><img src="${qr}" alt="QR"><small>Escanee para seguimiento</small></div>`
        : `<div class="field field-${id}" style="text-align:${alignment};${style?.bold ? 'font-weight:700;' : ''}">${name === 'heading' ? '' : `<span class="field-label">${e(label)}</span>`}<strong class="field-value">${e(value)}</strong></div>`)
    }
    return groups.map(group => `<div class="ticket-block block-${group.name}">${group.rows.join('')}</div>`).join('')
  }
  const renderCopy = (copy: DocumentPrintTemplate['copies'][number], index: number) => {
    const fields: TemplateFieldId[] = copy.order.filter(id => copy.visibleFields.includes(id))
    return `<section class="copy ${index === 1 ? 'agency' : ''}" style="--copy-pad:${copy.compact ? '1mm' : '2mm'}">
      ${options.includeLogo && copy.showLogo && doc.logoUrl?.startsWith('https://') ? `<img class="logo" src="${e(doc.logoUrl)}" alt="Logo institucional">` : ''}
      <header><strong class="company">${e(doc.companyName || 'EXPRESO PUNATA')}</strong><div>${e(doc.branchName || doc.branchId)}</div>${(doc.documentType === 'passenger_ticket' || (doc.documentType === 'shipment_guide' && index === 1)) ? `<b class="copy-label">${e(copy.label)}</b>` : ''}${copy.showBranchContact && (doc.branchAddress || doc.branchPhone) ? `<div class="institution-detail">${e(doc.branchAddress || '')}${doc.branchPhone ? ` · ${e(doc.branchPhone)}` : ''}</div>` : ''}</header>
      ${isGuide ? renderGuideFields(copy, fields) : `<div class="separator"></div>
      ${fields.map(id => id === 'qr' ? (qr ? `<div class="qr"><img src="${qr}" alt="QR"><small>Escanee para seguimiento</small></div>` : '') : `<div class="field" style="text-align:${copy.fieldStyles[id]?.alignment || (id === 'financials' ? 'right' : 'center')};${copy.fieldStyles[id]?.bold || ['title','number','tracking','financials'].includes(id) ? 'font-weight:700;' : ''}"><span>${e(labels.get(id) || id)}:</span> ${e(templateFieldValue(id, doc))}</div>`).join('')}`}
    </section>`
  }
  const copies = options.copyIndex !== undefined ? renderCopy(template.copies[options.copyIndex], options.copyIndex) : template.secondCopyEnabled ? template.copies.map(renderCopy).join(template.cutBetweenCopies === 'page_break' ? '<div class="page-break"></div>' : '<div class="continuous-gap"></div>') : renderCopy(template.copies[0], 0)
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${e(doc.title)} · ${e(doc.documentNumber)}</title><style>
    @page{size:${width}mm auto;margin:${template.marginsMm}mm}*{box-sizing:border-box}body{width:${doc.documentType === 'shipment_guide' ? Math.min(width - 2 * template.marginsMm, width === 58 ? 48 : 72) : width}mm;margin:0 auto;font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:${font};line-height:1.3;color:#111;padding-bottom:2mm}
    ${doc.documentType === 'shipment_guide' ? '.agency .field{margin:.55mm 0}.agency header{margin-bottom:1mm}.agency .separator{margin:1mm 0}' : ''}
    .copy{width:100%;padding:0 1mm var(--copy-pad);break-inside:avoid}header{text-align:center;margin-bottom:2mm}.company{display:block;font-size:1.2em;letter-spacing:.1px}.institution-detail{font-size:.85em}.copy-label{display:block;font-size:1.05em;margin-top:1mm}.logo{display:block;max-width:34mm;max-height:14mm;margin:0 auto 1mm}.separator{border-top:${separator};margin:2mm 0}.field{margin:1.2mm 0;overflow-wrap:anywhere}.field span{font-weight:500}.qr{text-align:center;margin:2mm}.qr img{width:28mm;height:28mm;display:block;margin:auto}.qr small{font-size:.8em}.page-break{break-after:page;height:0}.continuous-gap{height:2mm;border-top:1px dashed #aaa;margin:2mm 0}
    .thermal-guide{font-family:Arial,Helvetica,sans-serif;font-size:${template.fontSize === 'compact' ? '11px' : template.fontSize === 'large' ? '14px' : '12px'};line-height:1.25;color:#000}
    .thermal-guide header{border-bottom:1px solid #000;padding-bottom:1.3mm;margin-bottom:1.3mm}
    .thermal-guide .institution-detail,.thermal-guide .qr small{font-size:.94em}
    .thermal-guide .ticket-block + .ticket-block{margin-top:1.2mm}
    .thermal-guide .block-reference,.thermal-guide .block-payment{border:1px solid #000;padding:1mm 1.4mm}
    .thermal-guide .block-details,.thermal-guide .block-notice{border-top:${separator};padding-top:.7mm}
    .thermal-guide .field{margin:0;padding:.38mm 0;overflow-wrap:anywhere}
    .thermal-guide .field-label{font-weight:700;margin-inline-end:.9mm}
    .thermal-guide .field-value{font-weight:inherit}
    .thermal-guide .field-title,.thermal-guide .field-tracking .field-value,.thermal-guide .field-number .field-value,.thermal-guide .field-financials .field-value{font-size:1.18em;font-weight:700}
    .thermal-guide .field-payment .field-value{font-weight:700}
    .thermal-guide .field-footer .field-value{white-space:pre-line}
    .thermal-guide .agency .ticket-block + .ticket-block{margin-top:.75mm}
    .thermal-guide .agency .field{margin:0;padding:.18mm 0}
    .thermal-guide .agency .block-reference,.thermal-guide .agency .block-payment{padding:.65mm 1mm}
    @media screen{body{border:1px solid #ddd;padding:3mm}.page-break{border-top:2px dashed #aaa;height:5mm}}
  </style></head><body${isGuide ? ' class="thermal-guide"' : ''}>${copies}</body></html>`
}
