import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
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

before(async () => {
  // El archivo mantiene usuarios de fixture entre casos, pero sus claves y
  // movimientos no deben sobrevivir a una ejecución anterior de la suite.
  for (const collectionName of ['shipments', 'counters', 'idempotency_keys', 'financial_movements', 'cash_shifts']) {
    const snapshot = await db.collection(collectionName).get()
    const batch = db.batch()
    snapshot.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
})

after(async () => {
  if (adminApp) {
    await deleteApp(adminApp)
  }
})

// Simulación exacta de la función transaccional ejecutada por Admin SDK en Cloud Functions
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

  let totalWeightKg = 0
  let packageCount = 0
  for (const it of items) {
    packageCount += Number(it.quantity) || 1
    totalWeightKg += (Number(it.weightKg) || 0) * (Number(it.quantity) || 1)
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
  const safeDiscountCents = Math.min(subtotalCents, Math.max(0, rawDiscount))
  const suggestedAmountCents = subtotalCents - safeDiscountCents

  let finalAmountCents = suggestedAmountCents
  let isPriceAdjusted = false
  let cleanAdjustmentReason = null

  if (data.agreedAmountCents !== undefined && data.agreedAmountCents !== null) {
    const rawAgreed = Number(data.agreedAmountCents)
    if (!Number.isInteger(rawAgreed) || isNaN(rawAgreed) || rawAgreed < 0) {
      throw new Error('INVALID_ARGUMENT: El precio acordado debe ser un número entero de centavos no negativo.')
    }
    if (rawAgreed === 0) {
      if (!data.priceAdjustmentReason || typeof data.priceAdjustmentReason !== 'string' || data.priceAdjustmentReason.trim().length < 3) {
        throw new Error('INVALID_ARGUMENT: Para encomiendas con precio Bs 0.00 es obligatorio especificar el motivo del acuerdo comercial.')
      }
    }
    finalAmountCents = rawAgreed
    if (finalAmountCents !== suggestedAmountCents) {
      isPriceAdjusted = true
      cleanAdjustmentReason = data.priceAdjustmentReason ? String(data.priceAdjustmentReason).trim() : null
    }
  }

  // Huella de datos exhaustiva para protección de idempotencia completa
  const payloadFingerprint = JSON.stringify({
    originBranchId,
    destinationBranchId,
    deliveryType,
    deliveryAddress: deliveryType === 'home' ? (deliveryAddress || '').trim().toLowerCase() : null,
    sender: {
      name: sender.name.trim().toLowerCase(),
      phone: sender.phone.trim(),
      docNumber: sender.docNumber ? sender.docNumber.trim() : null,
    },
    recipient: {
      name: recipient.name.trim().toLowerCase(),
      phone: recipient.phone.trim(),
      docNumber: recipient.docNumber ? recipient.docNumber.trim() : null,
    },
    items: items.map(it => ({
      description: it.description.trim().toLowerCase(),
      quantity: Number(it.quantity) || 1,
      weightKg: Number(it.weightKg) || 0,
      packaging: it.packaging || 'paquete',
      isFragile: Boolean(it.isFragile),
      isPerishable: Boolean(it.isPerishable),
    })),
    packageCount,
    totalWeightKg,
    discountCents: safeDiscountCents,
    finalAmountCents,
    declaredValueTotal: Number(data.declaredValueTotal) || 0,
    paymentTiming,
    paymentMethod: paymentTiming === 'origin_paid' ? paymentMethod : null,
  })

  const branchCode = originBranchId === 'punata' ? 'PUN' : 'CBB'
  const currentYear = 2026
  const counterDocRef = db.collection('counters').doc(`${branchCode}_${currentYear}`)
  const idempotencyDocRef = db.collection('idempotency_keys').doc(idempotencyKey)
  const isPaid = paymentTiming === 'origin_paid'

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

    // Validación estricta del turno de caja en la misma transacción
    let isDefinitivePayment = false
    let movementId = null
    let effectiveShiftId = null

    if (isPaid && cashShiftId) {
      const shiftDocRef = db.collection('cash_shifts').doc(cashShiftId)
      const shiftDoc = await transaction.get(shiftDocRef)
      if (!shiftDoc.exists) {
        throw new Error(`FAILED_PRECONDITION: El turno de caja '${cashShiftId}' no existe en el sistema.`)
      }
      const shiftData = shiftDoc.data() || {}
      if (shiftData.status !== 'open') {
        throw new Error(`FAILED_PRECONDITION: El turno de caja '${cashShiftId}' no está abierto (estado actual: ${shiftData.status}).`)
      }
      if (shiftData.operatorUid !== callerAuth.uid) {
        throw new Error(`PERMISSION_DENIED: El turno de caja '${cashShiftId}' pertenece a otro operador.`)
      }
      if (shiftData.branchId !== originBranchId) {
        throw new Error(`PERMISSION_DENIED: El turno de caja '${cashShiftId}' no corresponde a la sucursal de origen '${originBranchId}'.`)
      }
      isDefinitivePayment = true
      effectiveShiftId = cashShiftId
    }

    const counterDoc = await transaction.get(counterDocRef)
    const nextSeq = counterDoc.exists ? (Number(counterDoc.data().current) || 0) + 1 : 1
    const seqStr = String(nextSeq).padStart(5, '0')
    const trackingCode = `${branchCode}${currentYear}${seqStr}`

    if (isDefinitivePayment) {
      movementId = `MOV-${trackingCode}`
    }

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
      suggestedAmountCents,
      agreedAmountCents: finalAmountCents,
      finalAmountCents,
      isPriceAdjusted,
      priceAdjustmentReason: cleanAdjustmentReason,
      discountCents: safeDiscountCents,
      paymentTiming,
      paymentStatus: isDefinitivePayment ? 'paid' : 'pending',
      paymentMethod: isDefinitivePayment ? paymentMethod : null,
      financialMovementId: movementId,
      status: 'received',
      registeredByUid: callerAuth.uid,
      registeredByName: userProfile.fullName || 'Operador',
    }

    if (isDefinitivePayment && movementId && effectiveShiftId) {
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
        cashShiftId: effectiveShiftId,
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

test('1. Creación atómica de encomienda CON movimiento financiero auditable vinculado a turno abierto', async () => {
  await db.collection('users').doc('sec-test-fin').set({
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    fullName: 'Secretaria Financiera Punata',
    isActive: true,
  })

  // Crear turno de caja abierto válido
  await db.collection('cash_shifts').doc('shift-punata-valid-1').set({
    id: 'shift-punata-valid-1',
    branchId: 'punata',
    operatorUid: 'sec-test-fin',
    status: 'open',
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
    cashShiftId: 'shift-punata-valid-1',
  }

  const res = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  assert.equal(res.isDuplicate, false)
  assert.equal(res.shipment.paymentStatus, 'paid')
  assert.ok(res.shipment.financialMovementId)

  // Verificar que el documento financiero fue creado en Firestore
  const movDoc = await db.collection('financial_movements').doc(res.shipment.financialMovementId).get()
  assert.equal(movDoc.exists, true)
  assert.equal(movDoc.data().amountCents, 1500)
  assert.equal(movDoc.data().cashShiftId, 'shift-punata-valid-1')
  assert.equal(movDoc.data().trackingCode, res.shipment.trackingCode)
})

test('2. Encomienda contraentrega (destination_cod) NO crea movimiento financiero en origen', async () => {
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Carlos Ramos', phone: '71788888' },
    recipient: { name: 'Beatriz Soliz', phone: '72299999' },
    items: [{ description: 'Sobre con documentos', quantity: 1, weightKg: 0.5 }],
    paymentTiming: 'destination_cod',
    paymentMethod: 'cash',
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
  const originalKey = 'idemp-repeat-003'
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Mario Vaca', phone: '71700001' },
    recipient: { name: 'Juana Torrico', phone: '72200002' },
    items: [{ description: 'Repuesto mecánico', quantity: 1, weightKg: 4 }],
    paymentTiming: 'destination_cod',
    paymentMethod: 'cash',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: originalKey,
  }

  const firstCall = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  assert.equal(firstCall.isDuplicate, false)

  const secondCall = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  assert.equal(secondCall.isDuplicate, true)
  assert.equal(secondCall.shipment.trackingCode, firstCall.shipment.trackingCode)

  await assert.rejects(
    async () => executeCreateShipment(
      { uid: 'otro-operador' },
      payload
    ),
    (err) => {
      assert.match(err.message, /PERMISSION_DENIED/)
      return true
    }
  )
})

test('4. Bloqueo estricto de roles (conductor y sucursal no permitida)', async () => {
  await db.collection('users').doc('driver-test').set({
    role: 'conductor',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata'],
    fullName: 'Chofer Juan',
    isActive: true,
  })

  await assert.rejects(
    async () => executeCreateShipment(
      { uid: 'driver-test' },
      {
        originBranchId: 'punata',
        destinationBranchId: 'cochabamba',
        sender: { name: 'A', phone: '12345' },
        recipient: { name: 'B', phone: '12345' },
        items: [{ description: 'Test', quantity: 1, weightKg: 1 }],
        paymentTiming: 'destination_cod',
        prohibitedGoodsNoticeAccepted: true,
        idempotencyKey: 'fail-driver',
      }
    ),
    (err) => {
      assert.match(err.message, /PERMISSION_DENIED: El rol 'conductor' no tiene permiso/)
      return true
    }
  )
})

test('5. Concurrencia de 10 peticiones simultáneas sin correlativos duplicados', async () => {
  const promises = []
  for (let i = 0; i < 10; i++) {
    const payload = {
      originBranchId: 'punata',
      destinationBranchId: 'cochabamba',
      deliveryType: 'agency',
      sender: { name: `Remitente ${i}`, phone: '71700000' },
      recipient: { name: `Destinatario ${i}`, phone: '72200000' },
      items: [{ description: `Paquete concurrente ${i}`, quantity: 1, weightKg: 1 }],
      paymentTiming: 'destination_cod',
      paymentMethod: 'cash',
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `concurrent-key-${Date.now()}-${i}`,
    }
    promises.push(executeCreateShipment({ uid: 'sec-test-fin' }, payload))
  }

  const results = await Promise.all(promises)
  const trackingCodes = results.map(r => r.shipment.trackingCode)
  const unique = new Set(trackingCodes)

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
        discountCents: 500,
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
      paymentTiming: 'destination_cod',
      discountCents: 500,
      prohibitedGoodsNoticeAccepted: true,
      idempotencyKey: `discount-admin-ok-${Date.now()}`,
    }
  )

  assert.equal(result.isDuplicate, false)
  assert.equal(result.shipment.discountCents, 500)
  assert.equal(result.shipment.finalAmountCents, 1000)
})

