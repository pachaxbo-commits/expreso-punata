import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import {
  manageUnionMember,
  generateMonthlyDues,
  collectMemberDue,
  getMemberAccountStatement,
  getUnionMembersRoster,
  openCashShift,
} from '../index.js'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199'
process.env.STORAGE_EMULATOR_HOST ||= 'http://127.0.0.1:9199'

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

test('1A. Afiliado: persiste campos de expediente en Firestore Emulator', async () => {
  await createTestUser('tesorero-campos', 'tesoreria', 'punata')
  const fields = {
    id: 'member-expediente-campos',
    memberNumber: 'SOC-EXP-001',
    fullName: 'Afiliada de Prueba',
    ci: '7654321',
    ciComplement: '1A',
    phone: '70001122',
    alternatePhone: '70003344',
    address: 'Calle de Prueba 123',
    locality: 'Punata',
    birthDate: '1985-03-12',
    joinedAt: '2020-02-01',
    retiredAt: '2025-10-15',
    status: 'retired',
    monthlyFeeBob: 50,
  }

  const result = await manageUnionMember.run({
    auth: { uid: 'tesorero-campos' },
    data: fields,
  })
  assert.equal(result.success, true)

  const saved = await db.collection('union_members').doc(fields.id).get()
  assert.equal(saved.exists, true)
  for (const key of ['ciComplement', 'alternatePhone', 'address', 'locality', 'birthDate', 'joinedAt', 'retiredAt', 'status']) {
    assert.equal(saved.data()[key], fields[key], `Campo persistido: ${key}`)
  }
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

test('11. getMemberAccountStatement: Secretaria accede a su sucursal y conductor permanece bloqueado', async () => {
  await createTestUser('sec-1', 'secretaria', 'punata')
  await createTestUser('driver-1', 'conductor', 'punata')
  await createTestUser('admin-1', 'directiva_admin', 'punata')

  await manageUnionMember.run({
    auth: { uid: 'admin-1' },
    data: { id: 'm-sec-view', memberNumber: 'SOC-300', fullName: 'Socio Vista', monthlyFeeBob: 50, status: 'active', branchId: 'punata' },
  })

  const secretaryStatement = await getMemberAccountStatement.run({
    auth: { uid: 'sec-1' },
    data: { memberId: 'm-sec-view' },
  })
  assert.equal(secretaryStatement.member.id, 'm-sec-view')

  await assert.rejects(async () => {
    await getMemberAccountStatement.run({
      auth: { uid: 'driver-1' },
      data: { memberId: 'm-sec-view' },
    })
  }, (err) => err.code === 'permission-denied')
})

test('12. Afiliado antiguo: actualizar expediente conserva datos y cuota vinculada', async () => {
  await createTestUser('tesorero-old', 'tesoreria', 'punata')
  const memberRef = db.collection('union_members').doc('m-legacy')
  await memberRef.set({
    id: 'm-legacy', memberNumber: 'SOC-LEG-001', fullName: 'Afiliado Histórico', ci: '1234567',
    phone: '71112223', joinedAt: '2018-04-10', status: 'active', category: 'propietario_transporte',
    monthlyFeeBob: 50, monthlyFeeCents: 5000, notes: 'Dato histórico',
  })

  await generateMonthlyDues.run({
    auth: { uid: 'tesorero-old' },
    data: { period: '2026-11', dueDate: '2026-11-15' },
  })
  const dueRef = db.collection('union_dues').doc('m-legacy_2026-11')
  const dueBefore = await dueRef.get()
  assert.equal(dueBefore.exists, true)
  const dueDataBefore = dueBefore.data()

  await manageUnionMember.run({
    auth: { uid: 'tesorero-old' },
    data: {
      id: 'm-legacy', memberNumber: 'SOC-LEG-001', fullName: 'Afiliado Histórico', ci: '1234567',
      phone: '70009988', joinedAt: '2018-04-10', status: 'active', category: 'propietario_transporte',
      monthlyFeeBob: 50, notes: 'Dato histórico', alternatePhone: '70007766',
      address: 'Avenida Compatibilidad 20', locality: 'Punata',
    },
  })

  const saved = await memberRef.get()
  assert.equal(saved.data().fullName, 'Afiliado Histórico')
  assert.equal(saved.data().ci, '1234567')
  assert.equal(saved.data().phone, '70009988')
  assert.equal(saved.data().joinedAt, '2018-04-10')
  assert.equal(saved.data().monthlyFeeCents, 5000)
  assert.equal(saved.data().notes, 'Dato histórico')
  assert.equal(saved.data().alternatePhone, '70007766')
  assert.equal(saved.data().address, 'Avenida Compatibilidad 20')
  assert.equal(saved.data().locality, 'Punata')

  const dueAfter = await dueRef.get()
  assert.deepEqual(dueAfter.data(), dueDataBefore)
})

test('13. Afiliado: rechaza fecha de retiro anterior al ingreso sin persistir', async () => {
  await createTestUser('tesorero-fechas', 'tesoreria', 'punata')
  const memberId = 'member-fechas-invalidas'

  await assert.rejects(async () => {
    await manageUnionMember.run({
      auth: { uid: 'tesorero-fechas' },
      data: {
        id: memberId,
        memberNumber: 'SOC-DATE-001',
        fullName: 'Afiliado Fechas Inconsistentes',
        joinedAt: '2020-01-15',
        retiredAt: '2018-06-10',
        status: 'retired',
        monthlyFeeBob: 50,
      },
    })
  }, (error) => error.code === 'invalid-argument')

  const saved = await db.collection('union_members').doc(memberId).get()
  assert.equal(saved.exists, false)
})

test('14. Afiliado: quitar fecha de retiro limpia el campo y permite verificar estado', async () => {
  await createTestUser('tesorero-retirar-fecha', 'tesoreria', 'punata')
  const memberId = 'member-quitar-retiro'
  const auth = { uid: 'tesorero-retirar-fecha' }

  await manageUnionMember.run({
    auth,
    data: {
      id: memberId, memberNumber: 'SOC-RET-014', fullName: 'Afiliado Retiro Prueba',
      joinedAt: '2020-01-15', retiredAt: '2024-06-01', status: 'retired', monthlyFeeBob: 50,
    },
  })
  let saved = await db.collection('union_members').doc(memberId).get()
  assert.equal(saved.data().retiredAt, '2024-06-01')
  assert.equal(saved.data().status, 'retired')

  await manageUnionMember.run({
    auth,
    data: {
      id: memberId, memberNumber: 'SOC-RET-014', fullName: 'Afiliado Retiro Prueba',
      joinedAt: '2020-01-15', retiredAt: '', status: 'active', monthlyFeeBob: 50,
    },
  })

  saved = await db.collection('union_members').doc(memberId).get()
  assert.equal(saved.data().retiredAt, null)
  assert.equal(saved.data().status, 'active')
})

test('15. Hijos: crear, consultar y editar conserva campos omitidos y rechaza rol no autorizado', async () => {
  const runId = Date.now().toString(36)
  await createTestUser('tesorero-hijos-crud', 'tesoreria', 'punata')
  await createTestUser('secretaria-hijos-crud', 'secretaria', 'punata')
  const auth = { uid: 'tesorero-hijos-crud' }
  const memberId = `member-hijos-crud-${runId}`
  await manageUnionMember.run({
    auth,
    data: {
      id: memberId, memberNumber: `SOC-CHILD-015-${runId}`, fullName: 'Afiliado Prueba Hijos',
      joinedAt: '2020-01-15', status: 'active', monthlyFeeBob: 50,
    },
  })

  const created = await manageUnionMember.run({
    auth,
    data: {
      action: 'addChild', memberId,
      child: { fullName: 'Camila Prueba', ci: '1234567', birthDate: '2012-04-20', phone: '70001122', address: 'Calle Uno', notes: 'Dato original' },
    },
  })
  assert.equal(created.success, true)
  const childId = created.child.id
  const childRef = db.collection('union_members').doc(memberId).collection('children').doc(childId)
  const createdDoc = await childRef.get()
  assert.equal(createdDoc.exists, true)
  assert.equal(createdDoc.data().fullName, 'Camila Prueba')

  const statement = await getMemberAccountStatement.run({ auth, data: { memberId } })
  assert.equal(statement.children.length, 1)
  assert.equal(statement.children[0].id, childId)
  assert.equal(statement.children[0].address, 'Calle Uno')

  const updated = await manageUnionMember.run({
    auth,
    data: { action: 'updateChild', memberId, childId, child: { phone: '70009988', address: 'Avenida Nueva' } },
  })
  assert.equal(updated.success, true)
  assert.equal(updated.child.phone, '70009988')
  assert.equal(updated.child.address, 'Avenida Nueva')
  assert.equal(updated.child.fullName, 'Camila Prueba')
  assert.equal(updated.child.ci, '1234567')
  assert.equal(updated.child.notes, 'Dato original')

  await assert.rejects(async () => {
    await manageUnionMember.run({
      auth: { uid: 'secretaria-hijos-crud' },
      data: { action: 'updateChild', memberId, childId, child: { fullName: 'Cambio No Autorizado' } },
    })
  }, (error) => error.code === 'permission-denied')
  const persisted = await childRef.get()
  assert.equal(persisted.data().fullName, 'Camila Prueba')
  assert.equal(persisted.data().phone, '70009988')
})

test('16. Vínculos: afiliado e hijo usan conductores existentes sin alterar viajes ni cuotas', async () => {
  const runId = Date.now().toString(36)
  await createTestUser('tesorero-vinculos', 'tesoreria', 'punata')
  await createTestUser('secretaria-vinculos', 'secretaria', 'punata')
  await createTestUser(`driver-vinculo-a-${runId}`, 'conductor', 'punata')
  await createTestUser(`driver-vinculo-b-${runId}`, 'conductor', 'punata')
  const drivers = [`driver-vinculo-a-${runId}`, `driver-vinculo-b-${runId}`]
  for (const uid of drivers) {
    await db.collection('driver_directory').doc(uid).set({ uid, fullName: `Conductor ${uid}`, phone: '70001122', isActive: true })
  }
  const driverUsersBefore = await Promise.all(drivers.map((uid) => db.collection('users').doc(uid).get()))
  const driverDirectoryBefore = await Promise.all(drivers.map((uid) => db.collection('driver_directory').doc(uid).get()))

  const auth = { uid: 'tesorero-vinculos' }
  const memberId = `member-vinculos-${runId}`
  const otherMemberId = `member-vinculos-otro-${runId}`
  await manageUnionMember.run({ auth, data: { id: memberId, memberNumber: `SOC-LINK-016-${runId}`, fullName: 'Afiliado Vinculos', status: 'active', monthlyFeeBob: 50 } })
  await manageUnionMember.run({ auth, data: { id: otherMemberId, memberNumber: `SOC-LINK-017-${runId}`, fullName: 'Otro Afiliado', status: 'active', monthlyFeeBob: 50 } })
  const childRes = await manageUnionMember.run({ auth, data: { action: 'addChild', memberId, child: { fullName: 'Hijo Vinculado' } } })
  const childId = childRes.child.id

  const dueRef = db.collection('union_dues').doc(`due-vinculos-preserved-${runId}`)
  const manifestRef = db.collection('manifests').doc(`manifest-vinculos-preserved-${runId}`)
  const vehicleRef = db.collection('vehicles').doc(`vehicle-vinculos-preserved-${runId}`)
  const dueOriginal = { memberId, amountCents: 5000, status: 'pending' }
  const manifestOriginal = { driverUid: drivers[0], vehicleId: vehicleRef.id, status: 'in_transit', driverCustodyStatus: 'accepted' }
  const vehicleOriginal = { assignedDriverUid: drivers[0], plate: 'LINK-016', status: 'active' }
  await Promise.all([dueRef.set(dueOriginal), manifestRef.set(manifestOriginal), vehicleRef.set(vehicleOriginal)])

  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId, driverUid: drivers[0] } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId, childId, driverUid: drivers[1] } })
  let statement = await getMemberAccountStatement.run({ auth, data: { memberId } })
  assert.equal(statement.member.primaryDriverUid, drivers[0])
  assert.equal(statement.children.find((child) => child.id === childId).driverUid, drivers[1])
  assert.equal(statement.member.primaryDriverName, 'Usuario Test conductor')
  assert.equal(statement.children.find((child) => child.id === childId).driverName, 'Usuario Test conductor')

  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId, driverUid: drivers[1] } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId, childId, driverUid: null } })
  statement = await getMemberAccountStatement.run({ auth, data: { memberId } })
  assert.equal(statement.member.primaryDriverUid, drivers[1])
  assert.equal(statement.children.find((child) => child.id === childId).driverUid, null)

  await manageUnionMember.run({ auth, data: { action: 'addChild', memberId: otherMemberId, child: { fullName: 'Hijo de Otro' } } })
  await assert.rejects(async () => manageUnionMember.run({
    auth,
    data: { action: 'setDriverLink', memberId: otherMemberId, childId, driverUid: drivers[0] },
  }), (error) => error.code === 'not-found')
  await assert.rejects(async () => manageUnionMember.run({
    auth,
    data: { action: 'setDriverLink', memberId, driverUid: `missing-driver-${runId}` },
  }), (error) => error.code === 'failed-precondition')
  await assert.rejects(async () => manageUnionMember.run({
    auth: { uid: 'secretaria-vinculos' },
    data: { action: 'setDriverLink', memberId, driverUid: drivers[0] },
  }), (error) => error.code === 'permission-denied')

  assert.deepEqual((await dueRef.get()).data(), dueOriginal)
  assert.deepEqual((await manifestRef.get()).data(), manifestOriginal)
  assert.deepEqual((await vehicleRef.get()).data(), vehicleOriginal)
  const driverUsersAfter = await Promise.all(drivers.map((uid) => db.collection('users').doc(uid).get()))
  const driverDirectoryAfter = await Promise.all(drivers.map((uid) => db.collection('driver_directory').doc(uid).get()))
  for (let index = 0; index < drivers.length; index += 1) {
    assert.deepEqual(driverUsersAfter[index].data(), driverUsersBefore[index].data())
    assert.deepEqual(driverDirectoryAfter[index].data(), driverDirectoryBefore[index].data())
  }
})

