import { getShipmentSignatureUrlThroughBackend } from './dispatchService.ts'

/**
 * Resuelve y carga la firma digital como Data URL, admitiendo Base64 en memoria o URL de Firebase Storage.
 */
async function resolveSignatureDataUrl(deliv: any, shipmentId?: string): Promise<string | null> {
  if (!deliv) return null
  let url = deliv.signature?.downloadUrl || deliv.signatureUrl
  if (!url && deliv.signature?.storagePath && shipmentId) {
    try {
      const res = await getShipmentSignatureUrlThroughBackend({
        shipmentId,
        storagePath: deliv.signature.storagePath,
      })
      if (res && res.url) url = res.url
    } catch (err) {
      console.warn('[pdfService] Signed URL fallback:', err)
    }
  }
  if (!deliv) return null
  if (typeof deliv.signatureDataUrl === 'string' && deliv.signatureDataUrl.startsWith('data:image')) {
    return deliv.signatureDataUrl
  }
  if (!url) url = deliv.signature?.downloadUrl || deliv.signatureUrl
  if (url && typeof url === 'string') {
    if (url.startsWith('data:image')) return url
    try {
      const resp = await fetch(url)
      if (resp.ok) {
        const blob = await resp.blob()
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
      }
    } catch {
      return null
    }
  }
  return null
}

import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import type { Shipment, CashShift, DispatchManifest } from '../types/index.ts'
import { formatCurrencyBob } from '../domain/parcelEngine.ts'

/**
 * Genera la Guía Oficial de Encomienda de Expreso Punata en PDF con código QR integrado.
 * Formato de media página / A5 horizontal o ticket oficial para impresión en ventanilla.
 */
