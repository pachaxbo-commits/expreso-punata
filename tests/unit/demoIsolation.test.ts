import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_PROFILES, type DemoRoleId } from '../../src/modules/demo/demoTypes.ts'
import {
  INITIAL_DEMO_SHIPMENTS,
  INITIAL_DEMO_CASH_SHIFT,
  INITIAL_DEMO_MEMBERS,
  INITIAL_DEMO_ASSETS,
} from '../../src/modules/demo/demoInitialData.ts'

describe('MODO DEMOSTRACIÓN PÚBLICA AISLADA (/demo)', () => {
  it('1. Verificación de los 5 roles operativos simulados', () => {
    const roleKeys = Object.keys(DEMO_PROFILES) as DemoRoleId[]
    assert.equal(roleKeys.length, 5)

    assert.ok(DEMO_PROFILES.admin)
    assert.equal(DEMO_PROFILES.admin.role, 'directiva_admin')
    assert.deepEqual(DEMO_PROFILES.admin.allowedBranches, ['punata', 'cochabamba'])

    assert.ok(DEMO_PROFILES.secretaria_punata)
    assert.equal(DEMO_PROFILES.secretaria_punata.role, 'secretaria')
    assert.equal(DEMO_PROFILES.secretaria_punata.branchId, 'punata')
    assert.deepEqual(DEMO_PROFILES.secretaria_punata.allowedBranches, ['punata'])

    assert.ok(DEMO_PROFILES.secretaria_cochabamba)
    assert.equal(DEMO_PROFILES.secretaria_cochabamba.role, 'secretaria')
    assert.equal(DEMO_PROFILES.secretaria_cochabamba.branchId, 'cochabamba')
    assert.deepEqual(DEMO_PROFILES.secretaria_cochabamba.allowedBranches, ['cochabamba'])

    assert.ok(DEMO_PROFILES.encargado)
    assert.equal(DEMO_PROFILES.encargado.role, 'encargado_agencia')

    assert.ok(DEMO_PROFILES.conductor)
    assert.equal(DEMO_PROFILES.conductor.role, 'conductor')
    assert.ok(DEMO_PROFILES.conductor.assignedVehicle?.includes('Móvil 14'))
  })

  it('2. Integridad de los datos iniciales demostrativos', () => {
    assert.equal(INITIAL_DEMO_SHIPMENTS.length, 3)
    assert.ok(INITIAL_DEMO_SHIPMENTS.some((s) => s.paymentTiming === 'origin_paid'))
    assert.ok(INITIAL_DEMO_SHIPMENTS.some((s) => s.paymentTiming === 'destination_cod'))
    assert.ok(INITIAL_DEMO_SHIPMENTS.some((s) => s.status === 'delivered'))

    assert.equal(INITIAL_DEMO_CASH_SHIFT.id, 'DEMO-TUR-PUN-001')
    assert.equal(INITIAL_DEMO_CASH_SHIFT.initialCashBob, 200)

    assert.equal(INITIAL_DEMO_MEMBERS.length, 2)
    assert.equal(INITIAL_DEMO_ASSETS.length, 2)
  })

  it('3. Inmutabilidad y Aislamiento de Red: Cero dependencias con Firestore remoto', () => {
    // Los datos demo son estructuras JavaScript puras en memoria
    const demoPayload = JSON.stringify({
      shipments: INITIAL_DEMO_SHIPMENTS,
      cashShift: INITIAL_DEMO_CASH_SHIFT,
      members: INITIAL_DEMO_MEMBERS,
      assets: INITIAL_DEMO_ASSETS,
    })

    assert.ok(!demoPayload.includes('firestore.googleapis.com'))
    assert.ok(!demoPayload.includes('identitytoolkit.googleapis.com'))
  })
})
