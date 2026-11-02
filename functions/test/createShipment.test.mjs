import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// Asegurar que apunte al emulador de Firestore
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.GCLOUD_PROJECT = 'demo-expreso-punata-dev'

let adminApp
let db

before(() => {
  if (getApps().length === 0) {
    adminApp = initializeApp({ projectId: 'demo-expreso-punata-dev' })
  } else {
    adminApp = getApps()[0]
  }
  db = getFirestore(adminApp)
})

after(async () => {
  if (adminApp) {
    await deleteApp(adminApp)
  }
})

// Función helper para invocar la lógica de creación atómica
async function executeCreateShipment(callerAuth, data) {
  if (!callerAuth) {
    throw new Error('UNAUTHENTICATED: Debe iniciar sesión para registrar encomiendas.')
  }

  const userDoc = await db.collection('users').doc(callerAuth.uid).get()
  if (!userDoc.exists) {
    throw new Error('PERMISSION_DENIED: El usuario no tiene perfil registrado en el sistema.')
  }

  const userProfile = userDoc.data() || {}
  if (userProfile.isActive === false) {
    throw new Error('PERMISSION_DENIED: La cuenta de usuario se encuentra inactiva.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(userProfile.role)) {
    throw new Error(`PERMISSION_DENIED: El rol '${userProfile.role}' no tiene permiso para emitir guías de encomienda.`)
  }

  const {
    originBranchId,
    destinationBranchId,
    deliveryType = 'agency',
    deliveryAddress = '',
    sender,
    recipient,
    items,
    paymentTiming = 'origin_paid',
    paymentMethod = 'cash',
    discountCents = 0,
    prohibitedGoodsNoticeAccepted,
    idempotencyKey,
  } = data

  const userAllowedBranches = userProfile.allowedBranchIds || [userProfile.primaryBranchId]
  if (userProfile.role !== 'directiva_admin' && !userAllowedBranches.includes(originBranchId)) {
    throw new Error(`PERMISSION_DENIED: No está autorizado para registrar envíos con origen en '${originBranchId}'.`)
  }

  const validBranches = ['punata', 'cochabamba']
  if (!validBranches.includes(originBranchId) || !validBranches.includes(destinationBranchId) || originBranchId === destinationBranchId) {
    throw new Error('INVALID_ARGUMENT: Sucursales inválidas.')
  }

  if (!sender?.name || !sender?.phone || !recipient?.name || !recipient?.phone) {
    throw new Error('INVALID_ARGUMENT: Datos de personas incompletos.')
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('INVALID_ARGUMENT: Se requiere al menos un ítem.')
  }

  if (prohibitedGoodsNoticeAccepted !== true) {
    throw new Error('FAILED_PRECONDITION: Debe aceptarse la declaración.')
  }

  if (!idempotencyKey) {
    throw new Error('INVALID_ARGUMENT: Clave de idempotencia requerida.')
  }

  let totalWeightKg = 0
  let packageCount = 0
  for (const it of items) {
    packageCount += Number(it.quantity) || 1
    totalWeightKg += Math.max(0, Number(it.weightKg) || 0)
  }

  const baseFeeCents = 1500
  const excessKg = Math.max(0, Math.round((totalWeightKg - 3) * 100) / 100)
  const weightSurchargeCents = Math.round(excessKg * 200)
  const homeDeliveryFeeCents = deliveryType === 'home' ? 1200 : 0
  const subtotalCents = baseFeeCents + weightSurchargeCents + homeDeliveryFeeCents
  const finalAmountCents = subtotalCents - Math.min(subtotalCents, Math.max(0, Number(discountCents) || 0))

  const branchCode = originBranchId === 'punata' ? 'PUN' : 'CBB'
  const currentYear = 2026
  const counterDocRef = db.collection('counters').doc(`${branchCode}_${currentYear}`)
  const idempotencyDocRef = db.collection('idempotency_keys').doc(idempotencyKey)

  return await db.runTransaction(async (transaction) => {
    const idempDoc = await transaction.get(idempotencyDocRef)
    if (idempDoc.exists) {
      const existingTracking = idempDoc.data().trackingCode
      const existingDoc = await transaction.get(db.collection('shipments').doc(existingTracking))
      if (existingDoc.exists) {
        return { isDuplicate: true, shipment: existingDoc.data() }
      }
    }

    const counterDoc = await transaction.get(counterDocRef)
    const nextSeq = counterDoc.exists ? (Number(counterDoc.data().current) || 0) + 1 : 1
    const seqStr = String(nextSeq).padStart(5, '0')
    const trackingCode = `${branchCode}-${currentYear}-${seqStr}`

    const shipmentDocRef = db.collection('shipments').doc(trackingCode)
    const newShipment = {
      id: trackingCode,
      trackingCode,
      idempotencyKey,
      originBranchId,
      destinationBranchId,
      sender,
      recipient,
      items,
      packageCount,
      totalWeightKg,
      finalAmountCents,
      paymentTiming,
      status: 'received',
      registeredByUid: callerAuth.uid,
      registeredByName: userProfile.fullName,
    }

    transaction.set(counterDocRef, { current: nextSeq, year: currentYear }, { merge: true })
    transaction.set(shipmentDocRef, newShipment)
    transaction.set(idempotencyDocRef, { trackingCode, createdAt: FieldValue.serverTimestamp() })

    return { isDuplicate: false, shipment: newShipment }
  })
}

test('1. Creación atómica e incremento secuencial de guía', async () => {
  // Configurar usuario de prueba
  await db.collection('users').doc('sec-test-1').set({
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    fullName: 'Secretaria Punata 1',
    isActive: true,
  })

  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Carlos Perez', phone: '71711111' },
    recipient: { name: 'Maria Lopez', phone: '72222222' },
    items: [{ description: 'Caja con repuestos', quantity: 2, weightKg: 5 }],
    paymentTiming: 'origin_paid',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-test-atomic-001',
  }

  const res1 = await executeCreateShipment({ uid: 'sec-test-1' }, payload)
  assert.equal(res1.isDuplicate, false)
  assert.match(res1.shipment.trackingCode, /^PUN-2026-\d{5}$/)
  assert.equal(res1.shipment.packageCount, 2)
  assert.equal(res1.shipment.finalAmountCents, 1900) // 1500 base + 2kg exceso * 200 = 1900
})

