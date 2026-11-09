import { httpsCallable } from 'firebase/functions'
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type {
  ShipmentIncident,
  ShipmentIncidentType,
  ShipmentContact,
  ShipmentContactMethod,
  ShipmentContactResult,
} from '../types/index.ts'

export async function fetchShipmentIncidents(
  branchId?: string,
  maxRecords = 50
): Promise<ShipmentIncident[]> {
  let q = query(
    collection(db, 'shipment_incidents'),
    orderBy('createdAtIso', 'desc'),
    limit(maxRecords)
  )
  if (branchId && branchId !== 'all') {
    q = query(
      collection(db, 'shipment_incidents'),
      where('branchId', '==', branchId),
      orderBy('createdAtIso', 'desc'),
      limit(maxRecords)
    )
  }
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ShipmentIncident))
}

export async function fetchShipmentContacts(shipmentId: string, branchId?: string, maxRecords = 50): Promise<ShipmentContact[]> {
  const constraints = [where('shipmentId', '==', shipmentId)]
  if (branchId && branchId !== 'all') constraints.push(where('branchId', '==', branchId))
  const q = query(collection(db, 'shipment_contacts'), ...constraints, limit(maxRecords))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ShipmentContact)).sort((a, b) => b.contactedAtIso.localeCompare(a.contactedAtIso))
}

export async function registerShipmentContact(params: {
  shipmentId: string
  method: ShipmentContactMethod
  result: ShipmentContactResult
  notes: string
  idempotencyKey: string
}): Promise<{ success: boolean; contact: ShipmentContact }> {
  const fn = httpsCallable(functions, 'registerShipmentContact')
  const res = await fn(params)
  return res.data as { success: boolean; contact: ShipmentContact }
}

export async function reportShipmentIncident(params: {
  shipmentId: string
  incidentType: ShipmentIncidentType
  description: string
  responsiblePerson?: string
  evidenceUrl?: string
  branchId?: string
}): Promise<{ success: boolean; incident: ShipmentIncident }> {
  const fn = httpsCallable(functions, 'registerShipmentIncident')
  const res = await fn({ action: 'report_incident', ...params })
  return res.data as { success: boolean; incident: ShipmentIncident }
}

export async function resolveShipmentIncident(params: {
  incidentId: string
  resolutionNotes: string
}): Promise<{ success: boolean; message: string }> {
  const fn = httpsCallable(functions, 'registerShipmentIncident')
  const res = await fn({ action: 'resolve_incident', ...params })
  return res.data as { success: boolean; message: string }
}

export async function indemnifyShipmentIncident(params: {
  incidentId: string
  compensationAmountCents: number
  paymentSource: 'cash_register' | 'union_reserve'
  branchId?: string
}): Promise<{ success: boolean; compensationAmountBob: number; message: string }> {
  const fn = httpsCallable(functions, 'registerShipmentIncident')
  const res = await fn({ action: 'indemnify_incident', ...params })
  return res.data as { success: boolean; compensationAmountBob: number; message: string }
}
