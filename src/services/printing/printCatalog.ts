import type { DocumentPrintType } from '../../types/printing.ts'

export type PrintCatalogSection = 'Encomiendas' | 'Despachos' | 'Entregas' | 'Cobros y caja' | 'Pasajes' | 'Conductores' | 'Afiliados' | 'Personal' | 'Gastos' | 'Inventario' | 'Diagnóstico'
export const DOCUMENT_PRINT_CATALOG: Array<{ type: DocumentPrintType; section: PrintCatalogSection; label: string; description: string }> = [
  { type: 'shipment_guide', section: 'Encomiendas', label: 'Guía de encomienda', description: 'Comprobante de cliente y copia de agencia.' },
  { type: 'dispatch_manifest', section: 'Despachos', label: 'Manifiesto de despacho', description: 'Manifiesto de carga y ruta.' },
  { type: 'delivery_proof', section: 'Entregas', label: 'Constancia de entrega', description: 'Constancia asociada a una encomienda entregada.' },
  { type: 'payment_receipt', section: 'Cobros y caja', label: 'Recibo de cobro', description: 'Recibo generado por las operaciones de cobro existentes.' },
  { type: 'cash_shift_close', section: 'Cobros y caja', label: 'Cierre de caja', description: 'Acta de cierre y arqueo de turno.' },
  { type: 'passenger_ticket', section: 'Pasajes', label: 'Pasajes de pasajeros', description: 'Comprobante de oficina y ticket para el conductor, solo con pago QR verificado.' },
  { type: 'driver_settlement', section: 'Conductores', label: 'Rendición de conductor', description: 'Liquidación de rendición de cuentas.' },
  { type: 'commission_voucher', section: 'Conductores', label: 'Vale de comisión', description: 'Comprobante de liquidación de comisión.' },
  { type: 'payment_receipt', section: 'Afiliados', label: 'Aportes y cuotas sociales', description: 'Usa la plantilla compartida de recibo para comprobantes de aporte ya existentes.' },
  { type: 'member_due_receipt', section: 'Afiliados', label: 'Recibo de aporte', description: 'Recibo de aporte de socio.' },
  { type: 'worker_payroll_receipt', section: 'Personal', label: 'Salario o anticipo', description: 'Comprobante de pago a personal.' },
  { type: 'general_expense_voucher', section: 'Gastos', label: 'Comprobante de egreso', description: 'Vale de egreso operativo.' },
  { type: 'fixed_asset_label', section: 'Inventario', label: 'Etiqueta de activo fijo', description: 'Etiqueta del activo fijo registrado.' },
  { type: 'test_page', section: 'Diagnóstico', label: 'Página de prueba', description: 'Diagnóstico de estación de impresión.' },
]