test('8. Cobro origin_paid SIN turno de caja mantiene estado pending y no crea movimiento', async () => {
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Socio Punata', phone: '71799999' },
    recipient: { name: 'Destino Cbb', phone: '72299999' },
    items: [{ description: 'Bulto sin turno', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    paymentMethod: 'cash',
    cashShiftId: null, // Sin turno de caja abierto
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `no-shift-${Date.now()}`,
  }

  const result = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  assert.equal(result.shipment.paymentStatus, 'pending')
  assert.equal(result.shipment.financialMovementId, null)

  const movDoc = await db.collection('financial_movements').doc(`MOV-${result.shipment.trackingCode}`).get()
  assert.equal(movDoc.exists, false)
})

test('9. Turno de caja inventado / inexistente es RECHAZADO', async () => {
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'Socio Punata', phone: '71799999' },
    recipient: { name: 'Destino Cbb', phone: '72299999' },
    items: [{ description: 'Bulto fake shift', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    cashShiftId: 'turno-inventado-999',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `fake-shift-${Date.now()}`,
  }

  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, payload),
    (err) => {
      assert.match(err.message, /FAILED_PRECONDITION: El turno de caja 'turno-inventado-999' no existe en el sistema/)
      return true
    }
  )
})

test('10. Turno de caja CERRADO es RECHAZADO', async () => {
  await db.collection('cash_shifts').doc('shift-closed-1').set({
    id: 'shift-closed-1',
    branchId: 'punata',
    operatorUid: 'sec-test-fin',
    status: 'closed', // Cerrado
  })

  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'Socio Punata', phone: '71799999' },
    recipient: { name: 'Destino Cbb', phone: '72299999' },
    items: [{ description: 'Bulto closed shift', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    cashShiftId: 'shift-closed-1',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `closed-shift-${Date.now()}`,
  }

  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, payload),
    (err) => {
      assert.match(err.message, /FAILED_PRECONDITION: El turno de caja 'shift-closed-1' no está abierto/)
      return true
    }
  )
})

