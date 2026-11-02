import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

if (getApps().length === 0) {
  initializeApp()
}

const db = getFirestore()

// Tarifas referenciales de desarrollo (no oficiales ni confirmadas con Expreso Punata)
const TARIFFS_DEV_REFERENCE = {
  baseFeeCents: 1500, // Referencial desarrollo: Bs. 15.00
  freeWeightKg: 3,
  extraKgRateCents: 200, // Referencial desarrollo: Bs. 2.00 por kg adicional
  homeDeliveryFeeCents: 1200, // Referencial desarrollo: Bs. 12.00
}

/**
 * Cloud Function Callable para la creación atómica, segura, idempotente y auditable de encomiendas.
 * Utiliza Firebase Admin SDK y transacciones de Firestore.
 */
export const createShipment = onCall({ cors: true }, async (request) => {
  // 1. Validar autenticación
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para registrar encomiendas.')
  }

  const callerUid = request.auth.uid

  // 2. Obtener y validar perfil del usuario llamador
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'El usuario no tiene perfil registrado en el sistema.')
  }

  const userProfile = userDoc.data() || {}
  if (userProfile.isActive === false) {
    throw new HttpsError('permission-denied', 'La cuenta de usuario se encuentra inactiva.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(userProfile.role)) {
    throw new HttpsError('permission-denied', `El rol '${userProfile.role}' no tiene permiso para emitir guías de encomienda.`)
  }

  const payload = request.data || {}
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
  } = payload

  // 3. Validar sucursal autorizada para el usuario
  const userAllowedBranches = userProfile.allowedBranchIds || [userProfile.primaryBranchId]
  if (userProfile.role !== 'directiva_admin' && !userAllowedBranches.includes(originBranchId)) {
    throw new HttpsError('permission-denied', `No está autorizado para registrar envíos con origen en la sucursal '${originBranchId}'.`)
  }

  // 4. Validar sucursales de origen y destino válidas
  const validBranches = ['punata', 'cochabamba']
  if (!validBranches.includes(originBranchId)) {
    throw new HttpsError('invalid-argument', `Sucursal de origen inválida: ${originBranchId}`)
  }
  if (!validBranches.includes(destinationBranchId)) {
    throw new HttpsError('invalid-argument', `Sucursal de destino inválida: ${destinationBranchId}`)
  }
  if (originBranchId === destinationBranchId) {
    throw new HttpsError('invalid-argument', 'La sucursal de origen y destino deben ser distintas.')
  }

  // 5. Validar datos de personas
  if (!sender || !sender.name || sender.name.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'El nombre del remitente es obligatorio (mínimo 2 caracteres).')
  }
  if (!sender.phone || sender.phone.trim().length < 5) {
    throw new HttpsError('invalid-argument', 'El teléfono del remitente es obligatorio (mínimo 5 dígitos).')
  }
  if (!recipient || !recipient.name || recipient.name.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'El nombre del destinatario es obligatorio (mínimo 2 caracteres).')
  }
  if (!recipient.phone || recipient.phone.trim().length < 5) {
    throw new HttpsError('invalid-argument', 'El teléfono del destinatario es obligatorio (mínimo 5 dígitos).')
  }

  // 6. Validar modalidad de entrega
  if (!['agency', 'home', 'direct_driver'].includes(deliveryType)) {
    throw new HttpsError('invalid-argument', 'Modalidad de entrega inválida.')
  }
  if (deliveryType === 'home' && (!deliveryAddress || deliveryAddress.trim().length < 4)) {
    throw new HttpsError('invalid-argument', 'Debe especificar la dirección exacta para entrega a domicilio.')
  }

  // 7. Validar contenido y bultos
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'Debe registrar al menos un ítem o bulto en la encomienda.')
  }
  let totalWeightKg = 0
  let packageCount = 0
  for (const item of items) {
    if (!item.description || item.description.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'La descripción de cada ítem es obligatoria.')
    }
    const q = Number(item.quantity) || 1
    if (q < 1) throw new HttpsError('invalid-argument', 'La cantidad de bultos debe ser mayor a cero.')
    packageCount += q
    totalWeightKg += Math.max(0, Number(item.weightKg) || 0)
  }

  if (prohibitedGoodsNoticeAccepted !== true) {
    throw new HttpsError('failed-precondition', 'Debe aceptarse la declaración de contenido permitido.')
  }

  // 8. Validar condiciones de pago
  if (!['origin_paid', 'destination_cod'].includes(paymentTiming)) {
    throw new HttpsError('invalid-argument', 'Modalidad de cobro inválida (debe ser origen o contraentrega).')
  }
  if (paymentTiming === 'origin_paid' && !['cash', 'qr', 'transfer'].includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'Debe seleccionar un método de pago válido (efectivo, qr o transferencia).')
  }

  // 9. Requerir clave de idempotencia
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
    throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia única válida por solicitud.')
  }

  const safeIdempotencyKey = idempotencyKey.trim()

  // Huella de datos para verificar que una misma clave no se use con datos distintos
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

  // 10. Cálculo canónico del costo en centavos enteros
  const chargeableExcessWeightKg = Math.max(0, Math.round((totalWeightKg - TARIFFS_DEV_REFERENCE.freeWeightKg) * 100) / 100)
  const baseFeeCents = TARIFFS_DEV_REFERENCE.baseFeeCents
  const weightSurchargeCents = Math.round(chargeableExcessWeightKg * TARIFFS_DEV_REFERENCE.extraKgRateCents)
  const homeDeliveryFeeCents = deliveryType === 'home' ? TARIFFS_DEV_REFERENCE.homeDeliveryFeeCents : 0
  const subtotalCents = baseFeeCents + weightSurchargeCents + homeDeliveryFeeCents
  const safeDiscountCents = Math.min(subtotalCents, Math.max(0, Math.round(Number(discountCents) || 0)))
  const finalAmountCents = subtotalCents - safeDiscountCents

  // 11. Ejecución atómica en transacción Firestore
  const branchCode = originBranchId === 'punata' ? 'PUN' : 'CBB'
  const currentYear = new Date().getFullYear() // 2026
  const counterDocRef = db.collection('counters').doc(`${branchCode}_${currentYear}`)
  const idempotencyDocRef = db.collection('idempotency_keys').doc(safeIdempotencyKey)

  const result = await db.runTransaction(async (transaction) => {
    // A. Comprobar si ya existe la clave de idempotencia
    const idempDoc = await transaction.get(idempotencyDocRef)
    if (idempDoc.exists) {
      const idempData = idempDoc.data() || {}
      // Validación de aislamiento de usuario
      if (idempData.callerUid && idempData.callerUid !== callerUid) {
        throw new HttpsError('permission-denied', 'Esta clave de idempotencia pertenece a otro usuario.')
      }
      // Validación de consistencia de datos
      if (idempData.payloadFingerprint && idempData.payloadFingerprint !== payloadFingerprint) {
        throw new HttpsError('invalid-argument', 'Esta clave de idempotencia ya fue utilizada con datos de envío diferentes.')
      }
      const existingTrackingCode = idempData.trackingCode
      const existingShipmentDoc = await transaction.get(db.collection('shipments').doc(existingTrackingCode))
      if (existingShipmentDoc.exists) {
        return {
          isDuplicate: true,
          shipment: existingShipmentDoc.data(),
        }
      }
    }

    // B. Leer e incrementar el correlativo anual de la sucursal
    const counterDoc = await transaction.get(counterDocRef)
    let nextSeq = 1
    if (counterDoc.exists) {
      nextSeq = (Number(counterDoc.data().current) || 0) + 1
    }

    const seqFormatted = String(nextSeq).padStart(5, '0')
    const trackingCode = `${branchCode}-${currentYear}-${seqFormatted}`

    const shipmentDocRef = db.collection('shipments').doc(trackingCode)
    const initialStatusLogRef = shipmentDocRef.collection('status_logs').doc()

    const nowIso = new Date().toISOString()
    const isPaid = paymentTiming === 'origin_paid'
    const movementId = isPaid ? `MOV-${trackingCode}` : null

    // C. Ensamblar documento de encomienda con centavos enteros como valor canónico
    const newShipment = {
      id: trackingCode,
      trackingCode,
      idempotencyKey: safeIdempotencyKey,
      originBranchId,
      originCity: originBranchId === 'punata' ? 'Punata' : 'Cochabamba',
      destinationBranchId,
      destinationCity: destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba',
      deliveryType,
      deliveryAddress: deliveryType === 'home' ? deliveryAddress.trim() : null,

      sender: {
        name: sender.name.trim(),
        phone: sender.phone.trim(),
        docType: sender.docType || 'CI',
        docNumber: sender.docNumber ? sender.docNumber.trim() : null,
      },
      recipient: {
        name: recipient.name.trim(),
        phone: recipient.phone.trim(),
        docType: recipient.docType || 'CI',
        docNumber: recipient.docNumber ? recipient.docNumber.trim() : null,
      },

      items: items.map(it => ({
        description: it.description.trim(),
        category: it.category || 'general',
        quantity: Number(it.quantity) || 1,
        packaging: it.packaging || 'paquete',
        weightKg: Number(it.weightKg) || 0,
        isFragile: Boolean(it.isFragile),
        isPerishable: Boolean(it.isPerishable),
        handlingNotes: it.handlingNotes ? it.handlingNotes.trim() : null,
      })),
      packageCount,
      totalWeightKg,
      declaredValueTotal: Number(payload.declaredValueTotal) || 0,
      prohibitedGoodsNoticeAccepted: true,

      // Valores monetarios en centavos enteros (única fuente de verdad)
      shippingFeeCents: baseFeeCents,
      weightSurchargeCents,
      homeDeliveryFeeCents,
      discountCents: safeDiscountCents,
      finalAmountCents,

      // Condición de cobro y movimiento financiero auditable
      paymentTiming,
      paymentStatus: isPaid ? 'paid' : 'pending',
      paymentMethod: isPaid ? paymentMethod : null,
      paidAt: isPaid ? nowIso : null,
      paidCashierUid: isPaid ? callerUid : null,
      paidCashierName: isPaid ? (userProfile.fullName || 'Secretaria') : null,
      financialMovementId: movementId,

      status: 'received',
      registeredByUid: callerUid,
      registeredByName: userProfile.fullName || 'Secretaria',
      registeredByBranchId: originBranchId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    }

    // D. Registrar log inicial de auditoría
    const initialStatusLog = {
      status: 'received',
      operatorUid: callerUid,
      operatorName: userProfile.fullName || 'Secretaria',
      branchId: originBranchId,
      note: 'Recepción inicial en ventanilla y emisión de guía de encomienda',
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    }

    // E. Registro financiero auditable si fue pagado en origen
    if (isPaid && movementId) {
      const effectiveShiftId = cashShiftId || 'PENDING_SHIFT_DEV'
      const financialMovementDocRef = db.collection('financial_movements').doc(movementId)
      const financialMovement = {
        id: movementId,
        trackingCode,
        operatorUid: callerUid,
        operatorName: userProfile.fullName || 'Secretaria',
        branchId: originBranchId,
        amountCents: finalAmountCents,
        paymentMethod,
        concept: 'shipment_origin_payment',
        status: 'completed',
        cashShiftId: effectiveShiftId,
        reconciliationStatus: cashShiftId ? 'shift_assigned' : 'pending_shift_opening',
        auditNotice: cashShiftId
          ? 'Asignado a turno de caja formal'
          : 'Cobro registrado en Fase 2 sin turno de caja formal abierto (pendiente conciliación en Fase 7)',
        idempotencyKey: safeIdempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
      }
      transaction.set(financialMovementDocRef, financialMovement)
    }

    // F. Escribir operaciones atómicas en la transacción
    transaction.set(counterDocRef, {
      branchId: originBranchId,
      branchCode,
      year: currentYear,
      current: nextSeq,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    transaction.set(shipmentDocRef, newShipment)
    transaction.set(initialStatusLogRef, initialStatusLog)
    transaction.set(idempotencyDocRef, {
      trackingCode,
      callerUid,
      payloadFingerprint,
      createdAt: FieldValue.serverTimestamp(),
    })

    return {
      isDuplicate: false,
      shipment: {
        ...newShipment,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    }
  })

  return {
    success: true,
    trackingCode: result.shipment.trackingCode,
    isDuplicate: result.isDuplicate,
    shipment: result.shipment,
  }
})


/**
 * Cloud Function Callable para aprovisionamiento seguro de perfiles de usuario.
 * Solo puede ser ejecutada por usuarios con rol 'directiva_admin' activo,
 * o como bootstrap si la colección 'users' está completamente vacía.
 */
export const adminProvisionUser = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para aprovisionar usuarios.')
  }

  const callerUid = request.auth.uid
  const callerEmail = request.auth.token.email || ''

  // Verificar si la base de datos está vacía (Bootstrap inicial seguro)
  const usersSnapshot = await db.collection('users').limit(1).get()
  const isBootstrap = usersSnapshot.empty

  if (!isBootstrap) {
    const callerDoc = await db.collection('users').doc(callerUid).get()
    if (!callerDoc.exists) {
      throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
    }
    const callerData = callerDoc.data() || {}
    if (callerData.isActive === false) {
      throw new HttpsError('permission-denied', 'Su cuenta de usuario se encuentra inactiva.')
    }
    if (callerData.role !== 'directiva_admin') {
      throw new HttpsError('permission-denied', 'Solo la Directiva / Administración puede aprovisionar usuarios.')
    }
  }

  const payload = request.data || {}
  const {
    targetUid,
    fullName,
    ci,
    phone,
    role = 'secretaria',
    primaryBranchId = 'punata',
    allowedBranchIds = ['punata'],
    assignedVehiclePlate,
    assignedMobileNumber,
    isActive = true,
  } = payload

  if (!targetUid || typeof targetUid !== 'string' || !targetUid.trim()) {
    throw new HttpsError('invalid-argument', 'El targetUid del usuario es obligatorio.')
  }
  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    throw new HttpsError('invalid-argument', 'El nombre completo es obligatorio.')
  }
  if (!ci || typeof ci !== 'string' || !ci.trim()) {
    throw new HttpsError('invalid-argument', 'El número de CI es obligatorio.')
  }

  const validRoles = ['secretaria', 'conductor', 'encargado_agencia', 'tesoreria', 'directiva_admin']
  if (!validRoles.includes(role)) {
    throw new HttpsError('invalid-argument', `Rol inválido: '${role}'.`)
  }

  const validBranches = ['punata', 'cochabamba']
  if (!validBranches.includes(primaryBranchId)) {
    throw new HttpsError('invalid-argument', `Sucursal primaria inválida: '${primaryBranchId}'.`)
  }

  const nowIso = new Date().toISOString()
  const targetUserRef = db.collection('users').doc(targetUid.trim())
  const auditDocRef = db.collection('audit_logs').doc()

  const profileData = {
    uid: targetUid.trim(),
    fullName: fullName.trim(),
    ci: ci.trim(),
    phone: (phone || '').trim(),
    role,
    primaryBranchId,
    allowedBranchIds: Array.isArray(allowedBranchIds) && allowedBranchIds.length > 0 ? allowedBranchIds : [primaryBranchId],
    assignedVehiclePlate: role === 'conductor' ? assignedVehiclePlate || '' : null,
    assignedMobileNumber: role === 'conductor' ? assignedMobileNumber || '' : null,
    isActive: Boolean(isActive),
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso,
  }

  await db.runTransaction(async (transaction) => {
    const existingDoc = await transaction.get(targetUserRef)
    if (!existingDoc.exists) {
      profileData.createdAt = FieldValue.serverTimestamp()
      profileData.createdAtIso = nowIso
      profileData.createdReason = isBootstrap ? 'bootstrap_initial_admin' : 'admin_provisioned'
    }
    transaction.set(targetUserRef, profileData, { merge: true })

    transaction.set(auditDocRef, {
      id: auditDocRef.id,
      entityType: 'user_profile',
      entityId: targetUid.trim(),
      action: existingDoc.exists ? 'USER_PROFILE_UPDATED' : 'USER_PROFILE_PROVISIONED',
      performedByUid: callerUid,
      performedByEmail: callerEmail,
      isBootstrap,
      details: {
        role,
        primaryBranchId,
        isActive: Boolean(isActive),
      },
      timestamp: FieldValue.serverTimestamp(),
      timestampIso: nowIso,
    })
  })

  return {
    success: true,
    message: isBootstrap ? 'Administrador inicial creado exitosamente por bootstrap.' : 'Perfil de usuario aprovisionado exitosamente.',
    profile: {
      ...profileData,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  }
})