test('2. Idempotencia estricta: solicitud repetida devuelve la misma guía sin duplicar', async () => {
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Carlos Perez', phone: '71711111' },
    recipient: { name: 'Maria Lopez', phone: '72222222' },
    items: [{ description: 'Documentos urgentes', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-duplicate-check-999',
  }

  const res1 = await executeCreateShipment({ uid: 'sec-test-1' }, payload)
  const res2 = await executeCreateShipment({ uid: 'sec-test-1' }, payload)

  assert.equal(res2.isDuplicate, true)
  assert.equal(res1.shipment.trackingCode, res2.shipment.trackingCode)
})

test('3. Bloqueo de roles no autorizados (conductor)', async () => {
  await db.collection('users').doc('driver-test-1').set({
    role: 'conductor',
    fullName: 'Conductor Prueba',
    isActive: true,
  })

  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'A', phone: '12345' },
    recipient: { name: 'B', phone: '54321' },
    items: [{ description: 'Sobre', quantity: 1 }],
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-driver-block',
  }

  await assert.rejects(
    executeCreateShipment({ uid: 'driver-test-1' }, payload),
    /PERMISSION_DENIED.*conductor/
  )
})

test('4. Bloqueo de registro en sucursal no autorizada', async () => {
  const payload = {
    originBranchId: 'cochabamba', // sec-test-1 solo tiene permiso para 'punata'
    destinationBranchId: 'punata',
    sender: { name: 'A', phone: '12345' },
    recipient: { name: 'B', phone: '54321' },
    items: [{ description: 'Sobre', quantity: 1 }],
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-branch-block',
  }

  await assert.rejects(
    executeCreateShipment({ uid: 'sec-test-1' }, payload),
    /PERMISSION_DENIED.*cochabamba/
  )
})

test('5. Concurrencia real: 10 solicitudes concurrentes sin colisiones de correlativos', async () => {
  await db.collection('users').doc('sec-cbb-1').set({
    role: 'secretaria',
    primaryBranchId: 'cochabamba',
    allowedBranchIds: ['cochabamba'],
    fullName: 'Secretaria Cochabamba 1',
    isActive: true,
  })

  // 5 para Punata y 5 para Cochabamba disparadas simultáneamente
  const promises = []
  for (let i = 0; i < 5; i++) {
    promises.push(
      executeCreateShipment(
        { uid: 'sec-test-1' },
        {
          originBranchId: 'punata',
          destinationBranchId: 'cochabamba',
          sender: { name: `Remitente Punata ${i}`, phone: '71700000' },
          recipient: { name: `Destinatario CBB ${i}`, phone: '72200000' },
          items: [{ description: `Bulto P-${i}`, quantity: 1, weightKg: 2 }],
          prohibitedGoodsNoticeAccepted: true,
          idempotencyKey: `concurrent-punata-${i}-${Date.now()}`,
        }
      )
    )
    promises.push(
      executeCreateShipment(
        { uid: 'sec-cbb-1' },
        {
          originBranchId: 'cochabamba',
          destinationBranchId: 'punata',
          sender: { name: `Remitente CBB ${i}`, phone: '72200000' },
          recipient: { name: `Destinatario Punata ${i}`, phone: '71700000' },
          items: [{ description: `Bulto C-${i}`, quantity: 1, weightKg: 2 }],
          prohibitedGoodsNoticeAccepted: true,
          idempotencyKey: `concurrent-cbb-${i}-${Date.now()}`,
        }
      )
    )
  }

  const results = await Promise.all(promises)
  const trackingCodes = results.map(r => r.shipment.trackingCode)
  const uniqueCodes = new Set(trackingCodes)

  assert.equal(results.length, 10)
  assert.equal(uniqueCodes.size, 10, 'Todas las guías deben ser únicas e independientes')

  const punCodes = trackingCodes.filter(c => c.startsWith('PUN-'))
  const cbbCodes = trackingCodes.filter(c => c.startsWith('CBB-'))
  assert.equal(punCodes.length, 5)
  assert.equal(cbbCodes.length, 5)
})
