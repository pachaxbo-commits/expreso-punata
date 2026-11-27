import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUserProfile } from '../../src/modules/auth/profileValidation.ts'

const identity = { uid: 'qa-user', displayName: null, email: 'qa@example.test' }

test('normaliza un perfil sin nombre usando una alternativa visual', () => {
  const profile = parseUserProfile({ role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true }, identity)
  assert.equal(profile?.fullName, 'qa')
})

test('acepta el perfil técnico de soporte para su pantalla aislada', () => {
  const profile = parseUserProfile({ role: 'soporte_pachax', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true }, identity)
  assert.equal(profile?.role, 'soporte_pachax')
})

test('rechaza perfiles sin datos indispensables de autorización', () => {
  assert.equal(parseUserProfile({ fullName: 'Sin rol', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true }, identity), null)
  assert.equal(parseUserProfile({ fullName: 'Sin sucursal', role: 'secretaria', allowedBranchIds: ['punata'], isActive: true }, identity), null)
  assert.equal(parseUserProfile({ fullName: 'Sucursal no autorizada', role: 'secretaria', primaryBranchId: 'punata', allowedBranchIds: ['cochabamba'], isActive: true }, identity), null)
})
