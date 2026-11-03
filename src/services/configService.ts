import { httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { functions, db } from '../firebase/config.ts'
import type { SystemConfig, SystemConfigResponse } from '../types/index.ts'

export const BLANK_UNCONFIGURED_TEMPLATE: SystemConfig = {
  id: 'expreso_punata',
  company: {
    name: 'EXPRESO PUNATA',
    tradeName: 'EXPRESO PUNATA',
    legalName: '',
    acronym: 'EP',
    legalNotice: 'DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL',
  },
  branches: {
    punata: {
      name: 'Agencia Central Punata',
      code: 'PUN',
      city: 'Punata',
      department: 'Cochabamba',
      address: '',
      phone: '',
      isActive: true,
    },
    cochabamba: {
      name: 'Agencia Cochabamba',
      code: 'CBB',
      city: 'Cochabamba',
      department: 'Cochabamba',
      address: '',
      phone: '',
      isActive: true,
    },
  },
  tariffs: {
    baseFeeCents: 0,
    baseFeeBob: 0,
    freeWeightKg: 0,
    extraKgRateCents: 0,
    extraKgRateBob: 0,
    homeDeliveryFeeCents: 0,
    homeDeliveryFeeBob: 0,
  },
  commissions: {
    defaultType: 'percentage',
    defaultValue: 0,
  },
  dues: {
    monthlyDueCents: 0,
    monthlyDueBob: 0,
    lateFeePercentage: 0,
    gracePeriodDays: 0,
  },
  printing: {
    headerNotice: 'EXPRESO PUNATA',
    footerNotice: 'Conserve este comprobante para recoger su encomienda.',
    cutPaper: true,
    openDrawer: false,
  },
  status: 'unconfigured',
  isOfficial: false,
  updatedAtIso: new Date().toISOString(),
}

/**
 * Consulta la configuración oficial del sistema diferenciando:
 * - 'configured': Configuración oficial aprobada en Firestore.
 * - 'unconfigured': Aún no configurada (sin datos inventados).
 * - 'error': Error de red o permisos.
 */
export async function fetchSystemConfig(): Promise<SystemConfigResponse> {
  try {
    const fn = httpsCallable<void, SystemConfigResponse>(functions, 'getSystemConfig')
    const res = await fn()
    return res.data
  } catch (fnErr: any) {
    try {
      const snap = await getDoc(doc(db, 'system_config', 'expreso_punata'))
      if (snap.exists()) {
        const data = snap.data() as SystemConfig
        const isActuallyConfigured = data.status === 'configured' && data.isOfficial === true
        if (isActuallyConfigured) {
          return {
            success: true,
            status: 'configured',
            isOfficial: true,
            isDefault: false,
            config: { ...data, id: snap.id, isOfficial: true, status: 'configured' },
          }
        } else {
          return {
            success: true,
            status: 'unconfigured',
            isOfficial: false,
            isDefault: true,
            config: null,
            message: 'Configuración oficial pendiente de registro o aprobación por la Administración.',
          }
        }
      } else {
        return {
          success: true,
          status: 'unconfigured',
          isOfficial: false,
          isDefault: true,
          config: null,
          message: 'Configuración oficial pendiente de registro por la Administración.',
        }
      }
    } catch (dbErr: any) {
      console.warn('[configService] Error al conectar con Firestore:', dbErr)
      return {
        success: false,
        status: 'error',
        isOfficial: false,
        isDefault: false,
        config: null,
        error: dbErr?.message || fnErr?.message || 'Error de conexión o permisos al cargar configuración oficial.',
      }
    }
  }
}

export async function updateSystemConfig(
  config: Partial<SystemConfig>
): Promise<{ success: boolean; config: SystemConfig; message: string }> {
  const fn = httpsCallable(functions, 'updateSystemConfig')
  const res = await fn(config)
  return res.data as { success: boolean; config: SystemConfig; message: string }
}
