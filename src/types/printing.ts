/**
 * PACHAX EXPRESO PUNATA 1.0 — Tipos del Motor Unificado de Impresión
 * Portado desde PACHAX Platform sin modificar el núcleo original.
 */

export type PrinterConnectionType =
  | 'browser_dialog'  // Diálogo estándar del navegador (Windows USB, Mac, Linux)
  | 'rawbt_intent'    // Intent Android RawBT (ru.a402d.rawbtprinter)
  | 'network_tcp'     // Impresora térmica en red (puerto 9100)
  | 'web_bluetooth'   // Conexión Web Bluetooth SPP
  | 'virtual_pdf'     // Generación de documento PDF descargable

export type PaperFormat = '80mm' | '58mm' | 'letter' | 'half_letter' | 'a4'

export type DocumentPrintType =
  | 'shipment_guide'        // Guía oficial de encomienda
  | 'dispatch_manifest'     // Manifiesto de despacho de carga
  | 'delivery_proof'        // Constancia de entrega con firma
  | 'payment_receipt'       // Recibo de cobro en ventanilla
  | 'cash_shift_close'      // Acta de cierre de turno y arqueo
  | 'driver_settlement'     // Acta de rendición de cuentas de conductor
  | 'financial_report'      // Reporte de movimientos de caja
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
  bluetoothDeviceId?: string
  bluetoothDeviceName?: string
  capabilities: PrinterCapabilities
  createdAtIso: string
  updatedAtIso: string
}

export interface PrintResult {
  success: boolean
  jobId: string
  connectionType: PrinterConnectionType
  bytesSent?: number
  errorMessage?: string
  errorClassification?: ErrorClassification
  dispatchedAtIso: string
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
  financials?: {
    subtotalBob: number
    discountBob?: number
    totalBob: number
    amountCents: number
    paymentTiming?: 'origin_paid' | 'destination_cod'
    paymentMethod?: 'cash' | 'qr' | 'transfer'
    initialCashBob?: number
    expectedCashBob?: number
    countedCashBob?: number
    differenceBob?: number
    driverBalanceBeforeBob?: number
    driverRemittanceBob?: number
    driverBalanceRemainingBob?: number
  }

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