test('11. Turno de caja de OTRO OPERADOR u OTRA SUCURSAL es RECHAZADO', async () => {
  // Turno de otro operador
  await db.collection('cash_shifts').doc('shift-other-op').set({
    id: 'shift-other-op',
    branchId: 'punata',
    operatorUid: 'otro-operador-uid',
    status: 'open',
  })

  const payloadOtherOp = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'Socio Punata', phone: '71799999' },
    recipient: { name: 'Destino Cbb', phone: '72299999' },
    items: [{ description: 'Bulto', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    cashShiftId: 'shift-other-op',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `other-op-${Date.now()}`,
  }

  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, payloadOtherOp),
    (err) => {
      assert.match(err.message, /PERMISSION_DENIED: El turno de caja 'shift-other-op' pertenece a otro operador/)
      return true
    }
  )

  // Turno de otra sucursal (Cochabamba en vez de Punata)
  await db.collection('cash_shifts').doc('shift-other-branch').set({
    id: 'shift-other-branch',
    branchId: 'cochabamba',
    operatorUid: 'sec-test-fin',
    status: 'open',
  })

  const payloadOtherBranch = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    sender: { name: 'Socio Punata', phone: '71799999' },
    recipient: { name: 'Destino Cbb', phone: '72299999' },
    items: [{ description: 'Bulto', quantity: 1, weightKg: 1 }],
    paymentTiming: 'origin_paid',
    cashShiftId: 'shift-other-branch',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `other-branch-${Date.now()}`,
  }

  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, payloadOtherBranch),
    (err) => {
      assert.match(err.message, /PERMISSION_DENIED: El turno de caja 'shift-other-branch' no corresponde a la sucursal de origen 'punata'/)
      return true
    }
  )
})

