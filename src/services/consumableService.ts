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
  ConsumableItem,
  ConsumableMovement,
  ConsumableCategory,
} from '../types/index.ts'

export async function fetchBranchConsumables(branchId?: string): Promise<ConsumableItem[]> {
  let q = query(collection(db, 'branch_consumables'), orderBy('name', 'asc'))
  if (branchId && branchId !== 'all') {
    q = query(
      collection(db, 'branch_consumables'),
      where('branchId', '==', branchId),
      orderBy('name', 'asc')
    )
  }
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConsumableItem))
}

export async function fetchConsumableMovements(
  branchId?: string,
  maxRecords = 50
): Promise<ConsumableMovement[]> {
  let q = query(
    collection(db, 'consumable_movements'),
    orderBy('timestampIso', 'desc'),
    limit(maxRecords)
  )
  if (branchId && branchId !== 'all') {
    q = query(
      collection(db, 'consumable_movements'),
      where('branchId', '==', branchId),
      orderBy('timestampIso', 'desc'),
      limit(maxRecords)
    )
  }
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConsumableMovement))
}

export async function createConsumableItem(params: {
  code: string
  name: string
  category: ConsumableCategory
  branchId: string
  unit?: string
  currentStock?: number
  minStockAlert?: number
  costPerUnitCents?: number
  referenceDocument?: string
}): Promise<{ success: boolean; item: ConsumableItem }> {
  const fn = httpsCallable(functions, 'manageConsumable')
  const res = await fn({ action: 'create_item', ...params })
  return res.data as { success: boolean; item: ConsumableItem }
}

export async function updateConsumableItem(params: {
  id: string
  name?: string
  minStockAlert?: number
  costPerUnitCents?: number
  status?: 'active' | 'archived'
}): Promise<{ success: boolean; message: string }> {
  const fn = httpsCallable(functions, 'manageConsumable')
  const res = await fn({ action: 'update_item', ...params })
  return res.data as { success: boolean; message: string }
}

export async function recordConsumableEntry(params: {
  id: string
  quantity: number
  costPerUnitCents?: number
  reason?: string
  referenceDocument?: string
}): Promise<{ success: boolean; nextStock: number }> {
  const fn = httpsCallable(functions, 'manageConsumable')
  const res = await fn({ action: 'record_entry', ...params })
  return res.data as { success: boolean; nextStock: number }
}

export async function recordConsumableConsumption(params: {
  id: string
  quantity: number
  reason?: string
  referenceDocument?: string
}): Promise<{ success: boolean; nextStock: number }> {
  const fn = httpsCallable(functions, 'manageConsumable')
  const res = await fn({ action: 'record_consumption', ...params })
  return res.data as { success: boolean; nextStock: number }
}

export async function recordConsumableAdjustment(params: {
  id: string
  newStock: number
  reason: string
  referenceDocument?: string
}): Promise<{ success: boolean; newStock: number }> {
  const fn = httpsCallable(functions, 'manageConsumable')
  const res = await fn({ action: 'record_adjustment', ...params })
  return res.data as { success: boolean; newStock: number }
}
