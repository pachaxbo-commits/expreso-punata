import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  manageWorker,
  registerWorkerPayment,
  registerGeneralExpense,
  manageFixedAsset,
  openCashShift,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST ||= 'http://127.0.0.1:9199'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-workers-test' })
}

const db = getFirestore()

async function clearCollections() {
  const collections = [
    'users',
    'union_workers',
    'union_worker_payments',
    'union_expenses',
    'fixed_assets',
    'audit_logs',
    'idempotency_keys',
    'cash_shifts',
    'cash_shift_active_locks',
    'financial_movements',
    'counters',
  ]
  for (const coll of collections) {
    const snap = await db.collection(coll).get()
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}

async function createTestUser(uid, role, primaryBranchId = 'punata') {
  await db.collection('users').doc(uid).set({
    uid,
    role,
    primaryBranchId,
    allowedBranchIds: ['punata', 'cochabamba'],
    fullName: `Usuario Test ${role}`,
    isActive: true,
    email: `${uid}@expresopunata.com`,
  })
}

before(async () => {
  await clearCollections()
})

beforeEach(async () => {
  await clearCollections()
})

test('1. manageWorker: Creación exitosa de trabajador con código autogenerado y auditoría', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const res = await manageWorker.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      fullName: 'Carlos Torrico Vallejos',
      ci: '4532189-CB',
      phone: '71712345',
      role: 'estibador',
      branchId: 'punata',
      salaryType: 'monthly',
      baseSalaryBob: 2600,
    },
  })

  assert.equal(res.success, true)
  assert.equal(res.worker.workerCode, 'TRA-001')
  assert.equal(res.worker.baseSalaryCents, 260000)
  assert.equal(res.worker.baseSalaryBob, 2600)
  assert.equal(res.worker.branchId, 'punata')

  const snap = await db.collection('union_workers').doc(res.worker.id).get()
  assert.equal(snap.exists, true)
  assert.equal(snap.data().fullName, 'Carlos Torrico Vallejos')
})

test('2. manageWorker: Denegación estricta para usuarios sin rol directiva o tesorería', async () => {
  await createTestUser('sec-1', 'secretaria')

  await assert.rejects(
    async () => {
      await manageWorker.run({
        auth: { uid: 'sec-1' },
        data: {
          action: 'create',
          fullName: 'Juan Pérez',
          ci: '1234567',
        },
      })
    },
    {
      code: 'permission-denied',
    }
  )
})

test('3. manageWorker: Actualización de datos y cambio de estado de trabajador', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const created = await manageWorker.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      fullName: 'Elena Rodríguez',
      ci: '5678912-CB',
      role: 'secretaria',
      branchId: 'cochabamba',
      baseSalaryBob: 2800,
    },
  })

  const updateRes = await manageWorker.run({
    auth: { uid: 'admin-1' },
    data: {
      id: created.worker.id,
      action: 'update',
      baseSalaryBob: 3000,
      status: 'suspended',
      notes: 'Permiso temporal solicitado',
    },
  })

  assert.equal(updateRes.success, true)
  const snap = await db.collection('union_workers').doc(created.worker.id).get()
  assert.equal(snap.data().baseSalaryCents, 300000)
  assert.equal(snap.data().status, 'suspended')
  assert.equal(snap.data().notes, 'Permiso temporal solicitado')
})