export async function generateShipmentGuidePdf(shipment: Shipment): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5', // 148 x 210 mm
  })

  // Código QR verificable localmente sin enlaces rotos ni exposición de datos personales
  const qrVerificationText = `EXPRESO PUNATA\nGuía: ${shipment.trackingCode}\nOrigen: ${shipment.originCity}\nDestino: ${shipment.destinationCity}\nBultos: ${shipment.packageCount || 1}\nSistema PACHAX • Verificación Local`
  const qrDataUrl = await QRCode.toDataURL(qrVerificationText, { width: 140, margin: 1 })

  // Franja de aviso de entorno de desarrollo
  doc.setFillColor(254, 243, 199)
  doc.rect(0, 0, 148, 5, 'F')
  doc.setTextColor(146, 64, 14)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'bold')
  doc.text('DOCUMENTO DE PRUEBA EN DESARROLLO — SIN VALIDEZ FISCAL / NO OFICIAL', 18, 3.8)

  // Header institucional
  doc.setFillColor(6, 78, 59)
  doc.rect(0, 5, 148, 24, 'F')

  doc.setTextColor(250, 204, 21)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('EXPRESO PUNATA', 10, 14)

  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.text('Transporte Interprovincial Punata - Cochabamba', 10, 20)
  doc.text('Punata: 4-4571234 — Cochabamba: 4-4256789', 10, 25)

  // Recuadro de Guía
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(88, 8, 52, 18, 2, 2, 'F')
  doc.setTextColor(6, 78, 59)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('GUÍA DE ENCOMIENDA', 92, 13)
  doc.setFontSize(12)
  doc.setTextColor(180, 83, 9)
  doc.text(shipment.trackingCode, 92, 21)

  // Metadatos de Fecha y Operador
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.setFont('helvetica', 'normal')
  const dateStr = shipment.createdAtIso
    ? new Date(shipment.createdAtIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })
    : new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' })
  doc.text(`Fecha/Hora: ${dateStr}`, 10, 31)
  doc.text(`Operador: ${shipment.registeredByName || 'Ventanilla'} (${shipment.originCity})`, 80, 31)

  // Línea separadora
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.4)
  doc.line(10, 33, 138, 33)

  // Recuadro Remitente y Destinatario
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(10, 35, 62, 38, 2, 2, 'FD')
  doc.roundedRect(76, 35, 62, 38, 2, 2, 'FD')

  // Remitente
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(6, 78, 59)
  doc.text('REMITENTE (ORIGEN)', 13, 40)
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text(`Nombre: ${shipment.sender.name}`, 13, 46, { maxWidth: 56 })
  doc.setFont('helvetica', 'normal')
  doc.text(`Teléfono: ${shipment.sender.phone}`, 13, 56)
  if (shipment.sender.docNumber) {
    doc.text(`Doc: ${shipment.sender.docType || 'CI'} ${shipment.sender.docNumber}`, 13, 62)
  }
  doc.text(`Agencia: ${shipment.originCity}`, 13, 68)

  // Destinatario
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(6, 78, 59)
  doc.text('DESTINATARIO (DESTINO)', 79, 40)
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text(`Nombre: ${shipment.recipient.name}`, 79, 46, { maxWidth: 56 })
  doc.setFont('helvetica', 'normal')
  doc.text(`Teléfono: ${shipment.recipient.phone}`, 79, 56)
  if (shipment.recipient.docNumber) {
    doc.text(`Doc: ${shipment.recipient.docType || 'CI'} ${shipment.recipient.docNumber}`, 79, 62)
  }
  const deliveryLabel = shipment.deliveryType === 'home'
    ? 'A Domicilio'
    : shipment.deliveryType === 'direct_driver' ? 'Entrega en Ruta' : 'En Agencia'
  doc.text(`Modalidad: ${deliveryLabel}`, 79, 68)
  if (shipment.deliveryAddress) {
    doc.setFontSize(7)
    doc.text(`Dir: ${shipment.deliveryAddress.substring(0, 38)}`, 79, 72)
  }

  // Detalle de Carga y Contenido
  doc.setFillColor(241, 245, 249)
  doc.rect(10, 75, 128, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(15, 23, 42)
  doc.text('DETALLE DEL CONTENIDO', 13, 79.5)
  doc.text('BULTOS', 90, 79.5)
  doc.text('PESO', 115, 79.5)

  let yPos = 85
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  for (const it of shipment.items.slice(0, 4)) {
    const desc = `${it.description} (${it.category || 'general'})`
    doc.text(desc.substring(0, 45), 13, yPos)
    doc.text(`${it.quantity} ${it.packaging || 'pza'}`, 92, yPos)
    doc.text(`${it.weightKg || 0} kg`, 117, yPos)
    yPos += 5
  }

  // Resumen de Totales y Liquidación
  doc.setDrawColor(203, 213, 225)
  doc.line(10, 106, 138, 106)

  // Código QR
  doc.addImage(qrDataUrl, 'PNG', 12, 109, 32, 32)
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text('Escanear para rastreo', 13, 144)

  // Liquidación Financiera
  doc.setFillColor(254, 252, 232)
  doc.roundedRect(48, 109, 90, 36, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(6, 78, 59)
  doc.text('LIQUIDACIÓN Y FORMA DE PAGO', 52, 114)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(51, 65, 85)
  doc.text('Tarifa Base:', 52, 120)
  doc.text(formatCurrencyBob(shipment.shippingFeeCents, true), 115, 120)

  if (shipment.weightSurchargeCents > 0) {
    doc.text('Recargo Exceso Peso:', 52, 124)
    doc.text(formatCurrencyBob(shipment.weightSurchargeCents, true), 115, 124)
  }

  if (shipment.homeDeliveryFeeCents > 0) {
    doc.text('Recargo Entrega Domicilio:', 52, 128)
    doc.text(formatCurrencyBob(shipment.homeDeliveryFeeCents, true), 115, 128)
  }

  // TOTAL
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(15, 23, 42)
  doc.text('TOTAL A COBRAR:', 52, 135)
  doc.setTextColor(180, 83, 9)
  doc.text(formatCurrencyBob(shipment.finalAmountCents, true), 110, 135)

  // Estado del Pago
  doc.setFontSize(8)
  const isPaid = shipment.paymentStatus === 'paid'
  const payLabel = isPaid
    ? `PAGADO EN ORIGEN (${(shipment.paymentMethod || 'EFECTIVO').toUpperCase()})`
    : 'PENDIENTE DE COBRO EN ORIGEN'
  doc.setTextColor(isPaid ? 22 : 185, isPaid ? 101 : 28, isPaid ? 52 : 28)
  doc.text(`Condición: ${payLabel}`, 52, 141)

  // Términos y firmas
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(
    'Términos: El remitente declara que el paquete no contiene objetos ilícitos, explosivos ni perecederos no declarados.',
    10,
    155
  )
  doc.text(
    'Plazo máximo de recojo en almacén: 30 días calendario conforme a reglamento de Expreso Punata.',
    10,
    159
  )

  // Firmas
  doc.line(18, 185, 60, 185)
  doc.text('Firma Remitente / Ventanilla', 22, 189)

  doc.line(88, 185, 130, 185)
  doc.text('Firma y Aclaración de Quien Recibe', 88, 189)

  return doc.output('blob')
}

/**
 * Dispara la visualización e impresión del PDF en una nueva pestaña del navegador.
 */
export async function printShipmentGuidePdf(shipment: Shipment): Promise<void> {
  const blob = await generateShipmentGuidePdf(shipment)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

/** Genera la etiqueta interna de almacén usando la ubicación persistida de la encomienda. */
export async function printShipmentStorageLabelPdf(shipment: Shipment): Promise<void> {
  const location = shipment.storageLocation
  if (!location) throw new Error('La encomienda aún no tiene una ubicación de almacén asignada.')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 120] })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('EXPRESO PUNATA', 40, 10, { align: 'center' })
  doc.setFontSize(9)
  doc.text('ETIQUETA INTERNA DE ALMACÉN', 40, 17, { align: 'center' })
  doc.setDrawColor(6, 78, 59)
  doc.line(6, 21, 74, 21)
  doc.setFontSize(12)
  doc.text(`GUÍA: ${shipment.trackingCode}`, 6, 30)
  doc.setFontSize(9)
  doc.text(`Contenido: ${shipment.items?.[0]?.description || 'Encomienda'}`, 6, 38, { maxWidth: 68 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('UBICACIÓN FÍSICA', 6, 51)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Almacén: ${location.warehouseName || location.warehouseId || 'Almacén 1'}`, 6, 59)
  doc.text(`Módulo: ${location.moduleNumber || location.moduleId}`, 6, 66)
  doc.text(`Piso: ${location.floorNumber || location.rowNumber || 'N/D'}`, 6, 73)
  doc.text(`Fila/repisa: ${location.rowNumber || 'N/D'}`, 6, 80)
  doc.text(`Espacio: ${location.spaceNumber || location.position || 'N/D'}`, 6, 87)
  doc.setFontSize(7)
  doc.text(`Guardado: ${new Date(location.storedAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}`, 6, 98)
  doc.text(`Responsable: ${location.storedByName}`, 6, 104, { maxWidth: 68 })
  const url = URL.createObjectURL(doc.output('blob'))
  window.open(url, '_blank')
}


/**
 * Genera el Comprobante Oficial de Arqueo y Cierre de Caja en formato Ticket Térmico de 80 mm (o 58 mm).
 */
export async function generateCashShiftTicketPdf(
  shift: CashShift,
  ticketWidth: '80mm' | '58mm' = '80mm'
): Promise<Blob> {
  const is58 = ticketWidth === '58mm'
  const widthMm = is58 ? 58 : 80
  const heightMm = is58 ? 220 : 200

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  })

  const leftMargin = is58 ? 3 : 5
  const rightMargin = widthMm - leftMargin
  const centerX = widthMm / 2

  let y = 6

  // 1. Identidad Institucional
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(is58 ? 10 : 12)
  doc.setTextColor(6, 78, 59)
  doc.text('EXPRESO PUNATA', centerX, y, { align: 'center' })
  y += 4

  doc.setFontSize(is58 ? 6.5 : 7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.text('Servicio de Transporte y Encomiendas', centerX, y, { align: 'center' })
  y += 3.5

  const branchName = shift.branchId === 'punata' ? 'Agencia Punata' : 'Agencia Cochabamba'
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(branchName.toUpperCase(), centerX, y, { align: 'center' })
  y += 4

  // Línea separadora
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // 2. Datos del Turno
  doc.setFontSize(is58 ? 7 : 8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(6, 78, 59)
  doc.text('COMPROBANTE DE ARQUEO DE CAJA', centerX, y, { align: 'center' })
  y += 4

  doc.setFontSize(is58 ? 6.5 : 7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)

  doc.text(`N° Turno: ${shift.shiftNumber || shift.id}`, leftMargin, y)
  y += 3.5
  doc.text(`Operador: ${shift.operatorName}`, leftMargin, y)
  y += 3.5

  const openDateStr = shift.openedAt ? new Date(shift.openedAt).toLocaleString('es-BO') : 'N/D'
  const closeDateStr = shift.closedAt ? new Date(shift.closedAt).toLocaleString('es-BO') : 'Abierto'
  doc.text(`Apertura: ${openDateStr}`, leftMargin, y)
  y += 3.5
  doc.text(`Cierre:   ${closeDateStr}`, leftMargin, y)
  y += 4

  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // 3. Resumen Financiero
  const bd = shift.breakdown || {
    initialCashCents: shift.initialCashCents || 0,
    cashIncomeCents: 0,
    qrIncomeCents: 0,
    transferIncomeCents: 0,
    totalIncomeCents: 0,
    expensesCents: 0,
    netCashCents: shift.expectedCashCents || 0,
    pendingIncomeCents: 0,
  }

  const printRow = (label: string, amountBobStr: string, isBold = false) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal')
    doc.text(label, leftMargin, y)
    doc.text(amountBobStr, rightMargin, y, { align: 'right' })
    y += 3.5
  }

  doc.setFont('helvetica', 'bold')
  doc.text('RESUMEN DE FONDOS Y RECAUDACIÓN', leftMargin, y)
  y += 4

  printRow('Fondo Inicial (Sencillo):', formatCurrencyBob(shift.initialCashCents || 0))
  printRow('Ingresos en Efectivo:', formatCurrencyBob(bd.cashIncomeCents || 0))
  printRow('Ingresos por Pago QR:', formatCurrencyBob(bd.qrIncomeCents || 0))
  printRow('Ingresos Transferencia:', formatCurrencyBob(bd.transferIncomeCents || 0))

  doc.setLineWidth(0.2)
  doc.line(leftMargin, y, rightMargin, y)
  y += 3.5

  printRow('Total Ventas Cobradas:', formatCurrencyBob(bd.totalIncomeCents || 0), true)

  if (bd.expensesCents > 0) {
    printRow('(-) Egresos Autorizados:', `-${formatCurrencyBob(bd.expensesCents)}`)
  }

  if (bd.pendingIncomeCents && bd.pendingIncomeCents > 0) {
    printRow('Pendientes (No en Caja):', formatCurrencyBob(bd.pendingIncomeCents))
  }

  y += 1
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // 4. Arqueo y Diferencia
  const expectedBob = formatCurrencyBob(shift.expectedCashCents || 0)
  const actualBob = shift.actualCashCents !== null && shift.actualCashCents !== undefined
    ? formatCurrencyBob(shift.actualCashCents)
    : 'No registrado'
  const diffCents = shift.differenceCents || 0
  const diffStatus = shift.differenceStatus || (diffCents === 0 ? 'conforme' : diffCents > 0 ? 'sobrante' : 'faltante')

  printRow('Efectivo Esperado:', expectedBob, true)
  printRow('Efectivo Físico Contado:', actualBob, true)

  doc.setFont('helvetica', 'bold')
  const diffColor = diffStatus === 'conforme' ? [22, 101, 52] : diffStatus === 'sobrante' ? [37, 99, 235] : [220, 38, 38]
  doc.setTextColor(diffColor[0], diffColor[1], diffColor[2])
  printRow(`Diferencia (${diffStatus.toUpperCase()}): `, formatCurrencyBob(diffCents), true)
  doc.setTextColor(15, 23, 42)

  if (shift.closingNotes) {
    y += 1
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(is58 ? 5.5 : 6.5)
    doc.text(`Obs: ${shift.closingNotes}`, leftMargin, y)
    y += 4
  }

  y += 2
  doc.setLineWidth(0.3)
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // 5. Código QR de Verificación Interna
  const qrText = `EXPRESO PUNATA
Turno: ${shift.shiftNumber || shift.id}
Sucursal: ${shift.branchId}
Operador: ${shift.operatorName}
Esperado: ${expectedBob}
Contado: ${actualBob}
Estado: ${diffStatus.toUpperCase()}`
  const qrDataUrl = await QRCode.toDataURL(qrText, { width: 100, margin: 0 })
  const qrSize = is58 ? 20 : 22
  doc.addImage(qrDataUrl, 'PNG', centerX - qrSize / 2, y, qrSize, qrSize)
  y += qrSize + 4

  doc.setFontSize(is58 ? 5.5 : 6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('Comprobante de Control Interno — Sistema PACHAX', centerX, y, { align: 'center' })
  y += 8

  // 6. Firmas
  const lineW = is58 ? 22 : 30
  const col1 = leftMargin + (is58 ? 2 : 4)
  const col2 = rightMargin - lineW - (is58 ? 2 : 4)

  doc.setDrawColor(15, 23, 42)
  doc.line(col1, y, col1 + lineW, y)
  doc.line(col2, y, col2 + lineW, y)
  y += 3.5

  doc.setFontSize(is58 ? 5.5 : 6.5)
  doc.text('Firma Operador', col1 + lineW / 2, y, { align: 'center' })
  doc.text('Revisión / Auditoría', col2 + lineW / 2, y, { align: 'center' })

  return doc.output('blob')
}

/**
 * Dispara la visualización e impresión del comprobante de turno en el navegador.
 */
export async function printCashShiftTicketPdf(shift: CashShift, ticketWidth: '80mm' | '58mm' = '80mm'): Promise<void> {
  const blob = await generateCashShiftTicketPdf(shift, ticketWidth)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

/**
 * Genera el Manifiesto de Despacho y Carga en Ruta oficial de Expreso Punata en formato A4 / Carta.
 * Incluye membrete, código QR, datos del móvil y conductor, tabla de guías y casillas de firma de custodia.
 */
export async function generateDispatchManifestPdf(manifest: DispatchManifest): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4', // 210 x 297 mm
  })

  const pageWidth = 210
  const margin = 12
  const contentWidth = pageWidth - margin * 2

  // 1. Franja de aviso de entorno de desarrollo
  doc.setFillColor(254, 243, 199)
  doc.rect(0, 0, pageWidth, 5, 'F')
  doc.setTextColor(146, 64, 14)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text('DOCUMENTO DE CONTROL OPERATIVO EN DESARROLLO — EXPRESO PUNATA', margin, 3.8)

  // 2. Encabezado institucional
  doc.setFillColor(6, 78, 59)
  doc.rect(0, 5, pageWidth, 26, 'F')

  doc.setTextColor(250, 204, 21)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('EXPRESO PUNATA', margin, 14)

  doc.setFontSize(8.5)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.text('MANIFIESTO DE DESPACHO Y CARGA EN RUTA', margin, 20)
  doc.setFontSize(7.5)
  doc.text('Servicio Interprovincial Punata — Cochabamba y viceversa • PACHAX Logistics', margin, 26)

  // Recuadro Correlativo de Manifiesto
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(pageWidth - margin - 58, 8, 58, 20, 2, 2, 'F')
  doc.setTextColor(6, 78, 59)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('MANIFIESTO OFICIAL', pageWidth - margin - 54, 14)
  doc.setFontSize(12)
  doc.setTextColor(180, 83, 9)
  doc.text(manifest.manifestNumber, pageWidth - margin - 54, 23)

  let y = 35

  // 3. Cuadros de Información de Ruta, Vehículo y Conductor
  const colWidth = (contentWidth - 6) / 2

  // Cuadro Izquierdo: Ruta y Salida
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(margin, y, colWidth, 34, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(6, 78, 59)
  doc.text('INFORMACIÓN DEL VIAJE', margin + 4, y + 6)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)
  const originName = manifest.originBranchId === 'punata' ? 'Punata' : 'Cochabamba'
  const destName = manifest.destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba'
  doc.text(`Ruta: ${originName.toUpperCase()} ➔ ${destName.toUpperCase()}`, margin + 4, y + 12)
  const dateFormatted = manifest.dispatchedAtIso
    ? new Date(manifest.dispatchedAtIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })
    : 'Reciente'
  doc.text(`Fecha y Hora: ${dateFormatted}`, margin + 4, y + 18)
  doc.text(`Despachado por: ${manifest.dispatchedByName}`, margin + 4, y + 24)
  if (manifest.departureNotes) {
    doc.text(`Obs: ${manifest.departureNotes.substring(0, 45)}`, margin + 4, y + 30)
  }

  // Cuadro Derecho: Vehículo y Conductor + QR
  doc.roundedRect(margin + colWidth + 6, y, colWidth, 34, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(6, 78, 59)
  doc.text('TRANSPORTE Y CONDUCTOR', margin + colWidth + 10, y + 6)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(15, 23, 42)
  doc.text(`Móvil Interno: N° ${manifest.mobileNumber}  •  Placa: ${manifest.vehiclePlate}`, margin + colWidth + 10, y + 12)
  doc.text(`Conductor: ${manifest.driverName}`, margin + colWidth + 10, y + 18)
  doc.text(`Teléfono: ${manifest.driverPhone || 'S/N'}`, margin + colWidth + 10, y + 24)
  doc.text(`Custodia: ${manifest.driverCustodyStatus === 'accepted' ? 'CONFIRMADA' : 'PENDIENTE'}`, margin + colWidth + 10, y + 30)

  // QR en esquina derecha
  const qrVerificationText = `EXPRESO PUNATA\nManifiesto: ${manifest.manifestNumber}\nOrigen: ${originName}\nDestino: ${destName}\nMóvil: ${manifest.mobileNumber}\nChofer: ${manifest.driverName}\nGuías: ${manifest.totalShipments}\nBultos: ${manifest.totalPackages}`
  const qrDataUrl = await QRCode.toDataURL(qrVerificationText, { width: 120, margin: 0 })
  doc.addImage(qrDataUrl, 'PNG', margin + colWidth * 2 - 20, y + 5, 24, 24)

  y += 39

  // 4. Tabla de Encomiendas Incorporadas
  doc.setFillColor(6, 78, 59)
  doc.rect(margin, y, contentWidth, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(250, 204, 21)

  const colX = {
    num: margin + 2,
    code: margin + 9,
    sender: margin + 40,
    recipient: margin + 78,
    packages: margin + 116,
    weight: margin + 129,
    timing: margin + 144,
    amount: margin + 168,
  }

  doc.text('#', colX.num, y + 5)
  doc.text('GUÍA', colX.code, y + 5)
  doc.text('REMITENTE', colX.sender, y + 5)
  doc.text('DESTINATARIO', colX.recipient, y + 5)
  doc.text('BULTOS', colX.packages, y + 5)
  doc.text('PESO', colX.weight, y + 5)
  doc.text('CONDICIÓN', colX.timing, y + 5)
  doc.text('COBRO DESTINO', colX.amount, y + 5)

  y += 7

  const items = manifest.shipmentSummaries || []
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)

  items.forEach((item, index) => {
    // Alternancia de color de fila
    if (index % 2 === 0) {
      doc.setFillColor(248, 250, 252)
      doc.rect(margin, y, contentWidth, 6, 'F')
    }

    doc.setTextColor(15, 23, 42)
    doc.text(String(index + 1), colX.num, y + 4.2)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(6, 78, 59)
    doc.text(item.trackingCode, colX.code, y + 4.2)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.text(item.senderName.substring(0, 20), colX.sender, y + 4.2)
    doc.text(item.recipientName.substring(0, 20), colX.recipient, y + 4.2)

    doc.text(`${item.packageCount} blt`, colX.packages, y + 4.2)
    doc.text(`${item.totalWeightKg} kg`, colX.weight, y + 4.2)

    const isCod = item.paymentTiming === 'destination_cod' && item.paymentStatus !== 'paid'
    if (isCod) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(180, 83, 9)
      doc.text('POR PAGAR', colX.timing, y + 4.2)
      doc.text(formatCurrencyBob(item.finalAmountCents, true), colX.amount, y + 4.2)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(22, 101, 52)
      doc.text('PAGADO ORIGEN', colX.timing, y + 4.2)
      doc.text('Bs 0.00', colX.amount, y + 4.2)
    }

    // Línea separadora ligera
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.line(margin, y + 6, margin + contentWidth, y + 6)

    y += 6
  })

  // 5. Fila de Totales
  doc.setFillColor(241, 245, 249)
  doc.rect(margin, y, contentWidth, 7, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(6, 78, 59)
  doc.text(`TOTALES: ${manifest.totalShipments} Encomiendas`, colX.num, y + 5)
  doc.text(`${manifest.totalPackages} Bultos`, colX.packages, y + 5)
  doc.text(`${manifest.totalWeightKg} kg`, colX.weight, y + 5)
  doc.setTextColor(180, 83, 9)
  doc.text(`Total a Cobrar: ${formatCurrencyBob(manifest.totalCodAmountCents, true)}`, colX.timing, y + 5)

  y += 14

  // 6. Casillas de Firmas de Custodia y Recepción
  const signBoxWidth = (contentWidth - 10) / 3
  const signBoxHeight = 30

  // Despacho Origen
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.roundedRect(margin, y, signBoxWidth, signBoxHeight, 1.5, 1.5, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(6, 78, 59)
  doc.text('1. DESPACHADO (ORIGEN)', margin + 3, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Responsable: ${manifest.dispatchedByName}`, margin + 3, y + 22)
  doc.text('Firma y Sello Agencia Origen', margin + 3, y + 27)

  // Chofer Custodia
  const xChofer = margin + signBoxWidth + 5
  doc.roundedRect(xChofer, y, signBoxWidth, signBoxHeight, 1.5, 1.5, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(6, 78, 59)
  doc.text('2. CUSTODIA (CONDUCTOR)', xChofer + 3, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Conductor: ${manifest.driverName}`, xChofer + 3, y + 22)
  doc.text(`Móvil: ${manifest.mobileNumber} • Firma de Conformidad`, xChofer + 3, y + 27)

  // Recepción Destino
  const xDest = margin + (signBoxWidth + 5) * 2
  doc.roundedRect(xDest, y, signBoxWidth, signBoxHeight, 1.5, 1.5, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(6, 78, 59)
  doc.text('3. RECEPCIÓN (DESTINO)', xDest + 3, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.text(`Agencia Destino: ${destName}`, xDest + 3, y + 22)
  doc.text('Firma, Sello y Fecha de Recepción', xDest + 3, y + 27)

  y += signBoxHeight + 8

  // Pie de página
  doc.setFontSize(6)
  doc.setTextColor(148, 163, 184)
  doc.text(`Documento generado por PACHAX Platform para Expreso Punata • Manifiesto ${manifest.manifestNumber} • Fecha: ${dateFormatted}`, margin, y)

  return doc.output('blob')
}

export async function printDispatchManifestPdf(manifest: DispatchManifest): Promise<void> {
  const blob = await generateDispatchManifestPdf(manifest)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

/**
 * Genera el comprobante de viaje resumido para impresora térmica de 80 mm (Ticket Conductor).
 */
export async function generateDispatchManifestTicket80mmPdf(manifest: DispatchManifest): Promise<Blob> {
  const widthMm = 80
  const leftMargin = 4
  const rightMargin = 76
  const centerX = 40

  const items = manifest.shipmentSummaries || []
  const baseHeight = 120 + items.length * 9

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, baseHeight],
  })

  let y = 6

  // Cabecera
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(6, 78, 59)
  doc.text('EXPRESO PUNATA', centerX, y, { align: 'center' })
  y += 4

  doc.setFontSize(8)
  doc.setTextColor(180, 83, 9)
  doc.text('HOJA DE RUTA / CHOFER', centerX, y, { align: 'center' })
  y += 4

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(manifest.manifestNumber, centerX, y, { align: 'center' })
  y += 5

  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // Datos de viaje
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  const originName = manifest.originBranchId === 'punata' ? 'Punata' : 'Cochabamba'
  const destName = manifest.destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba'
  doc.text(`Ruta: ${originName} ➔ ${destName}`, leftMargin, y)
  y += 3.5
  doc.text(`Móvil: ${manifest.mobileNumber}  •  Placa: ${manifest.vehiclePlate}`, leftMargin, y)
  y += 3.5
  doc.text(`Chofer: ${manifest.driverName}`, leftMargin, y)
  y += 3.5
  const dateFormatted = manifest.dispatchedAtIso
    ? new Date(manifest.dispatchedAtIso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
    : ''
  doc.text(`Salida: ${dateFormatted} • Op: ${manifest.dispatchedByName}`, leftMargin, y)
  y += 4

  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // Lista de encomiendas
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text('GUÍAS ASIGNADAS:', leftMargin, y)
  y += 4

  items.forEach((item, idx) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(6, 78, 59)
    doc.text(`${idx + 1}. ${item.trackingCode}`, leftMargin, y)

    const isCod = item.paymentTiming === 'destination_cod' && item.paymentStatus !== 'paid'
    if (isCod) {
      doc.setTextColor(180, 83, 9)
      doc.text(`POR PAGAR: ${formatCurrencyBob(item.finalAmountCents, true)}`, rightMargin, y, { align: 'right' })
    } else {
      doc.setTextColor(22, 101, 52)
      doc.text('PAGADO', rightMargin, y, { align: 'right' })
    }
    y += 3

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(71, 85, 105)
    doc.text(`Para: ${item.recipientName.substring(0, 24)} (${item.packageCount} blt - ${item.totalWeightKg}kg)`, leftMargin + 2, y)
    y += 4
  })

  doc.setDrawColor(203, 213, 225)
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // Totales
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(6, 78, 59)
  doc.text(`Total Guías: ${manifest.totalShipments}`, leftMargin, y)
  doc.text(`Bultos: ${manifest.totalPackages}`, rightMargin, y, { align: 'right' })
  y += 4
  doc.setTextColor(180, 83, 9)
  doc.text(`Total por Cobrar en Destino:`, leftMargin, y)
  doc.text(formatCurrencyBob(manifest.totalCodAmountCents, true), rightMargin, y, { align: 'right' })
  y += 6

  // QR
  const qrVerificationText = `EXPRESO PUNATA\n${manifest.manifestNumber}\nMóvil ${manifest.mobileNumber}\n${manifest.totalShipments} Encomiendas`
  const qrDataUrl = await QRCode.toDataURL(qrVerificationText, { width: 90, margin: 0 })
  doc.addImage(qrDataUrl, 'PNG', centerX - 12, y, 24, 24)
  y += 28

  // Firma
  doc.setDrawColor(15, 23, 42)
  doc.line(centerX - 20, y, centerX + 20, y)
  y += 3.5
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('Firma de Custodia Chofer', centerX, y, { align: 'center' })

  return doc.output('blob')
}

export async function printDispatchManifestTicket80mm(manifest: DispatchManifest): Promise<void> {
  const blob = await generateDispatchManifestTicket80mmPdf(manifest)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

/**
 * Genera el Certificado / Acta de Entrega Conforme de Encomienda en PDF (Formato A5 / Media Carta).
 * Incluye la firma digital manuscrita capturada en ventanilla y datos de quien retira.
 */
export async function generateDeliveryProofPdf(shipment: Shipment): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5', // 148 x 210 mm
  })

  const deliv = shipment.deliveryRecord || {} as any

  // Franja de aviso de entorno de desarrollo
  doc.setFillColor(254, 243, 199)
  doc.rect(0, 0, 148, 5, 'F')
  doc.setTextColor(146, 64, 14)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'bold')
  doc.text('DOCUMENTO DE CONTROL INTERNO • ENTREGA CONFORME EN VENTANILLA', 20, 3.8)

  // Header institucional
  doc.setFillColor(6, 78, 59)
  doc.rect(0, 5, 148, 22, 'F')

  doc.setTextColor(250, 204, 21)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('EXPRESO PUNATA', 10, 14)

  doc.setFontSize(7.5)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.text('ACTA DE CONFORMIDAD Y ENTREGA DE ENCOMIENDA', 10, 19)
  doc.text(`Sucursal: ${shipment.destinationCity || shipment.destinationBranchId.toUpperCase()} • Punata - Cochabamba`, 10, 24)

  // Recuadro de Guía
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(88, 8, 52, 16, 2, 2, 'F')
  doc.setTextColor(6, 78, 59)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('GUÍA ENTREGADA', 92, 13)
  doc.setFontSize(11)
  doc.setTextColor(180, 83, 9)
  doc.text(shipment.trackingCode, 92, 20)

  // Datos del envío
  let y = 33
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(10, y, 138, y)
  y += 5

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('DATOS DE LA ENCOMIENDA:', 10, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text(`Origen: ${shipment.originCity}  ➔  Destino: ${shipment.destinationCity}`, 10, y)
  doc.text(`Bultos: ${shipment.packageCount || 1}  •  Peso: ${shipment.totalWeightKg || 0} kg`, 85, y)
  y += 4

  doc.text(`Remitente: ${shipment.sender?.name || 'N/A'}`, 10, y)
  doc.text(`Destinatario Original: ${shipment.recipient?.name || 'N/A'}`, 85, y)
  y += 5

  // Datos de la Entrega y Receptor
  doc.setFillColor(241, 245, 249)
  doc.roundedRect(10, y, 128, 28, 2, 2, 'F')
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(6, 78, 59)
  doc.text('CONSTANCIA DE RECEPCIÓN FÍSICA:', 14, y)
  y += 4.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(15, 23, 42)
  doc.text(`Retirado por: ${deliv.receivedByName || 'N/A'}`, 14, y)
  doc.text(`Doc. Identidad: ${deliv.receivedByDocType || 'CI'}: ${deliv.receivedByDocNumber || deliv.receivedByDoc || 'N/A'}`, 85, y)
  y += 4.5

  doc.text(`Parentesco / Relación: ${(deliv.recipientRelationship || 'titular').toUpperCase()}`, 14, y)
  const delivTimeStr = deliv.deliveredAtIso
    ? new Date(deliv.deliveredAtIso).toLocaleString('es-BO')
    : new Date().toLocaleString('es-BO')
  doc.text(`Fecha y Hora: ${delivTimeStr}`, 85, y)
  y += 4.5

  doc.text(`Entregado por: ${deliv.deliveredByName || 'Operador de Ventanilla'}`, 14, y)
  if (deliv.authorizationNote) {
    y += 4
    doc.setTextColor(180, 83, 9)
    doc.text(`Nota de autorización: ${deliv.authorizationNote.substring(0, 50)}`, 14, y)
  }
  y += 9

  // Estado económico / Liquidación COD
  doc.setFillColor(236, 253, 245)
  doc.setDrawColor(167, 243, 208)
  doc.roundedRect(10, y, 128, 14, 2, 2, 'FD')
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(22, 101, 52)
  if (shipment.paymentTiming === 'destination_cod') {
    doc.text('COBRO DE ENCOMIENDA POR PAGAR REALIZADO CONFORME', 14, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(`Monto Cobrado: ${formatCurrencyBob(shipment.finalAmountCents, true)} (${shipment.paymentMethod?.toUpperCase() || 'EFECTIVO'})`, 14, y)
    if (shipment.paidShiftId) {
      doc.text(`Turno Caja: ${shipment.paidShiftId}`, 85, y)
    }
  } else {
    doc.text('FLETE PAGADO EN ORIGEN — ENTREGA SIN CARGO', 14, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(`Importe cancelado: ${formatCurrencyBob(shipment.finalAmountCents, true)}`, 14, y)
  }
  y += 9

  // Firma Digital Manuscrita (Firebase Storage / En memoria)
  doc.setDrawColor(203, 213, 225)
  doc.roundedRect(10, y, 80, 42, 2, 2, 'D')
  doc.setFontSize(7)
  doc.setTextColor(100, 116, 139)
  doc.setFont('helvetica', 'bold')
  doc.text('FIRMA MANUSCRITA DIGITAL DEL RECEPTOR', 14, y + 4.5)

  const resolvedSig = await resolveSignatureDataUrl(deliv, shipment.id)
  if (resolvedSig) {
    try {
      doc.addImage(resolvedSig, 'PNG', 15, y + 6, 70, 32)
    } catch {
      doc.setFont('helvetica', 'normal')
      doc.text('[Firma digital verificada y resguardada en Storage]', 15, y + 20)
    }
  } else {
    doc.setFont('helvetica', 'normal')
    doc.text('[Firma digital resguardada en Firebase Storage]', 15, y + 20)
  }

  // QR de verificación de entrega
  const qrVerificationText = `EXPRESO PUNATA\nEntrega Conforme: ${shipment.trackingCode}\nReceptor: ${deliv.receivedByName}\nDoc: ${deliv.receivedByDocNumber || deliv.receivedByDoc}\nFecha: ${delivTimeStr}`
  const qrDataUrl = await QRCode.toDataURL(qrVerificationText, { width: 100, margin: 0 })
  doc.addImage(qrDataUrl, 'PNG', 98, y + 4, 34, 34)
  y += 47

  // Declaración de conformidad
  doc.setFontSize(6.5)
  doc.setTextColor(100, 116, 139)
  doc.setFont('helvetica', 'normal')
  doc.text(
    'DECLARACIÓN: El receptor declara haber verificado físicamente el contenido, integridad y estado conforme del paquete al momento de la entrega.',
    10,
    y,
    { maxWidth: 128 }
  )

  return doc.output('blob')
}

export async function printDeliveryProofPdf(shipment: Shipment): Promise<void> {
  const blob = await generateDeliveryProofPdf(shipment)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

/**
 * Genera el Recibo Térmico de 80mm de Entrega Conforme con firma estampada.
 */
export async function generateDeliveryProofTicket80mmPdf(shipment: Shipment): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 160], // 80 mm ancho x 160 mm alto
  })

  const leftMargin = 5
  const rightMargin = 75
  const centerX = 40
  let y = 6

  const deliv = shipment.deliveryRecord || {} as any

  // Encabezado
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(6, 78, 59)
  doc.text('EXPRESO PUNATA', centerX, y, { align: 'center' })
  y += 4

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.text('COMPROBANTE DE ENTREGA CONFORME', centerX, y, { align: 'center' })
  y += 3.5
  doc.text('Punata: 4-4571234 • Cochabamba: 4-4256789', centerX, y, { align: 'center' })
  y += 4

  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // Datos de la Guía
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(180, 83, 9)
  doc.text(`GUÍA: ${shipment.trackingCode}`, centerX, y, { align: 'center' })
  y += 4.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(15, 23, 42)
  doc.text(`Origen: ${shipment.originCity} ➔ Destino: ${shipment.destinationCity}`, leftMargin, y)
  y += 3.5
  doc.text(`Bultos: ${shipment.packageCount || 1}  •  Peso: ${shipment.totalWeightKg || 0} kg`, leftMargin, y)
  y += 3.5
  doc.text(`Remitente: ${shipment.sender?.name || 'N/A'}`, leftMargin, y)
  y += 4

  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // Receptor
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(6, 78, 59)
  doc.text('DATOS DE QUIEN RECIBE:', leftMargin, y)
  y += 3.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(15, 23, 42)
  doc.text(`Nombre: ${deliv.receivedByName || 'N/A'}`, leftMargin, y)
  y += 3.5
  doc.text(`Doc: ${deliv.receivedByDocType || 'CI'}: ${deliv.receivedByDocNumber || deliv.receivedByDoc || 'N/A'}`, leftMargin, y)
  y += 3.5
  doc.text(`Parentesco: ${(deliv.recipientRelationship || 'titular').toUpperCase()}`, leftMargin, y)
  y += 3.5

  const delivTimeStr = deliv.deliveredAtIso
    ? new Date(deliv.deliveredAtIso).toLocaleString('es-BO')
    : new Date().toLocaleString('es-BO')
  doc.text(`Fecha: ${delivTimeStr}`, leftMargin, y)
  y += 3.5
  doc.text(`Op: ${deliv.deliveredByName || 'Ventanilla'}`, leftMargin, y)
  y += 4

  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  // Pago
  if (shipment.paymentTiming === 'destination_cod') {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(180, 83, 9)
    doc.text('COBRO DE ENCOMIENDA POR PAGAR:', leftMargin, y)
    doc.text(formatCurrencyBob(shipment.finalAmountCents, true), rightMargin, y, { align: 'right' })
    y += 3.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    doc.text(`Método: ${(shipment.paymentMethod || 'cash').toUpperCase()}`, leftMargin, y)
    y += 4
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(22, 101, 52)
    doc.text('PAGADO EN ORIGEN', leftMargin, y)
    doc.text(formatCurrencyBob(shipment.finalAmountCents, true), rightMargin, y, { align: 'right' })
    y += 4
  }

  // Firma
  if (deliv.signatureDataUrl && deliv.signatureDataUrl.startsWith('data:image')) {
    try {
      doc.addImage(deliv.signatureDataUrl, 'PNG', centerX - 25, y, 50, 22)
      y += 24
    } catch {
      y += 5
    }
  } else {
    y += 5
  }

  doc.setDrawColor(15, 23, 42)
  doc.line(centerX - 20, y, centerX + 20, y)
  y += 3
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('Firma de Conformidad', centerX, y, { align: 'center' })
  y += 4

  // QR
  const qrVerificationText = `EXPRESO PUNATA\n${shipment.trackingCode}\nEntrega Conforme\n${deliv.receivedByName}`
  const qrDataUrl = await QRCode.toDataURL(qrVerificationText, { width: 70, margin: 0 })
  doc.addImage(qrDataUrl, 'PNG', centerX - 10, y, 20, 20)

  return doc.output('blob')
}

export async function printDeliveryProofTicket80mm(shipment: Shipment): Promise<void> {
  const blob = await generateDeliveryProofTicket80mmPdf(shipment)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

/**
 * Genera el Ticket Térmico de Liquidación / Rendición de Conductor en Caja.
 */
export async function generateDriverSettlementTicket80mmPdf(settlement: any): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 140],
  })

  const leftMargin = 5
  const rightMargin = 75
  const centerX = 40
  let y = 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(6, 78, 59)
  doc.text('EXPRESO PUNATA', centerX, y, { align: 'center' })
  y += 4

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.text('RECIBO DE RENDICIÓN DE CONDUCTOR', centerX, y, { align: 'center' })
  y += 4

  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(180, 83, 9)
  doc.text(settlement.settlementNumber || 'SETTL-001', centerX, y, { align: 'center' })
  y += 4.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(15, 23, 42)
  doc.text(`Conductor: ${settlement.driverName || 'Conductor'}`, leftMargin, y)
  y += 3.5
  doc.text(`Recibido por: ${settlement.receivedByName || 'Cajero'}`, leftMargin, y)
  y += 3.5
  doc.text(`Fecha: ${new Date(settlement.createdAtIso || Date.now()).toLocaleString('es-BO')}`, leftMargin, y)
  y += 4

  doc.line(leftMargin, y, rightMargin, y)
  y += 4

  if (settlement.previousDriverBalanceCents !== undefined) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text('Saldo previo bajo custodia:', leftMargin, y)
    doc.text(formatCurrencyBob(settlement.previousDriverBalanceCents, true), rightMargin, y, { align: 'right' })
    y += 3.8
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(6, 78, 59)
  doc.text('MONTO RENDIDO (EFECTIVO):', leftMargin, y)
  doc.text(formatCurrencyBob(settlement.amountCents || 0, true), rightMargin, y, { align: 'right' })
  y += 4.5

  if (settlement.remainingDriverBalanceCents !== undefined) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(settlement.remainingDriverBalanceCents > 0 ? 180 : 22, settlement.remainingDriverBalanceCents > 0 ? 83 : 101, settlement.remainingDriverBalanceCents > 0 ? 9 : 52)
    doc.text('Saldo pendiente de rendición:', leftMargin, y)
    doc.text(formatCurrencyBob(settlement.remainingDriverBalanceCents, true), rightMargin, y, { align: 'right' })
    y += 4
  }

  if (Array.isArray(settlement.reconciledShipmentIds) && settlement.reconciledShipmentIds.length > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    doc.text(`Guías conciliadas (${settlement.reconciledShipmentIds.length}): ${settlement.reconciledShipmentIds.slice(0, 3).join(', ')}${settlement.reconciledShipmentIds.length > 3 ? '...' : ''}`, leftMargin, y)
    y += 4
  }

  if (settlement.notes) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(71, 85, 105)
    doc.text(`Obs: ${settlement.notes}`, leftMargin, y)
    y += 4
  }

  y += 10
  // Doble firma: Conductor y Cajero
  doc.line(leftMargin + 2, y, leftMargin + 32, y)
  doc.line(rightMargin - 32, y, rightMargin - 2, y)
  y += 3.5
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('Conductor (Entrega)', leftMargin + 4, y)
  doc.text('Cajero (Recibe Conforme)', rightMargin - 30, y)

  return doc.output('blob')
}

export async function printDriverSettlementTicket80mm(settlement: any): Promise<void> {
  const blob = await generateDriverSettlementTicket80mmPdf(settlement)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
