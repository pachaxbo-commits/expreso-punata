import type { PrinterProfile } from '../../types/printing.ts'
import { isAndroidDevice } from '../../adapters/printing/rawbtPrinterAdapter.ts'

const STORAGE_PREFIX = 'pachax:printers:expreso-punata'

export function getPrinterStorageKey(branchId: string = 'punata'): string {
  return `${STORAGE_PREFIX}:${branchId}`
}

export function getDefaultPrinterProfiles(branchId: string = 'punata'): PrinterProfile[] {
  const isAndroid = isAndroidDevice()
  const now = new Date().toISOString()

  return [
    {
      id: `prn-${branchId}-80mm-default`,
      branchId,
      name: `Térmica Principal 80mm (${branchId === 'punata' ? 'Punata' : 'Cochabamba'})`,
      connectionType: isAndroid ? 'rawbt_intent' : 'browser_dialog',
      paperFormat: '80mm',
      isDefault: true,
      autoPrintOnCreation: true,
      autoPrintOnPayment: true,
      autoPrintOnDelivery: true,
      kickDrawerOnReceipt: true,
      cutPaperOnFinish: true,
      capabilities: {
        supportsPaperCut: true,
        supportsCashDrawerKick: true,
        supportsQrCode: true,
        supportsLogo: true,
        feedLinesEnd: 2,
        fontSize: 'normal',
        marginsMm: 3,
      },
      createdAtIso: now,
      updatedAtIso: now,
    },
    {
      id: `prn-${branchId}-58mm-compact`,
      branchId,
      name: `Térmica Compacta 58mm (${branchId === 'punata' ? 'Punata' : 'Cochabamba'})`,
      connectionType: isAndroid ? 'rawbt_intent' : 'browser_dialog',
      paperFormat: '58mm',
      isDefault: false,
      autoPrintOnCreation: false,
      autoPrintOnPayment: true,
      autoPrintOnDelivery: false,
      kickDrawerOnReceipt: true,
      cutPaperOnFinish: true,
      capabilities: {
        supportsPaperCut: true,
        supportsCashDrawerKick: true,
        supportsQrCode: true,
        supportsLogo: false,
        feedLinesEnd: 2,
        fontSize: 'compact',
        marginsMm: 2,
      },
      createdAtIso: now,
      updatedAtIso: now,
    },
    {
      id: `prn-${branchId}-letter-docs`,
      branchId,
      name: `Impresora de Oficina / Manifiestos (Carta)`,
      connectionType: 'browser_dialog',
      paperFormat: 'letter',
      isDefault: false,
      autoPrintOnCreation: false,
      autoPrintOnPayment: false,
      autoPrintOnDelivery: false,
      kickDrawerOnReceipt: false,
      cutPaperOnFinish: false,
      capabilities: {
        supportsPaperCut: false,
        supportsCashDrawerKick: false,
        supportsQrCode: true,
        supportsLogo: true,
        feedLinesEnd: 0,
        fontSize: 'normal',
        marginsMm: 15,
      },
      createdAtIso: now,
      updatedAtIso: now,
    },
  ]
}

export function loadPrinterProfiles(branchId: string = 'punata'): PrinterProfile[] {
  try {
    if (typeof localStorage === 'undefined') {
      return getDefaultPrinterProfiles(branchId)
    }

    const key = getPrinterStorageKey(branchId)
    const raw = localStorage.getItem(key)
    if (!raw) {
      const defaults = getDefaultPrinterProfiles(branchId)
      savePrinterProfiles(defaults, branchId)
      return defaults
    }

    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as PrinterProfile[]
    }

    const defaults = getDefaultPrinterProfiles(branchId)
    savePrinterProfiles(defaults, branchId)
    return defaults
  } catch (err) {
    console.warn('[printerProfiles] Error cargando perfiles locales:', err)
    return getDefaultPrinterProfiles(branchId)
  }
}

export function savePrinterProfiles(profiles: PrinterProfile[], branchId: string = 'punata'): void {
  try {
    if (typeof localStorage === 'undefined') return
    const key = getPrinterStorageKey(branchId)
    localStorage.setItem(key, JSON.stringify(profiles))
  } catch (err) {
    console.warn('[printerProfiles] Error persistiendo perfiles locales:', err)
  }
}

export function saveOrUpdateProfile(profile: PrinterProfile, branchId: string = 'punata'): PrinterProfile {
  const list = loadPrinterProfiles(branchId)
  const now = new Date().toISOString()
  const updatedProfile: PrinterProfile = {
    ...profile,
    branchId,
    updatedAtIso: now,
  }

  // Si este perfil es marcado como predeterminado, desmarcar los demás
  const updatedList = list.map((p) => {
    if (p.id === updatedProfile.id) {
      return updatedProfile
    }
    if (updatedProfile.isDefault) {
      return { ...p, isDefault: false }
    }
    return p
  })

  if (!updatedList.some((p) => p.id === updatedProfile.id)) {
    if (updatedProfile.isDefault) {
      for (const p of updatedList) {
        p.isDefault = false
      }
    }
    updatedList.push(updatedProfile)
  }

  savePrinterProfiles(updatedList, branchId)
  return updatedProfile
}

export function deleteProfile(profileId: string, branchId: string = 'punata'): void {
  const list = loadPrinterProfiles(branchId)
  const filtered = list.filter((p) => p.id !== profileId)
  if (filtered.length > 0 && !filtered.some((p) => p.isDefault)) {
    filtered[0].isDefault = true
  }
  savePrinterProfiles(filtered, branchId)
}

export function getDefaultPrinter(branchId: string = 'punata'): PrinterProfile {
  const list = loadPrinterProfiles(branchId)
  const def = list.find((p) => p.isDefault)
  return def || list[0] || getDefaultPrinterProfiles(branchId)[0]
}
