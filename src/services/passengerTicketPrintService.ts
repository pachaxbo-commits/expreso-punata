import QRCode from 'qrcode'
import { formatCurrencyBob } from '../domain/parcelEngine.ts'
import type { PassengerTicketOperation } from '../types/index.ts'

export type PassengerTicketPaperWidth = 58 | 80
export type PassengerTicketPresentation = { companyName?: string; branchName?: string; notice?: string }

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const formatDateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' })
  : '—'

export async function buildPassengerTicketPairHtml(
  operation: PassengerTicketOperation,
  options: PassengerTicketPresentation & { paperWidth?: PassengerTicketPaperWidth; reprint?: boolean } = {},
) {
  if (operation.paymentStatus !== 'paid_verified' || operation.paymentVerificationStatus !== 'verified' || !operation.paymentVerifiedAtIso) {
    throw new Error('Solo se imprimen pasajes con pago verificado en el servidor.')
  }
  const paperWidth = options.paperWidth ?? 80
  const ticketCode = escapeHtml(operation.ticketCode)
  const qrDataUrl = await QRCode.toDataURL(operation.ticketCode, { width: 180, margin: 1, errorCorrectionLevel: 'M' })
  const route = `${operation.originBranchId === 'punata' ? 'Punata' : 'Cochabamba'} → ${operation.destinationBranchId === 'cochabamba' ? 'Cochabamba' : 'Punata'}`
  const reprintBanner = options.reprint ? '<div class="duplicate">DUPLICADO · REIMPRESIÓN</div>' : ''
  const vehicle = operation.vehiclePlate
    ? `${operation.vehiclePlate}${operation.vehicleMobileNumber ? ` · Móvil ${operation.vehicleMobileNumber}` : ''}`
    : 'No registrado'
  const qr = `<img class="qr" alt="Código verificable ${ticketCode}" src="${qrDataUrl}">`
  const brand = escapeHtml(options.companyName || 'EXPRESO PUNATA')
  const notice = options.notice ? `<div class="foot">${escapeHtml(options.notice)}</div>` : ''
  const commonDetails = `
    <div class="row"><span>Operación</span><strong>${escapeHtml(operation.operationNumber)}</strong></div>
    <div class="row"><span>Fecha de viaje</span><strong>${escapeHtml(operation.travelDate)}</strong></div>
    <div class="row"><span>Ruta</span><strong>${escapeHtml(route)}</strong></div>
    <div class="row"><span>Chofer</span><strong>${escapeHtml(operation.driverName)}</strong></div>
    <div class="row"><span>Vehículo</span><strong>${escapeHtml(vehicle)}</strong></div>
    <div class="row"><span>Pasajes</span><strong>${operation.quantity}</strong></div>
    <div class="row total"><span>Total pagado</span><strong>${escapeHtml(formatCurrencyBob(operation.totalAmountCents, true))}</strong></div>
    <div class="row"><span>Pago</span><strong>QR VERIFICADO</strong></div>
    <div class="row"><span>Fecha de pago</span><strong>${escapeHtml(formatDateTime(operation.paymentVerifiedAtIso))}</strong></div>`

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pasajes ${escapeHtml(operation.operationNumber)}</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#e2e8f0;color:#0f172a;font:12px Arial,sans-serif}.tickets{display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px}.ticket{background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:12px;width:min(100%,76mm);box-shadow:0 2px 8px #0f172a20}.brand{text-align:center;color:#064e3b;font-weight:800;font-size:15px}.title{text-align:center;font-weight:800;font-size:13px;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed #cbd5e1;padding:4px 0}.row span{color:#475569}.row strong{text-align:right}.total{font-size:13px;color:#064e3b}.status{text-align:center;border:1px solid #059669;background:#ecfdf5;color:#065f46;padding:7px;font-weight:800;margin-top:8px}.qrbox{text-align:center;margin-top:8px}.qr{width:100px;height:100px}.code{font-family:monospace;font-weight:800;letter-spacing:.06em}.foot{text-align:center;color:#64748b;font-size:9px;margin-top:6px}.duplicate{text-align:center;background:#fef3c7;color:#92400e;font-weight:800;padding:5px;margin:-4px -4px 8px;border:1px dashed #b45309}.ticket+.ticket{border-top:2px dashed #64748b}
  @media screen and (min-width:600px){.ticket{width:76mm}}
  @media print{@page{size:${paperWidth}mm auto;margin:2mm}body{background:#fff}.tickets{display:block;padding:0}.ticket{width:${paperWidth - 4}mm;max-width:none;margin:0 auto;border:0;border-radius:0;box-shadow:none;break-after:page;page-break-after:always;padding:1mm}.ticket:last-child{break-after:auto;page-break-after:auto}.ticket+.ticket{border-top:0}.duplicate{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><main class="tickets">
<article class="ticket" data-ticket-copy="office">${reprintBanner}<div class="brand">${brand}</div><div class="title">COMPROBANTE DE OFICINA</div>${commonDetails}<div class="row"><span>Sucursal</span><strong>${escapeHtml(options.branchName || (operation.branchId === 'punata' ? 'Punata' : 'Cochabamba'))}</strong></div><div class="status">PAGADO / ${operation.settlementStatus === 'delivered' ? 'ENTREGADO AL CHOFER' : 'PENDIENTE DE ENTREGA AL CHOFER'}</div><div class="foot">Respaldo de pago QR y entrega al chofer · No es factura fiscal</div>${notice}</article>
<article class="ticket" data-ticket-copy="driver">${reprintBanner}<div class="brand">${brand}</div><div class="title">PASAJE PAGADO</div>${commonDetails}<div class="status">PAGO VERIFICADO · PRESENTAR AL CHOFER</div><div class="qrbox">${qr}<div class="code">${ticketCode}</div></div><div class="foot">La validez del pasaje se consulta en el registro digital.</div>${notice}</article>
</main></body></html>`
}

export function printPassengerTicketPair(iframe: HTMLIFrameElement | null) {
  if (!iframe?.contentWindow) throw new Error('No se pudo abrir la vista de impresión de los comprobantes.')
  iframe.contentWindow.focus()
  iframe.contentWindow.print()
}
