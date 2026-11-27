import type { UserProfile, UserRole } from '../../types'

const VALID_ROLES: UserRole[] = ['soporte_pachax', 'secretaria', 'afiliado_admin', 'afiliado', 'encargado_agencia', 'tesoreria', 'directiva_admin', 'conductor']
const VALID_BRANCHES = ['punata', 'cochabamba']

export interface AuthIdentity {
  uid: string
  displayName?: string | null
  email?: string | null
}

/** Normaliza datos visibles, pero nunca inventa datos necesarios para RBAC. */
export const parseUserProfile = (data: Record<string, unknown>, user: AuthIdentity): UserProfile | null => {
  const role = data.role
  const primaryBranchId = data.primaryBranchId
  const allowedBranchIds = data.allowedBranchIds
  if (
    typeof role !== 'string' || !VALID_ROLES.includes(role as UserRole) ||
    typeof primaryBranchId !== 'string' || !VALID_BRANCHES.includes(primaryBranchId) ||
    !Array.isArray(allowedBranchIds) ||
    !allowedBranchIds.every((branchId) => typeof branchId === 'string' && VALID_BRANCHES.includes(branchId)) ||
    !allowedBranchIds.includes(primaryBranchId)
  ) return null

  const rawName = typeof data.fullName === 'string' ? data.fullName.trim() : ''
  const fallbackName = user.displayName?.trim() || user.email?.split('@')[0] || 'Operador'
  return {
    ...data,
    uid: user.uid,
    fullName: rawName || fallbackName,
    role: role as UserRole,
    primaryBranchId,
    allowedBranchIds,
    isActive: data.isActive !== false,
  } as UserProfile
}
