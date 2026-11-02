import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import type { Shipment } from '../types/index.ts'
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

  // Generar imagen QR a partir del código de guía
  const qrDataUrl = await QRCode.toDataURL(
    `EXPRESO_PUNATA|GUIA:${shipment.trackingCode}|ORIGEN:${shipment.originCity}|DEST:${shipment.destinationCity}|TOTAL_BS:${(shipment.finalAmountCents / 100).toFixed(2)}`,
    { width: 140, margin: 1 }
  )

  // Header institucional
  doc.setFillColor(6, 78, 59)
  doc.rect(0, 0, 148, 26, 'F')

  doc.setTextColor(250, 204, 21)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('EXPRESO PUNATA', 10, 11)

  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.text(EXPRESO_PUNATA_COMPANY.slogan, 10, 17)
  doc.text(`Telf: ${EXPRESO_PUNATA_COMPANY.phone} — Punata y Cochabamba`, 10, 22)

  // Recuadro de Guía
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(88, 5, 52, 17, 2, 2, 'F')
  doc.setTextColor(6, 78, 59)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('GUÍA DE ENCOMIENDA', 92, 10)
  doc.setFontSize(12)
  doc.setTextColor(180, 83, 9)
  doc.text(shipment.trackingCode, 92, 18)

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
