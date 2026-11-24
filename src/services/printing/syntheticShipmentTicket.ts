import type { UnifiedDocumentPayload } from '../../types/printing.ts'

export function createSyntheticShipmentTicket(branchId: string = 'punata', nowIso = new Date().toISOString()): UnifiedDocumentPayload {
  const origin = branchId === 'cochabamba' ? 'Cochabamba' : 'Punata'
  const destination = branchId === 'cochabamba' ? 'Punata' : 'Cochabamba'
  return {
    documentType: 'shipment_guide',
    title: 'GUÍA DE ENCOMIENDA · PRUEBA',
    subtitle: `${origin} ➔ ${destination}`,
    branchId,
    branchName: `Agencia ${origin}`,
    branchAddress: 'Dirección institucional configurada',
    branchPhone: 'Teléfono institucional configurado',
    documentNumber: 'TEST-SINTETICO-0001',
    trackingCode: 'TEST-SINTETICO-0001',
    qrContent: 'EXPRESO-PUNATA:TEST-SINTETICO-0001',
    timestampIso: nowIso,
    operatorName: 'Operador de prueba',
    sender: { name: 'Remitente de prueba', phone: '70000001' },
    recipient: { name: 'Destinatario de prueba', phone: '70000002' },
    items: [{ description: 'Caja sintética de repuestos', quantity: 2, packaging: 'Caja', weightKg: 4.5, totalBob: 12.5 }],
    financials: {
      subtotalBob: 12.5,
      totalBob: 12.5,
      amountCents: 1250,
      paymentTiming: 'origin_paid',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
    },
    metadata: {
      originCity: origin,
      destinationCity: destination,
      packageCount: 2,
      totalWeightKg: 4.5,
      driverName: 'Conductor de prueba',
      deliveryType: 'Recojo en agencia',
      shipmentStatus: 'registrada · sintética',
    },
    footerNotes: ['Datos ficticios para calibrar impresora. No registrar ni cobrar.'],
  }
}
