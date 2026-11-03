import { httpsCallable } from 'firebase/functions'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type {
  DriverCommissionAccount,
  DriverCommissionRecord,
  DriverCommissionVoucher,
} from '../types/index.ts'

export async function fetchDriverCommissionAccount(
  driverUid: string
): Promise<DriverCommissionAccount | null> {
  const ref = doc(db, 'driver_commission_accounts', driverUid)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return snap.data() as DriverCommissionAccount
}

export async function fetchAllDriverCommissionAccounts(): Promise<DriverCommissionAccount[]> {
  const ref = collection(db, 'driver_commission_accounts')
  const snap = await getDocs(ref)
  return snap.docs.map((d) => d.data() as DriverCommissionAccount)
}

export async function fetchDriverCommissionRecords(
  driverUid: string,
  maxRecords = 50
): Promise<DriverCommissionRecord[]> {
  const q = query(
    collection(db, 'driver_commission_records'),
    where('driverUid', '==', driverUid),
    orderBy('createdAtIso', 'desc'),
    limit(maxRecords)
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DriverCommissionRecord))
}

export async function accrueDriverCommission(params: {
  driverUid: string
  shipmentId: string
  trackingCode: string
  manifestId?: string
  shippingAmountCents: number
  ruleType?: 'percentage' | 'fixed_per_shipment'
  ruleValue?: number
}): Promise<{ success: boolean; recordId: string; commissionAmountCents: number }> {
  const fn = httpsCallable(functions, 'accrueDriverCommission')
  const res = await fn(params)
  return res.data as { success: boolean; recordId: string; commissionAmountCents: number }
}

export async function settleDriverCommission(params: {
  driverUid: string
  amountCents: number
  branchId: string
  notes?: string
}): Promise<{ success: boolean; voucher: DriverCommissionVoucher; message: string }> {
  const fn = httpsCallable(functions, 'settleDriverCommission')
  const res = await fn(params)
  return res.data as { success: boolean; voucher: DriverCommissionVoucher; message: string }
}
