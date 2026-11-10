import { httpsCallable } from 'firebase/functions'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { FixedAsset, FixedAssetAuditLog, FixedAssetCategory, FixedAssetStatus, PatrimonialLocationId, PhysicalInventoryDocument } from '../types/index.ts'

export interface ManageFixedAssetInput {
  id?: string
  action?: 'create' | 'update' | 'transfer' | 'changeStatus' | 'dispose'
  assetCode?: string
  name?: string
  category?: FixedAssetCategory
  description?: string
  branchId?: 'punata' | 'cochabamba'
  physicalLocation?: string
  responsiblePersonUid?: string
  responsiblePersonName?: string
  acquisitionDate?: string
  acquisitionCostBob?: number
  acquisitionCostCents?: number
  status?: FixedAssetStatus
  photoUrl?: string
  notes?: string
  disposedReason?: string
  patrimonialLocationId?: PatrimonialLocationId
  propertyType?: string
  address?: string
  quantity?: number
  batchRequestId?: string
}

export interface ManageFixedAssetResult {
  success: boolean
  asset?: FixedAsset
  assetId?: string
  message: string
}

export async function manageFixedAsset(input: ManageFixedAssetInput): Promise<ManageFixedAssetResult> {
  const fn = httpsCallable<ManageFixedAssetInput, ManageFixedAssetResult>(functions, 'manageFixedAsset')
  const res = await fn(input)
  return res.data
}

export async function createFixedAssetBatch(input: Omit<ManageFixedAssetInput, 'action'> & { quantity: number; batchRequestId: string }): Promise<{ success: boolean; assets: FixedAsset[]; quantity: number; message: string }> {
  const fn = httpsCallable(functions, 'manageFixedAsset')
  const res = await fn({ ...input, action: 'create_batch' })
  return res.data as { success: boolean; assets: FixedAsset[]; quantity: number; message: string }
}

export async function fetchPhysicalInventoryDocuments(filters: { patrimonialLocationId?: PatrimonialLocationId | 'all'; search?: string } = {}): Promise<PhysicalInventoryDocument[]> {
  const fn = httpsCallable(functions, 'listPhysicalInventoryDocuments')
  const res = await fn(filters)
  return (res.data as { documents: PhysicalInventoryDocument[] }).documents
}

export async function managePhysicalInventoryDocument(input: Omit<PhysicalInventoryDocument, 'id' | 'createdAtIso' | 'updatedAtIso'> & { id?: string; action?: 'create' | 'update' }): Promise<PhysicalInventoryDocument> {
  const fn = httpsCallable(functions, 'managePhysicalInventoryDocument')
  const res = await fn(input)
  return (res.data as { document: PhysicalInventoryDocument }).document
}

export function subscribeFixedAssets(
  onUpdate: (assets: FixedAsset[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'fixed_assets'), orderBy('assetCode', 'asc'))
  return onSnapshot(
    q,
    (snap) => {
      const assets = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as FixedAsset[]
      onUpdate(assets)
    },
    (err) => {
      console.error('Error suscribiendo bienes fijos:', err)
      if (onError) onError(err)
    }
  )
}

export function subscribeAssetAuditLogs(
  assetId: string,
  onUpdate: (logs: FixedAssetAuditLog[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'fixed_assets', assetId, 'audit_logs'),
    orderBy('timestampIso', 'desc')
  )
  return onSnapshot(
    q,
    (snap) => {
      const logs = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as FixedAssetAuditLog[]
      onUpdate(logs)
    },
    (err) => {
      console.error('Error suscribiendo auditoría de activo:', err)
      if (onError) onError(err)
    }
  )
}