test('12. Idempotencia completa: Misma clave con ítems o pesos diferentes es RECHAZADA', async () => {
  const sharedKey = `idemp-full-fingerprint-${Date.now()}`
  const basePayload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Mario Vaca', phone: '71700001' },
    recipient: { name: 'Juana Torrico', phone: '72200002' },
    items: [{ description: 'Caja con herramientas', quantity: 1, weightKg: 5 }],
    paymentTiming: 'destination_cod',
    paymentMethod: 'cash',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: sharedKey,
  }

  const okResult = await executeCreateShipment({ uid: 'sec-test-fin' }, basePayload)
  assert.equal(okResult.isDuplicate, false)

  // Intento de reutilizar la misma clave pero con un peso de 10 kg en lugar de 5 kg
  const alteredPayload = {
    ...basePayload,
    items: [{ description: 'Caja con herramientas', quantity: 1, weightKg: 10 }],
  }

  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, alteredPayload),
    (err) => {
      assert.match(err.message, /INVALID_ARGUMENT: Clave de idempotencia ya utilizada con datos de envío diferentes/)
      return true
    }
  )
})

test('13. FASE 1: Precio acordado editable: secretaria registra precio superior al sugerido', async () => {
  const payloadSuperior = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Comerciante Mayorista', phone: '71711122' },
    recipient: { name: 'Tienda La Cancha', phone: '72233344' },
    items: [{ description: 'Bulto grande de mercadería', quantity: 1, weightKg: 2 }],
    // Tarifa sugerida sería 1500 centavos (Bs 15)
    agreedAmountCents: 2500, // Secretaria pacta Bs 25 por volumen
    priceAdjustmentReason: 'Paquete de alto volumen pactado con cliente',
    paymentTiming: 'destination_cod',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `price-sup-${Date.now()}`,
  }

  const result = await executeCreateShipment({ uid: 'sec-test-fin' }, payloadSuperior)
  assert.equal(result.isDuplicate, false)
  assert.equal(result.shipment.finalAmountCents, 2500)
  assert.equal(result.shipment.agreedAmountCents, 2500)
  assert.equal(result.shipment.suggestedAmountCents, 1500)
  assert.equal(result.shipment.isPriceAdjusted, true)
  assert.equal(result.shipment.priceAdjustmentReason, 'Paquete de alto volumen pactado con cliente')
  assert.ok(/^[A-Z]{3}\d{9}$/.test(result.shipment.trackingCode))
})