test('4. registerWorkerPayment: Pago de nómina en efectivo con descuento transaccional de caja', async () => {
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  // Abrir turno de caja en Punata con saldo inicial de Bs 5,000 (500000 cents)
  const shiftRes = await openCashShift.run({
    auth: { uid: 'admin-1' },
    data: {
      branchId: 'punata',
      initialCashCents: 500000,
      declaredCashBob: 5000,
    },
  })

  // Crear trabajador
  const workerRes = await manageWorker.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      fullName: 'Don Walter Céspedes',
      ci: '332211-CB',
      role: 'chofer_relevo',
      baseSalaryBob: 2500,
    },
  })

  // Pagar anticipo de Bs 1,000 (100000 cents) en efectivo vinculado a la caja
  const payRes = await registerWorkerPayment.run({
    auth: { uid: 'admin-1' },
    data: {
      workerId: workerRes.worker.id,
      amountBob: 1000,
      amountCents: 100000,
      concept: 'Anticipo quincenal de sueldo',
      period: '2026-11',
      paymentMethod: 'cash',
      shiftId: shiftRes.shift.id,
      branchId: 'punata',
      idempotencyKey: 'idemp-worker-pay-01',
    },
  })

  assert.equal(payRes.success, true)
  assert.ok(payRes.receiptNumber.startsWith('REC-TRA-'))
  assert.equal(payRes.amountCents, 100000)

  // Verificar turno de caja actualizado: expectedCashCents debe ser 400000
  const shiftSnap = await db.collection('cash_shifts').doc(shiftRes.shift.id).get()
  assert.equal(shiftSnap.data().expectedCashCents, 400000)
  assert.equal(shiftSnap.data().breakdown.expensesCents, 100000)
  assert.equal(shiftSnap.data().breakdown.workerPayrollExpenseCents, 100000)

  // Verificar movimiento financiero inmutable
  const movSnap = await db.collection('financial_movements')
    .where('type', '==', 'worker_payroll')
    .limit(1)
    .get()
  assert.equal(movSnap.empty, false)
  const mov = movSnap.docs[0].data()
  assert.equal(mov.amountCents, 100000)
  assert.equal(mov.direction, 'out')
  assert.equal(mov.referenceId, payRes.paymentId)
})

test('5. registerWorkerPayment: Idempotencia estricta contra doble pago o reintento de red', async () => {
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  const workerRes = await manageWorker.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      fullName: 'Ramiro Gutiérrez',
      ci: '998877-CB',
      role: 'seguridad',
      baseSalaryBob: 2000,
    },
  })

  const payload = {
    workerId: workerRes.worker.id,
    amountBob: 2000,
    amountCents: 200000,
    concept: 'Pago completo de salario',
    paymentMethod: 'transfer',
    branchId: 'punata',
    idempotencyKey: 'test-idemp-duplicate-key',
  }

  const res1 = await registerWorkerPayment.run({ auth: { uid: 'admin-1' }, data: payload })
  const res2 = await registerWorkerPayment.run({ auth: { uid: 'admin-1' }, data: payload })

  assert.equal(res1.paymentId, res2.paymentId)
  assert.equal(res1.receiptNumber, res2.receiptNumber)

  // Solo debe existir un pago registrado en la colección
  const paySnap = await db.collection('union_worker_payments').where('workerId', '==', workerRes.worker.id).get()
  assert.equal(paySnap.docs.length, 1)
})

test('6. registerGeneralExpense: Registro de gasto operativo con comprobante EGR-YYYY-XXXXX', async () => {
  await createTestUser('admin-1', 'directiva_admin', 'cochabamba')

  const shiftRes = await openCashShift.run({
    auth: { uid: 'admin-1' },
    data: {
      branchId: 'cochabamba',
      initialCashCents: 100000,
      declaredCashBob: 1000,
    },
  })

  const expenseRes = await registerGeneralExpense.run({
    auth: { uid: 'admin-1' },
    data: {
      category: 'servicios_basicos',
      branchId: 'cochabamba',
      concept: 'Factura de luz eléctrica oficina Cochabamba',
      amountBob: 180,
      amountCents: 18000,
      supplier: 'ENDE de Cochabamba',
      invoiceOrReceiptNumber: 'FAC-123456',
      paymentMethod: 'cash',
      shiftId: shiftRes.shift.id,
      idempotencyKey: 'idemp-exp-01',
    },
  })

  assert.equal(expenseRes.success, true)
  assert.ok(expenseRes.voucherNumber.startsWith('EGR-'))
  assert.equal(expenseRes.amountCents, 18000)

  // Turno de caja actualizado
  const shiftSnap = await db.collection('cash_shifts').doc(shiftRes.shift.id).get()
  assert.equal(shiftSnap.data().expectedCashCents, 82000)

  // Documento en union_expenses
  const expSnap = await db.collection('union_expenses').doc(expenseRes.expenseId).get()
  assert.equal(expSnap.exists, true)
  assert.equal(expSnap.data().supplier, 'ENDE de Cochabamba')
})

