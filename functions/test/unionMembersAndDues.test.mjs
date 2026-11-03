import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  manageUnionMember,
  generateMonthlyDues,
  collectMemberDue,
  getMemberAccountStatement,
  openCashShift,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'

if (getApps().length === 0) {
  initializeApp({ projectId: 'demo-expreso-punata-union-test' })
}

const db = getFirestore()

async function clearCollections() {
  const collections = [
    'users',
    'union_members',
    'union_dues',
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

beforeEach(async () => {
  await clearCollections()
})

test('1. PADRÓN DE SOCIOS: Tesorería registra nuevo socio afiliado con cuota mensual', async () => {
  await createTestUser('tesorero-1', 'tesoreria', 'punata')

  const res = await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: {
      memberNumber: 'SOC-001',
      fullName: 'Mario Torrico Villarroel',
      ci: '3456789',
      phone: '71001122',
      category: 'propietario_transporte',
      vehiclePlate: '4055-XYZ',
      assignedMobileNumber: '12',
      monthlyFeeBob: 50,
      notes: 'Socio fundador',
    },
  })

  assert.equal(res.success, true)
  assert.equal(res.isNew, true)
  assert.equal(res.member.memberNumber, 'SOC-001')
  assert.equal(res.member.monthlyFeeCents, 5000)
  assert.equal(res.member.monthlyFeeBob, 50)

  // Verificar en base de datos
  const doc = await db.collection('union_members').doc(res.member.id).get()
  assert.equal(doc.exists, true)
  assert.equal(doc.data().fullName, 'Mario Torrico Villarroel')
  assert.equal(doc.data().status, 'active')

  // Verificar auditoría
  const auditSnap = await db.collection('audit_logs')
    .where('targetId', '==', res.member.id)
    .get()
  assert.equal(auditSnap.empty, false)
  assert.equal(auditSnap.docs[0].data().action, 'union_member_created')
})

test('2. SEGURIDAD DE PADRÓN: Rol no autorizado (secretaria o conductor) NO puede registrar socios', async () => {
  await createTestUser('sec-1', 'secretaria', 'punata')
  await createTestUser('driver-1', 'conductor', 'punata')

  await assert.rejects(async () => {
    await manageUnionMember.run({
      auth: { uid: 'sec-1' },
      data: {
        memberNumber: 'SOC-002',
        fullName: 'Intento Ilegal Secretaria',
      },
    })
  }, (err) => err.code === 'permission-denied')

  await assert.rejects(async () => {
    await manageUnionMember.run({
      auth: { uid: 'driver-1' },
      data: {
        memberNumber: 'SOC-003',
        fullName: 'Intento Ilegal Chofer',
      },
    })
  }, (err) => err.code === 'permission-denied')
})

test('3. PADRÓN DE SOCIOS: Previene duplicados de memberNumber entre distintos socios', async () => {
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  await manageUnionMember.run({
    auth: { uid: 'admin-1' },
    data: {
      id: 'member-001',
      memberNumber: 'SOC-010',
      fullName: 'Socio Original',
      monthlyFeeBob: 40,
    },
  })

  // Intento de registrar a otro socio con el mismo número
  await assert.rejects(async () => {
    await manageUnionMember.run({
      auth: { uid: 'admin-1' },
      data: {
        id: 'member-002',
        memberNumber: 'SOC-010',
        fullName: 'Socio Usurpador',
        monthlyFeeBob: 40,
      },
    })
  }, (err) => err.code === 'already-exists')
})

