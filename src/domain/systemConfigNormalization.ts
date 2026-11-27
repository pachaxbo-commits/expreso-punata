import type { SystemConfig } from '../types/index.ts'

export function normalizeSystemConfig(config: SystemConfig): SystemConfig {
  const tariffs = config.tariffs || {} as SystemConfig['tariffs']
  const baseFeeCents = Number(tariffs.baseFeeCents) || 0
  const extraKgRateCents = Number(tariffs.extraKgRateCents) || 0
  const homeDeliveryFeeCents = Number(tariffs.homeDeliveryFeeCents) || 0
  return {
    ...config,
    tariffs: {
      ...tariffs,
      baseFeeCents,
      baseFeeBob: Number.isFinite(Number(tariffs.baseFeeBob)) && Number(tariffs.baseFeeBob) > 0 ? Number(tariffs.baseFeeBob) : baseFeeCents / 100,
      extraKgRateCents,
      extraKgRateBob: Number.isFinite(Number(tariffs.extraKgRateBob)) ? Number(tariffs.extraKgRateBob) : extraKgRateCents / 100,
      homeDeliveryFeeCents,
      homeDeliveryFeeBob: Number.isFinite(Number(tariffs.homeDeliveryFeeBob)) ? Number(tariffs.homeDeliveryFeeBob) : homeDeliveryFeeCents / 100,
    },
  }
}
