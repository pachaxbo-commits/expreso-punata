import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SystemConfigResponse } from '../../src/types/index.ts'
import { resolveOfficialBranchPhone } from '../../src/services/branchContactService.ts'

const officialConfig = {
  success: true,
  status: 'configured',
  isOfficial: true,
  isDefault: false,
  config: {
    id: 'expreso_punata', isOfficial: true, updatedAtIso: '',
    company: { name: '', tradeName: '', legalName: '', acronym: '', legalNotice: '' },
    branches: {
      punata: { name: 'Agencia Punata', code: 'PUN', city: 'Punata', department: 'Cochabamba', phone: '+591 4 4571234', isActive: true },
      cochabamba: { name: 'Agencia Cochabamba', code: 'CBB', city: 'Cochabamba', department: 'Cochabamba', phone: '', isActive: true },
    },
    tariffs: { baseFeeCents: 0, baseFeeBob: 0, freeWeightKg: 0, extraKgRateCents: 0, extraKgRateBob: 0, homeDeliveryFeeCents: 0, homeDeliveryFeeBob: 0 },
    commissions: { defaultType: 'percentage', defaultValue: 0 },
    dues: { monthlyDueCents: 0, monthlyDueBob: 0, lateFeePercentage: 0, gracePeriodDays: 0 },
    printing: { cutPaper: true, openDrawer: false },
  },
} as SystemConfigResponse

test('Teléfono de guía se resuelve por sucursal desde configuración oficial y no inventa datos ausentes', () => {
  assert.equal(resolveOfficialBranchPhone(officialConfig, 'punata'), '+591 4 4571234')
  assert.equal(resolveOfficialBranchPhone(officialConfig, 'cochabamba'), null)
  assert.equal(resolveOfficialBranchPhone({ ...officialConfig, isOfficial: false }, 'punata'), null)
  assert.equal(resolveOfficialBranchPhone({ ...officialConfig, status: 'unconfigured', config: null }, 'punata'), null)
})
