import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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

// Simulación exacta de la función transaccional ejecutada por Admin SDK
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
    cashShiftId = null,
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

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new Error('INVALID_ARGUMENT: Clave de idempotencia requerida.')
  }

  const payloadFingerprint = JSON.stringify({
    originBranchId,
    destinationBranchId,
    deliveryType,
    senderName: sender.name.trim().toLowerCase(),
    senderPhone: sender.phone.trim(),
    recipientName: recipient.name.trim().toLowerCase(),
    recipientPhone: recipient.phone.trim(),
    itemCount: items.length,
    paymentTiming,
    paymentMethod: paymentTiming === 'origin_paid' ? paymentMethod : null,
  })

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
  const rawDiscount = Number(discountCents) || 0
  if (rawDiscount < 0) {
    throw new Error('INVALID_ARGUMENT: El descuento no puede ser un valor negativo.')
  }
  if (rawDiscount > 0 && userProfile.role !== 'directiva_admin') {
    throw new Error('PERMISSION_DENIED: Los descuentos desde ventanilla están deshabilitados. Solo la Directiva / Administración puede aplicar descuentos.')
  }
  const finalAmountCents = subtotalCents - Math.min(subtotalCents, Math.max(0, rawDiscount))

  const branchCode = originBranchId === 'punata' ? 'PUN' : 'CBB'
  const currentYear = 2026
  const counterDocRef = db.collection('counters').doc(`${branchCode}_${currentYear}`)
  const idempotencyDocRef = db.collection('idempotency_keys').doc(idempotencyKey)

  return await db.runTransaction(async (transaction) => {
    const idempDoc = await transaction.get(idempotencyDocRef)
    if (idempDoc.exists) {
      const idempData = idempDoc.data()
      if (idempData.callerUid && idempData.callerUid !== callerAuth.uid) {
        throw new Error('PERMISSION_DENIED: Esta clave de idempotencia pertenece a otro usuario.')
      }
      if (idempData.payloadFingerprint && idempData.payloadFingerprint !== payloadFingerprint) {
        throw new Error('INVALID_ARGUMENT: Clave de idempotencia ya utilizada con datos de envío diferentes.')
      }
      const existingTracking = idempData.trackingCode
      const existingDoc = await transaction.get(db.collection('shipments').doc(existingTracking))
      if (existingDoc.exists) {
        return { isDuplicate: true, shipment: existingDoc.data() }
      }
    }

    const counterDoc = await transaction.get(counterDocRef)
    const nextSeq = counterDoc.exists ? (Number(counterDoc.data().current) || 0) + 1 : 1
    const seqStr = String(nextSeq).padStart(5, '0')
    const trackingCode = `${branchCode}-${currentYear}-${seqStr}`

    const isPaid = paymentTiming === 'origin_paid'
    const movementId = isPaid ? `MOV-${trackingCode}` : null

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
      discountCents: rawDiscount,
      paymentTiming,
      paymentStatus: isPaid ? 'paid' : 'pending',
      paymentMethod: isPaid ? paymentMethod : null,
      financialMovementId: movementId,
      status: 'received',
      registeredByUid: callerAuth.uid,
      registeredByName: userProfile.fullName || 'Operador',
    }

    if (isPaid && movementId) {
      const movDocRef = db.collection('financial_movements').doc(movementId)
      transaction.set(movDocRef, {
        id: movementId,
        trackingCode,
        operatorUid: callerAuth.uid,
        operatorName: userProfile.fullName || 'Operador',
        branchId: originBranchId,
        amountCents: finalAmountCents,
        paymentMethod,
        concept: 'shipment_origin_payment',
        status: 'completed',
        cashShiftId,
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    transaction.set(counterDocRef, { current: nextSeq, year: currentYear }, { merge: true })
    transaction.set(shipmentDocRef, newShipment)
    transaction.set(idempotencyDocRef, {
      trackingCode,
      callerUid: callerAuth.uid,
      payloadFingerprint,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { isDuplicate: false, shipment: newShipment }
  })
}

test('1. Creación atómica de encomienda CON movimiento financiero auditable (origin_paid)', async () => {
  await db.collection('users').doc('sec-test-fin').set({
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    fullName: 'Secretaria Financiera Punata',
    isActive: true,
  })

  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Raúl Morales', phone: '71712345' },
    recipient: { name: 'Ana Gómez', phone: '72254321' },
    items: [{ description: 'Caja con calzados', quantity: 1, weightKg: 2 }],
    paymentTiming: 'origin_paid',
    paymentMethod: 'cash',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-fin-001',
  }

  const res = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  assert.equal(res.isDuplicate, false)
  assert.equal(res.shipment.paymentStatus, 'paid')
  assert.ok(res.shipment.financialMovementId)

  // Verificar que el documento financiero fue creado en Firestore
  const movDoc = await db.collection('financial_movements').doc(res.shipment.financialMovementId).get()
  assert.equal(movDoc.exists, true)
  assert.equal(movDoc.data().amountCents, 1500)
  assert.equal(movDoc.data().paymentMethod, 'cash')
  assert.equal(movDoc.data().trackingCode, res.shipment.trackingCode)
})

test('2. Encomienda contraentrega (destination_cod) NO crea movimiento financiero en origen', async () => {
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Raúl Morales', phone: '71712345' },
    recipient: { name: 'Ana Gómez', phone: '72254321' },
    items: [{ description: 'Sobre de cartas', quantity: 1, weightKg: 0.5 }],
    paymentTiming: 'destination_cod',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-cod-002',
  }

  const res = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  assert.equal(res.shipment.paymentStatus, 'pending')
  assert.equal(res.shipment.financialMovementId, null)

  const movDoc = await db.collection('financial_movements').doc(`MOV-${res.shipment.trackingCode}`).get()
  assert.equal(movDoc.exists, false)
})

test('3. Idempotencia reforzada: rechaza misma clave con datos diferentes y usuario diferente', async () => {
  const payloadOriginal = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Cliente A', phone: '71700001' },
    recipient: { name: 'Destino A', phone: '72200001' },
    items: [{ description: 'Item 1', quantity: 1 }],
    paymentTiming: 'origin_paid',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-strong-test',
  }

  // Primera creación
  const res1 = await executeCreateShipment({ uid: 'sec-test-fin' }, payloadOriginal)

  // Mismo usuario, mismos datos -> Devuelve duplicado idéntico
  const res2 = await executeCreateShipment({ uid: 'sec-test-fin' }, payloadOriginal)
  assert.equal(res2.isDuplicate, true)
  assert.equal(res1.shipment.trackingCode, res2.shipment.trackingCode)

  // Mismo usuario, datos distintos -> RECHAZADO
  const payloadDiferente = { ...payloadOriginal, sender: { name: 'Otro Cliente', phone: '79999999' } }
  await assert.rejects(
    executeCreateShipment({ uid: 'sec-test-fin' }, payloadDiferente),
    /INVALID_ARGUMENT.*datos de envío diferentes/
  )

  // Usuario distinto con la misma clave -> RECHAZADO (Aislamiento de seguridad)
  await db.collection('users').doc('sec-other').set({
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    fullName: 'Otra Secretaria',
    isActive: true,
  })
  await assert.rejects(
    executeCreateShipment({ uid: 'sec-other' }, payloadOriginal),
    /PERMISSION_DENIED.*otro usuario/
  )
})

