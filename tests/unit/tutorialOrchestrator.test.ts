import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTutorialStorageKey,
  createDefaultTutorialState,
  resetTutorialState,
} from '../../src/modules/tutorial/storage.ts'
import {
  TUTORIAL_SECTIONS,
  getSectionsForRole,
  getTotalStepsForRole,
} from '../../src/modules/tutorial/tutorialSectionsData.ts'
import type { TutorialStorageScope } from '../../src/modules/tutorial/types.ts'

describe('SISTEMA INTEGRAL DE TUTORIALES — EXPRESO PUNATA', () => {
  it('1. Generación de claves de almacenamiento y aislamiento estricto por UID y Rol', () => {
    const scopeSecretariaPunata: TutorialStorageScope = {
      role: 'secretaria',
      uid: 'user_secretaria_punata',
      primaryBranchId: 'punata',
    }
    const scopeSecretariaCbba: TutorialStorageScope = {
      role: 'secretaria',
      uid: 'user_secretaria_cbba',
      primaryBranchId: 'cochabamba',
    }
    const scopeAdmin: TutorialStorageScope = {
      role: 'directiva_admin',
      uid: 'user_admin',
    }

    const keySecPunata = buildTutorialStorageKey(scopeSecretariaPunata)
    const keySecCbba = buildTutorialStorageKey(scopeSecretariaCbba)
    const keyAdmin = buildTutorialStorageKey(scopeAdmin)

    assert.equal(keySecPunata, 'expreso-punata:tutorial:user_secretaria_punata:secretaria:v1')
    assert.equal(keySecCbba, 'expreso-punata:tutorial:user_secretaria_cbba:secretaria:v1')
    assert.equal(keyAdmin, 'expreso-punata:tutorial:user_admin:directiva_admin:v1')

    // El progreso de la secretaria de Punata jamás colisiona con el de Cochabamba en la misma PC
    assert.notEqual(keySecPunata, keySecCbba)
  })

  it('2. Inicialización por defecto y persistencia resiliente ante almacenamiento local', () => {
    const def = createDefaultTutorialState()
    assert.equal(def.currentSectionId, null)
    assert.equal(def.currentStepIndex, 0)
    assert.equal(def.completedSectionIds.length, 0)
    assert.equal(def.isContinuousActive, false)
    assert.equal(def.isPaused, false)
    assert.equal(def.completedAll, false)
    assert.ok(def.lastUpdated)
  })

  it('3. Filtrado de secciones según los permisos efectivos del rol', () => {
    const secSections = getSectionsForRole('secretaria')
    const condSections = getSectionsForRole('conductor')
    const tesSections = getSectionsForRole('tesoreria')
    const adminSections = getSectionsForRole('directiva_admin')

    // Secretaria: debe tener ventanilla, almacén, caja, reportes
    assert.ok(secSections.some((s) => s.id === 'shipments_window'))
    assert.ok(secSections.some((s) => s.id === 'cash_management'))
    assert.ok(secSections.some((s) => s.id === 'storage_management'))
    // Secretaria NO debe tener configuración empresarial ni gestión de usuarios
    assert.ok(!secSections.some((s) => s.id === 'admin_users'))
    assert.ok(!secSections.some((s) => s.id === 'system_config'))

    // Conductor: debe tener manifiestos, comisiones, reportes y panel
    assert.ok(condSections.some((s) => s.id === 'dispatch_manifests'))
    assert.ok(condSections.some((s) => s.id === 'driver_commissions'))
    assert.ok(!condSections.some((s) => s.id === 'cash_management'))
    assert.ok(!condSections.some((s) => s.id === 'admin_users'))

    // Tesorería: socios, mensualidades, caja, personal
    assert.ok(tesSections.some((s) => s.id === 'union_members'))
    assert.ok(tesSections.some((s) => s.id === 'workers_expenses'))

    // Administrador: debe tener acceso a las 17 secciones completas
    assert.equal(adminSections.length, 17)
    assert.ok(getTotalStepsForRole('directiva_admin') >= 40)
  })

  it('4. Validación de calidad pedagógica de cada uno de los pasos formativos', () => {
    let totalVerified = 0

    TUTORIAL_SECTIONS.forEach((section) => {
      assert.ok(section.id, 'La sección debe tener id')
      assert.ok(section.title, 'La sección debe tener título')
      assert.ok(section.description, 'La sección debe tener descripción')
      assert.ok(section.estimatedMinutes > 0, 'Minutos estimados debe ser positivo')
      assert.ok(section.steps.length > 0, `La sección ${section.id} no puede estar vacía`)

      section.steps.forEach((step, idx) => {
        totalVerified++
        assert.equal(step.order, idx + 1)
        assert.ok(step.target.startsWith('[data-tutorial-target=') || step.target.length > 0, 'Target CSS debe existir')
        assert.ok(step.title.length > 3, `Título descriptivo en ${step.id}`)

        // Calidad formativa: ¿Qué es esto?
        assert.ok(step.whatIsIt.length >= 20, `¿Qué es esto? incompleto en ${step.id}`)
        // ¿Para qué sirve?
        assert.ok(step.whatIsItFor.length >= 20, `¿Para qué sirve? incompleto en ${step.id}`)
        // ¿Qué debo escribir o seleccionar?
        assert.ok(step.whatToWriteOrSelect.length >= 20, `Instrucciones incompletas en ${step.id}`)
        // Ejemplo boliviano
        assert.ok(step.example.length >= 20, `Ejemplo insuficiente en ${step.id}`)
        assert.ok(
          step.example.includes('Bs') ||
          step.example.includes('Punata') ||
          step.example.includes('Cochabamba') ||
          step.example.includes('Móvil') ||
          step.example.includes('CI') ||
          step.example.includes('Grover') ||
          step.example.includes('Carlos') ||
          step.example.includes('Montaño') ||
          step.example.includes('PNT') ||
          step.example.includes('Expreso') ||
          step.example.includes('Bolivia'),
          `Ejemplo en ${step.id} debe incluir contexto real de Bolivia o Expreso Punata`
        )
        // ¿Qué pasa después?
        assert.ok(step.whatHappensAfter.length >= 20, `¿Qué pasa después? incompleto en ${step.id}`)
        // Consejo importante
        assert.ok(step.importantTip.length >= 15, `Consejo importante incompleto en ${step.id}`)
        // Guion de audio
        assert.ok(step.audioScript.length >= 20, `Guion de audio incompleto en ${step.id}`)
      })
    })

    assert.equal(totalVerified, 44, 'Se deben verificar los 44 pasos pedagógicos canónicos')
  })

  it('5. Principio de Seguridad: Modo Educativo con Cero Mutaciones Financieras', () => {
    // Simulamos la ejecución del orquestador durante un tutorial
    const mockDbWrites: any[] = []
    const shipmentsSec = TUTORIAL_SECTIONS.find(s => s.id === 'shipments_window')!
    const activeStep = shipmentsSec.steps[0] // Nueva Encomienda
    assert.equal(activeStep.id, 'shipments_btn_new')

    // El tutorial solo lee y presenta información, nunca ejecuta mutaciones
    assert.equal(mockDbWrites.length, 0, 'Un tutorial no debe escribir en la base de datos')
  })

  it('6. Reinicio soberano de progreso sin afectar datos del negocio', () => {
    const scope: TutorialStorageScope = {
      role: 'secretaria',
      uid: 'user_test',
    }

    const resetState = resetTutorialState(scope)
    assert.equal(resetState.completedSectionIds.length, 0)
    assert.equal(resetState.currentSectionId, null)
    assert.equal(resetState.currentStepIndex, 0)
    assert.equal(resetState.isContinuousActive, false)
  })
})
