import { httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { SystemConfig } from '../types/index.ts'

export async function fetchSystemConfig(): Promise<{ success: boolean; config: SystemConfig; isDefault: boolean }> {
  try {
    const fn = httpsCallable(functions, 'getSystemConfig')
    const res = await fn()
    return res.data as { success: boolean; config: SystemConfig; isDefault: boolean }
  } catch (err) {
    // Fallback a Firestore directo
    const snap = await getDoc(doc(db, 'system_config', 'expreso_punata'))
    if (snap.exists()) {
      return { success: true, config: snap.data() as SystemConfig, isDefault: false }
    }
    throw err
  }
}

export async function updateSystemConfig(
  config: Partial<SystemConfig>
): Promise<{ success: boolean; config: SystemConfig; message: string }> {
  const fn = httpsCallable(functions, 'updateSystemConfig')
  const res = await fn(config)
  return res.data as { success: boolean; config: SystemConfig; message: string }
}
