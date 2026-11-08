import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  limit,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, functions, storage } from '../firebase/config.ts'
import type {
  DispatchManifest,
  Vehicle,
  UserProfile,
} from '../types/index.ts'

export interface CreateManifestInput {
  originBranchId: string
  destinationBranchId: string
  vehicleId: string
  driverUid: string
  shipmentIds: string[]
  departureNotes?: string
}

export interface ReceiveManifestInput {
  manifestId: string
  receptionNotes?: string
  receivedShipments: {
    shipmentId: string
    receivedPackages: number
    condition: 'good' | 'damaged' | 'missing'
    notes?: string
  }[]
}

export interface AssignStorageInput {
  shipmentId: string
  warehouseId: string
  warehouseName: string
  shelfId: string
  shelfName: string
  moduleId: string
  moduleNumber: number
  rowNumber: number
  floorNumber: number
  spaceNumber: number
  position?: string
  photo?: {
    storagePath: string
    contentType: string
    sizeBytes: number
    originalFileName?: string
    capturedAtIso: string
  }
}

export interface ManageVehicleInput {
  action: 'create' | 'update'
  vehicleId?: string
  vehicleData: {
    mobileNumber: string
    plate: string
    branchId: string
    brand?: string
    model?: string
    capacityKg?: number
    assignedDriverUid?: string | null
    assignedDriverName?: string | null
    status?: 'active' | 'in_maintenance' | 'inactive'
    notes?: string
  }
}

/**
 * Crea un manifiesto de despacho atómicamente mediante Cloud Functions.
 */
export async function createDispatchManifestThroughBackend(input: CreateManifestInput) {
  const callable = httpsCallable<CreateManifestInput, {
    success: boolean
    manifestId: string
    manifestNumber: string
    totalShipments: number
    totalPackages: number
    totalWeightKg: number
    totalCodAmountCents: number
  }>(functions, 'createDispatchManifest')

  const response = await callable(input)
  return response.data
}

export async function confirmShipmentDeparture(input: Omit<CreateManifestInput, 'shipmentIds'> & { shipmentId: string }) {
  await httpsCallable(functions, 'confirmShipmentDeparture')(input)
}

export async function confirmShipmentReception(input: ReceiveManifestInput['receivedShipments'][number] & { manifestId: string }) {
  await httpsCallable(functions, 'confirmShipmentReception')(input)
}

/**
 * Confirma la custodia de la carga por parte del conductor asignado.
 */
export async function driverConfirmCustodyThroughBackend(manifestId: string, notes?: string) {
  const callable = httpsCallable<{ manifestId: string; notes?: string }, {
    success: boolean
    manifestId: string
    manifestNumber: string
    driverCustodyStatus: 'accepted'
  }>(functions, 'driverConfirmCustody')

  const response = await callable({ manifestId, notes })
  return response.data
}

/**
 * Recibe formalmente un manifiesto en destino, verificando bulto a bulto e informando discrepancias.
 */
export async function receiveDispatchManifestThroughBackend(input: ReceiveManifestInput) {
  const callable = httpsCallable<ReceiveManifestInput, {
    success: boolean
    manifestId: string
    manifestNumber: string
    totalShipments: number
    discrepanciesCount: number
    receivedAtIso: string
  }>(functions, 'receiveDispatchManifest')

  const response = await callable(input)
  return response.data
}

/**
 * Asigna una encomienda a un módulo y estante físico de almacén.
 */
export async function assignShipmentStorageThroughBackend(input: AssignStorageInput) {
  const callable = httpsCallable<AssignStorageInput, {
    success: boolean
    shipmentId: string
    trackingCode: string
    storageLocation: any
  }>(functions, 'assignShipmentStorage')

  const response = await callable(input)
  return response.data
}

export async function uploadShipmentStoragePhoto(shipmentId: string, file: File) {
  if (!file.type.startsWith('image/')) throw new Error('La evidencia debe ser una imagen.')
  if (file.size > 2 * 1024 * 1024) throw new Error('La fotografía no puede superar 2 MB.')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const storagePath = `shipments/${shipmentId}/storage/${suffix}-${safeName}`
  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type })
  return { storagePath, contentType: file.type, sizeBytes: file.size, originalFileName: file.name }
}

