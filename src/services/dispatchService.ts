import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  limit,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config.ts'
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
  shelfId: string
  shelfName: string
  moduleId: string
  moduleNumber: number
  position?: string
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
    collection(db, 'users'),
    where('role', '==', 'conductor'),
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