test('4. Bloqueo estricto de roles (conductor y sucursal no permitida)', async () => {
  await db.collection('users').doc('driver-test-2').set({
    role: 'conductor',
    fullName: 'Chofer No Autorizado',
    isActive: true,
  })

  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'A', phone: '71700000' },
    recipient: { name: 'B', phone: '72200000' },
    items: [{ description: 'Bulto', quantity: 1 }],
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: 'idemp-driver-block-test',
  }

  await assert.rejects(
    executeCreateShipment({ uid: 'driver-test-2' }, payload),
    /PERMISSION_DENIED.*conductor/
  )
})

test('5. Concurrencia de 10 peticiones simultáneas sin correlativos duplicados', async () => {
  await db.collection('users').doc('sec-cbb-concurrent').set({
    role: 'secretaria',
    primaryBranchId: 'cochabamba',
    allowedBranchIds: ['cochabamba'],
    fullName: 'Secretaria Cochabamba Concurrente',
    isActive: true,
  })

  const promises = []
  for (let i = 0; i < 5; i++) {
    promises.push(
      executeCreateShipment(
        { uid: 'sec-test-fin' },
        {
          originBranchId: 'punata',
          destinationBranchId: 'cochabamba',
          sender: { name: `Remitente Punata C-${i}`, phone: '71711111' },
          recipient: { name: `Destinatario CBB C-${i}`, phone: '72211111' },
          items: [{ description: `Carga P-${i}`, quantity: 1, weightKg: 1 }],
          paymentTiming: 'origin_paid',
          prohibitedGoodsNoticeAccepted: true,
          idempotencyKey: `conc-punata-${i}-${Date.now()}`,
        }
      )
    )
    promises.push(
      executeCreateShipment(
        { uid: 'sec-cbb-concurrent' },
        {
          originBranchId: 'cochabamba',
          destinationBranchId: 'punata',
          sender: { name: `Remitente CBB C-${i}`, phone: '72222222' },
          recipient: { name: `Destinatario Punata C-${i}`, phone: '71722222' },
          items: [{ description: `Carga C-${i}`, quantity: 1, weightKg: 1 }],
          paymentTiming: 'origin_paid',
          prohibitedGoodsNoticeAccepted: true,
          idempotencyKey: `conc-cbb-${i}-${Date.now()}`,
        }
      )
    )
  }

  const results = await Promise.all(promises)
  const codes = results.map(r => r.shipment.trackingCode)
  const unique = new Set(codes)

  assert.equal(results.length, 10)
  assert.equal(unique.size, 10)
})