export async function getShipmentStoragePhotoUrl(storagePath: string) {
  return getDownloadURL(ref(storage, storagePath))
}

/**
 * Administra el padrón de vehículos y móviles de la flota.
 */
export async function manageVehicleThroughBackend(input: ManageVehicleInput) {
  const callable = httpsCallable<ManageVehicleInput, {
    success: boolean
    vehicleId: string
    mobileNumber?: string
    plate?: string
  }>(functions, 'manageVehicle')

  const response = await callable(input)
  return response.data
}

/**
 * Suscripción reactiva a los manifiestos de la sucursal activa.
 */
export function subscribeManifestsByBranch(
  branchId: string,
  onUpdate: (manifests: DispatchManifest[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(
    collection(db, 'manifests'),
    orderBy('createdAt', 'desc'),
    limit(50)
  )

  return onSnapshot(
    q,
    (snapshot) => {
      const list: DispatchManifest[] = []
      snapshot.forEach((doc) => {
        const data = doc.data() as any
        // Filtramos por pertenencia a la sucursal (origen o destino)
        if (data.originBranchId === branchId || data.destinationBranchId === branchId) {
          list.push({
            id: doc.id,
            ...data,
            dispatchedAtIso: data.dispatchedAtIso || (data.dispatchedAt?.toDate ? data.dispatchedAt.toDate().toISOString() : ''),
            receivedAtIso: data.receivedAtIso || (data.receivedAt?.toDate ? data.receivedAt.toDate().toISOString() : null),
          } as DispatchManifest)
        }
      })
      onUpdate(list)
    },
    (err) => {
      console.warn('[subscribeManifestsByBranch] Error Firestore:', err)
      if (onError) onError(err)
    }
  )
}

/**
 * Suscripción reactiva a los manifiestos asignados al conductor actual.
 */
export function subscribeDriverManifests(
  driverUid: string,
  onUpdate: (manifests: DispatchManifest[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(
    collection(db, 'manifests'),
    where('driverUid', '==', driverUid),
    orderBy('createdAt', 'desc'),
    limit(30)
  )

  return onSnapshot(
    q,
    (snapshot) => {
      const list: DispatchManifest[] = []
      snapshot.forEach((doc) => {
        const data = doc.data() as any
        list.push({
          id: doc.id,
          ...data,
          dispatchedAtIso: data.dispatchedAtIso || (data.dispatchedAt?.toDate ? data.dispatchedAt.toDate().toISOString() : ''),
          receivedAtIso: data.receivedAtIso || (data.receivedAt?.toDate ? data.receivedAt.toDate().toISOString() : null),
        } as DispatchManifest)
      })
      onUpdate(list)
    },
    (err) => {
      console.warn('[subscribeDriverManifests] Error Firestore:', err)
      if (onError) onError(err)
    }
  )
}

/**
 * Suscripción reactiva a la flota de vehículos activos.
 */
export function subscribeVehicles(
  onUpdate: (vehicles: Vehicle[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(
    collection(db, 'vehicles'),
    orderBy('mobileNumber', 'asc')
  )

  return onSnapshot(
    q,
    (snapshot) => {
      const list: Vehicle[] = []
      snapshot.forEach((doc) => {
        const data = doc.data() as any
        list.push({
          id: doc.id,
          ...data,
          createdAtIso: data.createdAtIso || (data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : ''),
        } as Vehicle)
      })
      onUpdate(list)
    },
    (err) => {
      console.warn('[subscribeVehicles] Error Firestore:', err)
      if (onError) onError(err)
    }
  )
}

/**
 * Suscripción reactiva a la lista de conductores activos.
 */
export function subscribeActiveDrivers(
  onUpdate: (drivers: UserProfile[]) => void,
  onError?: (err: Error) => void
) {
  const q = query(
    collection(db, 'driver_directory'),
    where('isActive', '==', true)
  )

  return onSnapshot(
    q,
    (snapshot) => {
      const list: UserProfile[] = []
      snapshot.forEach((doc) => {
        list.push({ uid: doc.id, ...doc.data() } as UserProfile)
      })
      onUpdate(list)
    },
    (err) => {
      console.warn('[subscribeActiveDrivers] Error Firestore:', err)
      if (onError) onError(err)
    }
  )
}

export interface DeliverShipmentInput {
  shipmentId: string
  receivedByName: string
  receivedByDocType?: string
  receivedByDocNumber: string
  recipientRelationship?: 'titular' | 'familiar' | 'apoderado' | 'empleado' | 'otro'
  authorizationNote?: string
  signatureDataUrl: string
  photoEvidenceUrl?: string | null
  paymentMethod?: 'cash' | 'qr' | 'transfer'
}

export interface SettleDriverCashInput {
  driverUid: string
  amountCents: number
  shipmentIds?: string[]
  paymentMethod?: 'cash'
  notes?: string
  idempotencyKey?: string
}

export interface GetDriverCustodyBalanceInput {
  driverUid?: string
}

export interface ManageShelfInput {
  action: 'get_or_seed' | 'list' | 'create_or_update'
  branchId: string
  shelfData?: {
    id: string
    name: string
    code?: string
    description?: string
    floorCount?: number
    rowCountPerFloor?: number
    spaceCountPerFloor?: number
    capacityPerSpace?: number
    physicalWarehouseId?: string
    physicalWarehouseName?: string
    moduleCount?: number
    active?: boolean
  }
}

/**
 * Entrega final de encomienda con captura de firma, verificación de receptor y cobro COD en caja.
 */
export async function deliverShipmentThroughBackend(input: DeliverShipmentInput) {
  const callable = httpsCallable<DeliverShipmentInput, {
    success: boolean
    shipmentId: string
    trackingCode: string
    status: 'delivered'
    deliveredAtIso: string
    paymentCollected: boolean
    deliveryRecord: any
  }>(functions, 'deliverShipment')

  const response = await callable(input)
  return response.data
}

/**
 * Liquidación de fondos y remesa de conductor en el turno de caja abierto.
 */
export async function settleDriverCashThroughBackend(input: SettleDriverCashInput) {
  const callable = httpsCallable<SettleDriverCashInput, {
    success: boolean
    settlementId: string
    settlementNumber: string
    amountCents: number
    amountBob: number
    previousDriverBalanceCents?: number
    remainingDriverBalanceCents?: number
    reconciledShipmentIds?: string[]
    settledAtIso: string
  }>(functions, 'settleDriverCash')

  const response = await callable(input)
  return response.data
}

/**
 * Gestión y auto-inicialización de estantes y módulos de almacén por sucursal.
 */
export async function manageShelfThroughBackend(input: ManageShelfInput) {
  const callable = httpsCallable<ManageShelfInput, {
    success: boolean
    shelves?: any[]
    shelf?: any
  }>(functions, 'manageShelf')

  const response = await callable(input)
  return response.data
}

/**
 * Obtiene la lista operativa de conductores activos y sincroniza el directorio público.
 */
export async function listActiveDriversThroughBackend() {
  const callable = httpsCallable<void, {
    success: boolean
    drivers: any[]
  }>(functions, 'listActiveDrivers')

  const response = await callable()
  return response.data
}

/**
 * Consulta el saldo de custodia acumulado y los cobros de ruta pendientes de un conductor.
 */
export async function getDriverCustodyBalanceThroughBackend(input: GetDriverCustodyBalanceInput = {}) {
  const callable = httpsCallable<GetDriverCustodyBalanceInput, {
    account: {
      driverUid: string
      driverName: string
      cashUnderCustodyCents: number
      pendingRemittanceCents: number
      totalCollectedCents: number
      totalRemittedCents: number
    }
    pendingRecords: any[]
    pendingCount: number
  }>(functions, 'getDriverCustodyBalance')

  const response = await callable(input)
  return response.data
}

export interface GetShipmentSignatureUrlInput {
  shipmentId: string
  storagePath?: string
}

export async function getShipmentSignatureUrlThroughBackend(input: GetShipmentSignatureUrlInput) {
  const callable = httpsCallable<GetShipmentSignatureUrlInput, {
    success: boolean
    url: string
    expiresInMinutes: number
  }>(functions, 'getShipmentSignatureUrl')
  const response = await callable(input)
  return response.data
}
