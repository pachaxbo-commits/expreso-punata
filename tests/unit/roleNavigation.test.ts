import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canAccessUnionManagement } from '../../src/app/navigation.ts'

describe('navegación de administración de afiliados', () => {
  it('expone el padrón a afiliado_admin además de los roles operativos autorizados', () => {
    assert.equal(canAccessUnionManagement('afiliado_admin'), true)
    assert.equal(canAccessUnionManagement('directiva_admin'), true)
    assert.equal(canAccessUnionManagement('tesoreria'), true)
    assert.equal(canAccessUnionManagement('secretaria'), true)
  })

  it('no expone administración de afiliados a conductor ni afiliado', () => {
    assert.equal(canAccessUnionManagement('conductor'), false)
    assert.equal(canAccessUnionManagement('afiliado'), false)
  })
})
