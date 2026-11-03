/**
 * PACHAX EXPRESO PUNATA 1.0 — Tipos del Motor Unificado de Impresión
 * Identidad Oficial: EXPRESO PUNATA
 */

export type PrinterConnectionType =
  | 'browser_dialog'  // Diálogo estándar del navegador (Windows USB, Mac, Linux)
  | 'rawbt_intent'    // Intent Android RawBT (ru.a402d.rawbtprinter)
  | 'network_tcp'     // Impresora en Red LAN / WiFi (Vía controlador de Windows)
  | 'virtual_pdf'     // Generación de documento PDF descargable

export type PaperFormat = '80mm' | '58mm' | 'letter' | 'half_letter' | 'a4'

export type DocumentPrintType =
  | 'shipment_guide'        // Guía oficial de encomienda
  | 'package_label'         // Etiqueta de bulto
  | 'dispatch_manifest'     // Manifiesto de despacho de carga
  | 'delivery_proof'        // Constancia de entrega con firma
  | 'payment_receipt'       // Recibo de cobro en ventanilla
  | 'cash_shift_close'      // Acta de cierre de turno y arqueo
  | 'driver_settlement'     // Acta de rendición de cuentas de conductor
  | 'financial_report'      // Reporte de movimientos de caja
  | 'discrepancy_act'       // Acta de discrepancia de recepción
  | 'member_due_receipt'    // Recibo de aporte de socio
  | 'worker_payroll_receipt' // Recibo de salario o anticipo
  | 'general_expense_voucher' // Comprobante oficial de egreso operativo
  | 'commission_voucher'      // Vale oficial de liquidación de comisión de conductor
  | 'fixed_asset_label'     // Etiqueta térmica de activo fijo
  | 'test_page'             // Página de prueba y diagnóstico

export type ErrorClassification = 'safeToRetry' | 'unsafeToRetry' | 'requiresOperatorDecision'

export interface PrinterCapabilities {
  supportsPaperCut: boolean
  supportsCashDrawerKick: boolean
  supportsQrCode: boolean
  supportsLogo: boolean
  feedLinesEnd: number
  fontSize: 'compact' | 'normal' | 'large'
  marginsMm: number
}

export interface PrinterProfile {
  id: string
  branchId: string
  name: string
  connectionType: PrinterConnectionType
  paperFormat: PaperFormat
  isDefault: boolean
  autoPrintOnCreation: boolean
  autoPrintOnPayment: boolean
  autoPrintOnDelivery: boolean
  kickDrawerOnReceipt: boolean
  cutPaperOnFinish: boolean
  ipAddress?: string
  ipPort?: number
  capabilities: PrinterCapabilities
  createdAtIso: string
  updatedAtIso: string
}

export interface PrintResult {
  success: boolean
  jobId: string
  connectionType: PrinterConnectionType
  bytesSent?: number
  status: 'hardware_confirmed' | 'dispatched_to_driver' | 'dialog_opened' | 'pdf_downloaded' | 'failed'
  message: string
  errorMessage?: string
  errorClassification?: ErrorClassification
  dispatchedAtIso: string
}

export type PaymentConditionState =
  | 'origin_paid'
  | 'origin_pending'
  | 'destination_cod_pending'
  | 'destination_cod_paid'
  | 'route_driver_collected_pending'
  | 'route_driver_collected_remitted_partial'
  | 'route_driver_collected_remitted_full'
  | 'cash_remittance_partial'
  | 'cash_remittance_full'

export interface DocumentFinancials {
  subtotalBob: number
  discountBob?: number
  totalBob: number
  amountCents: number
  paymentTiming?: 'origin_paid' | 'origin_pending' | 'destination_cod'
  paymentStatus?: 'paid' | 'pending'
  paymentMethod?: 'cash' | 'qr' | 'transfer'
  paymentConditionLabel?: string
  collectedByDriverUid?: string | null
  initialCashBob?: number
  expectedCashBob?: number
  countedCashBob?: number
  differenceBob?: number
  driverBalanceBeforeBob?: number
  driverRemittanceBob?: number
  driverBalanceRemainingBob?: number
  remittanceType?: 'partial' | 'full'
}

