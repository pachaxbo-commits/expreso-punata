/**
 * Tipos canónicos del dominio de EXPRESO PUNATA
 * Adaptados para Cloud Firestore multisucursal (Punata y Cochabamba),
 * reglas de seguridad RBAC y subcolecciones de auditoría inmutable.
 */

export type UserRole =
  | 'secretaria'
  | 'encargado_agencia'
  | 'tesoreria'
  | 'directiva_admin'
  | 'conductor'

export interface UserProfile {
  uid: string
  fullName: string
  ci?: string | null
  email?: string
  phone: string
  role: UserRole
  primaryBranchId: string
  allowedBranchIds: string[]
  assignedVehiclePlate?: string
  assignedMobileNumber?: string
  isActive: boolean
  createdAt?: string
  createdAtIso?: string
  updatedAtIso?: string
  lastLoginAt?: string
  syncStatus?: 'syncing' | 'synced' | 'failed'
  createdReason?: string
}

export interface UserAuditLog {
  id?: string
  entityType: string
  entityId: string
  action: string
  performedBy?: string
  performedByUid?: string
  performedByEmail?: string
  details?: Record<string, any>
  timestamp?: any
  timestampIso?: string
}

export interface Branch {
  id: string // 'punata' | 'cochabamba'
  code: string // 'PUN' | 'CBB'
  name: string
  city: string
  department: string
  address: string
  phone: string
  isActive: boolean
}

export interface StorageShelf {
  id: string // 'ESTANTE-A', 'ESTANTE-B'
  branchId: string
  name: string
  code: string
  description?: string
  moduleCount: number // 5 módulos por defecto
}

export interface StorageModule {
  id: string // 'MOD-1' a 'MOD-5'
  shelfId: string
  branchId: string
  moduleNumber: number
  description?: string
  currentPackageCount: number
}

export type ParcelShipmentStatus =
  | 'received'
  | 'pending_dispatch'
  | 'dispatched'
  | 'in_transit'
  | 'received_at_dest'
  | 'partially_received'
  | 'incident_investigation'
  | 'stored'
  | 'ready_for_pickup'
  | 'in_delivery'
  | 'delivered'
  | 'uncollected'
  | 'returned'
  | 'lost'
  | 'cancelled'
  | 'final_disposition_authorized'

export type PaymentTiming = 'origin_paid' | 'origin_pending' | 'destination_cod'
export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'uncollectible'
export type PaymentMethod = 'cash' | 'qr' | 'transfer'

export interface ParcelCustomer {
  customerId?: string
  name: string
  phone: string
  docType: 'CI' | 'NIT' | 'PASAPORTE' | 'OTRO' | 'NINGUNO'
  docNumber?: string
}

export interface ParcelItem {
  description: string
  category: 'general' | 'documents' | 'electronics' | 'clothing' | 'fragile' | 'perishable' | 'parts' | 'other'
  quantity: number
  packaging: 'caja' | 'sobre' | 'bolsa' | 'paquete' | 'fardo' | 'bidon' | 'otro'
  weightKg?: number
  declaredValue?: number
  isFragile: boolean
  isPerishable?: boolean
  handlingNotes?: string
}

export interface ParcelPhysicalLocation {
  branchId: string
  shelfId: string
  shelfName?: string
  moduleId: string
  moduleNumber?: number
  position?: string
  storedAt: string
  storedByUid: string
  storedByName: string
}

export interface DriverCustodyRecord {
  driverUid: string
  driverName: string
  mobileNumber: string
  collectedAmountCents: number
  collectedAmountBob: number
  collectedAt: string
  receiptNumber: string
  reconciled: boolean
  reconciledAt?: string
  reconciledByUid?: string
  reconciledShiftId?: string
}

export interface DeliverySignatureMetadata {
  storagePath: string
  downloadUrl?: string
  mimeType: string
  sizeBytes: number
  sha256?: string
  uploadedAtIso?: string
  verified?: boolean
}

export interface ParcelDeliveryRecord {
  deliveredAt: string
  deliveredAtIso?: string
  deliveredByUid: string
  deliveredByName: string
  deliveredByRole?: string
  deliveryChannel?: 'agency_counter' | 'route_delivery'
  receivedByName: string
  receivedByDocType?: string
  receivedByDocNumber?: string
  receivedByDoc?: string
  recipientRelationship: 'titular' | 'familiar' | 'apoderado' | 'empleado' | 'otro'
  authorizationNote?: string
  authorizedChangeReason?: string
  signature?: DeliverySignatureMetadata
  signatureDataUrl?: string
  signatureUrl?: string
  photoEvidenceUrl?: string
  deliveryNotes?: string
  branchId?: string
  collectedByDriverUid?: string
  collectedAmountCents?: number
}