test('14. FASE 1: Precio acordado editable: secretaria registra precio inferior (rebaja comercial legítima)', async () => {
  const payloadInferior = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Estudiante Universitario', phone: '71799887' },
    recipient: { name: 'Familiar Cochabamba', phone: '72211223' },
    items: [{ description: 'Libros y apuntes', quantity: 1, weightKg: 1 }],
    // Tarifa sugerida 1500 centavos
    agreedAmountCents: 1000, // Secretaria aplica tarifa convenida Bs 10
    priceAdjustmentReason: 'Tarifa preferencial para estudiante universitario',
    paymentTiming: 'destination_cod',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `price-inf-${Date.now()}`,
  }

  const result = await executeCreateShipment({ uid: 'sec-test-fin' }, payloadInferior)
  assert.equal(result.isDuplicate, false)
  assert.equal(result.shipment.finalAmountCents, 1000)
  assert.equal(result.shipment.suggestedAmountCents, 1500)
  assert.equal(result.shipment.isPriceAdjusted, true)
})

test('15. FASE 1: Precio cero exige justificación obligatoria y rechaza montos negativos/NaN', async () => {
  const payloadCeroSinMotivo = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Directiva Institucional', phone: '71700000' },
    recipient: { name: 'Agencia Central', phone: '72200000' },
    items: [{ description: 'Correspondencia interna', quantity: 1, weightKg: 1 }],
    agreedAmountCents: 0,
    priceAdjustmentReason: '', // Vacío: debe ser rechazado
    paymentTiming: 'destination_cod',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `price-cero-no-${Date.now()}`,
  }

  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, payloadCeroSinMotivo),
    (err) => {
      assert.match(err.message, /INVALID_ARGUMENT: Para encomiendas con precio Bs 0.00 es obligatorio/i)
      return true
    }
  )

  // Precio cero CON justificación: aceptado
  const payloadCeroConMotivo = {
    ...payloadCeroSinMotivo,
    priceAdjustmentReason: 'Documentación interna administrativa institucional sin costo',
    idempotencyKey: `price-cero-ok-${Date.now()}`,
  }
  const resultCero = await executeCreateShipment({ uid: 'sec-test-fin' }, payloadCeroConMotivo)
  assert.equal(resultCero.shipment.finalAmountCents, 0)

  // Precio negativo: rechazado
  const payloadNegativo = {
    ...payloadCeroSinMotivo,
    agreedAmountCents: -500,
    idempotencyKey: `price-neg-${Date.now()}`,
  }
  await assert.rejects(
    async () => executeCreateShipment({ uid: 'sec-test-fin' }, payloadNegativo),
    (err) => {
      assert.match(err.message, /INVALID_ARGUMENT: El precio acordado debe ser un número entero de centavos no negativo/i)
      return true
    }
  )
})

test('16. FASE 4: Número de guía alfanumérico limpio sin guiones, barras ni símbolos', async () => {
  const payload = {
    originBranchId: 'punata',
    destinationBranchId: 'cochabamba',
    deliveryType: 'agency',
    sender: { name: 'Don Walter', phone: '71755555' },
    recipient: { name: 'Doña Rosa', phone: '72266666' },
    items: [{ description: 'Queso y rosquitas de Punata', quantity: 1, weightKg: 2 }],
    paymentTiming: 'destination_cod',
    prohibitedGoodsNoticeAccepted: true,
    idempotencyKey: `tracking-clean-${Date.now()}`,
  }

  const result = await executeCreateShipment({ uid: 'sec-test-fin' }, payload)
  const code = result.shipment.trackingCode
  // Formato: 3 letras de sucursal (PUN) + 4 dígitos año (2026) + 5 dígitos correlativo (0000X)
  assert.match(code, /^PUN2026\d{5}$/)
  assert.equal(code.includes('-'), false)
  assert.equal(code.includes('/'), false)
  assert.equal(code.includes(' '), false)
})
