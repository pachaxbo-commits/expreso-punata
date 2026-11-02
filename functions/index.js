import crypto from 'node:crypto'
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

    if (isPaid) {
      let resolvedShiftId = cashShiftId && typeof cashShiftId === 'string' && cashShiftId.trim() ? cashShiftId.trim() : null

      if (!resolvedShiftId) {
        // Localizar turno activo autorizado del operador y sucursal desde el candado determinístico
        const activeLockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${originBranchId}`)
        const activeLockDoc = await transaction.get(activeLockRef)
        if (activeLockDoc.exists) {
          const lockData = activeLockDoc.data() || {}
          if (lockData.status === 'open' && lockData.shiftId) {
            resolvedShiftId = lockData.shiftId
          }
        }
      }

      if (!resolvedShiftId) {
        if (payload.allowPendingFallback === true) {
          isDefinitivePayment = false
        } else {
          throw new HttpsError(
            'failed-precondition',
            `No tiene un turno de caja abierto en la sucursal de origen '${originBranchId}'. Debe abrir caja para registrar cobros en origen o seleccionar pago pendiente / contraentrega.`
          )
        }
      } else {
        const shiftDocRef = db.collection('cash_shifts').doc(resolvedShiftId)
        const shiftDoc = await transaction.get(shiftDocRef)
        if (!shiftDoc.exists) {
          throw new HttpsError('failed-precondition', `El turno de caja '${resolvedShiftId}' no existe en el sistema.`)
        }
        const shiftData = shiftDoc.data() || {}
        if (shiftData.status !== 'open') {
          throw new HttpsError('failed-precondition', `El turno de caja '${resolvedShiftId}' no está abierto (estado actual: ${shiftData.status}).`)
        }
        if (shiftData.operatorUid !== callerUid) {
          throw new HttpsError('permission-denied', `El turno de caja '${resolvedShiftId}' pertenece a otro operador.`)
        }
        if (shiftData.branchId !== originBranchId) {
          throw new HttpsError('permission-denied', `El turno de caja '${resolvedShiftId}' no corresponde a la sucursal de origen '${originBranchId}'.`)
        }
        isDefinitivePayment = true
        effectiveShiftId = resolvedShiftId
      }
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
      cashShiftId: isDefinitivePayment ? effectiveShiftId : null,
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
        shiftId: effectiveShiftId,
        branchId: originBranchId,
        operatorUid: callerUid,
        operatorName: userProfile.fullName || 'Secretaria',
        amountCents: finalAmountCents,
        paymentMethod,
        type: 'shipment_income',
        concept: `Cobro en origen de encomienda ${trackingCode}`,
        referenceId: trackingCode,
        status: 'completed',
        cashShiftId: effectiveShiftId,
        reconciliationStatus: 'shift_assigned',
        auditNotice: 'Asignado a turno de caja formal verificado',
        idempotencyKey: safeIdempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
        createdAtIso: nowIso,
      }
      transaction.set(financialMovementDocRef, financialMovement)

      // Actualizar desglose y totales acumulados en cash_shifts
      const shiftUpdate = {
        updatedAt: FieldValue.serverTimestamp(),
        'breakdown.totalIncomeCents': FieldValue.increment(finalAmountCents),
        'breakdown.shipmentsIncomeCents': FieldValue.increment(finalAmountCents),
        movementsCount: FieldValue.increment(1),
      }

      if (paymentMethod === 'cash') {
        shiftUpdate.expectedCashCents = FieldValue.increment(finalAmountCents)
        shiftUpdate['breakdown.cashIncomeCents'] = FieldValue.increment(finalAmountCents)
        shiftUpdate['breakdown.netCashCents'] = FieldValue.increment(finalAmountCents)
      } else if (paymentMethod === 'qr') {
        shiftUpdate['breakdown.qrIncomeCents'] = FieldValue.increment(finalAmountCents)
      } else if (paymentMethod === 'transfer') {
        shiftUpdate['breakdown.transferIncomeCents'] = FieldValue.increment(finalAmountCents)
      }

      transaction.update(db.collection('cash_shifts').doc(effectiveShiftId), shiftUpdate)
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

  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    throw new HttpsError('invalid-argument', 'El nombre completo es obligatorio.')
  }

  // CI opcional: se guarda como null si no se ingresa; nunca inventar valores ficticios
  const safeCi = ci && typeof ci === 'string' && ci.trim() ? ci.trim() : null

  const validRoles = ['secretaria', 'conductor', 'encargado_agencia', 'tesoreria', 'directiva_admin']
  if (!validRoles.includes(role)) {
    throw new HttpsError('invalid-argument', `Rol inválido: '${role}'.`)
  }

  const validBranches = ['punata', 'cochabamba']
  if (!validBranches.includes(primaryBranchId)) {
    throw new HttpsError('invalid-argument', `Sucursal primaria inválida: '${primaryBranchId}'.`)
  }

  let safeTargetUid = targetUid && typeof targetUid === 'string' && targetUid.trim() ? targetUid.trim() : null
  let targetAuthUser = null

  // PROTECCIÓN ESTRICTA DEL ÚLTIMO ADMINISTRADOR ACTIVO CONTRA CONCURRENCIA
  if (safeTargetUid) {
    await db.runTransaction(async (transaction) => {
      const lockRef = db.collection('system_locks').doc('admin_management')
      await transaction.get(lockRef)

      const targetDocRef = db.collection('users').doc(safeTargetUid)
      const existingTargetDoc = await transaction.get(targetDocRef)

      if (existingTargetDoc.exists) {
        const existingData = existingTargetDoc.data() || {}
        const isCurrentlyActiveAdmin = existingData.role === 'directiva_admin' && existingData.isActive === true
        const willBeInactive = Boolean(isActive) === false
        const willDemoteRole = role !== 'directiva_admin'

        if (isCurrentlyActiveAdmin && (willBeInactive || willDemoteRole)) {
          const activeAdminsQuery = db.collection('users')
            .where('role', '==', 'directiva_admin')
            .where('isActive', '==', true)

          const activeAdminsSnap = await transaction.get(activeAdminsQuery)
          const otherAdmins = activeAdminsSnap.docs.filter((d) => d.id !== safeTargetUid)

          if (otherAdmins.length === 0) {
            throw new HttpsError(
              'failed-precondition',
              'Operación denegada por seguridad: no es posible suspender ni retirar privilegios al único Administrador General activo del sistema.'
            )
          }
        }
      }

      transaction.set(lockRef, {
        lastEvaluatedAt: FieldValue.serverTimestamp(),
        targetUid: safeTargetUid,
      }, { merge: true })
    })
  }

  // 3. Resolución / Creación en Firebase Authentication
  if (!safeTargetUid) {
    // Alta de nuevo usuario a través de correo electrónico
    const email = payload.email
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'Para dar de alta a un nuevo usuario se requiere un correo electrónico válido.')
    }
    const safeEmail = email.trim().toLowerCase()

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      throw new HttpsError('invalid-argument', 'El número de teléfono es obligatorio para registrar un nuevo operador.')
    }

    try {
      targetAuthUser = await authAdmin.getUserByEmail(safeEmail)
      safeTargetUid = targetAuthUser.uid
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // Generar contraseña aleatoria temporal criptográfica segura con crypto (alta entropía, nunca expuesta)
        const tempPassword = 'Ep_' + crypto.randomBytes(24).toString('base64url') + '!9Az'
        targetAuthUser = await authAdmin.createUser({
          email: safeEmail,
          displayName: fullName.trim(),
          password: tempPassword,
          disabled: !Boolean(isActive),
        })
        safeTargetUid = targetAuthUser.uid
      } else {
        throw err
      }
    }
  } else {
    // Usuario existente por UID
    try {
      targetAuthUser = await authAdmin.getUser(safeTargetUid)
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', `El usuario con UID '${safeTargetUid}' no existe en Firebase Authentication.`)
      }
      throw err
    }
  }

  // Sincronizar estado disabled, displayName y cambio de email en Firebase Auth de forma FAIL-CLOSED
  if (targetAuthUser) {
    const requestedEmail = payload.email && typeof payload.email === 'string' && payload.email.includes('@')
      ? payload.email.trim().toLowerCase()
      : targetAuthUser.email

    const authUpdatePayload = {
      disabled: !Boolean(isActive),
      displayName: fullName.trim(),
    }

    const emailChanged = requestedEmail && requestedEmail !== targetAuthUser.email
    if (emailChanged) {
      authUpdatePayload.email = requestedEmail
      authUpdatePayload.emailVerified = false // Exige verificación de la nueva dirección
    }

    try {
      targetAuthUser = await authAdmin.updateUser(safeTargetUid, authUpdatePayload)
    } catch (authUpErr) {
      throw new HttpsError('internal', `Fallo crítico al actualizar cuenta en Firebase Authentication: ${authUpErr.message}`)
    }
  }

  const nowIso = new Date().toISOString()
  const targetUserRef = db.collection('users').doc(safeTargetUid)
  const auditDocRef = db.collection('audit_logs').doc()

  const safePhone = phone && typeof phone === 'string' && phone.trim() ? phone.trim() : ''

  const profileData = {
    uid: safeTargetUid,
    email: targetAuthUser?.email || (payload.email ? payload.email.trim().toLowerCase() : ''),
    fullName: fullName.trim(),
    ci: safeCi,
    phone: safePhone,
    role,
    primaryBranchId,
    allowedBranchIds: Array.isArray(allowedBranchIds) && allowedBranchIds.length > 0 ? allowedBranchIds : [primaryBranchId],
    assignedVehiclePlate: role === 'conductor' ? (assignedVehiclePlate || '') : null,
    assignedMobileNumber: role === 'conductor' ? (assignedMobileNumber || '') : null,
    isActive: Boolean(isActive),
    syncStatus: 'syncing',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: nowIso,
  }

  // Escribir perfil en Firestore bajo candado transaccional
  await db.runTransaction(async (transaction) => {
    const lockRef = db.collection('system_locks').doc('admin_management')
    await transaction.get(lockRef)

    const existingDoc = await transaction.get(targetUserRef)
    if (existingDoc.exists) {
      const existingData = existingDoc.data() || {}
      const isCurrentlyActiveAdmin = existingData.role === 'directiva_admin' && existingData.isActive === true
      const willBeInactive = Boolean(isActive) === false
      const willDemoteRole = role !== 'directiva_admin'

      if (isCurrentlyActiveAdmin && (willBeInactive || willDemoteRole)) {
        const activeAdminsQuery = db.collection('users')
          .where('role', '==', 'directiva_admin')
          .where('isActive', '==', true)

        const activeAdminsSnap = await transaction.get(activeAdminsQuery)
        const otherAdmins = activeAdminsSnap.docs.filter((d) => d.id !== safeTargetUid)

        if (otherAdmins.length === 0) {
          throw new HttpsError(
            'failed-precondition',
            'Operación denegada por seguridad: no es posible suspender ni retirar privilegios al único Administrador General activo del sistema.'
          )
        }
      }

      if (!safePhone && existingData.phone) {
        profileData.phone = existingData.phone
      }
    } else {
      profileData.createdAt = FieldValue.serverTimestamp()
      profileData.createdAtIso = nowIso
      profileData.createdReason = 'admin_provisioned'
    }

    transaction.set(lockRef, {
      lastUpdateAt: FieldValue.serverTimestamp(),
      modifiedUid: safeTargetUid,
    }, { merge: true })

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
          email: profileData.email,
          fullName: profileData.fullName,
          role,
          primaryBranchId,
          isActive: Boolean(isActive),
          ciProvided: safeCi !== null,
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

  // NUNCA devolver enlaces sensibles, tokens ni contraseñas al cliente
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

/**
 * Cloud Function Callable para autorizar solicitud de restablecimiento de contraseña.
 * Protegido exclusivamente para directiva_admin.
 * NO expone enlaces sensibles: registra la auditoría y permite al cliente disparar
 * el correo oficial de Firebase Auth hacia la bandeja registrada del trabajador.
 */
export const adminSendPasswordReset = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para solicitar restablecimiento de contraseñas.')
  }

  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
  }
  const callerData = callerDoc.data() || {}
  if (!callerData.isActive || callerData.role !== 'directiva_admin') {
    throw new HttpsError('permission-denied', 'Solo la Directiva / Administración puede solicitar restablecimiento de contraseñas.')
  }

  const payload = request.data || {}
  let userEmail = payload.email && typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const targetUid = payload.targetUid && typeof payload.targetUid === 'string' ? payload.targetUid.trim() : null

  if (!userEmail && targetUid) {
    try {
      const user = await authAdmin.getUser(targetUid)
      userEmail = user.email || ''
    } catch (err) {
      throw new HttpsError('not-found', `No se encontró usuario en Auth con UID '${targetUid}'.`)
    }
  }

  if (!userEmail) {
    throw new HttpsError('invalid-argument', 'Se requiere el correo electrónico del usuario.')
  }

  // Registrar auditoría de seguridad
  await db.collection('audit_logs').add({
    entityType: 'user_profile',
    entityId: targetUid || userEmail,
    action: 'PASSWORD_RESET_AUTHORIZED_BY_ADMIN',
    performedByUid: callerUid,
    performedByEmail: request.auth.token?.email || callerData.email || '',
    details: { email: userEmail },
    timestamp: FieldValue.serverTimestamp(),
    timestampIso: new Date().toISOString(),
  })

  // Jamás devolver enlaces sensibles al navegador ni a la interfaz
  return {
    success: true,
    email: userEmail,
    message: 'Solicitud de restablecimiento autorizada y registrada en auditoría.',
  }
})


/**
 * =============================================================================
 * CLOUD FUNCTION: openCashShift (Apertura Segura de Turno de Caja)
 * =============================================================================
 */
export const openCashShift = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para abrir un turno de caja.')
  }

  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
  }
  const callerData = callerDoc.data() || {}
  if (!callerData.isActive) {
    throw new HttpsError('permission-denied', 'Su cuenta de usuario se encuentra inactiva.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', `El rol '${callerData.role}' no tiene permiso para abrir turnos de caja.`)
  }

  const payload = request.data || {}
  const branchId = payload.branchId && typeof payload.branchId === 'string' ? payload.branchId.trim().toLowerCase() : ''
  const validBranches = ['punata', 'cochabamba']
  if (!validBranches.includes(branchId)) {
    throw new HttpsError('invalid-argument', `Sucursal inválida: '${branchId}'.`)
  }

  // Validar sucursal permitida para el operador
  const allowedBranches = Array.isArray(callerData.allowedBranchIds) && callerData.allowedBranchIds.length > 0
    ? callerData.allowedBranchIds
    : [callerData.primaryBranchId]
  if (callerData.role !== 'directiva_admin' && !allowedBranches.includes(branchId)) {
    throw new HttpsError('permission-denied', `No tiene permiso para operar la caja de la sucursal '${branchId}'.`)
  }

  const initialCashCents = Math.round(Number(payload.initialCashCents) || 0)
  if (initialCashCents < 0) {
    throw new HttpsError('invalid-argument', 'El fondo inicial de caja no puede ser negativo.')
  }

  const initialCashBreakdown = payload.initialCashBreakdown && typeof payload.initialCashBreakdown === 'object'
    ? payload.initialCashBreakdown
    : null
  const notes = payload.notes && typeof payload.notes === 'string' ? payload.notes.trim() : ''

  const now = new Date()
  const nowIso = now.toISOString()
  const currentYear = now.getFullYear()
  const branchCode = branchId === 'punata' ? 'PUN' : 'CBB'

  return await db.runTransaction(async (transaction) => {
    // 1. Candado determinístico de operador y sucursal para evitar doble apertura o concurrencia
    const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${branchId}`)
    const lockDoc = await transaction.get(lockRef)

    if (lockDoc.exists) {
      const lockData = lockDoc.data() || {}
      if (lockData.status === 'open') {
        throw new HttpsError(
          'failed-precondition',
          `Ya existe un turno de caja abierto para este operador en la sucursal '${branchId}'. Debe cerrar el turno anterior antes de abrir uno nuevo.`
        )
      }
    }

    // 2. Obtener y avanzar correlativo anual de turnos
    const counterRef = db.collection('counters').doc(`shifts_${branchId}_${currentYear}`)
    const counterDoc = await transaction.get(counterRef)
    let nextSeq = 1
    if (counterDoc.exists) {
      nextSeq = (Number(counterDoc.data().current) || 0) + 1
    }

    const shiftSeqPadded = String(nextSeq).padStart(4, '0')
    const shiftId = `TUR-${branchCode}-${currentYear}-${shiftSeqPadded}`

    // 3. Documento canónico del turno de caja
    const shiftData = {
      id: shiftId,
      shiftNumber: shiftId,
      branchId,
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      openedAt: nowIso,
      openedAtServer: FieldValue.serverTimestamp(),
      initialCashCents,
      initialCashBreakdown,
      status: 'open',
      closedByUid: null,
      closedByName: null,
      closedAt: null,
      notes,
      closingNotes: null,
      expectedCashCents: initialCashCents,
      actualCashCents: null,
      differenceCents: null,
      differenceStatus: null,
      breakdown: {
        initialCashCents,
        cashIncomeCents: 0,
        qrIncomeCents: 0,
        transferIncomeCents: 0,
        totalIncomeCents: 0,
        shipmentsIncomeCents: 0,
        codIncomeCents: 0,
        contributionsIncomeCents: 0,
        monthlyFeesIncomeCents: 0,
        otherIncomeCents: 0,
        expensesCents: 0,
        refundsCents: 0,
        pendingIncomeCents: 0,
        netCashCents: initialCashCents,
      },
      movementsCount: initialCashCents > 0 ? 1 : 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    // 4. Registro de movimiento financiero para el fondo inicial (separado de ventas)
    if (initialCashCents > 0) {
      const initMovementId = `MOV-INIT-${shiftId}`
      const initMovement = {
        id: initMovementId,
        shiftId,
        branchId,
        operatorUid: callerUid,
        operatorName: callerData.fullName || 'Operador',
        type: 'initial_cash',
        amountCents: initialCashCents,
        paymentMethod: 'cash',
        concept: 'Fondo inicial de apertura de caja (cambio/sencillo)',
        referenceId: shiftId,
        status: 'completed',
        timestamp: nowIso,
        createdAt: FieldValue.serverTimestamp(),
      }
      transaction.set(db.collection('financial_movements').doc(initMovementId), initMovement)
    }

    // 5. Escribir documentos atómicamente
    transaction.set(counterRef, {
      branchId,
      current: nextSeq,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    transaction.set(db.collection('cash_shifts').doc(shiftId), shiftData)

    transaction.set(lockRef, {
      shiftId,
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      branchId,
      status: 'open',
      openedAt: FieldValue.serverTimestamp(),
    })

    // Log de auditoría
    transaction.set(db.collection('audit_logs').doc(), {
      entityType: 'cash_shift',
      entityId: shiftId,
      action: 'CASH_SHIFT_OPENED',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      branchId,
      initialCashCents,
      timestamp: FieldValue.serverTimestamp(),
      timestampIso: nowIso,
    })

    return {
      success: true,
      shift: {
        ...shiftData,
        openedAtServer: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    }
  })
})

/**
 * =============================================================================
 * CLOUD FUNCTION: closeCashShift (Cierre Seguro y Arqueo Transaccional de Caja)
 * =============================================================================
 */
export const closeCashShift = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para cerrar un turno de caja.')
  }

  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
  }
  const callerData = callerDoc.data() || {}
  if (!callerData.isActive) {
    throw new HttpsError('permission-denied', 'Su cuenta de usuario se encuentra inactiva.')
  }

  const payload = request.data || {}
  const shiftId = payload.shiftId && typeof payload.shiftId === 'string' ? payload.shiftId.trim() : ''
  if (!shiftId) {
    throw new HttpsError('invalid-argument', 'Se requiere el identificador del turno de caja.')
  }

  if (payload.actualCashCents === undefined || payload.actualCashCents === null || isNaN(Number(payload.actualCashCents))) {
    throw new HttpsError('invalid-argument', 'Debe ingresar el monto de efectivo físico contado en centavos.')
  }

  const actualCashCents = Math.round(Number(payload.actualCashCents))
  if (actualCashCents < 0) {
    throw new HttpsError('invalid-argument', 'El efectivo contado no puede ser negativo.')
  }

  const actualCashBreakdown = payload.actualCashBreakdown && typeof payload.actualCashBreakdown === 'object'
    ? payload.actualCashBreakdown
    : null

  // Validación autoritativa del desglose de billetes y monedas cuando se proporciona
  if (actualCashBreakdown) {
    let breakdownSumCents = 0
    for (const [key, rawCount] of Object.entries(actualCashBreakdown)) {
      const denomVal = parseFloat(key.replace(/^[bc]/i, ''))
      if (isNaN(denomVal) || denomVal <= 0) {
        continue
      }
      const count = parseInt(rawCount, 10) || 0
      if (count < 0) {
        throw new HttpsError('invalid-argument', `La cantidad para la denominación Bs ${key} no puede ser negativa.`)
      }
      const denomCents = Math.round(denomVal * 100)
      breakdownSumCents += denomCents * count
    }
    if (breakdownSumCents !== actualCashCents) {
      throw new HttpsError(
        'invalid-argument',
        `El desglose de billetes y monedas (Bs ${(breakdownSumCents / 100).toFixed(2)}) no coincide con el efectivo físico declarado (Bs ${(actualCashCents / 100).toFixed(2)}).`
      )
    }
  }

  const notes = payload.notes && typeof payload.notes === 'string' ? payload.notes.trim() : ''

  const nowIso = new Date().toISOString()

  return await db.runTransaction(async (transaction) => {
    const shiftRef = db.collection('cash_shifts').doc(shiftId)
    const shiftDoc = await transaction.get(shiftRef)

    if (!shiftDoc.exists) {
      throw new HttpsError('failed-precondition', `El turno de caja '${shiftId}' no existe en el sistema.`)
    }

    const shiftData = shiftDoc.data() || {}
    if (shiftData.status !== 'open') {
      throw new HttpsError('failed-precondition', `El turno de caja '${shiftId}' ya fue cerrado previamente el ${shiftData.closedAt || 'anteriormente'}.`)
    }

    // Permisos: el mismo operador, encargado de esa sucursal, tesorería de esa sucursal, o admin general
    const isOwner = shiftData.operatorUid === callerUid
    const isManagerOfBranch = callerData.role === 'encargado_agencia' && (callerData.allowedBranchIds || [callerData.primaryBranchId]).includes(shiftData.branchId)
    const isAdmin = callerData.role === 'directiva_admin'

    if (!isOwner && !isManagerOfBranch && !isAdmin) {
      throw new HttpsError('permission-denied', 'No tiene autorización para cerrar este turno de caja.')
    }

    const expectedCashCents = Number(shiftData.expectedCashCents) || 0
    const differenceCents = actualCashCents - expectedCashCents
    const differenceStatus = differenceCents === 0 ? 'conforme' : differenceCents > 0 ? 'sobrante' : 'faltante'

    const shiftCloseUpdate = {
      status: 'closed',
      closedByUid: callerUid,
      closedByName: callerData.fullName || 'Operador',
      closedAt: nowIso,
      closedAtServer: FieldValue.serverTimestamp(),
      actualCashCents,
      differenceCents,
      differenceStatus,
      actualCashBreakdown,
      closingNotes: notes,
      updatedAt: FieldValue.serverTimestamp(),
    }

    // Actualizar candado determinístico a cerrado
    const lockRef = db.collection('cash_shift_active_locks').doc(`${shiftData.operatorUid}_${shiftData.branchId}`)
    transaction.set(lockRef, {
      status: 'closed',
      closedAt: FieldValue.serverTimestamp(),
      lastClosedShiftId: shiftId,
    }, { merge: true })

    // Si hay diferencia (sobrante o faltante), registrar movimiento de ajuste
    if (differenceCents !== 0) {
      const diffMovementId = `MOV-ADJ-${shiftId}`
      const diffMovement = {
        id: diffMovementId,
        shiftId,
        branchId: shiftData.branchId,
        operatorUid: callerUid,
        operatorName: callerData.fullName || 'Operador',
        type: 'adjustment',
        amountCents: differenceCents,
        paymentMethod: 'cash',
        concept: `Ajuste por ${differenceStatus} de caja en arqueo: Bs ${(differenceCents / 100).toFixed(2)}`,
        referenceId: shiftId,
        status: 'completed',
        timestamp: nowIso,
        createdAt: FieldValue.serverTimestamp(),
      }
      transaction.set(db.collection('financial_movements').doc(diffMovementId), diffMovement)
    }

    transaction.update(shiftRef, shiftCloseUpdate)

    // Log de auditoría
    transaction.set(db.collection('audit_logs').doc(), {
      entityType: 'cash_shift',
      entityId: shiftId,
      action: 'CASH_SHIFT_CLOSED',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      branchId: shiftData.branchId,
      expectedCashCents,
      actualCashCents,
      differenceCents,
      differenceStatus,
      timestamp: FieldValue.serverTimestamp(),
      timestampIso: nowIso,
    })

    return {
      success: true,
      shift: {
        ...shiftData,
        ...shiftCloseUpdate,
        closedAtServer: nowIso,
        updatedAt: nowIso,
      },
    }
  })
})