export interface Shipment {
  id: string
  trackingCode: string // Inmutable (ej. 'PUN-2026-00042')
  createdAt: string
  createdAtIso?: string
  registeredByUid: string
  registeredByName: string
  originBranchId: string
  originCity: string
  destinationBranchId: string
  destinationCity: string
  deliveryType: 'agency' | 'home' | 'direct_driver'
  deliveryAddress?: string

  sender: ParcelCustomer
  recipient: ParcelCustomer

  items: ParcelItem[]
  packageCount: number
  totalWeightKg: number
  declaredValueTotal: number
  prohibitedGoodsNoticeAccepted: boolean

  // Ubicación física actual en almacén de destino (resumen rápido)
  storageLocation?: ParcelPhysicalLocation

  // Finanzas del envío: centavos enteros como valor canónico y única fuente de verdad
  shippingFeeCents: number
  weightSurchargeCents: number
  homeDeliveryFeeCents: number
  discountCents: number
  suggestedAmountCents?: number
  agreedAmountCents?: number
  finalAmountCents: number
  isPriceAdjusted?: boolean
  priceAdjustmentReason?: string | null
  priceAdjustedByUid?: string | null
  priceAdjustedByName?: string | null
  priceAdjustedAt?: string | null
  finalAmountBob?: number // Proyección de solo lectura calculada al vuelo
  idempotencyKey?: string

  paymentTiming: PaymentTiming
  paymentStatus: PaymentStatus
  paymentMethod?: PaymentMethod
  paidAt?: string
  paidCashierUid?: string
  paidCashierName?: string
  paidShiftId?: string

  // Asignación de conductor/vehículo
  assignedVehicle?: {
    mobileNumber: string
    vehiclePlate: string
    driverUid?: string
    driverName: string
    manifestId: string
  }

  // Custodia de dinero de conductor en entregas en ruta
  driverCustody?: DriverCustodyRecord

  status: ParcelShipmentStatus

  // Resumen de entrega final
  deliveryRecord?: ParcelDeliveryRecord

  // Resumen de baja o disposición final
  finalDisposition?: {
    authorizedByUid: string
    authorizedByName: string
    authorizedAt: string
    reason: string
    resolutionType: 'destroyed' | 'donated' | 'auctioned' | 'indemnified'
  }
  auditHistory?: Array<{
    changedAt: string
    operatorUid: string
    operatorName: string
    operatorRole: string
    reason: string
    previousValues: Record<string, any>
    newValues: Record<string, any>
  }>
}

export interface CashShiftBreakdown {
  initialCashCents: number
  cashIncomeCents: number
  qrIncomeCents: number
  transferIncomeCents: number
  totalIncomeCents: number
  shipmentsIncomeCents: number
  codIncomeCents: number
  driverRemittanceCents?: number
  contributionsIncomeCents: number
  monthlyFeesIncomeCents: number
  otherIncomeCents: number
  expensesCents: number
  refundsCents: number
  pendingIncomeCents: number
  netCashCents: number
}

export interface CashShift {
  id: string
  shiftNumber?: string
  branchId: string
  operatorUid: string
  operatorName: string
  openedAt: string
  closedAt?: string | null
  status: 'open' | 'closed'

  initialCashCents: number
  initialCashBob?: number
  initialCashBreakdown?: Record<string, number> | null

  expectedCashCents: number
  expectedCashBob?: number

  actualCashCents?: number | null
  actualCashBob?: number | null
  actualCashBreakdown?: Record<string, number> | null

  differenceCents?: number | null
  differenceBob?: number | null
  differenceStatus?: 'conforme' | 'sobrante' | 'faltante' | null

  closedByUid?: string | null
  closedByName?: string | null
  notes?: string
  closingNotes?: string | null

  breakdown: CashShiftBreakdown
  movementsCount?: number
}

export type FinancialMovementType =
  | 'shipment_income'
  | 'cod_income'
  | 'driver_remittance'
  | 'contribution_income'
  | 'monthly_fee_income'
  | 'worker_payroll'
  | 'expense'
  | 'initial_cash'
  | 'refund'
  | 'adjustment'

export interface FinancialMovement {
  id: string
  shiftId: string
  branchId: string
  operatorUid: string
  operatorName: string
  type: FinancialMovementType
  amountCents: number
  paymentMethod: PaymentMethod | 'none'
  concept: string
  description?: string
  referenceId?: string
  trackingCode?: string | null
  status: 'completed' | 'cancelled'
  timestamp: string
  notes?: string
  settlementType?: 'partial' | 'full'
}