test('7. manageFixedAsset: Registro de activo con código autogenerado ACT-PUN-0001 y auditoría', async () => {
  await createTestUser('manager-1', 'encargado_agencia', 'punata')

  const res = await manageFixedAsset.run({
    auth: { uid: 'manager-1' },
    data: {
      action: 'create',
      name: 'Impresora Térmica Xprinter 80mm',
      category: 'computacion',
      description: 'Impresora USB de recepción',
      branchId: 'punata',
      physicalLocation: 'Ventanilla 1 - Punata',
      responsiblePersonName: 'María Rodríguez',
      acquisitionDate: '2026-03-15',
      acquisitionCostBob: 650,
      acquisitionCostCents: 65000,
    },
  })

  assert.equal(res.success, true)
  assert.equal(res.asset.assetCode, 'ACT-PUN-0001')
  assert.equal(res.asset.barcodeQr, 'ACT-PUN-0001')
  assert.equal(res.asset.acquisitionCostCents, 65000)

  // Subcolección audit_logs debe registrar la creación
  const auditSnap = await db.collection('fixed_assets').doc(res.asset.id).collection('audit_logs').get()
  assert.equal(auditSnap.empty, false)
  assert.equal(auditSnap.docs[0].data().action, 'created')
})

test('8. manageFixedAsset: Transferencia de activo a Cochabamba registra trazabilidad', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const created = await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      name: 'Balanza Electrónica de Plataforma 300kg',
      category: 'balanzas_pesaje',
      branchId: 'punata',
      physicalLocation: 'Área de pesaje Punata',
      responsiblePersonName: 'Carlos Torrico',
    },
  })

  // Transferir a Cochabamba
  const transferRes = await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      id: created.asset.id,
      action: 'transfer',
      branchId: 'cochabamba',
      physicalLocation: 'Almacén Central Cochabamba',
      responsiblePersonName: 'Elena Morales',
    },
  })

  assert.equal(transferRes.success, true)

  const updatedSnap = await db.collection('fixed_assets').doc(created.asset.id).get()
  assert.equal(updatedSnap.data().branchId, 'cochabamba')
  assert.equal(updatedSnap.data().physicalLocation, 'Almacén Central Cochabamba')
  assert.equal(updatedSnap.data().responsiblePersonName, 'Elena Morales')

  const logsSnap = await db.collection('fixed_assets').doc(created.asset.id).collection('audit_logs')
    .where('action', '==', 'transfer')
    .get()
  assert.equal(logsSnap.empty, false)
  assert.equal(logsSnap.docs[0].data().newLocation, 'Almacén Central Cochabamba')
})

test('9. manageFixedAsset: Baja justificada de activo fija estado disposed y motivo inmutable', async () => {
  await createTestUser('admin-1', 'directiva_admin')

  const created = await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      name: 'Monitor CRT Antiguo 15 pulgadas',
      category: 'computacion',
      branchId: 'punata',
      physicalLocation: 'Depósito viejo',
      responsiblePersonName: 'Nelson Admin',
    },
  })

  const disposeRes = await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      id: created.asset.id,
      action: 'dispose',
      disposedReason: 'Obsolescencia tecnológica irreparable con tubo fundido',
    },
  })

  assert.equal(disposeRes.success, true)

  const disposedSnap = await db.collection('fixed_assets').doc(created.asset.id).get()
  assert.equal(disposedSnap.data().status, 'disposed')
  assert.equal(disposedSnap.data().disposedReason, 'Obsolescencia tecnológica irreparable con tubo fundido')

  const logsSnap = await db.collection('fixed_assets').doc(created.asset.id).collection('audit_logs')
    .where('action', '==', 'disposed')
    .get()
  assert.equal(logsSnap.empty, false)
})