test('4. EMISIÓN DE CUOTAS MENSUALES: Generación atómica e idempotente para socios activos', async () => {
  await createTestUser('tesorero-1', 'tesoreria', 'punata')

  // Crear 2 socios activos y 1 inactivo
  await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: { id: 'm-1', memberNumber: 'SOC-001', fullName: 'Socio Uno', monthlyFeeBob: 50, status: 'active' },
  })
  await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: { id: 'm-2', memberNumber: 'SOC-002', fullName: 'Socio Dos', monthlyFeeBob: 60, status: 'active' },
  })
  await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: { id: 'm-3', memberNumber: 'SOC-003', fullName: 'Socio Inactivo', monthlyFeeBob: 50, status: 'inactive' },
  })

  // 1ra emisión del período 2026-11
  const genRes1 = await generateMonthlyDues.run({
    auth: { uid: 'tesorero-1' },
    data: { period: '2026-11' },
  })

  assert.equal(genRes1.success, true)
  assert.equal(genRes1.generatedCount, 2)
  assert.equal(genRes1.skippedCount, 0)
  assert.equal(genRes1.totalAmountCents, 11000) // 5000 + 6000

  // 2da emisión del mismo período -> Idempotente: omite las 2 ya generadas
  const genRes2 = await generateMonthlyDues.run({
    auth: { uid: 'tesorero-1' },
    data: { period: '2026-11' },
  })

  assert.equal(genRes2.generatedCount, 0)
  assert.equal(genRes2.skippedCount, 2)
})

test('5. RECAUDACIÓN DE CUOTA EN CAJA: Cobro en ventanilla ingresa a turno activo de caja y genera recibo', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  // Crear socio y cuota
  await manageUnionMember.run({
    auth: { uid: 'admin-1' },
    data: { id: 'm-socio', memberNumber: 'SOC-050', fullName: 'Gonzalo Claros', monthlyFeeBob: 50, status: 'active' },
  })
  await generateMonthlyDues.run({
    auth: { uid: 'admin-1' },
    data: { period: '2026-11' },
  })

  // Secretaria abre turno de caja con Bs 100
  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-punata' },
    data: { branchId: 'punata', initialCashCents: 10000, idempotencyKey: 'idemp-shift-pun-union-1' },
  })
  const shiftId = shiftRes.shift.id

  // Cobro parcial de Bs 30.00 en efectivo (3000 cts)
  const dueId = 'm-socio_2026-11'
  const payRes1 = await collectMemberDue.run({
    auth: { uid: 'sec-punata' },
    data: {
      dueId,
      amountCents: 3000,
      paymentMethod: 'cash',
      shiftId,
      idempotencyKey: 'pay-union-key-11111',
      notes: 'Pago a cuenta de mensualidad noviembre',
    },
  })

  assert.equal(payRes1.success, true)
  assert.equal(payRes1.status, 'partial')
  assert.equal(payRes1.amountCents, 3000)
  assert.equal(payRes1.remainingBalanceCents, 2000)
  assert.ok(payRes1.receiptNumber.startsWith('REC-SOC-'))

  // Verificar que el turno de caja subió de Bs 100 a Bs 130
  const shiftDoc = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(shiftDoc.data().expectedCashCents, 13000)
  assert.equal(shiftDoc.data().breakdown.contributionsIncomeCents, 3000)

  // Completar el pago con los restantes Bs 20.00
  const payRes2 = await collectMemberDue.run({
    auth: { uid: 'sec-punata' },
    data: {
      dueId,
      amountCents: 2000,
      paymentMethod: 'cash',
      shiftId,
      idempotencyKey: 'pay-union-key-22222',
      notes: 'Saldo mensualidad noviembre',
    },
  })

  assert.equal(payRes2.success, true)
  assert.equal(payRes2.status, 'paid')
  assert.equal(payRes2.remainingBalanceCents, 0)

  // Turno de caja ahora tiene Bs 150
  const shiftDocFinal = await db.collection('cash_shifts').doc(shiftId).get()
  assert.equal(shiftDocFinal.data().expectedCashCents, 15000)
  assert.equal(shiftDocFinal.data().breakdown.contributionsIncomeCents, 5000)

  // Cuota está cancelada
  const dueFinal = await db.collection('union_dues').doc(dueId).get()
  assert.equal(dueFinal.data().status, 'paid')
  assert.equal(dueFinal.data().balanceCents, 0)
  assert.equal(dueFinal.data().paymentsCount, 2)
})

