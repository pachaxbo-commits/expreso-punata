import type { UserRole } from '../types'

/** Roles autorizados para administrar el padrón y sus obligaciones. */
export function canAccessUnionManagement(role: UserRole): boolean {
  return ['secretaria', 'tesoreria', 'directiva_admin', 'afiliado_admin'].includes(role)
}
