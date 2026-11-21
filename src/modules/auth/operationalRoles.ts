import type { UserProfile } from '../../types'

type AuthorizationProfile = Pick<UserProfile, 'role' | 'primaryBranchId' | 'allowedBranchIds'>

export function isOperationalAdmin(profile: AuthorizationProfile | null | undefined): boolean {
  return profile?.role === 'directiva_admin' || (
    profile?.role === 'afiliado_admin' &&
    ['punata', 'cochabamba'].includes(profile.primaryBranchId) &&
    Array.isArray(profile.allowedBranchIds) &&
    ['punata', 'cochabamba'].every(branchId => profile.allowedBranchIds.includes(branchId))
  )
}

export function hasOperationalRole(profile: AuthorizationProfile, roles: readonly string[]): boolean {
  return roles.includes(profile.role) || (roles.includes('directiva_admin') && isOperationalAdmin(profile))
}