export type CashMovement = FinancialMovement

export type FixedAssetCategory =
  | 'computacion'
  | 'muebles'
  | 'herramientas'
  | 'comunicacion'
  | 'balanzas_pesaje'
  | 'oficina'
  | 'otro'

export type FixedAssetStatus =
  | 'available'
  | 'in_use'
  | 'in_maintenance'
  | 'damaged'
  | 'out_of_service'
  | 'lost'
  | 'disposed'

export interface FixedAsset {
  id: string
  assetCode: string // ej. 'ACT-PUN-0012'
  barcodeQr: string
  name: string
  category: FixedAssetCategory
  description: string
  branchId: string // 'punata' | 'cochabamba'
  physicalLocation: string
  responsiblePersonUid?: string
  responsiblePersonName: string
  acquisitionDate: string
  acquisitionCostBob?: number
  acquisitionCostCents?: number
  status: FixedAssetStatus
  photoUrl?: string
  notes?: string
  createdAtIso?: string
  updatedAtIso?: string
  disposedReason?: string
  disposedAtIso?: string
  disposedByUid?: string
  disposedByName?: string
}

export interface FixedAssetAuditLog {
  id: string
  assetId: string
  assetCode: string
  action: 'created' | 'update' | 'transfer' | 'maintenance' | 'status_change' | 'disposed'
  previousLocation?: string
  newLocation?: string
  previousResponsible?: string
  newResponsible?: string
  previousStatus?: string
  newStatus?: string
  details: string
  performedByUid: string
  performedByName: string
  timestampIso: string
}

export type WorkerRole =
  | 'secretaria'
  | 'estibador'
  | 'chofer_relevo'
  | 'limpieza'
  | 'seguridad'
  | 'administrativo'
  | 'encargado'
  | 'otro'

export type WorkerStatus = 'active' | 'inactive' | 'suspended'

export interface Worker {
  id: string
  workerCode: string // ej. 'TRA-001'
  fullName: string
  ci: string
  phone: string
  role: WorkerRole
  roleLabel?: string
  branchId: string // 'punata' | 'cochabamba' | 'ambas'
  salaryType: 'monthly' | 'daily' | 'per_task'
  baseSalaryBob: number
  baseSalaryCents: number
  status: WorkerStatus
  joinedAt: string
  notes?: string
  createdAtIso?: string
  updatedAtIso?: string
}

export interface WorkerPayment {
  id: string
  paymentNumber: string // ej. 'REC-TRA-2026-00001'
  workerId: string
  workerCode: string
  workerName: string
  workerRole: string
  workerCi: string
  amountBob: number
  amountCents: number
  concept: string
  period?: string // ej. '2026-10'
  paymentMethod: 'cash' | 'transfer' | 'check'
  shiftId?: string | null
  branchId: string
  paidAtIso: string
  registeredByUid: string
  registeredByName: string
  notes?: string
  status: 'completed' | 'cancelled'
}

export type ExpenseCategory =
  | 'alquiler'
  | 'servicios_basicos'
  | 'combustible'
  | 'mantenimiento'
  | 'material_escritorio'
  | 'viaticos'
  | 'impuestos_tasas'
  | 'otro'

export interface GeneralExpense {
  id: string
  voucherNumber: string // ej. 'EGR-2026-00001'
  category: ExpenseCategory
  branchId: string // 'punata' | 'cochabamba' | 'general'
  concept: string
  amountBob: number
  amountCents: number
  supplier?: string
  invoiceOrReceiptNumber?: string
  paymentMethod: 'cash' | 'transfer' | 'qr'
  shiftId?: string | null
  paidAtIso?: string
  createdAtIso: string
  createdByUid: string
  createdByName: string
  status: 'completed' | 'cancelled'
  notes?: string
}

export interface UnionMember {
  id: string
  memberNumber: string
  fullName: string
  ci: string
  phone: string
  joinedAt: string
  status: 'active' | 'inactive' | 'suspended' | 'honorary'
  category: 'propietario_transporte' | 'conductor' | 'socio_general'
  vehiclePlate?: string
  assignedMobileNumber?: string
  monthlyFeeBob: number
  monthlyFeeCents?: number
  notes?: string
  createdAtIso?: string
  updatedAtIso?: string
}

export interface UnionMonthlyDue {
  id: string
  dueNumber?: string
  memberId: string
  memberNumber: string
  memberName: string
  period: string
  periodLabel: string
  amountBob: number
  amountCents?: number
  dueDate: string
  status: 'paid' | 'partial' | 'pending' | 'overdue'
  paidAmountBob: number
  paidAmountCents?: number
  balanceBob: number
  balanceCents?: number
  paidAtIso?: string | null
  paidShiftId?: string | null
  paymentsCount?: number
  notes?: string
  createdAtIso?: string
}

