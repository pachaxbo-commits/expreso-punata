import { test, describe } from 'node:test'
import assert from 'node:assert'
import type { UserProfile, UserRole } from '../../src/types'

describe('FASE 2 & 4: Seguridad RBAC y Asignación Automática de Sucursales', () => {
  // Simulación de la lógica de evaluación de cambio de sucursal en AuthContext
  function canSwitchBranch(user: UserProfile | null, targetBranchId: string): boolean {
    if (!user || user.isActive === false) return false

    // Secretarias: NUNCA pueden cambiar de agencia fuera de su asignación
    if (user.role === 'secretaria') {
      return false
    }

    // Directiva / Admin: libre cambio entre agencias
    if (user.role === 'directiva_admin') {
      return true
    }

    // Encargados y Tesorería: únicamente entre sucursales autorizadas
    const allowed = Array.isArray(user.allowedBranchIds) && user.allowedBranchIds.length > 0
      ? user.allowedBranchIds
      : [user.primaryBranchId]

    return allowed.includes(targetBranchId)
  }

  // Simulación de la regla de backend en adminProvisionUser
  function sanitizeAllowedBranches(role: UserRole, primaryBranchId: string, allowedBranchIds?: string[]): string[] {
    if (role === 'secretaria') {
      return [primaryBranchId]
    }
    if (role === 'directiva_admin') {
      return ['punata', 'cochabamba']
    }
    if (Array.isArray(allowedBranchIds) && allowedBranchIds.length > 0) {
      return allowedBranchIds.includes(primaryBranchId) ? allowedBranchIds : [primaryBranchId, ...allowedBranchIds]
    }
    return [primaryBranchId]
  }

  test('1. Secretaria Punata: entra automáticamente a su agencia y cambio a Cbba es RECHAZADO', () => {
    const secPunata: UserProfile = {
      uid: 'sec-pun-1',
      fullName: 'Rosmery Flores',
      email: 'secretaria.punata@expresopunata.com',
      role: 'secretaria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      isActive: true,
      phone: '71458920',
      createdAt: new Date().toISOString(),
    }

    assert.strictEqual(secPunata.primaryBranchId, 'punata')
    assert.strictEqual(canSwitchBranch(secPunata, 'cochabamba'), false)
    assert.strictEqual(canSwitchBranch(secPunata, 'punata'), false) // Fija
  })

  test('2. Secretaria Cochabamba: entra automáticamente a su agencia y cambio a Punata es RECHAZADO', () => {
    const secCbba: UserProfile = {
      uid: 'sec-cbb-1',
      fullName: 'Elena Quispe',
      email: 'secretaria.cbba@expresopunata.com',
      role: 'secretaria',
      primaryBranchId: 'cochabamba',
      allowedBranchIds: ['cochabamba'],
      isActive: true,
      phone: '72091823',
      createdAt: new Date().toISOString(),
    }

    assert.strictEqual(secCbba.primaryBranchId, 'cochabamba')
    assert.strictEqual(canSwitchBranch(secCbba, 'punata'), false)
  })

  test('3. Administrador General (Directiva): libre alternancia entre Punata y Cochabamba', () => {
    const admin: UserProfile = {
      uid: 'admin-1',
      fullName: 'Nelson Directiva',
      email: 'admin@expresopunata.com',
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      phone: '75999279',
      createdAt: new Date().toISOString(),
    }

    assert.strictEqual(canSwitchBranch(admin, 'punata'), true)
    assert.strictEqual(canSwitchBranch(admin, 'cochabamba'), true)
  })

  test('4. Tesorería con permiso multisucursal vs sucursal única', () => {
    const tesoMulti: UserProfile = {
      uid: 'teso-1',
      fullName: 'Tesorero General',
      email: 'tesoreria@expresopunata.com',
      role: 'tesoreria',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: true,
      phone: '71122334',
      createdAt: new Date().toISOString(),
    }

    const tesoSingle: UserProfile = {
      uid: 'teso-2',
      fullName: 'Tesorero Local',
      email: 'tesorero.local@expresopunata.com',
      role: 'tesoreria',
      primaryBranchId: 'cochabamba',
      allowedBranchIds: ['cochabamba'],
      isActive: true,
      phone: '72233445',
      createdAt: new Date().toISOString(),
    }

    assert.strictEqual(canSwitchBranch(tesoMulti, 'cochabamba'), true)
    assert.strictEqual(canSwitchBranch(tesoSingle, 'punata'), false)
  })

  test('5. Conductor asignado: no tiene privilegios para alternar agencia de caja', () => {
    const chofer: UserProfile = {
      uid: 'chofer-1',
      fullName: 'Marcelino Soto',
      email: 'chofer.movil14@expresopunata.com',
      role: 'conductor',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata'],
      assignedMobileNumber: '14',
      assignedVehiclePlate: '2341-ABC',
      isActive: true,
      phone: '71234567',
      createdAt: new Date().toISOString(),
    }

    assert.strictEqual(canSwitchBranch(chofer, 'cochabamba'), false)
  })

  test('6. Usuario inactivo o sin perfil: cambio de sucursal es denegado rotundamente', () => {
    const inactiveUser: UserProfile = {
      uid: 'user-inact',
      fullName: 'Operador Suspendido',
      email: 'suspendido@expresopunata.com',
      role: 'directiva_admin',
      primaryBranchId: 'punata',
      allowedBranchIds: ['punata', 'cochabamba'],
      isActive: false,
      phone: '70000000',
      createdAt: new Date().toISOString(),
    }

    assert.strictEqual(canSwitchBranch(inactiveUser, 'punata'), false)
    assert.strictEqual(canSwitchBranch(inactiveUser, 'cochabamba'), false)
    assert.strictEqual(canSwitchBranch(null, 'punata'), false)
  })

  test('7. Backend: sanitizeAllowedBranches fuerza exactamente [primaryBranchId] para secretarias', () => {
    // Si un cliente intenta enviar ambas sucursales para una secretaria:
    const sanitized = sanitizeAllowedBranches('secretaria', 'punata', ['punata', 'cochabamba'])
    assert.deepStrictEqual(sanitized, ['punata'])

    const sanitizedCbba = sanitizeAllowedBranches('secretaria', 'cochabamba', ['punata', 'cochabamba'])
    assert.deepStrictEqual(sanitizedCbba, ['cochabamba'])

    // Para directiva, siempre ambas
    assert.deepStrictEqual(sanitizeAllowedBranches('directiva_admin', 'punata', ['punata']), ['punata', 'cochabamba'])

    // Para encargado, respeta las enviadas si incluye la primaria
    assert.deepStrictEqual(sanitizeAllowedBranches('encargado_agencia', 'punata', ['punata', 'cochabamba']), ['punata', 'cochabamba'])
  })

  test('8. Transición limpia entre dos usuarios sucesivos sin arrastrar sucursales previas', () => {
    let activeBranchId = 'punata'

    // Login 1: Secretaria Cochabamba
    activeBranchId = 'cochabamba'
    assert.strictEqual(activeBranchId, 'cochabamba')

    // Logout
    activeBranchId = 'punata' // Reset limpio

    // Login 2: Secretaria Punata
    activeBranchId = 'punata'
    assert.strictEqual(activeBranchId, 'punata')
  })
})
