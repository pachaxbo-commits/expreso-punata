import QRCode from 'qrcode'
import type { UnifiedDocumentPayload, PaperFormat, PrintResult } from '../../types/printing'

const escapeHtml = (val: unknown): string =>
  String(val ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/**
 * Genera el código HTML adaptado al formato de papel seleccionado.
 */
export async function buildDocumentHtml(
  doc: UnifiedDocumentPayload,
  paperFormat: PaperFormat = '80mm',
  options: {
    fontSize?: 'compact' | 'normal' | 'large'
    marginsMm?: number
    includeQr?: boolean
    includeLogo?: boolean
  } = {}
): Promise<string> {
  const isThermal = paperFormat === '58mm' || paperFormat === '80mm'
  const contentWidth = paperFormat === '58mm' ? '48mm' : paperFormat === '80mm' ? '72mm' : '100%'
  const marginMm = options.marginsMm ?? (isThermal ? 3 : 15)
  const baseFontSize =
    options.fontSize === 'compact'
      ? (isThermal ? '11px' : '12px')
      : options.fontSize === 'large'
      ? (isThermal ? '14px' : '15px')
      : (isThermal ? '12px' : '13px')

  // Generar código QR si corresponde
  let qrDataUrl = ''
  if (options.includeQr !== false && (doc.qrContent || doc.trackingCode)) {
    try {
      const qrText = doc.qrContent || `EXPRESO-PUNATA:${doc.trackingCode || doc.documentNumber}`
      qrDataUrl = await QRCode.toDataURL(qrText, {
        width: isThermal ? 160 : 180,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
    } catch (err) {
      console.warn('[browserDialog] Error generando QR para ticket:', err)
    }
  }

  const dateFormatted = doc.timestampIso
    ? new Date(doc.timestampIso).toLocaleString('es-BO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : new Date().toLocaleString('es-BO')

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(doc.title)} - ${escapeHtml(doc.documentNumber)}</title>
  <style>
    @page {
      size: ${paperFormat === '58mm' ? '58mm auto' : paperFormat === '80mm' ? '80mm auto' : paperFormat === 'half_letter' ? '140mm 216mm' : paperFormat === 'letter' ? 'letter' : 'a4'};
      margin: ${marginMm}mm;
    }
    @media print {
      body { width: 100%; margin: 0; padding: 0; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; }
    body {
      width: ${contentWidth};
      max-width: ${isThermal ? contentWidth : '190mm'};
      margin: 0 auto;
      font-family: ${isThermal ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace' : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'};
      font-size: ${baseFontSize};
      line-height: 1.35;
      color: #000;
      background: #fff;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: bold; }
    .uppercase { text-transform: uppercase; }
    .header-box { text-align: center; margin-bottom: 6px; }
    .company-title { font-size: ${isThermal ? '16px' : '20px'}; font-weight: 800; letter-spacing: 0.5px; margin: 0; }
    .doc-title { font-size: ${isThermal ? '14px' : '16px'}; font-weight: bold; margin: 4px 0 2px 0; }
    .doc-num { font-size: ${isThermal ? '13px' : '15px'}; font-weight: 800; }
    .separator-solid { border-top: 1.5px solid #000; margin: 6px 0; }
    .separator-dashed { border-top: 1px dashed #000; margin: 5px 0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .info-label { font-weight: 600; }
    .items-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
    .items-table th { border-bottom: 1px solid #000; text-align: left; padding: 2px 0; font-size: 11px; }
    .items-table td { padding: 3px 0; vertical-align: top; }
    .qr-container { text-align: center; margin: 8px 0; }
    .qr-img { width: ${isThermal ? '130px' : '150px'}; height: ${isThermal ? '130px' : '150px'}; display: inline-block; }
    .signatures-box { margin-top: 15px; display: flex; justify-content: space-around; text-align: center; }
    .signature-slot { display: inline-block; width: 45%; border-top: 1px solid #000; padding-top: 4px; font-size: 10px; }
    .signature-preview { max-width: 130px; max-height: 50px; display: block; margin: 0 auto 4px auto; }
    .footer-notes { font-size: 10px; text-align: center; margin-top: 8px; color: #333; }
    .badge { display: inline-block; padding: 2px 6px; border: 1px solid #000; font-weight: bold; font-size: 11px; }
  </style>
</head>
<body>

  <!-- ENCABEZADO INSTITUCIONAL -->
  <div class="header-box">
    <div class="company-title">S.M.T. EXPRESO PUNATA</div>
    <div style="font-size: 10px; margin-top: 1px;">Sindicato Mixto de Transportes y Encomiendas</div>
    <div style="font-size: 10px; margin-top: 1px;">Agencia: ${escapeHtml(doc.branchName || doc.branchId)} ${doc.branchAddress ? '— ' + escapeHtml(doc.branchAddress) : ''}</div>
    ${doc.branchPhone ? `<div style="font-size: 10px;">Teléfono: ${escapeHtml(doc.branchPhone)}</div>` : ''}
    <div class="separator-solid"></div>
    <div class="doc-title uppercase">${escapeHtml(doc.title)}</div>
    ${doc.subtitle ? `<div style="font-size: 11px;">${escapeHtml(doc.subtitle)}</div>` : ''}
    <div class="doc-num">${escapeHtml(doc.documentNumber)}</div>
    ${doc.trackingCode ? `<div class="badge" style="margin-top: 3px;">GUÍA: ${escapeHtml(doc.trackingCode)}</div>` : ''}
  </div>

  <div class="separator-dashed"></div>

  <!-- METADATOS DE EMISIÓN -->
  <div class="info-row">
    <span class="info-label">Fecha y Hora:</span>
    <span>${escapeHtml(dateFormatted)}</span>
  </div>
  <div class="info-row">
    <span class="info-label">Operador:</span>
    <span>${escapeHtml(doc.operatorName)} ${doc.operatorRole ? `(${escapeHtml(doc.operatorRole)})` : ''}</span>
  </div>

  <!-- DATOS DE DESPACHO INTERAGENCIAS (SI APLICA) -->
  ${doc.dispatch ? `
    <div class="separator-dashed"></div>
    <div class="info-row"><span class="info-label">Ruta:</span><span>${escapeHtml(doc.dispatch.originBranchName)} ➔ ${escapeHtml(doc.dispatch.destinationBranchName)}</span></div>
    ${doc.dispatch.vehiclePlate ? `<div class="info-row"><span class="info-label">Móvil / Placa:</span><span>Nº ${escapeHtml(doc.dispatch.mobileNumber || '')} (${escapeHtml(doc.dispatch.vehiclePlate)})</span></div>` : ''}
    ${doc.dispatch.driverName ? `<div class="info-row"><span class="info-label">Conductor:</span><span>${escapeHtml(doc.dispatch.driverName)}</span></div>` : ''}
    <div class="info-row"><span class="info-label">Total Bultos:</span><span>${escapeHtml(doc.dispatch.totalPackages)} paquetes (${escapeHtml(doc.dispatch.totalWeightKg.toFixed(1))} kg)</span></div>
  ` : ''}

  <!-- DATOS DE REMITENTE Y DESTINATARIO -->
  ${doc.sender || doc.recipient ? `
    <div class="separator-dashed"></div>
    ${doc.sender ? `
      <div><span class="info-label">Remitente:</span> ${escapeHtml(doc.sender.name)}</div>
      ${doc.sender.phone ? `<div style="font-size: 11px; margin-left: 8px;">Tel: ${escapeHtml(doc.sender.phone)} ${doc.sender.docNumber ? `| Doc: ${escapeHtml(doc.sender.docType || 'CI')} ${escapeHtml(doc.sender.docNumber)}` : ''}</div>` : ''}
    ` : ''}
    ${doc.recipient ? `
      <div style="margin-top: 3px;"><span class="info-label">Consignatario:</span> ${escapeHtml(doc.recipient.name)}</div>
      ${doc.recipient.phone ? `<div style="font-size: 11px; margin-left: 8px;">Tel: ${escapeHtml(doc.recipient.phone)} ${doc.recipient.docNumber ? `| Doc: ${escapeHtml(doc.recipient.docType || 'CI')} ${escapeHtml(doc.recipient.docNumber)}` : ''}</div>` : ''}
      ${doc.recipient.relationship ? `<div style="font-size: 11px; margin-left: 8px;">Parentesco: ${escapeHtml(doc.recipient.relationship)}</div>` : ''}
    ` : ''}
  ` : ''}

  <!-- TABLA DE PAQUETES / CONTENIDO -->
  ${doc.items && doc.items.length > 0 ? `
    <div class="separator-dashed"></div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Cant/Desc</th>
          <th class="text-right">Peso</th>
          <th class="text-right">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${doc.items.map(item => `
          <tr>
            <td>
              <div class="bold">${item.quantity}x ${escapeHtml(item.description)}</div>
              ${item.packaging ? `<div style="font-size: 10px; color: #444;">Empaque: ${escapeHtml(item.packaging)}</div>` : ''}
            </td>
            <td class="text-right">${item.weightKg ? item.weightKg.toFixed(1) + ' kg' : '-'}</td>
            <td class="text-right bold">${item.totalBob !== undefined ? 'Bs ' + item.totalBob.toFixed(2) : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : ''}

  <!-- DETALLE FINANCIERO / CONDICIÓN DE COBRO -->
  ${doc.financials ? `
    <div class="separator-dashed"></div>
    ${doc.financials.paymentTiming ? `
      <div class="info-row">
        <span class="info-label">Condición:</span>
        <span class="bold">${doc.financials.paymentTiming === 'destination_cod' ? 'CONTRAENTREGA (COD Destino)' : 'PAGADO EN ORIGEN'}</span>
      </div>
    ` : ''}
    ${doc.financials.paymentMethod ? `
      <div class="info-row">
        <span class="info-label">Método Pago:</span>
        <span class="uppercase">${escapeHtml(doc.financials.paymentMethod === 'cash' ? 'Efectivo' : doc.financials.paymentMethod === 'qr' ? 'Pago QR' : 'Transferencia')}</span>
      </div>
    ` : ''}
    ${doc.financials.initialCashBob !== undefined ? `
      <div class="info-row"><span>Fondo Inicial de Caja:</span><span class="bold">Bs ${doc.financials.initialCashBob.toFixed(2)}</span></div>
    ` : ''}
    ${doc.financials.expectedCashBob !== undefined ? `
      <div class="info-row"><span>Efectivo Esperado en Gaveta:</span><span class="bold">Bs ${doc.financials.expectedCashBob.toFixed(2)}</span></div>
    ` : ''}
    ${doc.financials.countedCashBob !== undefined ? `
      <div class="info-row"><span>Efectivo Físico Arqueado:</span><span class="bold">Bs ${doc.financials.countedCashBob.toFixed(2)}</span></div>
    ` : ''}
    ${doc.financials.differenceBob !== undefined ? `
      <div class="info-row"><span class="bold">Diferencia de Arqueo:</span><span class="bold ${doc.financials.differenceBob < 0 ? 'color: red;' : ''}">Bs ${doc.financials.differenceBob.toFixed(2)}</span></div>
    ` : ''}
    ${doc.financials.driverBalanceBeforeBob !== undefined ? `
      <div class="info-row"><span>Saldo Custodia Previo:</span><span>Bs ${doc.financials.driverBalanceBeforeBob.toFixed(2)}</span></div>
      <div class="info-row"><span class="bold">Monto Rendido a Caja:</span><span class="bold">Bs ${(doc.financials.driverRemittanceBob || 0).toFixed(2)}</span></div>
      <div class="info-row"><span class="bold">Saldo Remanente en Custodia:</span><span class="bold">Bs ${(doc.financials.driverBalanceRemainingBob || 0).toFixed(2)}</span></div>
    ` : ''}
    <div class="separator-solid"></div>
    <div class="info-row" style="font-size: ${isThermal ? '15px' : '17px'}; font-weight: 800;">
      <span>TOTAL:</span>
      <span>Bs ${(doc.financials.totalBob || (doc.financials.amountCents / 100) || 0).toFixed(2)}</span>
    </div>
  ` : ''}

  <!-- FIRMAS DIGITALES O MANUSCRITAS -->
  ${doc.signatures ? `
    <div class="signatures-box">
      <div class="signature-slot">
        ${doc.signatures.signatureDataUrl ? `<img class="signature-preview" src="${doc.signatures.signatureDataUrl}" alt="Firma">` : '<div style="height: 35px;"></div>'}
        <div>${escapeHtml(doc.signatures.clientSignatureName || 'Firma Conforme Receptor')}</div>
      </div>
      <div class="signature-slot">
        <div style="height: 35px;"></div>
        <div>${escapeHtml(doc.signatures.operatorSignatureName || doc.operatorName || 'Operador Autorizado')}</div>
      </div>
    </div>
  ` : ''}

  <!-- CÓDIGO QR DE SEGUIMIENTO OPERATIVO -->
  ${qrDataUrl ? `
    <div class="qr-container">
      <img class="qr-img" src="${qrDataUrl}" alt="QR de Verificación">
      <div style="font-size: 9px; margin-top: 2px;">Escanee para rastreo y verificación interna</div>
    </div>
  ` : ''}

  <!-- PIE DE PÁGINA Y AVISOS -->
  <div class="separator-dashed"></div>
  <div class="footer-notes">
    <div>DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL</div>
    <div>Expreso Punata: 40 años uniendo los valles de Cochabamba.</div>
    ${(doc.footerNotes || []).map(note => `<div>${escapeHtml(note)}</div>`).join('')}
  </div>

</body>
</html>`
}

/**
 * Lanza la impresión directamente en el navegador del cliente mediante un iframe invisible.
 */
export async function printViaBrowserDialog(
  doc: UnifiedDocumentPayload,
  paperFormat: PaperFormat = '80mm',
  options: {
    fontSize?: 'compact' | 'normal' | 'large'
    marginsMm?: number
    includeQr?: boolean
    includeLogo?: boolean
  } = {}
): Promise<PrintResult> {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const nowIso = new Date().toISOString()

  try {
    const html = await buildDocumentHtml(doc, paperFormat, options)

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        success: true,
        jobId,
        connectionType: 'browser_dialog',
        dispatchedAtIso: nowIso,
      }
    }

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.top = '-9999px'
    iframe.style.left = '-9999px'
    iframe.style.width = '0px'
    iframe.style.height = '0px'
    iframe.style.border = 'none'
    document.body.appendChild(iframe)

    const iframeDoc = iframe.contentWindow?.document || iframe.contentDocument
    if (!iframeDoc) {
      if (iframe.parentNode) document.body.removeChild(iframe)
      throw new Error('No fue posible acceder al contexto de impresión del navegador.')
    }

    iframeDoc.open()
    iframeDoc.write(html)
    iframeDoc.close()

    const cleanup = () => {
      try {
        if (iframe.parentNode) document.body.removeChild(iframe)
      } catch {}
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
          setTimeout(() => {
            cleanup()
            resolve({
              success: true,
              jobId,
              connectionType: 'browser_dialog',
              dispatchedAtIso: nowIso,
            })
          }, 1000)
        } catch (err: any) {
          cleanup()
          resolve({
            success: false,
            jobId,
            connectionType: 'browser_dialog',
            errorMessage: err?.message || 'Error al disparar el cuadro de impresión.',
            errorClassification: 'safeToRetry',
            dispatchedAtIso: nowIso,
          })
        }
      }, 300)
    })
  } catch (err: any) {
    return {
      success: false,
      jobId,
      connectionType: 'browser_dialog',
      errorMessage: err?.message || 'Error preparando el documento para impresión.',
      errorClassification: 'unsafeToRetry',
      dispatchedAtIso: nowIso,
    }
  }
}