// =========================================================================
// TIPOS DE LOGÍSTICA INTERAGENCIAS: Vehículos, Conductores, Manifiestos y Almacén
// =========================================================================

export interface Vehicle {
  id: string
  mobileNumber: string // ej. '04', '12' (número interno de móvil)
  plate: string // ej. '3456-ABC' (placa oficial)
  branchId: string // 'punata' | 'cochabamba'
  brand?: string
  model?: string
  capacityKg?: number
  assignedDriverUid?: string | null
  assignedDriverName?: string | null
  status: 'active' | 'in_maintenance' | 'inactive'
  notes?: string
  createdAt?: string
  createdAtIso?: string
  updatedAtIso?: string
}

export interface ManifestShipmentSummary {
  shipmentId: string
  trackingCode: string
  senderName: string
  recipientName: string
  packageCount: number
  totalWeightKg: number
  paymentStatus: PaymentStatus
  paymentTiming: PaymentTiming
  suggestedAmountCents?: number
  agreedAmountCents?: number
  finalAmountCents: number
  isPriceAdjusted?: boolean
  priceAdjustmentReason?: string | null
  priceAdjustedByUid?: string | null
  priceAdjustedByName?: string | null
  priceAdjustedAt?: string | null
  deliveryType: 'agency' | 'home' | 'direct_driver'
}

export interface ManifestDiscrepancy {
  shipmentId: string
  trackingCode: string
  issueType: 'missing' | 'damaged' | 'excess' | 'other'
  expectedPackages: number
  receivedPackages: number
  notes: string
  reportedAt: string
  reportedByUid: string
}

export interface DispatchManifest {
  id: string
  manifestNumber: string // ej. 'MAN-PUN-2026-0001'
  originBranchId: string
  destinationBranchId: string
  vehicleId: string
  vehiclePlate: string
  mobileNumber: string
  driverUid: string
  driverName: string
  driverPhone?: string
  shipmentIds: string[]
  shipmentSummaries: ManifestShipmentSummary[]
  totalShipments: number
  totalPackages: number
  totalWeightKg: number
  totalCodAmountCents: number
  status: 'dispatched' | 'in_transit' | 'received' | 'cancelled'
  departureNotes?: string
  dispatchedAt: string
  dispatchedAtIso?: string
  dispatchedByUid: string
  dispatchedByName: string
  driverCustodyStatus: 'pending' | 'accepted'
  driverCustodyAt?: string | null
  driverCustodyNotes?: string | null
  receivedAt?: string | null
  receivedAtIso?: string | null
  receivedByUid?: string | null
  receivedByName?: string | null
  receptionNotes?: string | null
  discrepancies?: ManifestDiscrepancy[]
}

export interface StorageLocationAssignment {
  shipmentId: string
  trackingCode: string
  branchId: string
  shelfId: string
  shelfName: string
  moduleId: string
  moduleNumber: number
  position?: string
  assignedAt: string
  assignedByUid: string
  assignedByName: string
}

export interface DriverDirectoryEntry {
  uid: string
  fullName: string
  phone: string
  assignedVehiclePlate?: string | null
  assignedMobileNumber?: string | null
  isActive: boolean
}

export interface DriverCustodyAccount {
  driverUid: string
  driverName: string
  cashUnderCustodyCents: number
  pendingRemittanceCents: number
  totalCollectedCents: number
  totalRemittedCents: number
  lastActivityAtIso?: string
  updatedAtIso?: string
}

export interface DriverCustodyRecord {
  id: string
  driverUid: string
  driverName: string
  type: 'route_collection' | 'remittance_to_cashier' | 'adjustment'
  shipmentId?: string
  trackingCode?: string
  amountCents: number
  amountBob: number
  paymentMethod: 'cash'
  status: 'pending_remittance' | 'partially_remitted' | 'reconciled'
  remittedAmountCents: number
  settlementIds: string[]
  createdAtIso: string
}

export interface DriverSettlement {
  id: string
  settlementNumber: string
  driverUid: string
  driverName: string
  receivedByUid: string
  receivedByName: string
  branchId: string
  cashShiftId: string
  amountCents: number
  amountBob?: number
  paymentMethod: string
  previousDriverBalanceCents?: number
  remainingDriverBalanceCents?: number
  notes?: string
  reconciledShipmentIds?: string[]
  shipmentIds: string[]
  createdAtIso: string
}
