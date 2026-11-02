import { EXPRESO_PUNATA_LOGO_DATA_URL, EXPRESO_PUNATA_LOGO_PATH } from '../assets/expresoPunataLogo.ts'
import type { Branch } from '../types/index.ts'

export { EXPRESO_PUNATA_LOGO_DATA_URL, EXPRESO_PUNATA_LOGO_PATH }

export const EXPRESO_PUNATA_COMPANY = {
  name: 'EXPRESO PUNATA',
  tradeName: 'EXPRESO PUNATA',
  legalName: 'Expreso Punata',
  acronym: 'EP',
  slogan: 'Servicio Ejecutivo — "Somos los Pioneros"',
  serviceHours: 'Atención 24 Horas',
  phone: '4-4571234 / 71798765',
  address: 'Av. Heroínas del Coronel esq. Sucre (Parada Punata)',
  city: 'Punata, Cochabamba - Bolivia',
  taxId: 'DEMO — DATOS FICTICIOS / SIN VALIDEZ FISCAL',
  logoUrl: EXPRESO_PUNATA_LOGO_DATA_URL,
}

export const INITIAL_BRANCHES: Branch[] = [
  {
    id: 'punata',
    code: 'PUN',
    name: 'Agencia Central Punata',
    city: 'Punata',
    department: 'Cochabamba',
    address: 'Av. Heroínas del Coronel esq. Sucre (Parada Punata)',
    phone: '4-4571234 / 71798765',
    isActive: true,
  },
  {
    id: 'cochabamba',
    code: 'CBB',
    name: 'Agencia Cochabamba',
    city: 'Cochabamba',
    department: 'Cochabamba',
    address: 'Av. Ayacucho esq. Heroínas #340',
    phone: '4-4256789 / 72234567',
    isActive: true,
  },
]

// TARIFAS REFERENCIALES DE DESARROLLO (NO OFICIALES NI CONFIRMADAS POR EXPRESO PUNATA)
export const EXPRESO_PUNATA_TARIFFS = {
  isDevReference: true,
  notice: 'Valores referenciales de desarrollo — Sujeto a tarifario oficial de Expreso Punata',
  baseFeeBob: 15,
  baseFeeCents: 1500,
  freeWeightKg: 3,
  extraKgRateBob: 2,
  extraKgRateCents: 200,
  homeDeliveryFeeBob: 12,
  homeDeliveryFeeCents: 1200,
}

export const EXPRESO_PUNATA_THEME = {
  primary: '#064e3b',
  primaryHover: '#065f46',
  accent: '#facc15',
  accentHover: '#ca8a04',
  darkGreen: '#064e3b',
  slateDark: '#0f172a',
  white: '#ffffff',
}