test('17. Padrón imprimible: devuelve afiliados, hijos y vínculos con los roles de lectura existentes', async () => {
  const runId = Date.now().toString(36)
  await createTestUser(`tesorero-roster-${runId}`, 'tesoreria', 'punata')
  await createTestUser(`secretaria-roster-${runId}`, 'secretaria', 'punata')
  await createTestUser(`driver-roster-${runId}`, 'conductor', 'punata')
  const auth = { uid: `tesorero-roster-${runId}` }
  const memberId = `member-roster-${runId}`
  const legacyId = `member-roster-legacy-${runId}`
  const driverUid = `driver-roster-${runId}`
  await db.collection('users').doc(driverUid).update({ fullName: 'Conductor del Padrón' })
  await db.collection('driver_directory').doc(driverUid).set({ uid: driverUid, fullName: 'Conductor del Padrón', isActive: true, phone: '' })
  await manageUnionMember.run({ auth, data: {
    id: memberId, memberNumber: `SOC-ROSTER-${runId}`, fullName: 'Afiliada Ejemplo', ci: '1234567', ciComplement: 'A',
    phone: '70001122', alternatePhone: '70003344', address: 'Calle Central', locality: 'Punata',
    birthDate: '1980-01-02', joinedAt: '2015-06-01', status: 'active', notes: 'Observación de prueba', monthlyFeeBob: 50,
  } })
  const child = await manageUnionMember.run({ auth, data: { action: 'addChild', memberId, child: { fullName: 'Hijo Afiliada', birthDate: '2010-05-02' } } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId, driverUid } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId, childId: child.child.id, driverUid } })
  await db.collection('union_members').doc(legacyId).set({
    id: legacyId, memberNumber: `SOC-OLD-${runId}`, fullName: 'Afiliado Antiguo', ci: '', phone: '', joinedAt: '',
    status: 'retired', category: 'socio_general', monthlyFeeBob: 0,
  })

  const fullRoster = await getUnionMembersRoster.run({ auth, data: {} })
  assert.equal(fullRoster.success, true)
  assert.equal(fullRoster.members.length, 2)
  const currentEntry = fullRoster.members.find((member) => member.id === memberId)
  assert.equal(currentEntry.primaryDriverName, 'Conductor del Padrón')
  assert.equal(currentEntry.children.length, 1)
  assert.equal(currentEntry.children[0].driverName, 'Conductor del Padrón')
  const legacyEntry = fullRoster.members.find((member) => member.id === legacyId)
  assert.equal(legacyEntry.status, 'retired')
  assert.equal(legacyEntry.alternatePhone, '')
  assert.equal(legacyEntry.children.length, 0)

  const filteredRoster = await getUnionMembersRoster.run({ auth, data: { memberIds: [memberId] } })
  assert.deepEqual(filteredRoster.members.map((member) => member.id), [memberId])
  await assert.rejects(async () => getUnionMembersRoster.run({
    auth: { uid: `secretaria-roster-${runId}` }, data: {},
  }), (error) => error.code === 'permission-denied')
})