test('6. RECAUDACIÓN: Idempotencia estricta previene duplicar cobros ante reintentos', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  await manageUnionMember.run({
    auth: { uid: 'admin-1' },
    data: { id: 'm-idem', memberNumber: 'SOC-080', fullName: 'Socio Idempotente', monthlyFeeBob: 50, status: 'active' },
  })
  await generateMonthlyDues.run({
    auth: { uid: 'admin-1' },
    data: { period: '2026-11' },
  })

  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-punata' },
    data: { branchId: 'punata', initialCashCents: 5000, idempotencyKey: 'idemp-shift-pun-idem' },
  })

  const dueId = 'm-idem_2026-11'
  const key = 'idem-unique-key-99999'

  // Primer intento
  const res1 = await collectMemberDue.run({
    auth: { uid: 'sec-punata' },
    data: { dueId, amountCents: 5000, paymentMethod: 'cash', shiftId: shiftRes.shift.id, idempotencyKey: key },
  })

  // Segundo intento con la misma clave
  const res2 = await collectMemberDue.run({
    auth: { uid: 'sec-punata' },
    data: { dueId, amountCents: 5000, paymentMethod: 'cash', shiftId: shiftRes.shift.id, idempotencyKey: key },
  })

  assert.equal(res1.receiptNumber, res2.receiptNumber)
  assert.equal(res1.paymentId, res2.paymentId)

  // La caja solo se incrementó una vez
  const shiftDoc = await db.collection('cash_shifts').doc(shiftRes.shift.id).get()
  assert.equal(shiftDoc.data().expectedCashCents, 10000) // 5000 + 5000
})

test('7. EXTRACTO DE CUENTA: getMemberAccountStatement calcula saldo, pagos e histórico de aportes', async () => {
  await createTestUser('tesorero-1', 'tesoreria', 'punata')

  await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: { id: 'm-stmt', memberNumber: 'SOC-099', fullName: 'Don Pedro Statement', monthlyFeeBob: 50, status: 'active' },
  })

  // Emitir 2 meses: 2026-10 y 2026-11
  await generateMonthlyDues.run({ auth: { uid: 'tesorero-1' }, data: { period: '2026-10', dueDate: '2026-10-15' } })
  await generateMonthlyDues.run({ auth: { uid: 'tesorero-1' }, data: { period: '2026-11', dueDate: '2026-11-15' } })

  // Pagar completamente octubre (5000 cts)
  await collectMemberDue.run({
    auth: { uid: 'tesorero-1' },
    data: {
      dueId: 'm-stmt_2026-10',
      amountCents: 5000,
      paymentMethod: 'qr',
      idempotencyKey: 'pay-stmt-oct-11111',
    },
  })

  // Consultar extracto
  const stmt = await getMemberAccountStatement.run({
    auth: { uid: 'tesorero-1' },
    data: { memberId: 'm-stmt' },
  })

  assert.equal(stmt.member.fullName, 'Don Pedro Statement')
  assert.equal(stmt.summary.totalDuesCount, 2)
  assert.equal(stmt.summary.totalBilledCents, 10000)
  assert.equal(stmt.summary.totalPaidCents, 5000)
  assert.equal(stmt.summary.totalBalanceCents, 5000)
  assert.equal(stmt.summary.isUpToDate, false) // Porque noviembre sigue pendiente
})

test('8. generateMonthlyDues: Omite socios sin cuota configurada (sin fallback ficticio) y emite warnings', async () => {
  await createTestUser('tesorero-1', 'tesoreria', 'punata')

  // Socio 1: con cuota válida de Bs 40
  await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: { id: 'm-valido', memberNumber: 'SOC-101', fullName: 'Socio Con Cuota', monthlyFeeBob: 40, status: 'active' },
  })
  // Socio 2: sin cuota (monthlyFeeBob: 0, monthlyFeeCents: 0)
  await manageUnionMember.run({
    auth: { uid: 'tesorero-1' },
    data: { id: 'm-sin-cuota', memberNumber: 'SOC-102', fullName: 'Socio Sin Cuota', monthlyFeeBob: 0, status: 'active' },
  })

  const genRes = await generateMonthlyDues.run({
    auth: { uid: 'tesorero-1' },
    data: { period: '2026-12' },
  })

  assert.equal(genRes.success, true)
  assert.equal(genRes.generatedCount, 1)
  assert.equal(genRes.skippedCount, 1)
  assert.equal(genRes.totalAmountCents, 4000) // Solo socio 1
  assert.equal(genRes.warnings.length, 1)
  assert.equal(genRes.warnings[0].memberNumber, 'SOC-102')
  assert.ok(genRes.warnings[0].reason.includes('sin cuota mensual configurada'))

  // Verificar que NO existe cuota generada con fallback de 5000 para el socio 2
  const dueSinCuota = await db.collection('union_dues').doc('m-sin-cuota_2026-12').get()
  assert.equal(dueSinCuota.exists, false)
})