test('6. Validación de descuentos: secretaria NO puede aplicar descuentos arbitrarios', async () => {
  await assert.rejects(
    async () => executeCreateShipment(
      { uid: 'sec-test-fin' },
      {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        sender: { name: 'Remitente Prueba', phone: '71711111' },
        recipient: { name: 'Destinatario Prueba', phone: '72211111' },
        items: [{ description: 'Carga con descuento', quantity: 1, weightKg: 1 }],
        paymentTiming: 'origin_paid',
        discountCents: 500, // Intento de descuento por secretaria
        prohibitedGoodsNoticeAccepted: true,
        idempotencyKey: `discount-sec-fail-${Date.now()}`,
      }
    ),
    (err) => {
      assert.match(err.message, /PERMISSION_DENIED: Los descuentos desde ventanilla están deshabilitados/)
      return true
    }
  )
})

test('7. Directiva / Administración puede aplicar descuentos autorizados', async () => {
  await db.collection('users').doc('admin-descuentos').set({
    uid: 'admin-descuentos',
    fullName: 'Administrador Descuentos',
    role: 'directiva_admin',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
  })

  const result = await executeCreateShipment(
    { uid: 'admin-descuentos' },
    {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      sender: { name: 'Remitente Especial', phone: '71711111' },
      recipient: { name: 'Destinatario Especial', phone: '72211111' },
      items: [{ description: 'Carga con descuento oficial', quantity: 1, weightKg: 1 }],
      paymentTiming: 'origin_paid',
      discountCents: 500, // 5 Bs. de descuento aprobado por admin
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `discount-admin-ok-${Date.now()}`,
    }
  )

  assert.equal(result.isDuplicate, false)
  assert.equal(result.shipment.discountCents, 500)
  assert.equal(result.shipment.finalAmountCents, 1000) // 1500 - 500 = 1000
})
