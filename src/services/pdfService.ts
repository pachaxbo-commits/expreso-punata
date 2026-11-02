import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import type { Shipment, CashShift } from '../types/index.ts'
import { EXPRESO_PUNATA_COMPANY } from '../domain/expresoPunataConfig.ts'
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
  doc.text(EXPRESO_PUNATA_COMPANY.slogan, 10, 20)
  doc.text(`Telf: ${EXPRESO_PUNATA_COMPANY.phone} — Punata y Cochabamba`, 10, 25)

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
    : 'COBRO CONTRAENTREGA EN DESTINO (COD)'
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
