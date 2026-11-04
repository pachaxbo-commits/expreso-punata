import type { UserRole } from '../../types'

export type DemoRoleId = 'admin' | 'secretaria_punata' | 'secretaria_cochabamba' | 'encargado' | 'conductor'

export interface DemoRoleProfile {
  id: DemoRoleId
  title: string
  role: UserRole
  fullName: string
  branchId: string
  branchName: string
  allowedBranches: string[]
  assignedVehicle?: string
  description: string
  badgeColor: string
}

export const DEMO_PROFILES: Record<DemoRoleId, DemoRoleProfile> = {
  admin: {
    id: 'admin',
    title: 'Administrador General',
    role: 'directiva_admin',
    fullName: 'Nelson Claros (Directiva)',
    branchId: 'punata',
    branchName: 'Agencia Central Punata',
    allowedBranches: ['punata', 'cochabamba'],
    description: 'Acceso total a ambas sucursales, finanzas, comisiones, personal, tarifas y reportes ejecutivos.',
    badgeColor: 'bg-purple-100 text-purple-900 border-purple-200',
  },
  secretaria_punata: {
    id: 'secretaria_punata',
    title: 'Secretaria Punata',
    role: 'secretaria',
    fullName: 'Rosmery Flores Morales',
    branchId: 'punata',
    branchName: 'Agencia Central Punata',
    allowedBranches: ['punata'],
    description: 'Ventanilla de Punata: registro 50/50, cobros al contado, apertura de caja del turno y guías.',
    badgeColor: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  secretaria_cochabamba: {
    id: 'secretaria_cochabamba',
    title: 'Secretaria Cochabamba',
    role: 'secretaria',
    fullName: 'Elena Quispe Rodríguez',
    branchId: 'cochabamba',
    branchName: 'Agencia Cochabamba',
    allowedBranches: ['cochabamba'],
    description: 'Ventanilla de Cochabamba: recepción de encomiendas llegadas, cobro por cobrar (COD) y entrega con firma.',
    badgeColor: 'bg-blue-100 text-blue-900 border-blue-200',
  },
  encargado: {
    id: 'encargado',
    title: 'Encargado de Agencia',
    role: 'encargado_agencia',
    fullName: 'Roberto Vargas Siles',
    branchId: 'punata',
    branchName: 'Agencia Central Punata',
    allowedBranches: ['punata'],
    description: 'Supervisión operativa, estantes de almacén, despachos a ruta, insumos y aportes de socios.',
    badgeColor: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  conductor: {
    id: 'conductor',
    title: 'Conductor de Bus (Móvil 14)',
    role: 'conductor',
    fullName: 'Marcelino Soto Fuentes',
    branchId: 'punata',
    branchName: 'Ruta Interprovincial Punata - Cbba',
    allowedBranches: ['punata', 'cochabamba'],
    assignedVehicle: 'Móvil 14 (Placa 2831-PNT)',
    description: 'Planillas de despacho de carga, transporte en carretera, custodia COD y liquidación de comisiones.',
    badgeColor: 'bg-yellow-100 text-yellow-900 border-yellow-300',
  },
}
