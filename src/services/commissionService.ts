import { observedHttpsCallable as httpsCallable } from '../firebase/observedCallable.ts'
import { doc } from 'firebase/firestore'
import { getDoc } from '../firebase/observedFirestore.ts'
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
  const fn = httpsCallable(functions, 'getDriverCommissionOverview')
  const res = await fn({})
  return (res.data as { accounts: DriverCommissionAccount[] }).accounts || []
}

export async function fetchDriverCommissionRecords(
  driverUid: string,
  maxRecords = 50
): Promise<DriverCommissionRecord[]> {
  const fn = httpsCallable(functions, 'getDriverCommissionOverview')
  const res = await fn({})
  return ((res.data as { records: DriverCommissionRecord[] }).records || [])
    .filter((record) => record.driverUid === driverUid)
    .slice(0, maxRecords)
}

export async function accrueDriverCommission(params: {
  shipmentId: string
  manifestId: string
  driverUid?: string
}): Promise<{ success: boolean; recordId: string; driverUid: string; commissionAmountCents: number }> {
  const fn = httpsCallable(functions, 'accrueDriverCommission')
  const res = await fn(params)
  return res.data as { success: boolean; recordId: string; driverUid: string; commissionAmountCents: number }
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
