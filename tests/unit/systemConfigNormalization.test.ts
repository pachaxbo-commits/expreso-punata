import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSystemConfig } from '../../src/domain/systemConfigNormalization.ts'

test('normaliza tarifas en centavos a campos monetarios usados por la administración', () => {
  const normalized = normalizeSystemConfig({
    id: 'expreso_punata',
    company: {},
    branches: {},
    tariffs: { baseFeeCents: 1500, extraKgRateCents: 250, homeDeliveryFeeCents: 1200 },
    commissions: { defaultType: 'percentage', defaultValue: 10 },
    dues: {},
    printing: {},
    status: 'configured',
    isOfficial: true,
  } as any)
  assert.equal(normalized.tariffs.baseFeeBob, 15)
  assert.equal(normalized.tariffs.extraKgRateBob, 2.5)
  assert.equal(normalized.tariffs.homeDeliveryFeeBob, 12)
})
