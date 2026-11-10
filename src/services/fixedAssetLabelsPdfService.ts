import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import type { FixedAsset } from '../types/index.ts'

const LOCATION_LABELS: Record<string, string> = {
  sede_punata: 'Sede Punata',
  oficina_punata: 'Oficina Punata',
  oficina_cochabamba: 'Oficina Cochabamba',
}

export async function buildFixedAssetLabelsPdf(assets: FixedAsset[]): Promise<jsPDF> {
  if (!assets.length) throw new Error('Seleccione al menos un bien para imprimir etiquetas.')
  const uniqueIds = new Set(assets.map((asset) => asset.id))
  if (uniqueIds.size !== assets.length) throw new Error('La selección contiene bienes repetidos.')

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const marginX = 8
  const marginY = 9
  const gapX = 4
  const gapY = 4
  const columns = 3
  const rows = 5
  const cardWidth = (210 - marginX * 2 - gapX * (columns - 1)) / columns
  const cardHeight = (297 - marginY * 2 - gapY * (rows - 1)) / rows

  for (let index = 0; index < assets.length; index += 1) {
    if (index > 0 && index % (columns * rows) === 0) pdf.addPage()
    const asset = assets[index]
    const position = index % (columns * rows)
    const x = marginX + (position % columns) * (cardWidth + gapX)
    const y = marginY + Math.floor(position / columns) * (cardHeight + gapY)
    const qrPayload = asset.qrPayload || `EXPRESO-PUNATA:ACTIVO:${asset.id}`
    const qr = await QRCode.toDataURL(qrPayload, { width: 240, margin: 1, errorCorrectionLevel: 'M' })

    pdf.setDrawColor(148, 163, 184)
    pdf.setLineWidth(0.25)
    pdf.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5)
    pdf.setFillColor(6, 78, 59)
    pdf.roundedRect(x, y, cardWidth, 8, 1.5, 1.5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(255, 255, 255)
    pdf.text('EXPRESO PUNATA', x + cardWidth / 2, y + 5.3, { align: 'center' })

    const qrSize = 27
    pdf.addImage(qr, 'PNG', x + 3, y + 11, qrSize, qrSize)
    pdf.setTextColor(15, 23, 42)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.text(pdf.splitTextToSize(asset.assetCode, cardWidth - qrSize - 10), x + qrSize + 6, y + 15)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.3)
    const name = pdf.splitTextToSize(asset.name || asset.category, cardWidth - qrSize - 10).slice(0, 3)
    pdf.text(name, x + qrSize + 6, y + 20)
    const location = LOCATION_LABELS[asset.patrimonialLocationId || ''] || asset.branchId || ''
    pdf.setFontSize(5.5)
    pdf.text(pdf.splitTextToSize(location, cardWidth - qrSize - 10).slice(0, 2), x + qrSize + 6, y + 35)
  }
  return pdf
}

export async function downloadFixedAssetLabelsPdf(assets: FixedAsset[]): Promise<void> {
  const pdf = await buildFixedAssetLabelsPdf(assets)
  const timestamp = new Date().toISOString().slice(0, 10)
  pdf.save(`expreso-punata-etiquetas-activos-${timestamp}.pdf`)
}
