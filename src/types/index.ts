/**
 * Tipos canónicos del dominio de S.M.T. EXPRESO PUNATA
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
  ci: string
  phone: string
  role: UserRole
  primaryBranchId: string
  allowedBranchIds: string[]
  assignedVehiclePlate?: string
  assignedMobileNumber?: string
  isActive: boolean
  createdAt: string
  lastLoginAt?: string
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
  | 'stored'
  | 'ready_for_pickup'
  | 'in_delivery'
  | 'delivered'
  | 'uncollected'
  | 'returned'
  | 'lost'
  | 'cancelled'
  | 'final_disposition_authorized'

export type PaymentTiming = 'origin_paid' | 'destination_cod'
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
  moduleId: string
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

export interface ParcelDeliveryRecord {
  deliveredAt: string
  deliveredByUid: string
  deliveredByName: string
  receivedByName: string
  receivedByDoc: string
  recipientRelationship: 'titular' | 'familiar' | 'apoderado' | 'empleado' | 'otro'
  authorizedChangeReason?: string
  signatureUrl?: string
  deliveryNotes?: string
}

export interface Shipment {
  id: string
  trackingCode: string // Inmutable (ej. 'PUN-2026-00042')
  createdAt: string
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

  // Finanzas del envío (en centavos enteros para evitar errores flotantes y en Bolivianos)
  shippingFeeCents: number
  weightSurchargeCents: number
  homeDeliveryFeeCents: number
  discountCents: number
  finalAmountCents: number
  finalAmountBob: number

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
}

export interface CashShift {
  id: string
  branchId: string
  operatorUid: string
  operatorName: string
  openedAt: string
  closedAt?: string
  status: 'open' | 'closed'

  initialCashCents: number
  initialCashBob: number
  totalCashInCents: number
  totalCashOutCents: number
  expectedCashCents: number
  expectedCashBob: number
  actualCashCents?: number
  actualCashBob?: number
  differenceCents?: number
  differenceBob?: number

  totalQrInCents: number
  totalTransferInCents: number
  reconciledDriverCustodyInCents: number

  notes?: string
}

export interface CashMovement {
  id: string
  shiftId: string
  branchId: string
  timestamp: string
  type: 'income' | 'expense' | 'reversal'
  category: string
  amountCents: number
  amountBob: number
  paymentMethod: PaymentMethod
  concept: string
  referenceId?: string
  operatorUid: string
  operatorName: string
  notes?: string
}

export interface FixedAsset {
  id: string
  assetCode: string // ej. 'ACT-PUN-0012'
  barcodeQr: string
  name: string
  category: 'computacion' | 'muebles' | 'herramientas' | 'comunicacion' | 'oficina' | 'otro'
  description: string
  branchId: string
  physicalLocation: string
  responsiblePersonUid?: string
  responsiblePersonName: string
  acquisitionDate: string
  acquisitionCostBob?: number
  status: 'available' | 'in_use' | 'in_maintenance' | 'damaged' | 'out_of_service' | 'lost' | 'disposed'
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
}

export interface UnionMonthlyDue {
  id: string
  memberId: string
  memberNumber: string
  memberName: string
  period: string // AAAA-MM
  periodLabel: string
  amountBob: number
  dueDate: string
  status: 'paid' | 'partial' | 'pending' | 'overdue'
  paidAmountBob: number
  balanceBob: number
}
