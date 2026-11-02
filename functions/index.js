import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

if (getApps().length === 0) {
  initializeApp()
}

const db = getFirestore()
const authAdmin = getAuth()

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

  // 2. Obtener y validar perfil del usuario llamador (autoritativo desde Firestore)
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
    throw new HttpsError('invalid-argument', 'La dirección de entrega a domicilio es obligatoria.')
  }

  // 7. Validar items / paquetes
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'Debe incluir al menos un paquete o bulto en la encomienda.')
  }

  let totalWeightKg = 0
  let packageCount = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item.description || item.description.trim().length < 2) {
      throw new HttpsError('invalid-argument', `El ítem #${i + 1} debe contener una descripción válida.`)
    }
    const q = Number(item.quantity)
    if (!Number.isInteger(q) || q < 1) {
      throw new HttpsError('invalid-argument', `El ítem #${i + 1} tiene una cantidad inválida.`)
    }
    const w = Number(item.weightKg) || 0
    if (w < 0) {
      throw new HttpsError('invalid-argument', `El peso del ítem #${i + 1} no puede ser negativo.`)
    }
    totalWeightKg += w * q
    packageCount += q
  }

  // 8. Validar declaración de prohibición de mercadería ilegal
  if (!prohibitedGoodsNoticeAccepted) {
    throw new HttpsError('invalid-argument', 'Debe aceptar la declaración de no transporte de sustancias prohibidas o valores ilícitos.')
  }

  // 9. Requerir clave de idempotencia
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
    throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia única válida por solicitud.')
  }

  const safeIdempotencyKey = idempotencyKey.trim()

  // 10. Validación estricta de descuentos
  // Descuentos arbitrarios desde ventanilla están bloqueados. Solo Directiva / Admin puede aplicar descuentos.
  const rawDiscount = Number(discountCents) || 0
  if (rawDiscount < 0) {
    throw new HttpsError('invalid-argument', 'El descuento no puede ser un valor negativo.')
  }
  if (rawDiscount > 0 && userProfile.role !== 'directiva_admin') {
    throw new HttpsError('permission-denied', 'Los descuentos desde ventanilla están deshabilitados. Solo la Directiva / Administración puede aplicar descuentos.')
  }

  // 11. Cálculo canónico del costo en centavos enteros
  const chargeableExcessWeightKg = Math.max(0, Math.round((totalWeightKg - TARIFFS_DEV_REFERENCE.freeWeightKg) * 100) / 100)
  const baseFeeCents = TARIFFS_DEV_REFERENCE.baseFeeCents
  const weightSurchargeCents = Math.round(chargeableExcessWeightKg * TARIFFS_DEV_REFERENCE.extraKgRateCents)
  const homeDeliveryFeeCents = deliveryType === 'home' ? TARIFFS_DEV_REFERENCE.homeDeliveryFeeCents : 0
  const subtotalCents = baseFeeCents + weightSurchargeCents + homeDeliveryFeeCents
  const safeDiscountCents = Math.min(subtotalCents, Math.round(rawDiscount))
  const finalAmountCents = subtotalCents - safeDiscountCents

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
    declaredValueTotal: Number(payload.declaredValueTotal) || 0,
    paymentTiming,
    paymentMethod: paymentTiming === 'origin_paid' ? paymentMethod : null,
  })

  // 12. Regla de cobro seguro y consistencia financiera
  const isPaid = paymentTiming === 'origin_paid'

  // 13. Ejecución atómica en transacción Firestore
  const branchCode = originBranchId === 'punata' ? 'PUN' : 'CBB'
  const currentYear = new Date().getFullYear() // 2026
  const counterDocRef = db.collection('counters').doc(`${branchCode}_${currentYear}`)
  const idempotencyDocRef = db.collection('idempotency_keys').doc(safeIdempotencyKey)

  const result = await db.runTransaction(async (transaction) => {
    // A. Comprobar si ya existe la clave de idempotencia
    const idempDoc = await transaction.get(idempotencyDocRef)
    if (idempDoc.exists) {
      const idempData = idempDoc.data() || {}
      if (idempData.callerUid !== callerUid) {
        throw new HttpsError('permission-denied', 'La clave de idempotencia especificada pertenece a otro usuario.')
      }
      if (idempData.payloadFingerprint !== payloadFingerprint) {
        throw new HttpsError('invalid-argument', 'La clave de idempotencia ya fue utilizada con datos de encomienda diferentes.')
      }

      const existingShipmentDoc = await transaction.get(db.collection('shipments').doc(idempData.trackingCode))
      if (existingShipmentDoc.exists) {
        return {
          isDuplicate: true,
          shipment: existingShipmentDoc.data(),
        }
      }
    }

    // B. Validación estricta del turno de caja en la misma transacción
    let isDefinitivePayment = false
    let movementId = null
    let effectiveShiftId = null

    if (isPaid && cashShiftId) {
      const shiftDocRef = db.collection('cash_shifts').doc(cashShiftId)
      const shiftDoc = await transaction.get(shiftDocRef)
      if (!shiftDoc.exists) {
        throw new HttpsError('failed-precondition', `El turno de caja '${cashShiftId}' no existe en el sistema.`)
      }
      const shiftData = shiftDoc.data() || {}
      if (shiftData.status !== 'open') {
        throw new HttpsError('failed-precondition', `El turno de caja '${cashShiftId}' no está abierto (estado actual: ${shiftData.status}).`)
      }
      if (shiftData.operatorUid !== callerUid) {
        throw new HttpsError('permission-denied', `El turno de caja '${cashShiftId}' pertenece a otro operador.`)
      }
      if (shiftData.branchId !== originBranchId) {
        throw new HttpsError('permission-denied', `El turno de caja '${cashShiftId}' no corresponde a la sucursal de origen '${originBranchId}'.`)
      }
      isDefinitivePayment = true
      effectiveShiftId = cashShiftId
    }

    // C. Leer y avanzar correlativo anual por sucursal
    const counterDoc = await transaction.get(counterDocRef)
    let nextSeq = 1
    if (counterDoc.exists) {
      const data = counterDoc.data() || {}
      nextSeq = (Number(data.current) || 0) + 1
    }

    const seqPadded = String(nextSeq).padStart(5, '0')
    const trackingCode = `${branchCode}-${currentYear}-${seqPadded}`
    if (isDefinitivePayment) {
      movementId = `MOV-${trackingCode}`
    }

    const shipmentDocRef = db.collection('shipments').doc(trackingCode)
    const initialStatusLogRef = shipmentDocRef.collection('status_logs').doc()
    const nowIso = new Date().toISOString()

    // D. Construir documento canónico de encomienda
    const newShipment = {
      id: trackingCode,
      trackingCode,
      originBranchId,
      destinationBranchId,
      deliveryType,
      deliveryAddress: deliveryType === 'home' ? deliveryAddress.trim() : null,

      sender: {
        name: sender.name.trim(),
        phone: sender.phone.trim(),
        docNumber: sender.docNumber ? sender.docNumber.trim() : null,
      },
      recipient: {
        name: recipient.name.trim(),
        phone: recipient.phone.trim(),
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
      paymentStatus: isDefinitivePayment ? 'paid' : 'pending',
      paymentMethod: isDefinitivePayment ? paymentMethod : null,
      paidAt: isDefinitivePayment ? nowIso : null,
      paidCashierUid: isDefinitivePayment ? callerUid : null,
      paidCashierName: isDefinitivePayment ? (userProfile.fullName || 'Secretaria') : null,
      financialMovementId: movementId,
      paymentNotice: !isDefinitivePayment && isPaid
        ? 'Cobro pendiente de registro en caja formal (Fase 7)'
        : null,

      status: 'received',
      registeredByUid: callerUid,
      registeredByName: userProfile.fullName || 'Secretaria',
      registeredByBranchId: originBranchId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    }

    // E. Registrar log inicial de auditoría
    const initialStatusLog = {
      status: 'received',
      operatorUid: callerUid,
      operatorName: userProfile.fullName || 'Secretaria',
      branchId: originBranchId,
      note: 'Recepción inicial en ventanilla y emisión de guía de encomienda',
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    }

    // F. Registro financiero auditable si fue pagado efectivamente con turno validado
    if (isDefinitivePayment && movementId && effectiveShiftId) {
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
        reconciliationStatus: 'shift_assigned',
        auditNotice: 'Asignado a turno de caja formal verificado',
        idempotencyKey: safeIdempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
      }
      transaction.set(financialMovementDocRef, financialMovement)
    }

    // G. Escribir operaciones atómicas en la transacción
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
 * Solo puede ser ejecutada por usuarios con rol 'directiva_admin' activo.
 * (El bootstrap inicial del primer administrador se realiza exclusivamente vía CLI privada bajo control de PACHAX).
 */
export const adminProvisionUser = onCall({ cors: true }, async (request) => {
  // 1. Validar autenticación
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para aprovisionar usuarios.')
  }

  const callerUid = request.auth.uid
  const callerEmail = request.auth.token.email || ''

  // 2. Validar que el llamador sea un directiva_admin activo (autoritativo desde Firestore)
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
  }
  const callerData = callerDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Su cuenta de usuario se encuentra inactiva.')
  }
  if (callerData.role !== 'directiva_admin') {
    throw new HttpsError('permission-denied', 'Solo la Directiva / Administración puede aprovisionar o modificar usuarios.')
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

  const safeTargetUid = targetUid.trim()

  // 3. Verificar que el usuario exista en Firebase Authentication
  let targetAuthUser = null
  try {
    targetAuthUser = await authAdmin.getUser(safeTargetUid)
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', `El usuario con UID '${safeTargetUid}' no existe en Firebase Authentication.`)
    }
  }

  const nowIso = new Date().toISOString()
  const targetUserRef = db.collection('users').doc(safeTargetUid)
  const auditDocRef = db.collection('audit_logs').doc()

  const profileData = {
    uid: safeTargetUid,
    email: targetAuthUser?.email || payload.email || '',
    fullName: fullName.trim(),
    ci: ci.trim(),
    phone: (phone || '').trim(),
    role,
    primaryBranchId,
    allowedBranchIds: Array.isArray(allowedBranchIds) && allowedBranchIds.length > 0 ? allowedBranchIds : [primaryBranchId],
    assignedVehiclePlate: role === 'conductor' ? assignedVehiclePlate || '' : null,
    assignedMobileNumber: role === 'conductor' ? assignedMobileNumber || '' : null,
    isActive: Boolean(isActive),
    syncStatus: 'syncing',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso,
  }

  // Escribir perfil en Firestore
  await db.runTransaction(async (transaction) => {
    const existingDoc = await transaction.get(targetUserRef)
    if (!existingDoc.exists) {
      profileData.createdAt = FieldValue.serverTimestamp()
      profileData.createdAtIso = nowIso
      profileData.createdReason = 'admin_provisioned'
    }
    transaction.set(targetUserRef, profileData, { merge: true })
  })

  // 4. Sincronizar Custom Claims en Firebase Authentication
  try {
    await authAdmin.setCustomUserClaims(safeTargetUid, {
      role: profileData.role,
      branchId: profileData.primaryBranchId,
      allowedBranches: profileData.allowedBranchIds,
      isActive: profileData.isActive,
    })

    // Si el usuario fue desactivado, revocar tokens de sesión inmediatamente
    if (!profileData.isActive) {
      await authAdmin.revokeRefreshTokens(safeTargetUid)
    }

    // Actualizar estado de sincronización exitosa en Firestore y log de auditoría
    await db.runTransaction(async (transaction) => {
      transaction.update(targetUserRef, {
        syncStatus: 'synced',
        claimsSyncedAt: FieldValue.serverTimestamp(),
        claimsSyncedAtIso: new Date().toISOString(),
      })
      transaction.set(auditDocRef, {
        id: auditDocRef.id,
        entityType: 'user_profile',
        entityId: safeTargetUid,
        action: 'USER_PROFILE_PROVISIONED_AND_SYNCED',
        performedByUid: callerUid,
        performedByEmail: callerEmail,
        details: {
          role,
          primaryBranchId,
          isActive: Boolean(isActive),
          claimsSynced: true,
        },
        timestamp: FieldValue.serverTimestamp(),
        timestampIso: new Date().toISOString(),
      })
    })
  } catch (claimErr) {
    console.error(`[adminProvisionUser] Fallo crítico al sincronizar custom claims para ${safeTargetUid}:`, claimErr)

    // Reconciliación: Registrar fallo explícito en Firestore y auditoría
    try {
      await targetUserRef.set({
        syncStatus: 'failed',
        syncError: claimErr.message,
        isActive: false, // Forzar inactivo por seguridad hasta reconciliación
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })

      await db.collection('audit_logs').add({
        entityType: 'user_profile',
        entityId: safeTargetUid,
        action: 'USER_CLAIMS_SYNC_FAILED',
        performedByUid: callerUid,
        performedByEmail: callerEmail,
        error: claimErr.message,
        timestamp: FieldValue.serverTimestamp(),
        timestampIso: new Date().toISOString(),
      })
    } catch (auditErr) {
      console.error('[adminProvisionUser] Error al registrar fallo en auditoría:', auditErr)
    }

    // NO declarar éxito si la sincronización falló
    throw new HttpsError(
      'internal',
      `Fallo crítico al sincronizar Custom Claims en Firebase Authentication: ${claimErr.message}. El usuario no fue habilitado.`
    )
  }

  return {
    success: true,
    message: 'Perfil de usuario aprovisionado y claims sincronizados exitosamente.',
    profile: {
      ...profileData,
      syncStatus: 'synced',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  }
})
