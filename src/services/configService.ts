import { httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { SystemConfig } from '../types/index.ts'

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  id: 'expreso_punata',
  company: {
    name: 'EXPRESO PUNATA',
    tradeName: 'EXPRESO PUNATA',
    legalName: 'Expreso Punata',
    acronym: 'EP',
    legalNotice: 'DOCUMENTO OPERATIVO INTERNO - NO CONSTITUYE FACTURA FISCAL',
  },
  branches: {
    punata: {
      name: 'Agencia Central Punata',
      code: 'PUN',
      city: 'Punata',
      department: 'Cochabamba',
      address: 'Av. Heroínas del Coronel esq. Sucre (Parada Punata)',
      phone: '4-4571234 / 71798765',
      isActive: true,
    },
    cochabamba: {
      name: 'Agencia Cochabamba',
      code: 'CBB',
      city: 'Cochabamba',
      department: 'Cochabamba',
      address: 'Av. 9 de Abril y Av. Barrientos (Zona San Carlos)',
      phone: '4-4256789 / 71712345',
      isActive: true,
    },
  },
  tariffs: {
    baseFeeCents: 1500,
    baseFeeBob: 15,
    freeWeightKg: 3,
    extraKgRateCents: 200,
    extraKgRateBob: 2,
    homeDeliveryFeeCents: 1200,
    homeDeliveryFeeBob: 12,
  },
  commissions: {
    defaultType: 'percentage',
    defaultValue: 10,
  },
  dues: {
    monthlyDueCents: 5000,
    monthlyDueBob: 50,
    lateFeePercentage: 0,
    gracePeriodDays: 5,
  },
  printing: {
    headerNotice: 'EXPRESO PUNATA - Transporte Interprovincial y Encomiendas',
    footerNotice: 'Conserve este comprobante para recoger su encomienda.',
    cutPaper: true,
    openDrawer: false,
  },
  updatedAtIso: new Date().toISOString(),
}

export async function fetchSystemConfig(): Promise<{ success: boolean; config: SystemConfig; isDefault: boolean }> {
  try {
    const fn = httpsCallable(functions, 'getSystemConfig')
    const res = await fn()
    return res.data as { success: boolean; config: SystemConfig; isDefault: boolean }
  } catch (err) {
    try {
      // Fallback a Firestore directo
      const snap = await getDoc(doc(db, 'system_config', 'expreso_punata'))
      if (snap.exists()) {
        return { success: true, config: snap.data() as SystemConfig, isDefault: false }
      }
    } catch {
      // Silencioso para fallback local
    }
    // Fallback resiliente a la configuración predeterminada
    return { success: true, config: DEFAULT_SYSTEM_CONFIG, isDefault: true }
  }
}

export async function updateSystemConfig(
  config: Partial<SystemConfig>
): Promise<{ success: boolean; config: SystemConfig; message: string }> {
  const fn = httpsCallable(functions, 'updateSystemConfig')
  const res = await fn(config)
  return res.data as { success: boolean; config: SystemConfig; message: string }
}
