import test from 'node:test'
import assert from 'node:assert/strict'
import { hasOperationalRole, isOperationalAdmin } from '../../src/modules/auth/operationalRoles.ts'
import type { UserProfile } from '../../src/types/index.ts'

test('affiliate administrators never inherit Directiva permissions from a multi-branch scope', () => {
  const profile: Pick<UserProfile, 'role' | 'primaryBranchId' | 'allowedBranchIds'> = { role: 'afiliado_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata', 'cochabamba'] }
  assert.equal(isOperationalAdmin(profile), false)
  assert.equal(hasOperationalRole(profile, ['directiva_admin']), false)
  assert.equal(hasOperationalRole(profile, ['afiliado_admin']), true)
})

test('only the directiva_admin role receives global operational privileges', () => {
  const profile: Pick<UserProfile, 'role' | 'primaryBranchId' | 'allowedBranchIds'> = { role: 'directiva_admin', primaryBranchId: 'punata', allowedBranchIds: ['punata'] }
  assert.equal(isOperationalAdmin(profile), true)
  assert.equal(hasOperationalRole(profile, ['directiva_admin']), true)
})
