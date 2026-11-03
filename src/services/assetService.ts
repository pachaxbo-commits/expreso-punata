import { httpsCallable } from 'firebase/functions'
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { FixedAsset, FixedAssetAuditLog, FixedAssetCategory, FixedAssetStatus } from '../types/index.ts'

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
