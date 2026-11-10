import type { SystemConfigResponse } from '../types/index.ts'

export function resolveOfficialBranchPhone(response: SystemConfigResponse, branchId: string): string | null {
  if (response.status !== 'configured' || response.isOfficial !== true || !response.config?.isOfficial) return null
  const phone = response.config.branches?.[branchId]?.phone?.trim()
  return phone || null
}

export async function fetchOfficialBranchPhone(branchId: string): Promise<string | null> {
  try {
    const { fetchSystemConfig } = await import('./configService.ts')
    return resolveOfficialBranchPhone(await fetchSystemConfig(), branchId)
  } catch {
    return null
  }
}

export async function applyOfficialBranchPhone<T extends { branchId: string; branchPhone?: string }>(document: T, branchId: string): Promise<T> {
  const phone = await fetchOfficialBranchPhone(branchId)
  return { ...document, branchId, branchPhone: phone || 'No configurado' }
}