export function resolvePaymentConditionLabel(financials?: DocumentFinancials): string {
  if (!financials) return 'NO ESPECIFICADO'

  // Si ya tiene una etiqueta explícita autoritativa
  if (financials.paymentConditionLabel) {
    return financials.paymentConditionLabel
  }

  // 1. Rendición directa en caja
  if (financials.remittanceType || (financials.driverRemittanceBob !== undefined && financials.driverRemittanceBob > 0)) {
    return financials.remittanceType === 'partial'
      ? 'RENDICIÓN PARCIAL EN CAJA'
      : 'RENDICIÓN COMPLETA EN CAJA'
  }

  // 2. Cobrado en ruta por conductor
  if (financials.collectedByDriverUid) {
    if (financials.driverBalanceRemainingBob === 0) {
      return 'COBRADO EN RUTA POR CONDUCTOR (RENDIDO TOTAL EN CAJA)'
    }
    if (financials.remittanceType === 'partial') {
      return 'COBRADO EN RUTA POR CONDUCTOR (RENDICIÓN PARCIAL)'
    }
    return 'COBRADO EN RUTA POR CONDUCTOR (PENDIENTE DE RENDICIÓN)'
  }

  // 3. Contraentrega (COD)
  if (financials.paymentTiming === 'destination_cod') {
    return financials.paymentStatus === 'paid'
      ? 'CONTRAENTREGA COBRADA EN DESTINO'
      : 'CONTRAENTREGA PENDIENTE DE COBRO'
  }

  // 4. Origen pendiente de cobro
  if (financials.paymentTiming === 'origin_pending' || financials.paymentStatus === 'pending') {
    return 'PENDIENTE DE COBRO EN ORIGEN'
  }

  // 5. Origen pagado
  if (financials.paymentTiming === 'origin_paid' && financials.paymentStatus === 'paid') {
    return 'PAGADO EN ORIGEN'
  }

  // Fallback seguro según paymentStatus
  return financials.paymentStatus === 'paid' ? 'PAGADO' : 'PENDIENTE DE COBRO'
}

export interface UnifiedDocumentPayload {
  documentType: DocumentPrintType
  title: string
  subtitle?: string
  branchId: string
  branchName: string
  branchAddress?: string
  branchPhone?: string
  documentNumber: string
  trackingCode?: string
  qrContent?: string
  logoUrl?: string
  timestampIso: string
  operatorName: string
  operatorRole?: string

  // Metadatos específicos según tipo de documento
  metadata?: Record<string, any>

  // Datos de clientes / remitente / consignatario
  sender?: {
    name: string
    phone?: string
    docType?: string
    docNumber?: string
  }
  recipient?: {
    name: string
    phone?: string
    docType?: string
    docNumber?: string
    relationship?: string
  }

  // Lista de ítems o bultos
  items?: Array<{
    description: string
    quantity: number
    packaging?: string
    weightKg?: number
    declaredValueBob?: number
    unitPriceBob?: number
    totalBob?: number
  }>

  // Información financiera
  financials?: DocumentFinancials

  // Firmas y custodias
  signatures?: {
    operatorSignatureName?: string
    clientSignatureName?: string
    signatureDataUrl?: string | null
    driverSignatureName?: string
  }

  // Manifiestos y viajes
  dispatch?: {
    originBranchName: string
    destinationBranchName: string
    vehiclePlate?: string
    mobileNumber?: string
    driverName?: string
    driverPhone?: string
    totalPackages: number
    totalWeightKg: number
    totalCodToCollectBob: number
  }

  // Pie de página
  footerNotes?: string[]
}