test('18. Simulación integral: afiliados, hijos, conductores y padrón conservan cuotas y operaciones existentes', async () => {
  const runId = Date.now().toString(36)
  const adminUid = `tesorero-integral-${runId}`
  const deniedUid = `secretaria-integral-${runId}`
  const driverA = `driver-a-integral-${runId}`
  const driverB = `driver-b-integral-${runId}`
  await createTestUser(adminUid, 'tesoreria')
  await createTestUser(deniedUid, 'secretaria')
  for (const [uid, fullName] of [[driverA, 'Chofer A Integración'], [driverB, 'Chofer B Integración']]) {
    await createTestUser(uid, 'conductor')
    await db.collection('users').doc(uid).update({ fullName })
    await db.collection('driver_directory').doc(uid).set({ uid, fullName, isActive: true })
  }
  const auth = { uid: adminUid }
  const firstId = `member-integral-a-${runId}`
  const secondId = `member-integral-b-${runId}`
  const firstRef = db.collection('union_members').doc(firstId)
  const dueRef = db.collection('union_dues').doc(`due-integral-${runId}`)
  const paymentRef = dueRef.collection('payments').doc('existing-payment')
  const vehicleRef = db.collection('vehicles').doc(`vehicle-integral-${runId}`)
  const manifestRef = db.collection('manifests').doc(`manifest-integral-${runId}`)
  const originalDue = { memberId: firstId, amountCents: 5000, paidAmountCents: 2000, balanceCents: 3000, status: 'partial' }
  const originalPayment = { amountCents: 2000, receiptNumber: `REC-${runId}` }
  const originalVehicle = { plate: `INT-${runId}`, assignedDriverUid: driverA, status: 'active' }
  const originalManifest = { driverUid: driverA, vehicleId: vehicleRef.id, status: 'in_transit' }
  await Promise.all([
    dueRef.set(originalDue), paymentRef.set(originalPayment),
    vehicleRef.set(originalVehicle), manifestRef.set(originalManifest),
  ])

  await manageUnionMember.run({ auth, data: { id: firstId, memberNumber: `INT-${runId}-A`, fullName: 'Afiliada Integrada', ci: '1111111', phone: '70001111', joinedAt: '2018-01-01', status: 'active', monthlyFeeBob: 50 } })
  await manageUnionMember.run({ auth, data: { id: secondId, memberNumber: `INT-${runId}-B`, fullName: 'Afiliado Integrado B', ci: '2222222', phone: '70002222', joinedAt: '2019-02-02', status: 'active', monthlyFeeBob: 50 } })
  await manageUnionMember.run({ auth, data: { id: firstId, memberNumber: `INT-${runId}-A`, fullName: 'Afiliada Integrada Editada', ci: '1111111', phone: '70003333', joinedAt: '2018-01-01', status: 'active', monthlyFeeBob: 50, address: 'Calle 1' } })

  const firstChild = await manageUnionMember.run({ auth, data: { action: 'addChild', memberId: firstId, child: { fullName: 'Hijo Integrado 1', phone: '71110001' } } })
  const secondChild = await manageUnionMember.run({ auth, data: { action: 'addChild', memberId: firstId, child: { fullName: 'Hijo Integrado 2' } } })
  await manageUnionMember.run({ auth, data: { action: 'updateChild', memberId: firstId, childId: firstChild.child.id, child: { address: 'Domicilio hijo', notes: 'Editado' } } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId: firstId, driverUid: driverA } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId: firstId, driverUid: driverB } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId: firstId, childId: firstChild.child.id, driverUid: driverA } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId: firstId, childId: secondChild.child.id, driverUid: driverB } })
  await manageUnionMember.run({ auth, data: { action: 'setDriverLink', memberId: firstId, childId: secondChild.child.id, driverUid: null } })

  await assert.rejects(() => manageUnionMember.run({ auth: { uid: deniedUid }, data: { id: firstId, memberNumber: `INT-${runId}-A`, fullName: 'No autorizado', monthlyFeeBob: 50 } }), (error) => error.code === 'permission-denied')
  const fullRoster = await getUnionMembersRoster.run({ auth, data: {} })
  assert.equal(fullRoster.members.length, 2)
  const member = fullRoster.members.find((item) => item.id === firstId)
  assert.equal(member.fullName, 'Afiliada Integrada Editada')
  assert.equal(member.primaryDriverName, 'Chofer B Integración')
  assert.equal(member.children.length, 2)
  assert.equal(member.children.find((item) => item.id === firstChild.child.id).driverName, 'Chofer A Integración')
  assert.equal(member.children.find((item) => item.id === secondChild.child.id).driverUid, null)
  const filtered = await getUnionMembersRoster.run({ auth, data: { memberIds: [secondId] } })
  assert.deepEqual(filtered.members.map((item) => item.id), [secondId])
  const storedMember = await firstRef.get()
  assert.equal(storedMember.data().address, 'Calle 1')
  assert.deepEqual((await dueRef.get()).data(), originalDue)
  assert.deepEqual((await paymentRef.get()).data(), originalPayment)
  assert.deepEqual((await vehicleRef.get()).data(), originalVehicle)
  assert.deepEqual((await manifestRef.get()).data(), originalManifest)
  assert.deepEqual((await db.collection('users').doc(driverA).get()).data().fullName, 'Chofer A Integración')
})