test('10. registerWorkerPayment: Rechaza pago si saldo en caja es insuficiente o reintenta con fingerprint alterado', async () => {
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  // Abrir turno con solo Bs 50 (5000 cents)
  const shiftRes = await openCashShift.run({
    auth: { uid: 'admin-1' },
    data: { branchId: 'punata', initialCashCents: 5000, declaredCashBob: 50 },
  })

  const workerRes = await manageWorker.run({
    auth: { uid: 'admin-1' },
    data: { action: 'create', fullName: 'Estibador Prueba', ci: '112233', role: 'estibador', baseSalaryBob: 2000 },
  })

  // Intento de pagar Bs 100 teniendo solo Bs 50 en caja -> RECHAZADO
  await assert.rejects(async () => {
    await registerWorkerPayment.run({
      auth: { uid: 'admin-1' },
      data: {
        workerId: workerRes.worker.id,
        amountBob: 100,
        amountCents: 10000,
        concept: 'Pago imposible por fondos',
        paymentMethod: 'cash',
        shiftId: shiftRes.shift.id,
        idempotencyKey: 'idemp-insufficient-01',
      },
    })
  }, (err) => err.code === 'failed-precondition')

  // Pago de Bs 20 (2000 cents) válido
  const validPay = await registerWorkerPayment.run({
    auth: { uid: 'admin-1' },
    data: {
      workerId: workerRes.worker.id,
      amountBob: 20,
      amountCents: 2000,
      concept: 'Pago parcial válido',
      paymentMethod: 'cash',
      shiftId: shiftRes.shift.id,
      idempotencyKey: 'idemp-valid-pay-01',
    },
  })
  assert.equal(validPay.success, true)

  // Reintento con la misma clave pero monto distinto -> RECHAZADO por fingerprint
  await assert.rejects(async () => {
    await registerWorkerPayment.run({
      auth: { uid: 'admin-1' },
      data: {
        workerId: workerRes.worker.id,
        amountBob: 10,
        amountCents: 1000,
        concept: 'Pago parcial válido',
        paymentMethod: 'cash',
        shiftId: shiftRes.shift.id,
        idempotencyKey: 'idemp-valid-pay-01',
      },
    })
  }, (err) => err.code === 'already-exists')
})

test('11. registerGeneralExpense: Control de saldo de caja y límite de Bs 150 para secretarias', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  // Abrir turno con Bs 300 (30000 cents)
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-punata' },
    data: { branchId: 'punata', initialCashCents: 30000, declaredCashBob: 300 },
  })

  // Secretaria intenta registrar gasto de Bs 200 (> Bs 150) -> RECHAZADO
  await assert.rejects(async () => {
    await registerGeneralExpense.run({
      auth: { uid: 'sec-punata' },
      data: {
        category: 'material_escritorio',
        concept: 'Compra grande de insumos',
        amountBob: 200,
        amountCents: 20000,
        paymentMethod: 'cash',
        shiftId: shiftRes.shift.id,
        idempotencyKey: 'idemp-sec-limit-01',
      },
    })
  }, (err) => err.code === 'permission-denied')

  // Intento de gasto que supera saldo en caja -> RECHAZADO
  await assert.rejects(async () => {
    await registerGeneralExpense.run({
      auth: { uid: 'admin-1' },
      data: {
        category: 'mantenimiento',
        concept: 'Arreglo de motor',
        amountBob: 500,
        amountCents: 50000,
        paymentMethod: 'cash',
        shiftId: shiftRes.shift.id,
        idempotencyKey: 'idemp-admin-exceed-01',
      },
    })
  }, (err) => err.code === 'failed-precondition')
})

test('12. manageFixedAsset: Activo dado de baja NO puede modificarse ni reactivarse sin directiva_admin y justificación', async () => {
  await createTestUser('manager-1', 'encargado_agencia', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  const created = await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      action: 'create',
      name: 'Balanza de Descarte',
      category: 'herramientas',
      branchId: 'punata',
      physicalLocation: 'Almacén de descarte',
      responsiblePersonName: 'Carlos Torrico',
    },
  })

  // Dar de baja
  await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      id: created.asset.id,
      action: 'dispose',
      disposedReason: 'Calibración perdida irreparable',
    },
  })

  // Encargado de agencia intenta reactivar -> RECHAZADO
  await assert.rejects(async () => {
    await manageFixedAsset.run({
      auth: { uid: 'manager-1' },
      data: {
        id: created.asset.id,
        action: 'changeStatus',
        status: 'available',
      },
    })
  }, (err) => err.code === 'permission-denied')

  // Admin intenta reactivar sin justificación detallada -> RECHAZADO
  await assert.rejects(async () => {
    await manageFixedAsset.run({
      auth: { uid: 'admin-1' },
      data: {
        id: created.asset.id,
        action: 'changeStatus',
        status: 'available',
        justification: 'ok',
      },
    })
  }, (err) => err.code === 'invalid-argument')

  // Admin reactiva con justificación detallada obligatoria -> ÉXITO
  const reactivateRes = await manageFixedAsset.run({
    auth: { uid: 'admin-1' },
    data: {
      id: created.asset.id,
      action: 'changeStatus',
      status: 'available',
      justification: 'Reparación autorizada por servicio técnico especializado con certificado de calibración',
    },
  })
  assert.equal(reactivateRes.success, true)
})