/**
 * =============================================================================
 * CLOUD FUNCTION: registerCashExpense (Registro Seguro de Egreso de Caja)
 * =============================================================================
 */
export const registerCashExpense = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para registrar un egreso de caja.')
  }

  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
  }
  const callerData = callerDoc.data() || {}
  if (!callerData.isActive) {
    throw new HttpsError('permission-denied', 'Su cuenta de usuario se encuentra inactiva.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para registrar gastos de caja.')
  }

  const payload = request.data || {}
  const branchId = payload.branchId && typeof payload.branchId === 'string' ? payload.branchId.trim().toLowerCase() : ''
  const amountCents = Math.round(Number(payload.amountCents) || 0)
  const concept = payload.concept && typeof payload.concept === 'string' ? payload.concept.trim() : ''
  const category = payload.category && typeof payload.category === 'string' ? payload.category.trim().toLowerCase() : 'oficina'
  const voucherNumber = payload.voucherNumber && typeof payload.voucherNumber === 'string' ? payload.voucherNumber.trim() : null
  const idempotencyKey = payload.idempotencyKey && typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : null
  const approvedBy = payload.approvedBy && typeof payload.approvedBy === 'string' ? payload.approvedBy.trim() : null

  if (!branchId || amountCents <= 0 || !concept) {
    throw new HttpsError('invalid-argument', 'Debe proporcionar sucursal, monto positivo y concepto del egreso.')
  }

  const validCategories = [
    'oficina',
    'limpieza',
    'refrigerio',
    'insumos',
    'combustible',
    'mantenimiento',
    'transporte',
    'viaticos',
    'servicios_basicos',
    'repuestos',
    'alquiler',
    'otro',
  ]
  if (!validCategories.includes(category)) {
    throw new HttpsError('invalid-argument', `Categoría de egreso '${category}' no válida. Categorías permitidas: ${validCategories.join(', ')}.`)
  }

  // Límites y autorización para rol 'secretaria'
  // Monto ordinario máximo sin aprobación superior: Bs 150.00 (15,000 centavos)
  const isSupervisorOrAdmin = ['encargado_agencia', 'directiva_admin'].includes(callerData.role)
  if (!isSupervisorOrAdmin && callerData.role === 'secretaria') {
    if (amountCents > 15000 && !approvedBy) {
      throw new HttpsError(
        'permission-denied',
        'Los egresos superiores a Bs 150.00 requieren el nombre o comprobante de autorización del Encargado de Sucursal o Directiva.'
      )
    }
  }

  const nowIso = new Date().toISOString()

  return await db.runTransaction(async (transaction) => {
    // 0. Idempotencia: si ya existe la clave, retornar el movimiento previo
    if (idempotencyKey) {
      const idemRef = db.collection('idempotency_keys').doc(`exp_${idempotencyKey}`)
      const idemDoc = await transaction.get(idemRef)
      if (idemDoc.exists) {
        const cached = idemDoc.data() || {}
        return {
          success: true,
          movementId: cached.movementId,
          amountCents: cached.amountCents,
          concept: cached.concept,
          newExpectedCashCents: cached.newExpectedCashCents,
          cached: true,
        }
      }
    }

    // Buscar turno de caja abierto
    const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${branchId}`)
    const lockDoc = await transaction.get(lockRef)
    if (!lockDoc.exists || lockDoc.data().status !== 'open' || !lockDoc.data().shiftId) {
      throw new HttpsError('failed-precondition', 'No tiene un turno de caja abierto en esta sucursal para registrar egresos.')
    }

    const shiftId = lockDoc.data().shiftId
    const shiftRef = db.collection('cash_shifts').doc(shiftId)
    const shiftDoc = await transaction.get(shiftRef)
    if (!shiftDoc.exists || shiftDoc.data().status !== 'open') {
      throw new HttpsError('failed-precondition', 'El turno de caja no se encuentra abierto.')
    }

    const shiftData = shiftDoc.data() || {}
    const currentExpectedCash = Number(shiftData.expectedCashCents) || 0
    if (amountCents > currentExpectedCash) {
      throw new HttpsError('failed-precondition', `El egreso (Bs ${(amountCents / 100).toFixed(2)}) supera el efectivo disponible en caja (Bs ${(currentExpectedCash / 100).toFixed(2)}).`)
    }

    const expenseMovementId = `MOV-EXP-${shiftId}-${Date.now().toString(36)}`
    const expenseMovement = {
      id: expenseMovementId,
      shiftId,
      branchId,
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      type: 'expense',
      category,
      amountCents: -amountCents,
      paymentMethod: 'cash',
      concept: `Egreso autorizado: ${concept}${voucherNumber ? ` (Comprobante: ${voucherNumber})` : ''}${approvedBy ? ` [Autorizado por: ${approvedBy}]` : ''}`,
      referenceId: voucherNumber || shiftId,
      authorizedBy: approvedBy || (isSupervisorOrAdmin ? callerData.fullName : 'Operador'),
      status: 'completed',
      timestamp: nowIso,
      createdAt: FieldValue.serverTimestamp(),
    }

    transaction.set(db.collection('financial_movements').doc(expenseMovementId), expenseMovement)

    transaction.update(shiftRef, {
      expectedCashCents: FieldValue.increment(-amountCents),
      'breakdown.expensesCents': FieldValue.increment(amountCents),
      'breakdown.netCashCents': FieldValue.increment(-amountCents),
      movementsCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (idempotencyKey) {
      const idemRef = db.collection('idempotency_keys').doc(`exp_${idempotencyKey}`)
      transaction.set(idemRef, {
        movementId: expenseMovementId,
        shiftId,
        branchId,
        amountCents,
        concept,
        newExpectedCashCents: currentExpectedCash - amountCents,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return {
      success: true,
      movementId: expenseMovementId,
      amountCents,
      concept,
      newExpectedCashCents: currentExpectedCash - amountCents,
    }
  })
})

/**
 * =============================================================================
 * CLOUD FUNCTION: collectShipmentPayment (Cobro de Encomienda en Ventanilla)
 * =============================================================================
 */
export const collectShipmentPayment = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para cobrar una encomienda.')
  }

  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', 'No tiene un perfil asignado en el sistema.')
  }
  const callerData = callerDoc.data() || {}
  if (!callerData.isActive) {
    throw new HttpsError('permission-denied', 'Su cuenta de usuario se encuentra inactiva.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos de cobranza en ventanilla.')
  }

  const payload = request.data || {}
  const trackingCode = payload.trackingCode && typeof payload.trackingCode === 'string' ? payload.trackingCode.trim().toUpperCase() : ''
  const paymentMethod = payload.paymentMethod && ['cash', 'qr', 'transfer'].includes(payload.paymentMethod) ? payload.paymentMethod : 'cash'
  const branchId = payload.branchId && typeof payload.branchId === 'string' ? payload.branchId.trim().toLowerCase() : callerData.primaryBranchId

  if (!trackingCode) {
    throw new HttpsError('invalid-argument', 'Se requiere el código de guía de la encomienda.')
  }

  const nowIso = new Date().toISOString()

  return await db.runTransaction(async (transaction) => {
    // 1. Candado determinístico de turno abierto
    const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${branchId}`)
    const lockDoc = await transaction.get(lockRef)
    if (!lockDoc.exists || lockDoc.data().status !== 'open' || !lockDoc.data().shiftId) {
      throw new HttpsError('failed-precondition', `No tiene un turno de caja abierto en la sucursal '${branchId}'. Debe abrir caja para cobrar.`)
    }

    const shiftId = lockDoc.data().shiftId
    const shiftRef = db.collection('cash_shifts').doc(shiftId)
    const shiftDoc = await transaction.get(shiftRef)
    if (!shiftDoc.exists || shiftDoc.data().status !== 'open') {
      throw new HttpsError('failed-precondition', 'El turno de caja activo no es válido o ya fue cerrado.')
    }

    // 2. Encomienda
    const shipmentRef = db.collection('shipments').doc(trackingCode)
    const shipmentDoc = await transaction.get(shipmentRef)
    if (!shipmentDoc.exists) {
      throw new HttpsError('not-found', `No se encontró la encomienda con guía '${trackingCode}'.`)
    }

    const shipmentData = shipmentDoc.data() || {}
    if (shipmentData.paymentStatus === 'paid') {
      throw new HttpsError('failed-precondition', `La encomienda '${trackingCode}' ya se encuentra registrada como pagada.`)
    }

    // Validación transaccional de sucursal y condición operativa de cobro
    const originBranch = (shipmentData.originBranchId || '').toLowerCase()
    const destBranch = (shipmentData.destinationBranchId || '').toLowerCase()
    const paymentTiming = shipmentData.paymentTiming || 'origin_paid'

    if (paymentTiming === 'origin_pending' || paymentTiming === 'origin_paid') {
      if (branchId !== originBranch) {
        throw new HttpsError(
          'failed-precondition',
          `El pago pendiente en origen de la encomienda '${trackingCode}' solo puede ser cobrado en la sucursal de origen ('${originBranch.toUpperCase()}').`
        )
      }
    } else if (paymentTiming === 'destination_cod') {
      if (branchId !== destBranch) {
        throw new HttpsError(
          'failed-precondition',
          `El cobro contraentrega (COD) de la encomienda '${trackingCode}' solo puede realizarse en la sucursal de destino ('${destBranch.toUpperCase()}').`
        )
      }
      // Verificar estado operativo para cobro contraentrega
      const allowedCodStatuses = ['received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery', 'delivered']
      if (!allowedCodStatuses.includes(shipmentData.status)) {
        throw new HttpsError(
          'failed-precondition',
          `La encomienda '${trackingCode}' se encuentra en estado '${shipmentData.status}'. No se puede realizar el cobro contraentrega anticipado antes de su arribo a la agencia de destino.`
        )
      }
    }

    if (['cancelled', 'lost', 'returned'].includes(shipmentData.status)) {
      throw new HttpsError(
        'failed-precondition',
        `No es posible cobrar la encomienda '${trackingCode}' porque se encuentra en estado '${shipmentData.status}'.`
      )
    }

    const amountCents = shipmentData.finalAmountCents || 0
    const movementId = `MOV-${trackingCode}`

    const financialMovement = {
      id: movementId,
      trackingCode,
      shiftId,
      branchId,
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      type: shipmentData.paymentTiming === 'destination_cod' ? 'cod_income' : 'shipment_income',
      amountCents,
      paymentMethod,
      concept: `Cobro en ventanilla de encomienda ${trackingCode}`,
      referenceId: trackingCode,
      status: 'completed',
      timestamp: nowIso,
      createdAt: FieldValue.serverTimestamp(),
    }

    transaction.set(db.collection('financial_movements').doc(movementId), financialMovement)

    // Actualizar shift
    const shiftUpdate = {
      updatedAt: FieldValue.serverTimestamp(),
      'breakdown.totalIncomeCents': FieldValue.increment(amountCents),
      movementsCount: FieldValue.increment(1),
    }

    if (shipmentData.paymentTiming === 'destination_cod') {
      shiftUpdate['breakdown.codIncomeCents'] = FieldValue.increment(amountCents)
    } else {
      shiftUpdate['breakdown.shipmentsIncomeCents'] = FieldValue.increment(amountCents)
    }

    if (paymentMethod === 'cash') {
      shiftUpdate.expectedCashCents = FieldValue.increment(amountCents)
      shiftUpdate['breakdown.cashIncomeCents'] = FieldValue.increment(amountCents)
      shiftUpdate['breakdown.netCashCents'] = FieldValue.increment(amountCents)
    } else if (paymentMethod === 'qr') {
      shiftUpdate['breakdown.qrIncomeCents'] = FieldValue.increment(amountCents)
    } else if (paymentMethod === 'transfer') {
      shiftUpdate['breakdown.transferIncomeCents'] = FieldValue.increment(amountCents)
    }

    transaction.update(shiftRef, shiftUpdate)

    // Actualizar encomienda
    transaction.update(shipmentRef, {
      paymentStatus: 'paid',
      paymentMethod,
      paidAt: nowIso,
      paidCashierUid: callerUid,
      paidCashierName: callerData.fullName || 'Operador',
      cashShiftId: shiftId,
      financialMovementId: movementId,
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Log de estado
    const statusLogRef = shipmentRef.collection('status_logs').doc()
    transaction.set(statusLogRef, {
      status: shipmentData.status,
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      branchId,
      note: `Pago confirmado en ventanilla (${paymentMethod.toUpperCase()}: Bs ${(amountCents / 100).toFixed(2)}) en turno ${shiftId}`,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    })

    return {
      success: true,
      trackingCode,
      amountCents,
      paymentMethod,
      shiftId,
    }
  })
})