test('9. generateMonthlyDues: Bloqueo atómico previene emisiones concurrentes simultáneas del mismo período', async () => {
  await createTestUser('tesorero-1', 'tesoreria', 'punata')

  // Simular lock activo en progreso para 2027-01
  await db.collection('system_locks').doc('generate_dues_2027-01').set({
    period: '2027-01',
    status: 'in_progress',
    startedAt: Date.now(),
    callerUid: 'otro-proceso',
  })

  await assert.rejects(async () => {
    await generateMonthlyDues.run({
      auth: { uid: 'tesorero-1' },
      data: { period: '2027-01' },
    })
  }, (err) => err.code === 'already-exists')
})

test('10. collectMemberDue: Rechaza reintentos con payload fingerprint alterado y exige turno válido en ventanilla', async () => {
  await createTestUser('sec-punata', 'secretaria', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  await manageUnionMember.run({
    auth: { uid: 'admin-1' },
    data: { id: 'm-sec-test', memberNumber: 'SOC-200', fullName: 'Socio Seguridad', monthlyFeeBob: 50, status: 'active' },
  })
  await generateMonthlyDues.run({
    auth: { uid: 'admin-1' },
    data: { period: '2026-11' },
  })

  const shiftRes = await openCashShift.run({
    auth: { uid: 'sec-punata' },
    data: { branchId: 'punata', initialCashCents: 5000, idempotencyKey: 'idemp-shift-pun-sec-test' },
  })
  const shiftId = shiftRes.shift.id
  const dueId = 'm-sec-test_2026-11'
  const key = 'idem-fingerprint-test-01'

  // Cobro exitoso inicial
  await collectMemberDue.run({
    auth: { uid: 'sec-punata' },
    data: { dueId, amountCents: 2000, paymentMethod: 'cash', shiftId, idempotencyKey: key },
  })

  // Intento de reusar la misma clave pero cambiando el monto -> DEBE FALLAR
  await assert.rejects(async () => {
    await collectMemberDue.run({
      auth: { uid: 'sec-punata' },
      data: { dueId, amountCents: 3000, paymentMethod: 'cash', shiftId, idempotencyKey: key },
    })
  }, (err) => err.code === 'already-exists')

  // Intento de cobro en efectivo SIN turno de caja -> DEBE FALLAR
  await assert.rejects(async () => {
    await collectMemberDue.run({
      auth: { uid: 'sec-punata' },
      data: { dueId, amountCents: 1000, paymentMethod: 'cash', idempotencyKey: 'sin-turno-key-001' },
    })
  }, (err) => err.code === 'failed-precondition')
})

test('11. getMemberAccountStatement: Secretaria y conductor NO tienen acceso al extracto contable', async () => {
  await createTestUser('sec-1', 'secretaria', 'punata')
  await createTestUser('driver-1', 'conductor', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  await manageUnionMember.run({
    auth: { uid: 'admin-1' },
    data: { id: 'm-sec-view', memberNumber: 'SOC-300', fullName: 'Socio Vista', monthlyFeeBob: 50, status: 'active' },
  })

  await assert.rejects(async () => {
    await getMemberAccountStatement.run({
      auth: { uid: 'sec-1' },
      data: { memberId: 'm-sec-view' },
    })
  }, (err) => err.code === 'permission-denied')

  await assert.rejects(async () => {
    await getMemberAccountStatement.run({
      auth: { uid: 'driver-1' },
      data: { memberId: 'm-sec-view' },
    })
  }, (err) => err.code === 'permission-denied')
})
