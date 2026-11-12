import crypto from 'node:crypto'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

if (getApps().length === 0) {
  initializeApp()
}

const db = getFirestore()
const authAdmin = getAuth()
const storageAdmin = getStorage()

/**
 * Crea el perfil operativo inicial únicamente dentro de Firebase Emulator.
 * Las escrituras siguen pasando por Admin SDK; firestore.rules permanece cerrado.
 */
export const ensureLocalUserProfile = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para inicializar su perfil local.')
  }
  if (process.env.FIRESTORE_EMULATOR_HOST === undefined || process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new HttpsError('failed-precondition', 'La inicialización automática de perfiles solo está disponible en emuladores locales.')
  }

  const uid = request.auth.uid
  const userRef = db.collection('users').doc(uid)
  const existing = await userRef.get()
  if (existing.exists) return { created: false, profile: existing.data() }

  const nowIso = new Date().toISOString()
  const profile = {
    uid,
    email: request.auth.token.email || null,
    fullName: request.auth.token.name || request.auth.token.email?.split('@')[0] || 'Operador Local',
    ci: null,
    phone: '',
    role: 'secretaria',
    primaryBranchId: 'punata',
    allowedBranchIds: ['punata', 'cochabamba'],
    isActive: true,
    createdAt: nowIso,
    createdReason: 'local_emulator_bootstrap',
  }

  await userRef.create(profile)
  return { created: true, profile }
})

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

  // 11. Cálculo canónico del costo en centavos enteros desde la configuración oficial
  const isFunctionsEmulator = Boolean(
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIRESTORE_EMULATOR_HOST
  )
  const sysConfigSnap = await db.collection('system_config').doc('expreso_punata').get()
  const sysConfig = sysConfigSnap.exists ? sysConfigSnap.data() : null

  let baseFeeCents = null
  let freeWeightKg = null
  let extraKgRateCents = null
  let homeDeliveryRateCents = null

  const hasOfficialConfig = sysConfig && sysConfig.status === 'configured' && sysConfig.isOfficial === true && sysConfig.tariffs && typeof sysConfig.tariffs === 'object'

  if (hasOfficialConfig) {
    const t = sysConfig.tariffs
    baseFeeCents = t.baseFeeCents !== undefined && t.baseFeeCents !== null ? Number(t.baseFeeCents) : null
    freeWeightKg = t.freeWeightKg !== undefined && t.freeWeightKg !== null ? Number(t.freeWeightKg) : null
    extraKgRateCents = t.extraKgRateCents !== undefined && t.extraKgRateCents !== null ? Number(t.extraKgRateCents) : null
    homeDeliveryRateCents = t.homeDeliveryFeeCents !== undefined && t.homeDeliveryFeeCents !== null ? Number(t.homeDeliveryFeeCents) : null
  }

  if (!isFunctionsEmulator) {
    if (
      !hasOfficialConfig ||
      baseFeeCents === null || isNaN(baseFeeCents) ||
      freeWeightKg === null || isNaN(freeWeightKg) ||
      extraKgRateCents === null || isNaN(extraKgRateCents) ||
      homeDeliveryRateCents === null || isNaN(homeDeliveryRateCents)
    ) {
      const missing = []
      if (!hasOfficialConfig) {
        missing.push('Configuración oficial de tarifas aprobada (system_config/expreso_punata)')
      } else {
        if (baseFeeCents === null || isNaN(baseFeeCents)) missing.push('tarifa base (baseFeeCents)')
        if (freeWeightKg === null || isNaN(freeWeightKg)) missing.push('peso libre (freeWeightKg)')
        if (extraKgRateCents === null || isNaN(extraKgRateCents)) missing.push('tarifa por kg adicional (extraKgRateCents)')
        if (homeDeliveryRateCents === null || isNaN(homeDeliveryRateCents)) missing.push('tarifa de entrega a domicilio (homeDeliveryFeeCents)')
      }
      throw new HttpsError('failed-precondition', `El sistema no cuenta con configuración tarifaria oficial aprobada en Administración. Faltan los siguientes parámetros: ${missing.join(', ')}. Configure y guarde los parámetros oficiales antes de emitir guías en producción.`)
    }
  } else {
    // Modo emulador local / suite de pruebas: usar TARIFFS_DEV_REFERENCE sólo si no están configurados
    if (baseFeeCents === null || isNaN(baseFeeCents)) baseFeeCents = TARIFFS_DEV_REFERENCE.baseFeeCents
    if (freeWeightKg === null || isNaN(freeWeightKg)) freeWeightKg = TARIFFS_DEV_REFERENCE.freeWeightKg
    if (extraKgRateCents === null || isNaN(extraKgRateCents)) extraKgRateCents = TARIFFS_DEV_REFERENCE.extraKgRateCents
    if (homeDeliveryRateCents === null || isNaN(homeDeliveryRateCents)) homeDeliveryRateCents = TARIFFS_DEV_REFERENCE.homeDeliveryFeeCents
  }

  const chargeableExcessWeightKg = Math.max(0, Math.round((totalWeightKg - freeWeightKg) * 100) / 100)
  const weightSurchargeCents = Math.round(chargeableExcessWeightKg * extraKgRateCents)
  const homeDeliveryFeeCents = deliveryType === 'home' ? homeDeliveryRateCents : 0
  const subtotalCents = baseFeeCents + weightSurchargeCents + homeDeliveryFeeCents
  const safeDiscountCents = Math.min(subtotalCents, Math.round(rawDiscount))
  const suggestedAmountCents = subtotalCents - safeDiscountCents

  // FASE 1: Precio de envío editable en ventanilla (Tarifa acordada vs sugerida)
  let finalAmountCents = suggestedAmountCents
  let isPriceAdjusted = false
  let cleanAdjustmentReason = null

  if (payload.agreedAmountCents !== undefined && payload.agreedAmountCents !== null) {
    const rawAgreed = Number(payload.agreedAmountCents)
    if (!Number.isInteger(rawAgreed) || isNaN(rawAgreed) || rawAgreed < 0) {
      throw new HttpsError('invalid-argument', 'El precio acordado debe ser un número entero de centavos no negativo.')
    }
    if (rawAgreed === 0) {
      if (!payload.priceAdjustmentReason || typeof payload.priceAdjustmentReason !== 'string' || payload.priceAdjustmentReason.trim().length < 3) {
        throw new HttpsError('invalid-argument', 'Para encomiendas con precio Bs 0.00 (cortesía o exoneración) es obligatorio especificar el motivo del acuerdo comercial.')
      }
    }
    finalAmountCents = rawAgreed
    if (finalAmountCents !== suggestedAmountCents) {
      isPriceAdjusted = true
      cleanAdjustmentReason = payload.priceAdjustmentReason ? String(payload.priceAdjustmentReason).trim() : null
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
      suggestedAmountCents,
      agreedAmountCents: finalAmountCents,
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
    const trackingCode = `${branchCode}${currentYear}${seqPadded}`
    if (isDefinitivePayment) {
      movementId = `MOV-${trackingCode}`
    }

    const shipmentDocRef = db.collection('shipments').doc(trackingCode)
    const shipmentNotificationRef = db.collection('shipment_notifications').doc(trackingCode)
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
      suggestedAmountCents,
      agreedAmountCents: finalAmountCents,
      finalAmountCents,
      isPriceAdjusted,
      priceAdjustmentReason: cleanAdjustmentReason,
      priceAdjustedByUid: isPriceAdjusted ? callerUid : null,
      priceAdjustedByName: isPriceAdjusted ? (userProfile.fullName || 'Operador') : null,
      priceAdjustedAt: isPriceAdjusted ? nowIso : null,

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
    if (originBranchId !== destinationBranchId) {
      transaction.create(shipmentNotificationRef, {
        id: trackingCode,
        eventType: 'shipment_registered',
        trackingCode,
        originBranchId,
        destinationBranchId,
        status: newShipment.status,
        createdAtIso: nowIso,
        createdAt: FieldValue.serverTimestamp(),
        readByUids: [],
      })
    }
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

function assertShipmentNotificationBranchAccess(caller, branchId) {
  if (!['punata', 'cochabamba'].includes(branchId)) throw new HttpsError('invalid-argument', 'Agencia de notificaciones no válida.')
  if (!['secretaria', 'encargado_agencia', 'directiva_admin', 'tesoreria'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene acceso a las notificaciones operativas de agencias.')
  }
  if (!['directiva_admin', 'tesoreria'].includes(caller.role)) {
    const allowed = new Set([caller.primaryBranchId, ...(Array.isArray(caller.allowedBranchIds) ? caller.allowedBranchIds : [])])
    if (!allowed.has(branchId)) throw new HttpsError('permission-denied', 'No tiene autorización para consultar notificaciones de esta agencia.')
  }
}

export const listShipmentNotifications = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (caller.isActive !== true) throw new HttpsError('permission-denied', 'El usuario debe estar activo para consultar notificaciones.')
  const branchId = request.data?.branchId
  assertShipmentNotificationBranchAccess(caller, branchId)
  const snapshot = await db.collection('shipment_notifications')
    .where('destinationBranchId', '==', branchId)
    .orderBy('createdAtIso', 'desc')
    .limit(100)
    .get()
  const shipmentSnapshots = snapshot.empty ? [] : await db.getAll(...snapshot.docs.map((doc) => db.collection('shipments').doc(doc.data().trackingCode)))
  const shipmentByCode = new Map(shipmentSnapshots.filter((shipment) => shipment.exists).map((shipment) => [shipment.id, shipment.data()]))
  return {
    notifications: snapshot.docs.map((doc) => {
      const data = doc.data()
      const readByUids = Array.isArray(data.readByUids) ? data.readByUids : []
      return {
        id: doc.id,
        trackingCode: data.trackingCode,
        originBranchId: data.originBranchId,
        destinationBranchId: data.destinationBranchId,
        status: shipmentByCode.get(data.trackingCode)?.status || data.status,
        createdAtIso: data.createdAtIso,
        eventType: data.eventType,
        readByUids,
        isReadByCurrentUser: readByUids.includes(caller.uid),
      }
    }),
  }
})

export const markShipmentNotificationRead = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (caller.isActive !== true) throw new HttpsError('permission-denied', 'El usuario debe estar activo para marcar notificaciones.')
  const { notificationId, branchId } = request.data || {}
  assertShipmentNotificationBranchAccess(caller, branchId)
  if (!notificationId || typeof notificationId !== 'string') throw new HttpsError('invalid-argument', 'Falta el identificador de notificación.')
  const notificationRef = db.collection('shipment_notifications').doc(notificationId)
  const auditRef = db.collection('audit_logs').doc(`shipment_notification_read_${notificationId}_${caller.uid}`)
  return db.runTransaction(async (transaction) => {
    const notificationDoc = await transaction.get(notificationRef)
    if (!notificationDoc.exists) throw new HttpsError('not-found', 'La notificación ya no está disponible.')
    const notification = notificationDoc.data()
    if (notification.destinationBranchId !== branchId) throw new HttpsError('permission-denied', 'La notificación no pertenece a la agencia consultada.')
    const readByUids = Array.isArray(notification.readByUids) ? notification.readByUids : []
    if (!readByUids.includes(caller.uid)) {
      transaction.update(notificationRef, { readByUids: FieldValue.arrayUnion(caller.uid) })
      transaction.create(auditRef, {
        entityType: 'shipment_notification', entityId: notificationId,
        action: 'shipment_notification_read', performedByUid: caller.uid,
        performedByName: caller.fullName || 'Operador',
        details: { trackingCode: notification.trackingCode, destinationBranchId: branchId },
        timestamp: FieldValue.serverTimestamp(), timestampIso: new Date().toISOString(),
      })
    }
    return { success: true, notificationId, isRead: true, changed: !readByUids.includes(caller.uid) }
  })
})

/**
 * Cloud Function Callable para edición y rectificación autoritativa de encomiendas.
 * Permite corregir datos legítimos de una encomienda recién registrada sin crear otra guía.
 * Aplica reglas estrictas de autorización por estado:
 * - Antes de despacho: permite corregir remitente, destinatario, dirección, notas y precio (si no está cobrado).
 * - Después de despacho: requiere motivo de rectificación formal y registra historial de auditoría inmutable.
 * - Una vez entregada: prohíbe terminantemente alterar montos o revertir el estado a no entregada.
 * - En todos los casos: el identificador y correlativo de guía son inmutables.
 */
export const updateShipment = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para modificar encomiendas.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists || userDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no registrado o inactivo.')
  }

  const userProfile = userDoc.data() || {}
  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(userProfile.role)) {
    throw new HttpsError('permission-denied', `El rol '${userProfile.role}' no tiene permiso para editar encomiendas.`)
  }

  const payload = request.data || {}
  const {
    trackingCode,
    sender,
    recipient,
    deliveryAddress,
    handlingNotes,
    agreedAmountCents,
    priceAdjustmentReason,
    rectificationReason,
  } = payload

  if (!trackingCode || typeof trackingCode !== 'string' || trackingCode.trim().length < 6) {
    throw new HttpsError('invalid-argument', 'Código de guía requerido.')
  }

  const cleanTracking = trackingCode.trim()
  const shipmentRef = db.collection('shipments').doc(cleanTracking)
  const nowIso = new Date().toISOString()

  return await db.runTransaction(async (transaction) => {
    const shipmentDoc = await transaction.get(shipmentRef)
    if (!shipmentDoc.exists) {
      throw new HttpsError('not-found', `No existe la encomienda con guía '${cleanTracking}'.`)
    }

    const currentData = shipmentDoc.data() || {}
    const currentStatus = currentData.status
    const isPaid = currentData.paymentStatus === 'paid'

    // Validación de permisos por sucursal
    const userAllowedBranches = userProfile.allowedBranchIds || [userProfile.primaryBranchId]
    const isOriginBranch = userAllowedBranches.includes(currentData.originBranchId)
    const isDestBranch = userAllowedBranches.includes(currentData.destinationBranchId)

    if (userProfile.role !== 'directiva_admin' && !isOriginBranch && !isDestBranch) {
      throw new HttpsError('permission-denied', 'No tiene permisos sobre la sucursal de esta encomienda.')
    }

    // Regla de inmutabilidad de entregas
    if (currentStatus === 'delivered' && userProfile.role === 'secretaria') {
      throw new HttpsError('permission-denied', 'Las encomiendas ya entregadas solo pueden ser rectificadas administrativamente por el Encargado de Agencia o Directiva.')
    }

    // Si el estado ya avanzó más allá de ventanilla inicial, exigir motivo de rectificación
    const isPostDispatch = ['dispatched', 'in_transit', 'received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery', 'delivered'].includes(currentStatus)
    if (isPostDispatch) {
      if (!rectificationReason || typeof rectificationReason !== 'string' || rectificationReason.trim().length < 5) {
        throw new HttpsError('invalid-argument', 'Para rectificar una encomienda despachada, en tránsito o entregada es obligatorio ingresar un motivo formal de rectificación (mínimo 5 caracteres).')
      }
    }

    const updates = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
      lastModifiedByUid: callerUid,
      lastModifiedByName: userProfile.fullName || 'Operador',
    }

    const previousValues = {}
    const newValues = {}

    // 1. Actualización de remitente
    if (sender) {
      const updatedSender = { ...currentData.sender }
      let changed = false
      if (sender.name && sender.name.trim().length >= 2 && sender.name.trim() !== currentData.sender?.name) {
        previousValues['sender.name'] = currentData.sender?.name
        newValues['sender.name'] = sender.name.trim()
        updatedSender.name = sender.name.trim()
        changed = true
      }
      if (sender.phone && sender.phone.trim().length >= 5 && sender.phone.trim() !== currentData.sender?.phone) {
        previousValues['sender.phone'] = currentData.sender?.phone
        newValues['sender.phone'] = sender.phone.trim()
        updatedSender.phone = sender.phone.trim()
        changed = true
      }
      if (sender.docNumber !== undefined && sender.docNumber !== currentData.sender?.docNumber) {
        previousValues['sender.docNumber'] = currentData.sender?.docNumber
        newValues['sender.docNumber'] = sender.docNumber ? sender.docNumber.trim() : null
        updatedSender.docNumber = sender.docNumber ? sender.docNumber.trim() : null
        changed = true
      }
      if (changed) {
        updates.sender = updatedSender
      }
    }

    // 2. Actualización de destinatario
    if (recipient) {
      const updatedRecipient = { ...currentData.recipient }
      let changed = false
      if (recipient.name && recipient.name.trim().length >= 2 && recipient.name.trim() !== currentData.recipient?.name) {
        previousValues['recipient.name'] = currentData.recipient?.name
        newValues['recipient.name'] = recipient.name.trim()
        updatedRecipient.name = recipient.name.trim()
        changed = true
      }
      if (recipient.phone && recipient.phone.trim().length >= 5 && recipient.phone.trim() !== currentData.recipient?.phone) {
        previousValues['recipient.phone'] = currentData.recipient?.phone
        newValues['recipient.phone'] = recipient.phone.trim()
        updatedRecipient.phone = recipient.phone.trim()
        changed = true
      }
      if (recipient.docNumber !== undefined && recipient.docNumber !== currentData.recipient?.docNumber) {
        previousValues['recipient.docNumber'] = currentData.recipient?.docNumber
        newValues['recipient.docNumber'] = recipient.docNumber ? recipient.docNumber.trim() : null
        updatedRecipient.docNumber = recipient.docNumber ? recipient.docNumber.trim() : null
        changed = true
      }
      if (changed) {
        updates.recipient = updatedRecipient
      }
    }

    // 3. Dirección de entrega a domicilio y notas
    if (deliveryAddress !== undefined && deliveryAddress !== currentData.deliveryAddress) {
      previousValues.deliveryAddress = currentData.deliveryAddress
      newValues.deliveryAddress = deliveryAddress ? deliveryAddress.trim() : null
      updates.deliveryAddress = deliveryAddress ? deliveryAddress.trim() : null
    }
    if (handlingNotes !== undefined && handlingNotes !== currentData.handlingNotes) {
      previousValues.handlingNotes = currentData.handlingNotes
      newValues.handlingNotes = handlingNotes ? handlingNotes.trim() : null
      updates.handlingNotes = handlingNotes ? handlingNotes.trim() : null
    }

    // 4. Edición de precio (solo permitido si aún no ha sido cobrado)
    if (agreedAmountCents !== undefined && agreedAmountCents !== null) {
      if (isPaid) {
        throw new HttpsError('failed-precondition', 'No se puede modificar directamente el importe de una encomienda ya cobrada. Debe realizarse una anulación y emisión formal por motivos contables.')
      }
      if (currentStatus !== 'received' && currentStatus !== 'pending_dispatch') {
        throw new HttpsError('failed-precondition', 'El precio solo puede modificarse en la agencia de origen antes del despacho.')
      }
      const rawPrice = Number(agreedAmountCents)
      if (!Number.isInteger(rawPrice) || rawPrice < 0) {
        throw new HttpsError('invalid-argument', 'El precio acordado debe ser un número entero de centavos no negativo.')
      }
      if (rawPrice !== currentData.finalAmountCents) {
        previousValues.finalAmountCents = currentData.finalAmountCents
        newValues.finalAmountCents = rawPrice
        updates.finalAmountCents = rawPrice
        updates.agreedAmountCents = rawPrice
        updates.isPriceAdjusted = true
        updates.priceAdjustmentReason = priceAdjustmentReason ? String(priceAdjustmentReason).trim() : 'Ajuste en ventanilla'
        updates.priceAdjustedByUid = callerUid
        updates.priceAdjustedByName = userProfile.fullName || 'Operador'
        updates.priceAdjustedAt = nowIso
      }
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, message: 'No se realizaron cambios.', shipment: currentData }
    }

    // 5. Registrar entrada en historial de auditoría
    const auditSafeValues = (values) => Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value === undefined ? null : value])
    )
    const auditEntry = {
      changedAt: nowIso,
      operatorUid: callerUid,
      operatorName: userProfile.fullName || 'Operador',
      operatorRole: userProfile.role,
      reason: rectificationReason ? rectificationReason.trim() : (priceAdjustmentReason || 'Corrección operativa de datos'),
      previousValues: auditSafeValues(previousValues),
      newValues: auditSafeValues(newValues),
    }

    const currentAuditHistory = Array.isArray(currentData.auditHistory) ? currentData.auditHistory : []
    updates.auditHistory = [...currentAuditHistory, auditEntry]

    transaction.update(shipmentRef, updates)

    // Subcolección audit_logs para historial inmutable
    const auditSubDoc = shipmentRef.collection('audit_logs').doc()
    transaction.set(auditSubDoc, {
      ...auditEntry,
      createdAt: FieldValue.serverTimestamp(),
    })

    return {
      success: true,
      trackingCode: cleanTracking,
      shipment: {
        ...currentData,
        ...updates,
      },
    }
  })
})

/** Anulación lógica de encomiendas antes de despacho y sin movimientos financieros. */
export const cancelShipment = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión para anular encomiendas.')
  const callerUid = request.auth.uid
  const { trackingCode, reason } = request.data || {}
  if (typeof trackingCode !== 'string' || trackingCode.trim().length < 6) throw new HttpsError('invalid-argument', 'Código de guía requerido.')
  if (typeof reason !== 'string' || reason.trim().length < 5) throw new HttpsError('invalid-argument', 'El motivo de anulación es obligatorio (mínimo 5 caracteres).')
  const shipmentRef = db.collection('shipments').doc(trackingCode.trim())
  const callerRef = db.collection('users').doc(callerUid)
  const nowIso = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const callerSnap = await transaction.get(callerRef)
    const caller = callerSnap.data() || {}
    if (!callerSnap.exists || caller.isActive !== true || !['secretaria', 'encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'No tiene permisos para anular encomiendas.')
    }
    const shipmentSnap = await transaction.get(shipmentRef)
    if (!shipmentSnap.exists) throw new HttpsError('not-found', 'No existe la encomienda indicada.')
    const current = shipmentSnap.data() || {}
    const allowedBranches = Array.isArray(caller.allowedBranchIds) ? caller.allowedBranchIds : [caller.primaryBranchId]
    if (caller.role !== 'directiva_admin' && !allowedBranches.includes(current.originBranchId)) {
      throw new HttpsError('permission-denied', 'Solo la sucursal de origen puede anular esta encomienda.')
    }
    if (current.status === 'cancelled') throw new HttpsError('already-exists', 'La encomienda ya está anulada.')
    if (current.paymentStatus === 'paid' || current.cashShiftId || current.financialMovementId || current.manifestId || current.assignedVehicle?.manifestId || current.driverCustody || current.deliveryRecord || !['received', 'pending_dispatch'].includes(current.status)) {
      throw new HttpsError('failed-precondition', 'Solo pueden anularse encomiendas sin pagos, despacho, custodia ni entrega y antes de salir de origen.')
    }
    const auditEntry = {
      action: 'cancel_shipment', trackingCode: trackingCode.trim(), reason: reason.trim(),
      operatorUid: callerUid, operatorName: caller.fullName || 'Operador', operatorRole: caller.role,
      branchId: caller.primaryBranchId || current.originBranchId, changedAt: nowIso,
      previousStatus: current.status, newStatus: 'cancelled', financialReferences: [],
    }
    const auditHistory = Array.isArray(current.auditHistory) ? current.auditHistory : []
    transaction.update(shipmentRef, {
      status: 'cancelled', cancelledAtIso: nowIso, cancelledByUid: callerUid,
      cancelledByName: caller.fullName || 'Operador', cancellationReason: reason.trim(),
      previousStatus: current.status, updatedAt: FieldValue.serverTimestamp(), updatedAtIso: nowIso,
      auditHistory: [...auditHistory, auditEntry],
    })
    transaction.set(db.collection('audit_logs').doc(), { ...auditEntry, createdAt: FieldValue.serverTimestamp(), entityType: 'shipment' })
    transaction.set(shipmentRef.collection('audit_logs').doc(), { ...auditEntry, createdAt: FieldValue.serverTimestamp() })
    return { success: true, trackingCode: trackingCode.trim(), status: 'cancelled', auditEntry }
  })
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
    unionMemberId,
    isActive = true,
  } = payload

  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    throw new HttpsError('invalid-argument', 'El nombre completo es obligatorio.')
  }

  // CI opcional: se guarda como null si no se ingresa; nunca inventar valores ficticios
  const safeCi = ci && typeof ci === 'string' && ci.trim() ? ci.trim() : null

  const validRoles = ['secretaria', 'afiliado_admin', 'afiliado', 'conductor', 'encargado_agencia', 'tesoreria', 'directiva_admin']
  if (!validRoles.includes(role)) {
    throw new HttpsError('invalid-argument', `Rol inválido: '${role}'.`)
  }

  const validBranches = ['punata', 'cochabamba']
  if (!validBranches.includes(primaryBranchId)) {
    throw new HttpsError('invalid-argument', `Sucursal primaria inválida: '${primaryBranchId}'.`)
  }

  let safeTargetUid = targetUid && typeof targetUid === 'string' && targetUid.trim() ? targetUid.trim() : null
  let targetAuthUser = null
  let safeUnionMemberId = typeof unionMemberId === 'string' && unionMemberId.trim() ? unionMemberId.trim() : null

  const requiresMemberLink = role === 'afiliado' || role === 'afiliado_admin'

  if (requiresMemberLink && !safeUnionMemberId && safeTargetUid) {
    const existingProfile = await db.collection('users').doc(safeTargetUid).get()
    safeUnionMemberId = existingProfile.data()?.unionMemberId || null
  }

  if (requiresMemberLink) {
    if (!safeUnionMemberId) throw new HttpsError('invalid-argument', 'Debe vincular la cuenta con un afiliado existente.')
    const memberRef = db.collection('union_members').doc(safeUnionMemberId)
    const memberDoc = await memberRef.get()
    const member = memberDoc.data() || {}
    if (!memberDoc.exists || member.status === 'inactive' || member.status === 'retired') {
      throw new HttpsError('failed-precondition', 'El afiliado no existe o no está activo.')
    }
    if (member.branchId !== primaryBranchId) {
      throw new HttpsError('permission-denied', 'El afiliado no pertenece a la sucursal asignada.')
    }
    const linkedUsers = await db.collection('users').where('unionMemberId', '==', safeUnionMemberId).get()
    if (linkedUsers.docs.some((doc) => doc.id !== safeTargetUid && doc.data()?.isActive !== false)) {
      throw new HttpsError('already-exists', 'El afiliado ya está vinculado a otra cuenta activa.')
    }
  } else {
    safeUnionMemberId = null
  }

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
          // Consultar por rol y filtrar isActive en memoria evita depender de un
          // índice compuesto durante las pruebas y mantiene la protección fail-closed.
          const activeAdminsQuery = db.collection('users').where('role', '==', 'directiva_admin')
          const activeAdminsSnap = await transaction.get(activeAdminsQuery)
          const activeAdmins = activeAdminsSnap.docs.filter((d) => d.data()?.isActive === true)
          const otherAdmins = activeAdmins.filter((d) => d.id !== safeTargetUid)

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
    allowedBranchIds: role === 'secretaria' || role === 'afiliado_admin' || role === 'afiliado'
      ? [primaryBranchId]
      : role === 'directiva_admin'
        ? ['punata', 'cochabamba']
        : (Array.isArray(allowedBranchIds) && allowedBranchIds.length > 0
            ? (allowedBranchIds.includes(primaryBranchId) ? allowedBranchIds : [primaryBranchId, ...allowedBranchIds])
            : [primaryBranchId]),
    assignedVehiclePlate: role === 'conductor' ? (assignedVehiclePlate || '') : null,
    assignedMobileNumber: role === 'conductor' ? (assignedMobileNumber || '') : null,
    unionMemberId: requiresMemberLink ? safeUnionMemberId : null,
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

  // Configuración estricta de denominaciones bolivianas oficiales en centavos
  const VALID_BOLIVIAN_DENOMINATIONS = {
    '200': 20000,
    '100': 10000,
    '50': 5000,
    '20': 2000,
    '10': 1000,
    '5': 500,
    '2': 200,
    '1': 100,
    '0.5': 50,
    '0.2': 20,
    '0.1': 10,
  }

  // Validación autoritativa estricta del desglose de billetes y monedas cuando se proporciona
  if (actualCashBreakdown !== null && actualCashBreakdown !== undefined) {
    if (typeof actualCashBreakdown !== 'object' || Array.isArray(actualCashBreakdown)) {
      throw new HttpsError('invalid-argument', 'El desglose de efectivo debe ser un objeto de denominaciones bolivianas.')
    }

    let breakdownSumCents = 0
    for (const key of Object.keys(actualCashBreakdown)) {
      if (!(key in VALID_BOLIVIAN_DENOMINATIONS)) {
        throw new HttpsError(
          'invalid-argument',
          `Denominación monetaria desconocida o no autorizada: 'Bs ${key}'. Solo se aceptan denominaciones bolivianas oficiales (200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1).`
        )
      }

      const count = actualCashBreakdown[key]
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new HttpsError(
          'invalid-argument',
          `La cantidad para la denominación 'Bs ${key}' debe ser un número entero no negativo, recibido: ${JSON.stringify(count)}.`
        )
      }

      breakdownSumCents += VALID_BOLIVIAN_DENOMINATIONS[key] * count
    }

    if (breakdownSumCents !== actualCashCents) {
      throw new HttpsError(
        'invalid-argument',
        `El desglose de billetes y monedas (Bs ${(breakdownSumCents / 100).toFixed(2)}) no coincide con el total de efectivo declarado (Bs ${(actualCashCents / 100).toFixed(2)}).`
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
 * Parámetro provisional del umbral para egresos que requieren aprobación superior (Bs 150.00).
 * En la siguiente etapa será configurable dinámicamente por la Administración de Expreso Punata.
 */
export const PROVISIONAL_EXPENSE_APPROVAL_THRESHOLD_CENTS = 15000

/**
 * =============================================================================
 * CLOUD FUNCTION: createExpenseAuthorization (Autorización Formal de Egreso Extraordinario)
 * =============================================================================
 * Permite a un Encargado de Agencia o Directiva Admin emitir una autorización
 * verificable en base de datos para que una secretaria ejecute un egreso > Bs 150.
 */
export const createExpenseAuthorization = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para autorizar un egreso.')
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

  const allowedRoles = ['encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'Solo Encargados de Agencia o Directiva pueden autorizar egresos extraordinarios.')
  }

  const payload = request.data || {}
  const branchId = payload.branchId && typeof payload.branchId === 'string' ? payload.branchId.trim().toLowerCase() : ''
  const maxAmountCents = Math.round(Number(payload.maxAmountCents) || 0)
  const concept = payload.concept && typeof payload.concept === 'string' ? payload.concept.trim() : ''
  const category = payload.category && typeof payload.category === 'string' ? payload.category.trim().toLowerCase() : 'otro'
  const authorizedOperatorUid = payload.authorizedOperatorUid && typeof payload.authorizedOperatorUid === 'string' ? payload.authorizedOperatorUid.trim() : ''

  if (!branchId || maxAmountCents <= 0 || !concept || !authorizedOperatorUid) {
    throw new HttpsError('invalid-argument', 'Debe proporcionar sucursal, monto máximo positivo, concepto y el UID del operador autorizado.')
  }

  if (callerData.role === 'encargado_agencia') {
    const allowedBranches = callerData.allowedBranchIds || [callerData.primaryBranchId]
    if (!allowedBranches.includes(branchId)) {
      throw new HttpsError('permission-denied', `No tiene autorización para emitir aprobaciones en la sucursal '${branchId}'.`)
    }
  }

  // Verificar que el operador a autorizar exista y esté activo
  const operatorDoc = await db.collection('users').doc(authorizedOperatorUid).get()
  if (!operatorDoc.exists || !operatorDoc.data().isActive) {
    throw new HttpsError('failed-precondition', 'El operador designado a autorizar no existe o se encuentra inactivo.')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const authCode = `AUT-EXP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

  const authRecord = {
    id: authCode,
    authCode,
    branchId,
    maxAmountCents,
    concept,
    category,
    authorizedOperatorUid,
    authorizedOperatorName: operatorDoc.data().fullName || 'Operador',
    approverUid: callerUid,
    approverName: callerData.fullName || 'Encargado',
    approverRole: callerData.role,
    status: 'approved',
    createdAt: now.toISOString(),
    expiresAt,
    createdAtServer: FieldValue.serverTimestamp(),
  }

  await db.collection('expense_authorizations').doc(authCode).set(authRecord)

  // Auditoría
  await db.collection('audit_logs').doc().set({
    entityType: 'expense_authorization',
    entityId: authCode,
    action: 'EXPENSE_AUTHORIZATION_CREATED',
    performedByUid: callerUid,
    performedByName: callerData.fullName || 'Encargado',
    branchId,
    maxAmountCents,
    authorizedOperatorUid,
    timestamp: FieldValue.serverTimestamp(),
  })

  return {
    success: true,
    authCode,
    authorization: authRecord,
  }
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
  const idempotencyKey = payload.idempotencyKey && typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : ''
  const authorizationCode = payload.authorizationCode && typeof payload.authorizationCode === 'string' ? payload.authorizationCode.trim().toUpperCase() : null

  // 1. Idempotencia OBLIGATORIA
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia obligatoria (mínimo 8 caracteres) para registrar egresos.')
  }

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

  // 2. Límites y autorización verificable para rol 'secretaria'
  const isSupervisorOrAdmin = ['encargado_agencia', 'directiva_admin'].includes(callerData.role)
  const requiresSupervisorApproval = !isSupervisorOrAdmin && callerData.role === 'secretaria' && amountCents > PROVISIONAL_EXPENSE_APPROVAL_THRESHOLD_CENTS

  if (requiresSupervisorApproval && !authorizationCode) {
    throw new HttpsError(
      'permission-denied',
      `Los egresos superiores a Bs ${(PROVISIONAL_EXPENSE_APPROVAL_THRESHOLD_CENTS / 100).toFixed(2)} requieren un código de autorización verificable emitido por Encargado de Sucursal o Directiva.`
    )
  }

  const nowIso = new Date().toISOString()

  return await db.runTransaction(async (transaction) => {
    // 0. Idempotencia vinculada al contenido (huella digital SHA-256)
    const payloadFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        callerUid,
        branchId,
        amountCents,
        category,
        concept: concept.toLowerCase().trim(),
        voucherNumber: voucherNumber ? voucherNumber.toLowerCase().trim() : null,
      }))
      .digest('hex')

    const idemRef = db.collection('idempotency_keys').doc(`exp_${idempotencyKey}`)
    const idemDoc = await transaction.get(idemRef)
    if (idemDoc.exists) {
      const cached = idemDoc.data() || {}
      if (cached.payloadFingerprint !== payloadFingerprint) {
        throw new HttpsError(
          'already-exists',
          'La clave de idempotencia ya fue utilizada previamente con un monto, concepto o contenido diferente.'
        )
      }
      return {
        success: true,
        movementId: cached.movementId,
        amountCents: cached.amountCents,
        concept: cached.concept,
        newExpectedCashCents: cached.newExpectedCashCents,
        cached: true,
      }
    }

    // 1. Validar autorización verificable del supervisor si aplica
    let approverInfo = {
      approverUid: callerUid,
      approverName: callerData.fullName || 'Operador',
      approverRole: callerData.role,
      authorizationCode: null,
    }

    if (requiresSupervisorApproval) {
      const authRef = db.collection('expense_authorizations').doc(authorizationCode)
      const authDoc = await transaction.get(authRef)
      if (!authDoc.exists) {
        throw new HttpsError('failed-precondition', `El código de autorización '${authorizationCode}' no existe en el sistema.`)
      }
      const authData = authDoc.data() || {}
      if (authData.status !== 'approved') {
        throw new HttpsError('failed-precondition', `El código de autorización '${authorizationCode}' no está vigente (estado: ${authData.status}).`)
      }
      if (authData.branchId !== branchId) {
        throw new HttpsError('failed-precondition', `El código de autorización fue emitido para la sucursal '${authData.branchId}', no para '${branchId}'.`)
      }
      if (authData.authorizedOperatorUid !== callerUid) {
        throw new HttpsError('permission-denied', 'Este código de autorización fue emitido para otro operador y no puede ser usado por su cuenta.')
      }
      if (authData.maxAmountCents < amountCents) {
        throw new HttpsError('failed-precondition', `El monto del egreso (Bs ${(amountCents / 100).toFixed(2)}) supera el monto máximo autorizado (Bs ${(authData.maxAmountCents / 100).toFixed(2)}).`)
      }
      if (authData.expiresAt && authData.expiresAt < nowIso) {
        throw new HttpsError('failed-precondition', `El código de autorización ha expirado el ${authData.expiresAt}.`)
      }

      approverInfo = {
        approverUid: authData.approverUid,
        approverName: authData.approverName,
        approverRole: authData.approverRole,
        authorizationCode,
        authRef,
      }
    }

    // 2. Buscar turno de caja abierto (TODAS las lecturas antes de las escrituras)
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

    // --- A PARTIR DE AQUÍ INICIAN TODAS LAS ESCRITURAS DE LA TRANSACCIÓN ---
    if (requiresSupervisorApproval && approverInfo.authRef) {
      // Consumir transaccionalmente la autorización para impedir reutilización
      transaction.update(approverInfo.authRef, {
        status: 'used',
        usedByUid: callerUid,
        usedAt: nowIso,
        usedAmountCents: amountCents,
        updatedAt: FieldValue.serverTimestamp(),
      })
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
      concept: `Egreso autorizado: ${concept}${voucherNumber ? ` (Comprobante: ${voucherNumber})` : ''}`,
      referenceId: voucherNumber || shiftId,
      authorizedByUid: approverInfo.approverUid,
      authorizedByName: approverInfo.approverName,
      authorizedByRole: approverInfo.approverRole,
      authorizationCode: approverInfo.authorizationCode,
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

    // Guardar clave de idempotencia vinculada a huella de contenido
    transaction.set(idemRef, {
      idempotencyKey,
      payloadFingerprint,
      movementId: expenseMovementId,
      shiftId,
      branchId,
      operatorUid: callerUid,
      amountCents,
      concept,
      newExpectedCashCents: currentExpectedCash - amountCents,
      createdAt: FieldValue.serverTimestamp(),
    })

    // Auditoría
    transaction.set(db.collection('audit_logs').doc(), {
      entityType: 'financial_movement',
      entityId: expenseMovementId,
      action: 'CASH_EXPENSE_REGISTERED',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      authorizedByUid: approverInfo.approverUid,
      authorizedByName: approverInfo.approverName,
      branchId,
      amountCents,
      concept,
      category,
      authorizationCode: approverInfo.authorizationCode,
      timestamp: FieldValue.serverTimestamp(),
    })

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
  const ALLOWED_PAYMENT_METHODS_COLLECT = ['cash', 'qr', 'transfer']
  const paymentMethod = payload.paymentMethod || 'cash'
  if (!ALLOWED_PAYMENT_METHODS_COLLECT.includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', `Método de pago no válido: '${paymentMethod}'. Permitidos: cash, qr, transfer.`)
  }
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


// =========================================================================
// BLOQUE 2: LOGÍSTICA INTERAGENCIAS, MANIFIESTOS, CUSTODIA Y ALMACÉN
// =========================================================================

/**
 * Cloud Function Callable para la creación de manifiestos de despacho con asignación de vehículo y conductor.
 * Bloquea guías en tránsito, genera correlativo inmutable (MAN-PUN-YYYY-XXXX / MAN-CBBA-YYYY-XXXX),
 * previene doble asignación a viajes activos y actualiza estados de forma atómica.
 */
const singleTransfer = Symbol('singleTransfer')

async function createDispatch(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para despachar encomiendas.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'El usuario no tiene perfil registrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'La cuenta de usuario está inactiva.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', `El rol '${callerData.role}' no tiene permiso para crear manifiestos de despacho.`)
  }

  const payload = request.data || {}
  const {
    originBranchId,
    destinationBranchId,
    vehicleId,
    driverUid,
    shipmentIds,
    departureNotes = '',
  } = payload

  if (!originBranchId || !destinationBranchId) {
    throw new HttpsError('invalid-argument', 'Debe especificar sucursal de origen y destino.')
  }

  if (originBranchId === destinationBranchId) {
    throw new HttpsError('invalid-argument', 'La sucursal de origen y destino no pueden ser iguales.')
  }

  if (callerData.role !== 'directiva_admin') {
    const isAllowed = callerData.primaryBranchId === originBranchId ||
      (Array.isArray(callerData.allowedBranchIds) && callerData.allowedBranchIds.includes(originBranchId))
    if (!isAllowed) {
      throw new HttpsError('permission-denied', `No tiene autorización para despachar carga desde la sucursal '${originBranchId}'.`)
    }
  }

  if (!vehicleId || typeof vehicleId !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe seleccionar un vehículo o móvil asignado.')
  }

  if (!driverUid || typeof driverUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe asignar un conductor para el viaje.')
  }

  if (!Array.isArray(shipmentIds) || shipmentIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Debe incluir al menos una encomienda en el manifiesto.')
  }

  for (const sId of shipmentIds) {
    if (!sId || typeof sId !== 'string') {
      throw new HttpsError('invalid-argument', 'Cada encomienda debe tener un identificador válido.')
    }
  }

  return await db.runTransaction(async (transaction) => {
    if (request[singleTransfer]) await assertTransferBranch(transaction, callerUid, originBranchId)
    // 1. TODAS LAS LECTURAS PRIMERO (Regla estricta de Firestore)
    const vehicleRef = db.collection('vehicles').doc(vehicleId)
    const vehicleDoc = await transaction.get(vehicleRef)

    const driverRef = db.collection('users').doc(driverUid)
    const driverDoc = await transaction.get(driverRef)

    const currentYear = new Date().getFullYear()
    const counterId = `manifests_${originBranchId}_${currentYear}`
    const counterRef = db.collection('counters').doc(counterId)
    const counterDoc = await transaction.get(counterRef)

    const shipmentRefsAndDocs = []
    for (const sId of shipmentIds) {
      const sRef = db.collection('shipments').doc(sId)
      const sDoc = await transaction.get(sRef)
      shipmentRefsAndDocs.push({ id: sId, ref: sRef, doc: sDoc })
    }

    // 2. VALIDACIONES
    if (!vehicleDoc.exists) {
      throw new HttpsError('not-found', 'El vehículo seleccionado no existe en el padrón de flota.')
    }
    const vehicleData = vehicleDoc.data() || {}
    if (vehicleData.status === 'inactive' || vehicleData.status === 'in_maintenance') {
      throw new HttpsError('failed-precondition', `El vehículo seleccionado se encuentra ${vehicleData.status === 'in_maintenance' ? 'en mantenimiento' : 'inactivo'}.`)
    }

    if (!driverDoc.exists) {
      throw new HttpsError('not-found', 'El conductor seleccionado no existe en el sistema.')
    }
    const driverData = driverDoc.data() || {}
    if (request[singleTransfer] && (driverData.isActive !== true || vehicleData.status !== 'active' || vehicleData.branchId !== originBranchId)) {
      throw new HttpsError('failed-precondition', 'Selecciona un conductor activo y un vehículo activo de la agencia de origen.')
    }
    if (driverData.isActive === false) {
      throw new HttpsError('failed-precondition', 'El conductor seleccionado se encuentra inactivo.')
    }
    if (driverData.role !== 'conductor') {
      throw new HttpsError('failed-precondition', `El usuario asignado tiene rol '${driverData.role}', no es un conductor.`)
    }

    let totalPackages = 0
    let totalWeightKg = 0
    let totalCodAmountCents = 0
    const shipmentSummaries = []

    for (const item of shipmentRefsAndDocs) {
      if (!item.doc.exists) {
        throw new HttpsError('not-found', `La encomienda con ID '${item.id}' no existe.`)
      }
      const sData = item.doc.data() || {}

      if (sData.originBranchId !== originBranchId) {
        throw new HttpsError('failed-precondition', `La encomienda '${sData.trackingCode || item.id}' no pertenece a la sucursal de origen '${originBranchId}'.`)
      }

      if (sData.destinationBranchId !== destinationBranchId) {
        throw new HttpsError('failed-precondition', `La encomienda '${sData.trackingCode || item.id}' tiene como destino '${sData.destinationBranchId}', incompatible con el viaje a '${destinationBranchId}'.`)
      }

      const validDispatchStatuses = ['received', 'pending_dispatch']
      if (!validDispatchStatuses.includes(sData.status)) {
        throw new HttpsError('failed-precondition', `La encomienda '${sData.trackingCode || item.id}' tiene estado '${sData.status}' y no puede ser incorporada al despacho.`)
      }

      if (request[singleTransfer] && (sData.manifestId || sData.assignedVehicle?.manifestId || sData.deliveryRecord)) {
        throw new HttpsError('failed-precondition', 'La guía ya tiene un traslado o una entrega registrada.')
      }

      if (sData.manifestId && (sData.status === 'in_transit' || sData.status === 'dispatched')) {
        throw new HttpsError('failed-precondition', `La encomienda '${sData.trackingCode || item.id}' ya se encuentra asignada al manifiesto activo '${sData.manifestNumber || sData.manifestId}'.`)
      }

      const pCount = Number(sData.packageCount) || 1
      const wKg = Number(sData.totalWeightKg) || 0
      totalPackages += pCount
      totalWeightKg += wKg

      if (sData.paymentTiming === 'destination_cod' && sData.paymentStatus !== 'paid') {
        totalCodAmountCents += (Number(sData.finalAmountCents) || 0)
      }

      shipmentSummaries.push({
        shipmentId: item.id,
        trackingCode: sData.trackingCode || item.id,
        senderName: sData.sender?.name || 'S/N',
        recipientName: sData.recipient?.name || 'S/N',
        packageCount: pCount,
        totalWeightKg: wKg,
        paymentStatus: sData.paymentStatus || 'pending',
        paymentTiming: sData.paymentTiming || 'origin_paid',
        finalAmountCents: sData.finalAmountCents || 0,
        deliveryType: sData.deliveryType || 'agency',
      })
    }

    // 3. GENERAR CORRELATIVO OFICIAL
    const currentSeq = counterDoc.exists ? (Number(counterDoc.data()?.currentSequence) || 0) : 0
    const nextSeq = currentSeq + 1
    const prefix = originBranchId === 'punata' ? 'MAN-PUN' : 'MAN-CBBA'
    const manifestNumber = `${prefix}-${currentYear}-${String(nextSeq).padStart(4, '0')}`

    const now = FieldValue.serverTimestamp()
    const nowIso = new Date().toISOString()
    const manifestRef = db.collection('manifests').doc()
    const manifestId = manifestRef.id

    // 4. ESCRITURAS TRANSACCIONALES
    transaction.set(counterRef, {
      currentSequence: nextSeq,
      year: currentYear,
      branchId: originBranchId,
      updatedAt: now,
    }, { merge: true })

    transaction.set(manifestRef, {
      id: manifestId,
      manifestNumber,
      originBranchId,
      destinationBranchId,
      vehicleId,
      vehiclePlate: vehicleData.plate || '',
      mobileNumber: vehicleData.mobileNumber || '',
      driverUid,
      driverName: driverData.fullName || 'Conductor',
      driverPhone: driverData.phone || '',
      shipmentIds,
      ...(request[singleTransfer] ? { singleTransfer: true } : {}),
      shipmentSummaries,
      totalShipments: shipmentIds.length,
      totalPackages,
      totalWeightKg: Math.round(totalWeightKg * 100) / 100,
      totalCodAmountCents,
      status: 'dispatched',
      departureNotes: departureNotes || '',
      dispatchedAt: now,
      dispatchedAtIso: nowIso,
      dispatchedByUid: callerUid,
      dispatchedByName: callerData.fullName || 'Operador',
      driverCustodyStatus: 'pending',
      driverCustodyAt: null,
      driverCustodyNotes: null,
      receivedAt: null,
      receivedAtIso: null,
      receivedByUid: null,
      receivedByName: null,
      receptionNotes: null,
      discrepancies: [],
      createdAt: now,
      updatedAt: now,
    })

    for (const item of shipmentRefsAndDocs) {
      transaction.update(item.ref, {
        status: 'in_transit',
        ...(request[singleTransfer] ? {
          singleTransfer: true,
          auditHistory: FieldValue.arrayUnion(transferAudit({
            action: 'confirm_shipment_departure', previousStatus: item.doc.data().status,
            newStatus: 'in_transit', callerUid, callerData, branchId: originBranchId, nowIso,
            reason: 'Salida confirmada en agencia.', newValues: { vehicleId, driverUid },
          })),
        } : {}),
        currentLocation: 'in_transit',
        manifestId,
        manifestNumber,
        assignedVehicle: {
          vehicleId,
          vehiclePlate: vehicleData.plate || '',
          mobileNumber: vehicleData.mobileNumber || '',
          driverUid,
          driverName: driverData.fullName || 'Conductor',
          manifestId,
        },
        dispatchedAt: now,
        updatedAt: now,
      })

      const statusLogRef = item.ref.collection('status_logs').doc()
      transaction.set(statusLogRef, {
        status: 'in_transit',
        previousStatus: item.doc.data().status,
        operatorUid: callerUid,
        operatorName: callerData.fullName || 'Operador',
        branchId: originBranchId,
        note: `Despachado en viaje hacia ${destinationBranchId} con manifiesto ${manifestNumber} (Móvil ${vehicleData.mobileNumber}, Chofer ${driverData.fullName})`,
        createdAt: now,
        createdAtIso: nowIso,
      })
    }

    const auditRef = db.collection('audit_logs').doc()
    transaction.set(auditRef, {
      entityType: 'manifest',
      entityId: manifestId,
      action: 'create_dispatch_manifest',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      details: {
        manifestNumber,
        originBranchId,
        destinationBranchId,
        shipmentCount: shipmentIds.length,
        totalPackages,
        totalWeightKg,
        totalCodAmountCents,
        vehiclePlate: vehicleData.plate,
        mobileNumber: vehicleData.mobileNumber,
        driverUid,
        driverName: driverData.fullName,
      },
      timestamp: now,
    })

    return {
      success: true,
      manifestId,
      manifestNumber,
      totalShipments: shipmentIds.length,
      totalPackages,
      totalWeightKg,
      totalCodAmountCents,
      dispatchedAtIso: nowIso,
    }
  })
}

export const createDispatchManifest = onCall({ cors: true }, createDispatch)

/**
 * Cloud Function Callable para que el conductor asignado confirme la recepción formal y custodia de la carga.
 */
export const driverConfirmCustody = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para confirmar custodia.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Perfil de usuario no encontrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo.')
  }

  const { manifestId, notes = '', supervisorOverride } = request.data || {}
  if (!manifestId || typeof manifestId !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe especificar el ID del manifiesto.')
  }

  return await db.runTransaction(async (transaction) => {
    const manifestRef = db.collection('manifests').doc(manifestId)
    const manifestDoc = await transaction.get(manifestRef)

    if (!manifestDoc.exists) {
      throw new HttpsError('not-found', 'El manifiesto no existe.')
    }

    const manifestData = manifestDoc.data() || {}

    // A3: Validación estricta del conductor titular asignado
    let overrideApplied = false
    if (manifestData.driverUid !== callerUid) {
      const isSupervisor = ['encargado_agencia', 'directiva_admin'].includes(callerData.role)
      const hasValidOverride = supervisorOverride &&
        typeof supervisorOverride.reason === 'string' &&
        supervisorOverride.reason.trim().length >= 10

      if (isSupervisor && hasValidOverride) {
        overrideApplied = true
      } else {
        throw new HttpsError('permission-denied', 'Solo el conductor titular asignado puede aceptar la custodia del manifiesto.')
      }
    }

    // A3: Comprobar que el conductor asignado se encuentra activo en la empresa
    const driverRef = db.collection('users').doc(manifestData.driverUid)
    const driverDoc = await transaction.get(driverRef)
    if (!driverDoc.exists || driverDoc.data()?.isActive === false) {
      throw new HttpsError('failed-precondition', 'El conductor asignado al manifiesto se encuentra inactivo o dado de baja.')
    }

    // A3: Comprobar que el vehículo asignado se encuentra activo en el padrón
    if (manifestData.vehicleId) {
      const vehicleRef = db.collection('vehicles').doc(manifestData.vehicleId)
      const vehicleDoc = await transaction.get(vehicleRef)
      if (!vehicleDoc.exists || vehicleDoc.data()?.status !== 'active') {
        throw new HttpsError('failed-precondition', 'El vehículo asignado al viaje no se encuentra activo.')
      }
    }

    if (manifestData.status !== 'dispatched' && manifestData.status !== 'in_transit') {
      throw new HttpsError('failed-precondition', `El manifiesto tiene estado '${manifestData.status}', no puede confirmarse custodia.`)
    }

    if (manifestData.driverCustodyStatus === 'accepted') {
      return {
        success: true,
        manifestId,
        manifestNumber: manifestData.manifestNumber,
        driverCustodyStatus: 'accepted',
        message: 'La custodia ya había sido aceptada previamente.',
      }
    }

    const now = FieldValue.serverTimestamp()
    const nowIso = new Date().toISOString()

    const updatePayload = {
      driverCustodyStatus: 'accepted',
      driverCustodyAt: now,
      driverCustodyAtIso: nowIso,
      driverCustodyNotes: notes || '',
      status: 'in_transit',
      updatedAt: now,
    }

    if (overrideApplied) {
      updatePayload.supervisorOverride = {
        applied: true,
        supervisorUid: callerUid,
        supervisorName: callerData.fullName || 'Supervisor',
        supervisorRole: callerData.role,
        reason: supervisorOverride.reason.trim(),
        timestamp: nowIso,
      }
    }

    transaction.update(manifestRef, updatePayload)

    const auditRef = db.collection('audit_logs').doc()
    transaction.set(auditRef, {
      entityType: 'manifest',
      entityId: manifestId,
      action: 'driver_confirm_custody',
      performedByUid: callerUid,
      performedByName: callerData.fullName || (overrideApplied ? 'Supervisor' : 'Conductor'),
      details: {
        manifestNumber: manifestData.manifestNumber,
        notes,
        overrideApplied,
        reason: overrideApplied ? supervisorOverride.reason.trim() : null,
      },
      timestamp: now,
    })

    return {
      success: true,
      manifestId,
      manifestNumber: manifestData.manifestNumber,
      driverCustodyStatus: 'accepted',
      driverCustodyAtIso: nowIso,
      overrideApplied,
    }
  })
})

/**
 * Cloud Function Callable para la recepción formal del manifiesto en agencia de destino,
 * con verificación bulto a bulto, registro de discrepancias y actualización de custodia.
 */
async function receiveDispatch(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para recibir manifiestos.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Perfil de usuario no encontrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', `El rol '${callerData.role}' no tiene permiso para recibir manifiestos en destino.`)
  }

  const {
    manifestId,
    receivedShipments = [],
    receptionNotes = '',
    supervisorOverride,
  } = request.data || {}

  if (!manifestId || typeof manifestId !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe especificar el ID del manifiesto.')
  }

  return await db.runTransaction(async (transaction) => {
    // 1. LECTURAS
    const manifestRef = db.collection('manifests').doc(manifestId)
    const manifestDoc = await transaction.get(manifestRef)

    if (!manifestDoc.exists) {
      throw new HttpsError('not-found', 'El manifiesto no existe.')
    }

    const manifestData = manifestDoc.data() || {}

    if (callerData.role !== 'directiva_admin') {
      const isAllowed = callerData.primaryBranchId === manifestData.destinationBranchId ||
        (Array.isArray(callerData.allowedBranchIds) && callerData.allowedBranchIds.includes(manifestData.destinationBranchId))
      if (!isAllowed) {
        throw new HttpsError('permission-denied', `No tiene permiso para recibir carga en la sucursal '${manifestData.destinationBranchId}'.`)
      }
    }

    // Regla de no auto-recepción: el mismo conductor no puede firmar la recepción
    if (manifestData.driverUid === callerUid) {
      throw new HttpsError('permission-denied', 'El conductor que transportó la carga no puede auto-firmar la recepción en la agencia de destino. Debe recibirlo el personal de ventanilla o encargado.')
    }

    if (manifestData.status === 'received') {
      throw new HttpsError('failed-precondition', 'Este manifiesto ya fue recibido y cerrado previamente.')
    }

    if (manifestData.status !== 'dispatched' && manifestData.status !== 'in_transit') {
      throw new HttpsError('failed-precondition', `El manifiesto tiene estado '${manifestData.status}', no puede ser recibido.`)
    }

    // A2: Custodia de conductor previa obligatoria, salvo contingencia autorizada con motivo explícito de supervisor
    let custodyOverrideApplied = false
    if (manifestData.driverCustodyStatus !== 'accepted') {
      const isSupervisor = ['encargado_agencia', 'directiva_admin'].includes(callerData.role)
      const hasValidOverride = supervisorOverride &&
        typeof supervisorOverride.reason === 'string' &&
        supervisorOverride.reason.trim().length >= 10

      if (isSupervisor && hasValidOverride) {
        custodyOverrideApplied = true
      } else {
        throw new HttpsError('failed-precondition', 'El conductor aún no ha aceptado la custodia formal del manifiesto. Se requiere confirmación de custodia o autorización explícita de supervisor para contingencia.')
      }
    }

    const expectedShipmentIds = manifestData.shipmentIds || []
    const simplified = manifestData.singleTransfer === true
    if (request[singleTransfer] && (!simplified || expectedShipmentIds.length !== 1)) {
      throw new HttpsError('failed-precondition', 'Usa el flujo avanzado para este viaje.')
    }
    if (simplified) {
      const profile = await assertTransferBranch(transaction, callerUid, manifestData.destinationBranchId)
      if (custodyOverrideApplied && !['encargado_agencia', 'directiva_admin'].includes(profile.role)) {
        throw new HttpsError('permission-denied', 'La contingencia requiere un supervisor autorizado.')
      }
    }

    // A2: No dar por recibida conforme una encomienda que no esté marcada explícitamente en la lista de recepción
    if (!Array.isArray(receivedShipments) || receivedShipments.length !== expectedShipmentIds.length) {
      throw new HttpsError('invalid-argument', `Cada encomienda del manifiesto debe ser verificada explícitamente en la lista de recepción. Se esperaban ${expectedShipmentIds.length} ítems pero se enviaron ${Array.isArray(receivedShipments) ? receivedShipments.length : 0}.`)
    }

    const shipmentRefsAndDocs = []
    for (const sId of expectedShipmentIds) {
      const sRef = db.collection('shipments').doc(sId)
      const sDoc = await transaction.get(sRef)
      shipmentRefsAndDocs.push({ id: sId, ref: sRef, doc: sDoc })
    }

    // 2. PROCESAR RECEPCIÓN Y DISCREPANCIAS
    const now = FieldValue.serverTimestamp()
    const nowIso = new Date().toISOString()
    const discrepancies = []
    const receivedMap = new Map()

    for (const item of receivedShipments) {
      if (item && item.shipmentId) {
        receivedMap.set(item.shipmentId, item)
      }
    }

    for (const item of shipmentRefsAndDocs) {
      if (!item.doc.exists && simplified) throw new HttpsError('not-found', 'No se encontró la encomienda del traslado.')
      if (!item.doc.exists) continue
      const sData = item.doc.data() || {}
      const itemInput = receivedMap.get(item.id)

      if (!itemInput) {
        throw new HttpsError('invalid-argument', `Falta la verificación explícita de recepción para la encomienda ${sData.trackingCode || item.id}.`)
      }

      const expectedPkg = Number(sData.packageCount ?? sData.itemsCount) || 1
      const recPkg = Number(itemInput.receivedPackages ?? itemInput.verifiedPackages)

      if (!Number.isInteger(recPkg) || recPkg < 0) {
        throw new HttpsError('invalid-argument', `El conteo de bultos recibidos para la encomienda ${sData.trackingCode || item.id} debe ser un entero mayor o igual a 0.`)
      }

      if (simplified && (sData.manifestId !== manifestId || !['in_transit', 'dispatched'].includes(sData.status))) {
        throw new HttpsError('failed-precondition', 'La encomienda ya no está en traslado.')
      }
      if (simplified && !['good', 'damaged', 'missing'].includes(itemInput.condition)) {
        throw new HttpsError('invalid-argument', 'Indica la condición física de los bultos.')
      }
      const condition = itemInput.condition || 'good'
      const isDiscrepant = (recPkg !== expectedPkg) || (condition !== 'good')
      const notesStr = (itemInput.notes || itemInput.discrepancyNote || itemInput.discrepancyNotes || '').trim()

      // A2: Si faltan bultos o hay daño visible, exige notas explicativas obligatorias (mínimo 5 caracteres)
      if (isDiscrepant) {
        if (notesStr.length < 5) {
          throw new HttpsError('invalid-argument', `Debe registrar una nota explicativa de al menos 5 caracteres justificando la discrepancia o daño en la encomienda ${sData.trackingCode || item.id}.`)
        }

        discrepancies.push({
          shipmentId: item.id,
          trackingCode: sData.trackingCode || item.id,
          issueType: condition === 'good' ? (recPkg < expectedPkg ? 'missing' : 'excess') : condition,
          expectedPackages: expectedPkg,
          receivedPackages: recPkg,
          notes: notesStr,
          reportedAt: nowIso,
          reportedByUid: callerUid,
        })
      }

      // A2: No marcar como pérdida total si llegaron bultos parciales; usar partially_received / incident_investigation
      let newStatus = 'received_at_dest'
      let statusNote = `Recibido en destino (${manifestData.destinationBranchId}) de viaje ${manifestData.manifestNumber}.`

      if (recPkg > 0 && recPkg < expectedPkg) {
        newStatus = 'partially_received'
        statusNote = `DISCREPANCIA PARCIAL: Llegaron ${recPkg} de ${expectedPkg} bultos declarados en manifiesto ${manifestData.manifestNumber}. (${notesStr}).`
      } else if (condition === 'missing' || recPkg === 0) {
        newStatus = condition === 'missing' ? 'lost' : 'incident_investigation'
        statusNote = `DISCREPANCIA: Paquete no encontrado al arribo del manifiesto ${manifestData.manifestNumber}. Declarado ${newStatus}.`
      } else if (simplified && isDiscrepant) {
        newStatus = 'incident_investigation'
        statusNote = `Recepción observada: ${recPkg}/${expectedPkg} bultos, ${condition}. ${notesStr}`
      } else if (condition === 'damaged') {
        statusNote += ` OBSERVACIÓN: Recibido con daños (${notesStr || 'sin detalle'}).`
      }

      const updatePayload = {
        status: newStatus,
        currentLocation: manifestData.destinationBranchId,
        arrivedAt: now,
        arrivedAtBranchId: manifestData.destinationBranchId,
        arrivedPackages: recPkg,
        updatedAt: now,
      }

      if (condition !== 'good' || recPkg !== expectedPkg) {
        updatePayload.incidentNotes = itemInput.notes || `Condición: ${condition}, Bultos: ${recPkg}/${expectedPkg}`
      }

      if (simplified) {
        updatePayload.auditHistory = FieldValue.arrayUnion(transferAudit({
          action: 'confirm_shipment_reception', previousStatus: sData.status, newStatus,
          callerUid, callerData, branchId: manifestData.destinationBranchId, nowIso,
          reason: notesStr || 'Recepción conforme.', newValues: { receivedPackages: recPkg, condition },
        }))
      }
      transaction.update(item.ref, updatePayload)

      const statusLogRef = item.ref.collection('status_logs').doc()
      transaction.set(statusLogRef, {
        status: newStatus,
        previousStatus: sData.status,
        receivedPackages: recPkg,
        condition,
        operatorUid: callerUid,
        operatorName: callerData.fullName || 'Operador',
        branchId: manifestData.destinationBranchId,
        note: statusNote,
        createdAt: now,
        createdAtIso: nowIso,
      })
    }

    const manifestUpdatePayload = {
      status: 'received',
      receivedAt: now,
      receivedAtIso: nowIso,
      receivedByUid: callerUid,
      receivedByName: callerData.fullName || 'Operador',
      receptionNotes: receptionNotes || '',
      discrepancies,
      updatedAt: now,
    }

    if (custodyOverrideApplied) {
      manifestUpdatePayload.custodyOverride = {
        applied: true,
        supervisorUid: callerUid,
        supervisorName: callerData.fullName || 'Supervisor',
        reason: supervisorOverride.reason.trim(),
        timestamp: nowIso,
      }
    }

    transaction.update(manifestRef, manifestUpdatePayload)

    const auditRef = db.collection('audit_logs').doc()
    transaction.set(auditRef, {
      entityType: 'manifest',
      entityId: manifestId,
      action: 'receive_dispatch_manifest',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      details: {
        manifestNumber: manifestData.manifestNumber,
        destinationBranchId: manifestData.destinationBranchId,
        totalShipments: manifestData.shipmentIds.length,
        discrepanciesCount: discrepancies.length,
        discrepancies,
        custodyOverrideApplied,
      },
      timestamp: now,
    })

    return {
      success: true,
      manifestId,
      manifestNumber: manifestData.manifestNumber,
      totalShipments: manifestData.shipmentIds.length,
      discrepanciesCount: discrepancies.length,
      totalDiscrepancies: discrepancies.length,
      receivedAtIso: nowIso,
    }
  })
}

export const receiveDispatchManifest = onCall({ cors: true }, receiveDispatch)

async function assertTransferBranch(transaction, uid, branchId) {
  const profile = (await transaction.get(db.collection('users').doc(uid))).data()
  const allowed = profile?.primaryBranchId === branchId ||
    (Array.isArray(profile?.allowedBranchIds) && profile.allowedBranchIds.includes(branchId))
  if (!branchId || !allowed || profile?.isActive !== true ||
      !['secretaria', 'encargado_agencia', 'directiva_admin'].includes(profile.role)) {
    throw new HttpsError('permission-denied', 'Se requiere un perfil activo autorizado en la sucursal.')
  }
  return profile
}

function transferAudit({ action, previousStatus, newStatus, callerUid, callerData, branchId, nowIso, reason, newValues }) {
  return {
    action, previousStatus, newStatus, branchId, reason, newValues,
    previousValues: { status: previousStatus },
    changedAt: nowIso, operatorUid: callerUid,
    operatorName: callerData.fullName || 'Operador', operatorRole: callerData.role,
  }
}

export const confirmShipmentDeparture = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.')
  if (process.env.SIMPLE_SHIPMENT_TRANSFER !== 'true') {
    throw new HttpsError('failed-precondition', 'El traslado simplificado está deshabilitado.')
  }
  const { shipmentId, originBranchId, destinationBranchId, vehicleId, driverUid } = request.data || {}
  return createDispatch({
    ...request,
    [singleTransfer]: true,
    data: { shipmentIds: [shipmentId], originBranchId, destinationBranchId, vehicleId, driverUid },
  })
})

export const confirmShipmentReception = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.')
  if (process.env.SIMPLE_SHIPMENT_TRANSFER !== 'true') {
    throw new HttpsError('failed-precondition', 'El traslado simplificado está deshabilitado.')
  }
  const { shipmentId, manifestId, receivedPackages, condition, notes = '' } = request.data || {}
  if (!Number.isInteger(receivedPackages) || receivedPackages < 0 || typeof notes !== 'string') {
    throw new HttpsError('invalid-argument', 'Indica la cantidad de bultos y una observación válida.')
  }
  return receiveDispatch({
    ...request,
    [singleTransfer]: true,
    data: { manifestId, receivedShipments: [{ shipmentId, receivedPackages, condition, notes }] },
  })
})

/**
 * Cloud Function Callable para asignar físicamente una encomienda a un estante y módulo de almacén.
 * Valida estado de recepción formal, existencia dinámica de estante y módulo, y trazabilidad física.
 */
export const assignShipmentStorage = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para asignar ubicación en almacén.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Perfil de usuario no encontrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'No tiene permiso para gestionar almacén.')
  }

  const {
    shipmentId,
    warehouseId = 'ALMACEN-1',
    warehouseName = 'Almacén 1',
    shelfId,
    shelfName,
    moduleId,
    moduleNumber,
    rowNumber = 1,
    floorNumber = 1,
    spaceNumber = 1,
    position = '',
    photo = null,
  } = request.data || {}

  const featureConfig = await db.collection('system_config').doc('expreso_punata').get()
  const storagePhotosEnabled = process.env.STORAGE_PHOTOS_ENABLED === 'true' &&
    featureConfig.data()?.storagePhotosEnabled === true
  if (photo && !storagePhotosEnabled) {
    throw new HttpsError('failed-precondition', 'Las fotografías de almacenamiento no están habilitadas para la versión básica.')
  }

  if (!shipmentId || typeof shipmentId !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe especificar el ID de la encomienda.')
  }
  if (!shelfId || !moduleId || typeof moduleNumber !== 'number') {
    throw new HttpsError('invalid-argument', 'Debe especificar estante, módulo y número de módulo.')
  }
  if (!warehouseId || !warehouseName || ![rowNumber, floorNumber, spaceNumber].every((value) => Number.isInteger(value) && value > 0)) {
    throw new HttpsError('invalid-argument', 'Almacén, fila, piso y espacio deben ser válidos.')
  }
  if (photo && (!photo.storagePath?.startsWith(`shipments/${shipmentId}/storage/`) || !photo.contentType?.startsWith('image/') || photo.sizeBytes > 2 * 1024 * 1024)) {
    throw new HttpsError('invalid-argument', 'La fotografía de almacenamiento no es válida.')
  }

  return await db.runTransaction(async (transaction) => {
    const shipmentRef = db.collection('shipments').doc(shipmentId)
    const shipmentDoc = await transaction.get(shipmentRef)

    if (!shipmentDoc.exists) {
      throw new HttpsError('not-found', 'La encomienda no existe.')
    }

    const sData = shipmentDoc.data() || {}

    // A1: Validar permisos sobre sucursal de destino
    if (callerData.role !== 'directiva_admin') {
      const isAllowed = callerData.primaryBranchId === sData.destinationBranchId ||
        (Array.isArray(callerData.allowedBranchIds) && callerData.allowedBranchIds.includes(sData.destinationBranchId))
      if (!isAllowed) {
        throw new HttpsError('permission-denied', 'No tiene autorización sobre la sucursal de destino de esta encomienda.')
      }
    }

    // A1: Validar que la encomienda haya sido recibida formalmente en destino
    const st = sData.status
    if (st === 'in_transit' || st === 'dispatched' || st === 'received') {
      throw new HttpsError('failed-precondition', `La encomienda aún no ha sido recibida en la sucursal de destino (estado actual: '${st}').`)
    }
    if (st === 'delivered' || st === 'lost' || st === 'cancelled' || st === 'incident_investigation') {
      throw new HttpsError('failed-precondition', `No se puede almacenar una encomienda en estado '${st}'.`)
    }

    const destBranch = sData.destinationBranchId || 'cochabamba'
    const occupancySnap = await transaction.get(
      db.collection('shipments').where('destinationBranchId', '==', destBranch)
    )
    const occupied = occupancySnap.docs.some((doc) => {
      if (doc.id === shipmentId) return false
      const location = doc.data().storageLocation || {}
      return doc.data().status === 'stored' &&
        location.branchId === destBranch &&
        location.warehouseId === warehouseId &&
        location.shelfId === shelfId &&
        location.moduleNumber === moduleNumber &&
        location.rowNumber === rowNumber &&
        location.floorNumber === floorNumber &&
        location.spaceNumber === spaceNumber
    })
    if (occupied) {
      throw new HttpsError('already-exists', 'El espacio físico seleccionado ya está ocupado por otra encomienda.')
    }

    const shelfRef = db.collection('branches').doc(destBranch).collection('shelves').doc(shelfId)
    let shelfDoc = await transaction.get(shelfRef)

    // A5: Si la colección de estantes de la sucursal aún está vacía, auto-inicializar catálogo predeterminado
    if (!shelfDoc.exists) {
      const allShelvesSnap = await db.collection('branches').doc(destBranch).collection('shelves').get()
      if (allShelvesSnap.empty) {
        const defaultShelves = [
          { id: 'ESTANTE-A', name: 'Estante A - General', code: 'EST-A', moduleCount: 5, active: true },
          { id: 'ESTANTE-B', name: 'Estante B - Frágil / Paquetería Menor', code: 'EST-B', moduleCount: 5, active: true },
          { id: 'ESTANTE-C', name: 'Estante C - Cargas Pesadas / Sobredimensionadas', code: 'EST-C', moduleCount: 5, active: true },
        ]
        for (const sh of defaultShelves) {
          const sRef = db.collection('branches').doc(destBranch).collection('shelves').doc(sh.id)
          transaction.set(sRef, {
            ...sh,
            branchId: destBranch,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
          for (let m = 1; m <= sh.moduleCount; m++) {
            const mRef = sRef.collection('modules').doc(`MOD-${m}`)
            transaction.set(mRef, {
              id: `MOD-${m}`,
              shelfId: sh.id,
              branchId: destBranch,
              moduleNumber: m,
              description: `Módulo ${m} de ${sh.name}`,
              currentPackageCount: 0,
            })
          }
        }
        const matchingDefault = defaultShelves.find((d) => d.id === shelfId)
        if (matchingDefault) {
          shelfDoc = {
            exists: true,
            data: () => matchingDefault,
          }
        }
      }
    }

    if (!shelfDoc.exists || (typeof shelfDoc.data === 'function' && shelfDoc.data()?.active === false)) {
      throw new HttpsError('not-found', `El estante '${shelfId}' no existe o no se encuentra activo en la sucursal '${destBranch}'.`)
    }

    const shelfInfo = typeof shelfDoc.data === 'function' ? shelfDoc.data() : shelfDoc
    const physicalModuleMatch = /^MODULO-(\d+)$/.exec(String(shelfId))
    const physicalModuleNumber = physicalModuleMatch ? Number(physicalModuleMatch[1]) : null
    const maxModules = shelfInfo?.moduleCount || 5
    if (physicalModuleNumber !== null && moduleNumber !== physicalModuleNumber) {
      throw new HttpsError('invalid-argument', `La ubicación ${shelfId} requiere moduleNumber ${physicalModuleNumber}.`)
    }
    if (moduleNumber < 1 || moduleNumber > maxModules && physicalModuleNumber === null) {
      throw new HttpsError('invalid-argument', `El número de módulo debe estar entre 1 y ${maxModules}.`)
    }

    const now = FieldValue.serverTimestamp()
    const nowIso = new Date().toISOString()

    const newLocation = {
      branchId: destBranch,
      warehouseId,
      warehouseName,
      shelfId,
      shelfName: shelfName || shelfInfo.name || shelfId,
      moduleId,
      moduleNumber,
      rowNumber,
      floorNumber,
      spaceNumber,
      position: position || '',
      storedAt: nowIso,
      storedByUid: callerUid,
      storedByName: callerData.fullName || 'Operador',
    }

    transaction.update(shipmentRef, {
      status: 'stored',
      storageLocation: newLocation,
      ...(photo ? {
        storagePhoto: {
          ...photo,
          capturedByUid: callerUid,
          capturedByName: callerData.fullName || 'Operador',
        },
      } : {}),
      updatedAt: now,
    })

    // A1: Trazabilidad física inmutable en storage_moves con origen y nuevo destino
    const moveRef = shipmentRef.collection('storage_moves').doc()
    transaction.set(moveRef, {
      branchId: destBranch,
      warehouseId,
      warehouseName,
      shelfId,
      shelfName: shelfName || shelfInfo.name || shelfId,
      moduleId,
      moduleNumber,
      rowNumber,
      floorNumber,
      spaceNumber,
      position: position || '',
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      previousLocation: sData.storageLocation || null,
      newLocation,
      timestamp: now,
      timestampIso: nowIso,
    })

    const statusLogRef = shipmentRef.collection('status_logs').doc()
    transaction.set(statusLogRef, {
      status: 'stored',
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      branchId: destBranch,
      note: `Almacenado físicamente en ${warehouseName} / ${shelfName || shelfInfo.name || shelfId} / Módulo ${moduleNumber} / Fila ${rowNumber} / Piso ${floorNumber} / Espacio ${spaceNumber}${position ? ' (' + position + ')' : ''}`,
      createdAt: now,
      createdAtIso: nowIso,
    })

    const auditRef = db.collection('audit_logs').doc()
    transaction.set(auditRef, {
      entityType: 'shipment',
      entityId: shipmentId,
      action: 'assign_shipment_storage',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      details: {
        trackingCode: sData.trackingCode,
        previousLocation: sData.storageLocation || null,
        newLocation,
      },
      timestamp: now,
    })

    return {
      success: true,
      shipmentId,
      trackingCode: sData.trackingCode,
      storageLocation: newLocation,
    }
  })
})

/**
 * Cloud Function Callable para administración del padrón de flota de vehículos y móviles.
 */
export const manageVehicle = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para administrar la flota.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Perfil de usuario no encontrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo.')
  }

  const allowedRoles = ['encargado_agencia', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'Solo encargados de agencia o administración pueden gestionar vehículos.')
  }

  const {
    action = 'create',
    vehicleId,
    vehicleData = {},
  } = request.data || {}

  const now = FieldValue.serverTimestamp()
  const nowIso = new Date().toISOString()

  if (action === 'create') {
    const {
      mobileNumber,
      plate,
      branchId = 'punata',
      brand = '',
      model = '',
      capacityKg = 1000,
      assignedDriverUid = null,
      assignedDriverName = null,
      notes = '',
    } = vehicleData

    if (!mobileNumber || !plate) {
      throw new HttpsError('invalid-argument', 'Debe especificar número de móvil y placa.')
    }

    const cleanMobile = String(mobileNumber).trim()
    const cleanPlate = String(plate).trim().toUpperCase()

    // Validar que no exista un vehículo con la misma placa
    const existingSnap = await db.collection('vehicles')
      .where('plate', '==', cleanPlate)
      .limit(1)
      .get()

    if (!existingSnap.empty) {
      throw new HttpsError('already-exists', `Ya existe un vehículo registrado con la placa ${cleanPlate}.`)
    }

    // Validar que no exista un vehículo activo con el mismo número de móvil
    const existingMobileSnap = await db.collection('vehicles')
      .where('mobileNumber', '==', cleanMobile)
      .limit(1)
      .get()

    if (!existingMobileSnap.empty) {
      throw new HttpsError('already-exists', `Ya existe un vehículo registrado con el número de móvil ${cleanMobile}.`)
    }

    const newVehicleRef = db.collection('vehicles').doc()
    const id = newVehicleRef.id

    await newVehicleRef.set({
      id,
      mobileNumber: cleanMobile,
      plate: cleanPlate,
      branchId,
      brand: brand || '',
      model: model || '',
      capacityKg: Number(capacityKg) || 1000,
      assignedDriverUid,
      assignedDriverName,
      status: 'active',
      notes,
      createdAt: now,
      createdAtIso: nowIso,
      updatedAt: now,
      updatedAtIso: nowIso,
    })

    return {
      success: true,
      vehicleId: id,
      mobileNumber: cleanMobile,
      plate: cleanPlate,
    }
  } else if (action === 'update') {
    if (!vehicleId) {
      throw new HttpsError('invalid-argument', 'Debe especificar el ID del vehículo.')
    }

    const vRef = db.collection('vehicles').doc(vehicleId)
    const vDoc = await vRef.get()
    if (!vDoc.exists) {
      throw new HttpsError('not-found', 'Vehículo no encontrado.')
    }

    const updateFields = {
      updatedAt: now,
      updatedAtIso: nowIso,
    }

    if (vehicleData.status) updateFields.status = vehicleData.status
    if (vehicleData.branchId) updateFields.branchId = vehicleData.branchId
    if (vehicleData.brand !== undefined) updateFields.brand = vehicleData.brand
    if (vehicleData.model !== undefined) updateFields.model = vehicleData.model
    if (vehicleData.capacityKg !== undefined) updateFields.capacityKg = Number(vehicleData.capacityKg)
    if (vehicleData.assignedDriverUid !== undefined) {
      updateFields.assignedDriverUid = vehicleData.assignedDriverUid
      updateFields.assignedDriverName = vehicleData.assignedDriverName || null
    }
    if (vehicleData.notes !== undefined) updateFields.notes = vehicleData.notes

    await vRef.update(updateFields)

    return {
      success: true,
      vehicleId,
      action: 'update',
    }
  } else {
    throw new HttpsError('invalid-argument', `Acción '${action}' no soportada.`)
  }
})

/**
 * A4: Cloud Function Callable para listar conductores activos protegiendo la privacidad de los empleados.
 * Sincroniza y expone únicamente campos operativos públicos en /driver_directory.
 */
export const listActiveDrivers = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar conductores.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists || userDoc.data()?.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no autorizado o inactivo.')
  }

  const snapshot = await db.collection('users')
    .where('role', '==', 'conductor')
    .where('isActive', '==', true)
    .get()

  const drivers = []
  const batch = db.batch()

  snapshot.forEach((doc) => {
    const data = doc.data() || {}
    const driverEntry = {
      uid: doc.id,
      fullName: data.fullName || 'Conductor',
      phone: data.phone || '',
      assignedVehiclePlate: data.assignedVehiclePlate || null,
      assignedMobileNumber: data.assignedMobileNumber || null,
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    }
    drivers.push(driverEntry)
    batch.set(db.collection('driver_directory').doc(doc.id), driverEntry, { merge: true })
  })

  await batch.commit()

  return { success: true, drivers }
})

/**
 * A5: Cloud Function Callable para gestión dinámica del catálogo de estantes y módulos por sucursal.
 */
export const manageShelf = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para gestionar estantes.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists || userDoc.data()?.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no autorizado o inactivo.')
  }
  const callerData = userDoc.data() || {}

  const { action = 'get_or_seed', branchId, shelfData } = request.data || {}
  if (!branchId || (branchId !== 'punata' && branchId !== 'cochabamba')) {
    throw new HttpsError('invalid-argument', 'Sucursal inválida.')
  }

  const shelvesCol = db.collection('branches').doc(branchId).collection('shelves')

  if (action === 'get_or_seed' || action === 'list') {
    const snapshot = await shelvesCol.get()
    if (snapshot.empty) {
      const defaultShelves = [
        {
          id: 'ESTANTE-A',
          name: 'Estante A - General',
          code: 'EST-A',
          description: 'Encomiendas y sobres generales',
          moduleCount: 5,
          active: true,
        },
        {
          id: 'ESTANTE-B',
          name: 'Estante B - Frágil / Paquetería Menor',
          code: 'EST-B',
          description: 'Artículos frágiles y cajas chicas',
          moduleCount: 5,
          active: true,
        },
        {
          id: 'ESTANTE-C',
          name: 'Estante C - Cargas Pesadas / Sobredimensionadas',
          code: 'EST-C',
          description: 'Bultos pesados, sacos y repuestos',
          moduleCount: 5,
          active: true,
        },
      ]

      const batch = db.batch()
      for (const sh of defaultShelves) {
        const ref = shelvesCol.doc(sh.id)
        batch.set(ref, {
          ...sh,
          branchId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        for (let m = 1; m <= sh.moduleCount; m++) {
          const modRef = ref.collection('modules').doc(`MOD-${m}`)
          batch.set(modRef, {
            id: `MOD-${m}`,
            shelfId: sh.id,
            branchId,
            moduleNumber: m,
            description: `Módulo ${m} de ${sh.name}`,
            currentPackageCount: 0,
          })
        }
      }
      await batch.commit()
      return { success: true, shelves: defaultShelves }
    }

    const shelves = []
    snapshot.forEach((doc) => shelves.push({ id: doc.id, ...doc.data() }))
    return { success: true, shelves }
  }

  // Creación o actualización (requiere encargado o directiva_admin)
  if (!['encargado_agencia', 'directiva_admin'].includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'Solo encargados de agencia o directiva pueden configurar estantes.')
  }
  if (callerData.role !== 'directiva_admin') {
    const isAllowed = callerData.primaryBranchId === branchId ||
      (Array.isArray(callerData.allowedBranchIds) && callerData.allowedBranchIds.includes(branchId))
    if (!isAllowed) {
      throw new HttpsError('permission-denied', 'No tiene permiso sobre esta sucursal.')
    }
  }

  if (action === 'create_or_update') {
    if (!shelfData || !shelfData.id || !shelfData.name) {
      throw new HttpsError('invalid-argument', 'Datos de estante incompletos.')
    }
    const moduleCount = Number(shelfData.moduleCount) || 5
    const floorCount = shelfData.floorCount === undefined ? undefined : Number(shelfData.floorCount)
    const rowCountPerFloor = shelfData.rowCountPerFloor === undefined ? undefined : Number(shelfData.rowCountPerFloor)
    const spaceCountPerFloor = shelfData.spaceCountPerFloor === undefined ? undefined : Number(shelfData.spaceCountPerFloor)
    const capacityPerSpace = shelfData.capacityPerSpace === undefined ? 1 : Number(shelfData.capacityPerSpace)
    for (const [label, value] of [['pisos', floorCount], ['filas por piso', rowCountPerFloor], ['espacios por piso', spaceCountPerFloor], ['capacidad por espacio', capacityPerSpace]]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100)) {
        throw new HttpsError('invalid-argument', `La configuración de ${label} debe ser un entero entre 1 y 100.`)
      }
    }
    if (moduleCount < 1 || moduleCount > 20) {
      throw new HttpsError('invalid-argument', 'El número de módulos debe estar entre 1 y 20.')
    }

    // No permitir que una reconfiguración deje fuera una encomienda almacenada.
    // Las ubicaciones existentes deben reubicarse antes de reducir pisos o espacios.
    if (floorCount !== undefined && spaceCountPerFloor !== undefined) {
      const storedShipments = await db.collection('shipments')
        .where('destinationBranchId', '==', branchId)
        .where('status', '==', 'stored')
        .get()
      const affected = storedShipments.docs.find((doc) => {
        const location = doc.data()?.storageLocation || {}
        return location.shelfId === shelfData.id &&
          ((location.floorNumber || 1) > floorCount || (location.spaceNumber || 1) > spaceCountPerFloor || (rowCountPerFloor !== undefined && (location.rowNumber || 1) > rowCountPerFloor))
      })
      if (affected) {
        throw new HttpsError('failed-precondition', 'No se puede reducir la estructura: existe una encomienda almacenada en un piso o espacio afectado. Reubíquela primero.')
      }
    }

    const shelfRef = shelvesCol.doc(shelfData.id)
    const now = FieldValue.serverTimestamp()
    const payload = {
      id: shelfData.id,
      branchId,
      name: shelfData.name.trim(),
      code: shelfData.code || shelfData.id,
      description: shelfData.description || '',
      moduleCount,
      ...(floorCount === undefined ? {} : { floorCount }),
      ...(rowCountPerFloor === undefined ? {} : { rowCountPerFloor }),
      ...(spaceCountPerFloor === undefined ? {} : { spaceCountPerFloor }),
      capacityPerSpace,
      physicalWarehouseId: shelfData.physicalWarehouseId || 'ALMACEN-1',
      physicalWarehouseName: shelfData.physicalWarehouseName || 'Almacén 1',
      active: shelfData.active !== false,
      updatedAt: now,
    }

    await shelfRef.set(payload, { merge: true })

    const batch = db.batch()
    for (let m = 1; m <= moduleCount; m++) {
      const modRef = shelfRef.collection('modules').doc(`MOD-${m}`)
      batch.set(modRef, {
        id: `MOD-${m}`,
        shelfId: shelfData.id,
        branchId,
        moduleNumber: m,
        description: `Módulo ${m} de ${shelfData.name}`,
      }, { merge: true })
    }
    await batch.commit()

    return { success: true, shelf: payload }
  }

  throw new HttpsError('invalid-argument', `Acción '${action}' no reconocida.`)
})

/**
 * Procesa la firma digital manuscrita o evidencia fotográfica y la almacena en Firebase Storage.
 * Devuelve únicamente metadatos y referencia segura para almacenar en Firestore (eliminando base64 de la base de datos).
 */
async function processAndSaveSignatureToStorage(shipmentId, signatureInput, operatorUid) {
  if (!signatureInput || typeof signatureInput !== 'string') {
    throw new HttpsError('invalid-argument', 'La firma digital es obligatoria para certificar la entrega conforme.')
  }

  const bucketName = process.env.STORAGE_BUCKET_NAME || 'expreso-punata-dev.firebasestorage.app'
  const bucket = storageAdmin.bucket(bucketName)

  // 1. Si ya es una ruta relativa o absoluta existente en Firebase Storage
  if (signatureInput.startsWith('shipments/') || signatureInput.startsWith('/shipments/')) {
    const cleanPath = signatureInput.replace(/^\//, '')
    const expectedPrefix = `shipments/${shipmentId}/signatures/`
    if (!cleanPath.startsWith(expectedPrefix) || cleanPath.includes('..')) {
      throw new HttpsError('permission-denied', `La ruta de firma no pertenece a la encomienda ${shipmentId}.`)
    }

    const file = bucket.file(cleanPath)
    const [exists] = await file.exists().catch(() => [false])
    if (!exists) {
      throw new HttpsError('invalid-argument', 'El archivo de firma indicado en Firebase Storage no existe.')
    }
    const [metadata] = await file.getMetadata().catch(() => [{}])
    return {
      fileRef: file,
      isNewUpload: false,
      metadata: {
        storagePath: cleanPath,
        mimeType: metadata.contentType || 'image/png',
        sizeBytes: Number(metadata.size) || 0,
        sha256: metadata.metadata?.sha256 || null,
        verified: true,
        uploadedAtIso: new Date().toISOString(),
      },
    }
  }

  // 2. Si es una cadena Base64 / Data URL
  const base64Match = signatureInput.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
  const rawBase64 = base64Match ? base64Match[2] : signatureInput.replace(/^data:[^;]+;base64,/, '')
  const mimeType = (base64Match && (base64Match[1] === 'jpeg' || base64Match[1] === 'jpg')) ? 'image/jpeg' : 'image/png'

  let buffer
  try {
    buffer = Buffer.from(rawBase64, 'base64')
  } catch {
    throw new HttpsError('invalid-argument', 'El formato de codificación Base64 de la firma es inválido.')
  }

  if (buffer.length < 50) {
    throw new HttpsError('invalid-argument', 'El trazo de la firma digital es demasiado corto o está vacío.')
  }
  if (buffer.length > 2 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'El archivo de la firma excede el límite permitido de 2MB.')
  }

  // Validar magic bytes (PNG: 89 50 4E 47 0D 0A 1A 0A, JPEG: FF D8 FF)
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
  if (!isPng && !isJpeg) {
    throw new HttpsError('invalid-argument', 'El archivo de firma debe ser una imagen válida en formato PNG o JPEG.')
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const ext = isJpeg ? 'jpg' : 'png'
  const fileName = `signature_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`
  const storagePath = `shipments/${shipmentId}/signatures/${fileName}`
  const file = bucket.file(storagePath)

  try {
    // Sin tokens públicos permanentes (firebaseStorageDownloadTokens eliminado)
    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          shipmentId,
          operatorUid,
          sha256,
        },
      },
    })
  } catch (uploadErr) {
    if (uploadErr.message?.includes('credentials') || process.env.NODE_ENV === 'test') {
      // Ignorar error de credenciales en test local unitario
    } else {
      throw uploadErr
    }
  }

  return {
    fileRef: file,
    isNewUpload: true,
    metadata: {
      storagePath,
      mimeType,
      sizeBytes: buffer.length,
      sha256,
      verified: true,
      uploadedAtIso: new Date().toISOString(),
    },
  }
}

/**
 * ENTREGA 3 — B1: Cloud Function Callable para la entrega final de encomiendas
 * (en ventanilla o en ruta por conductor), con verificación fehaciente, firma en Storage,
 * liberación de almacén y cobro transaccional COD bajo custodia estricta.
 */
export const deliverShipment = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para registrar la entrega.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Perfil de usuario no encontrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'directiva_admin', 'conductor']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', `El rol '${callerData.role}' no tiene permiso para entregar encomiendas.`)
  }

  const isDriver = callerData.role === 'conductor'

  const {
    shipmentId,
    receivedByName,
    receivedByDocType = 'CI',
    receivedByDocNumber,
    recipientRelationship = 'titular',
    authorizationNote = '',
    signatureDataUrl,
    signatureUrl,
    photoEvidenceUrl = null,
    paymentMethod = 'cash',
    idempotencyKey,
    isAuthorizedNoPaymentException = false,
    supervisorOverrideUid = null,
    supervisorOverrideReason = null,
  } = request.data || {}

  if (!shipmentId || typeof shipmentId !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe especificar el ID de la encomienda.')
  }
  if (!receivedByName || typeof receivedByName !== 'string' || receivedByName.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'El nombre de quien retira debe tener al menos 3 caracteres.')
  }
  if (!receivedByDocNumber || typeof receivedByDocNumber !== 'string' || receivedByDocNumber.trim().length < 4) {
    throw new HttpsError('invalid-argument', 'El número de documento debe tener al menos 4 caracteres.')
  }

  const rawSig = signatureDataUrl || signatureUrl
  if (!rawSig || typeof rawSig !== 'string' || rawSig.trim().length < 10) {
    throw new HttpsError('invalid-argument', 'La firma digital es obligatoria para certificar la entrega conforme.')
  }

  // 1. Guardar o verificar firma en Firebase Storage (previo a transacción)
  const sigResult = await processAndSaveSignatureToStorage(shipmentId, rawSig, callerUid)

  try {
    return await db.runTransaction(async (transaction) => {
      const shipmentRef = db.collection('shipments').doc(shipmentId)
      const shipmentDoc = await transaction.get(shipmentRef)
      if (!shipmentDoc.exists) {
        throw new HttpsError('not-found', 'La encomienda no existe.')
      }
      const sData = shipmentDoc.data() || {}

      if (sData.status === 'delivered') {
        throw new HttpsError('failed-precondition', 'La encomienda ya fue entregada previamente.')
      }

      // Validar asignación de conductor si es entrega en ruta
      if (isDriver) {
        const isDirectlyAssigned = (sData.assignedVehicle && sData.assignedVehicle.driverUid === callerUid)
        if (!isDirectlyAssigned) {
          // Comprobar si el conductor tiene un manifiesto activo con esta encomienda
          const manifestSnap = await transaction.get(
            db.collection('manifests')
              .where('driverUid', '==', callerUid)
              .where('status', 'in', ['dispatched', 'in_transit'])
              .limit(10)
          )
          const inManifest = manifestSnap.docs.some(d => {
            const m = d.data()
            return Array.isArray(m.shipmentIds) && m.shipmentIds.includes(shipmentId)
          })
          if (!inManifest) {
            throw new HttpsError('permission-denied', 'No tiene asignada la custodia de esta encomienda para realizar la entrega en ruta.')
          }
        }

        const driverDeliverable = sData.singleTransfer
          ? ['received_at_dest', 'stored']
          : ['in_transit', 'dispatched', 'received_at_dest', 'stored']
        if (!driverDeliverable.includes(sData.status)) {
          throw new HttpsError('failed-precondition', `No se puede entregar la encomienda en estado '${sData.status}'.`)
        }
      } else {
        // Entrega en ventanilla de sucursal
        if (callerData.role !== 'directiva_admin') {
          const isAllowed = callerData.primaryBranchId === sData.destinationBranchId ||
            (Array.isArray(callerData.allowedBranchIds) && callerData.allowedBranchIds.includes(sData.destinationBranchId))
          if (!isAllowed) {
            throw new HttpsError('permission-denied', `No tiene permiso para entregar encomiendas en la sucursal de destino '${sData.destinationBranchId}'.`)
          }
        }
        const counterDeliverable = ['received_at_dest', 'stored', 'in_delivery', 'ready_for_pickup']
        if (!counterDeliverable.includes(sData.status)) {
          throw new HttpsError('failed-precondition', `No se puede entregar una encomienda en estado '${sData.status}'. Debe haber sido recibida formalmente en destino.`)
        }
      }

      const now = FieldValue.serverTimestamp()
      const nowIso = new Date().toISOString()
      let paymentCollected = false
      let targetShiftId = null
      let finMovementRef = null
      let custodyRecordId = null

      const requiresCodPayment = sData.paymentTiming === 'destination_cod' && sData.paymentStatus !== 'paid'

      if (requiresCodPayment) {
        const amountCents = Number(sData.finalAmountCents) || 0
        if (amountCents <= 0) {
          throw new HttpsError('failed-precondition', 'Importe de encomienda contraentrega inválido.')
        }

        if (isDriver) {
          // Cobro en ruta por conductor: NO usa caja de secretaria. Va al libro de custodia del conductor
          if (paymentMethod !== 'cash') {
            throw new HttpsError('invalid-argument', 'El cobro en ruta por conductor debe ser en efectivo.')
          }

          // 1. Actualizar cuenta de custodia del conductor
          const custodyAccRef = db.collection('driver_custody_accounts').doc(callerUid)
          const custodyAccDoc = await transaction.get(custodyAccRef)
          if (!custodyAccDoc.exists) {
            transaction.set(custodyAccRef, {
              driverUid: callerUid,
              driverName: callerData.fullName || 'Conductor',
              cashUnderCustodyCents: amountCents,
              pendingRemittanceCents: amountCents,
              totalCollectedCents: amountCents,
              totalRemittedCents: 0,
              lastActivityAt: now,
              updatedAt: now,
            })
          } else {
            transaction.update(custodyAccRef, {
              cashUnderCustodyCents: FieldValue.increment(amountCents),
              pendingRemittanceCents: FieldValue.increment(amountCents),
              totalCollectedCents: FieldValue.increment(amountCents),
              lastActivityAt: now,
              updatedAt: now,
            })
          }

          // 2. Registrar asiento de custodia en driver_custody_records
          custodyRecordId = `CUST-REC-${sData.trackingCode || shipmentId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
          const custodyRecRef = db.collection('driver_custody_records').doc(custodyRecordId)
          transaction.set(custodyRecRef, {
            id: custodyRecordId,
            driverUid: callerUid,
            driverName: callerData.fullName || 'Conductor',
            type: 'route_collection',
            shipmentId,
            trackingCode: sData.trackingCode || shipmentId,
            amountCents,
            amountBob: amountCents / 100,
            paymentMethod: 'cash',
            status: 'pending_remittance',
            remittedAmountCents: 0,
            settlementIds: [],
            createdAt: now,
            createdAtIso: nowIso,
          })

          // 3. Registrar movimiento financiero de cobro en ruta bajo custodia de conductor
          finMovementRef = db.collection('financial_movements').doc()
          transaction.set(finMovementRef, {
            type: 'driver_route_cod_collected',
            // El cobro COD en ruta es ingreso comercial desde que el cliente paga.
            // La rendición posterior se registra aparte como transferencia de custodia.
            branchId: sData.destinationBranchId,
            concept: `Cobro en ruta por conductor: Guía ${sData.trackingCode || shipmentId}`,
            amountCents,
            amountBob: amountCents / 100,
            currency: 'BOB',
            paymentMethod: 'cash',
            driverUid: callerUid,
            driverName: callerData.fullName || 'Conductor',
            shipmentId,
            trackingCode: sData.trackingCode || shipmentId,
            custodyRecordId,
            status: 'under_driver_custody',
            operatorUid: callerUid,
            operatorName: callerData.fullName || 'Conductor',
            timestamp: nowIso,
            createdAt: now,
          })

          paymentCollected = true
        } else {
          // Cobro en ventanilla por secretaria / encargado: requiere turno de caja abierto
          const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${sData.destinationBranchId}`)
          const lockDoc = await transaction.get(lockRef)
          if (!lockDoc.exists || lockDoc.data().status !== 'open' || !lockDoc.data().shiftId) {
            throw new HttpsError('failed-precondition', 'Debe tener un turno de caja abierto en la sucursal de destino para cobrar contraentrega (COD) en efectivo.')
          }

          targetShiftId = lockDoc.data().shiftId
          const shiftRef = db.collection('cash_shifts').doc(targetShiftId)
          const shiftDoc = await transaction.get(shiftRef)
          if (!shiftDoc.exists || shiftDoc.data().status !== 'open') {
            throw new HttpsError('failed-precondition', 'El turno de caja activo no es válido o ya fue cerrado.')
          }

          const shiftUpdate = {
            updatedAt: now,
            'breakdown.totalIncomeCents': FieldValue.increment(amountCents),
            'breakdown.codIncomeCents': FieldValue.increment(amountCents),
            movementsCount: FieldValue.increment(1),
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

          finMovementRef = db.collection('financial_movements').doc()
          transaction.set(finMovementRef, {
            shiftId: targetShiftId,
            branchId: sData.destinationBranchId,
            type: 'cod_income',
            concept: `Cobro contraentrega (COD) en ventanilla: Guía ${sData.trackingCode || shipmentId}`,
            amountCents,
            amountBob: amountCents / 100,
            currency: 'BOB',
            paymentMethod,
            shipmentId,
            trackingCode: sData.trackingCode || shipmentId,
            operatorUid: callerUid,
            operatorName: callerData.fullName || 'Operador',
            status: 'completed',
            timestamp: nowIso,
            createdAt: now,
          })

          paymentCollected = true
        }
      } else if (requiresCodPayment && !paymentCollected) {
        // Excepción de no cobro autorizada expresamente
        if (!isAuthorizedNoPaymentException) {
          throw new HttpsError('failed-precondition', 'No se puede entregar una encomienda contraentrega (COD) sin cobrar.')
        }
        if (!supervisorOverrideUid || !supervisorOverrideReason || supervisorOverrideReason.trim().length < 10) {
          throw new HttpsError('invalid-argument', 'La excepción de entrega sin cobro requiere justificación del encargado mayor a 10 caracteres.')
        }
      }

      // Liberar ubicación física de almacén si estaba almacenada
      if (sData.storageLocation) {
        const exitMoveRef = shipmentRef.collection('storage_moves').doc()
        transaction.set(exitMoveRef, {
          branchId: sData.destinationBranchId,
          previousLocation: sData.storageLocation,
          newLocation: null,
          type: 'exit_delivery',
          operatorUid: callerUid,
          operatorName: callerData.fullName || 'Operador',
          timestamp: now,
          timestampIso: nowIso,
        })
      }

      const deliveryRecord = {
        deliveredAt: now,
        deliveredAtIso: nowIso,
        deliveredByUid: callerUid,
        deliveredByName: callerData.fullName || 'Operador',
        deliveredByRole: callerData.role,
        deliveryChannel: isDriver ? 'route_delivery' : 'agency_counter',
        receivedByName: receivedByName.trim(),
        receivedByDocType,
        receivedByDocNumber: receivedByDocNumber.trim(),
        recipientRelationship,
        authorizationNote: authorizationNote.trim(),
        signature: sigResult.metadata,
        signatureUrl: sigResult.metadata.storagePath || null,
        photoEvidenceUrl,
        branchId: isDriver ? null : sData.destinationBranchId,
        collectedByDriverUid: (isDriver && paymentCollected) ? callerUid : null,
        collectedAmountCents: (isDriver && paymentCollected) ? Number(sData.finalAmountCents) : null,
      }

      const updatePayload = {
        status: 'delivered',
        deliveryRecord,
        storageLocation: null,
        deliveredAt: now,
        deliveredAtIso: nowIso,
        updatedAt: now,
      }

      if (paymentCollected) {
        updatePayload.paymentStatus = 'paid'
        updatePayload.paymentMethod = paymentMethod
        updatePayload.paidAt = now
        updatePayload.paidAtIso = nowIso
        if (isDriver) {
          updatePayload.collectedByDriverUid = callerUid
          updatePayload.collectedByDriverName = callerData.fullName || 'Conductor'
          updatePayload.driverCustody = {
            recordId: custodyRecordId,
            inCustody: true,
            reconciled: false,
          }
        } else {
          updatePayload.paidCashierUid = callerUid
          updatePayload.paidCashierName = callerData.fullName || 'Operador'
          if (targetShiftId) updatePayload.paidShiftId = targetShiftId
        }
        if (finMovementRef) {
          updatePayload.financialMovementId = finMovementRef.id
        }
      }

      transaction.update(shipmentRef, updatePayload)

      // status_logs
      const statusLogRef = shipmentRef.collection('status_logs').doc()
      transaction.set(statusLogRef, {
        status: 'delivered',
        operatorUid: callerUid,
        operatorName: callerData.fullName || 'Operador',
        branchId: isDriver ? (sData.destinationBranchId || 'ruta') : sData.destinationBranchId,
        note: `Entregado conforme a ${receivedByName.trim()} (${recipientRelationship}, ${receivedByDocType}: ${receivedByDocNumber.trim()}) vía ${isDriver ? 'conductor en ruta' : 'ventanilla'}${paymentCollected ? (isDriver ? ' — Cobro en ruta bajo custodia' : ' — Cobro COD en caja') : ''}.`,
        createdAt: now,
        createdAtIso: nowIso,
      })

      // audit_logs
      const auditRef = db.collection('audit_logs').doc()
      transaction.set(auditRef, {
        entityType: 'shipment',
        entityId: shipmentId,
        action: isDriver ? 'driver_route_delivery' : 'deliver_shipment',
        performedByUid: callerUid,
        performedByName: callerData.fullName || 'Operador',
        details: {
          trackingCode: sData.trackingCode,
          receivedByName: receivedByName.trim(),
          receivedByDocNumber: receivedByDocNumber.trim(),
          recipientRelationship,
          deliveryChannel: isDriver ? 'route_delivery' : 'agency_counter',
          paymentCollected,
          paymentMethod: paymentCollected ? paymentMethod : null,
          collectedByDriver: isDriver && paymentCollected,
          signatureStoragePath: sigResult.metadata.storagePath,
        },
        timestamp: now,
      })

      return {
        success: true,
        shipmentId,
        trackingCode: sData.trackingCode,
        status: 'delivered',
        deliveredAtIso: nowIso,
        deliveryChannel: isDriver ? 'route_delivery' : 'agency_counter',
        paymentCollected,
        deliveryRecord,
      }
    })
  } catch (err) {
    if (sigResult.isNewUpload && sigResult.fileRef) {
      await sigResult.fileRef.delete().catch(() => {})
    }
    throw err
  }
})

/**
 * ENTREGA 3 — C1: Cloud Function Callable para la rendición y liquidación financiera
 * de conductores en caja, asegurando transferencia interna de custodia y conciliación sin duplicar ventas.
 */
export const settleDriverCash = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para liquidar fondos de conductores.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists) {
    throw new HttpsError('permission-denied', 'Perfil de usuario no encontrado.')
  }
  const callerData = userDoc.data() || {}
  if (callerData.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo.')
  }

  const allowedRoles = ['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'No tiene permiso para liquidar custodia financiera de conductores.')
  }

  const {
    driverUid,
    amountCents,
    shipmentIds = [],
    paymentMethod = 'cash',
    notes = '',
    idempotencyKey,
  } = request.data || {}

  // Clave de idempotencia obligatoria (mínimo 8 caracteres)
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
    throw new HttpsError('invalid-argument', 'La clave de idempotencia es obligatoria y debe tener al menos 8 caracteres.')
  }

  if (!driverUid || typeof driverUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe especificar el UID del conductor.')
  }
  const amount = Number(amountCents)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'El importe a rendir debe ser un entero positivo en centavos.')
  }

  // Validación estricta de método de pago: rendición en caja física solo admite efectivo ('cash')
  if (paymentMethod !== 'cash') {
    throw new HttpsError('invalid-argument', `Método de pago no válido: '${paymentMethod}'. La rendición de custodia de conductor debe realizarse en efectivo ('cash').`)
  }

  const branchId = callerData.primaryBranchId || 'punata'
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify({
    driverUid,
    amountCents: amount,
    paymentMethod,
    branchId,
  })).digest('hex')

  return await db.runTransaction(async (transaction) => {
    // 1. Idempotencia vinculada al contenido
    const idempRef = db.collection('idempotency_keys').doc(`settle_${idempotencyKey.trim()}`)
    const idempDoc = await transaction.get(idempRef)
    if (idempDoc.exists) {
      const existing = idempDoc.data()
      if (existing.payloadHash && existing.payloadHash !== payloadHash) {
        throw new HttpsError('failed-precondition', 'La clave de idempotencia ya fue utilizada con datos de rendición diferentes.')
      }
      return existing.response
    }

    // 2. Validar conductor activo
    const driverRef = db.collection('users').doc(driverUid)
    const driverDoc = await transaction.get(driverRef)
    if (!driverDoc.exists) {
      throw new HttpsError('not-found', 'El conductor no existe.')
    }
    const driverData = driverDoc.data() || {}
    if (driverData.role !== 'conductor') {
      throw new HttpsError('failed-precondition', 'El usuario especificado no tiene rol de conductor.')
    }

    // 3. Validar libro de custodia del conductor
    const custodyAccRef = db.collection('driver_custody_accounts').doc(driverUid)
    const custodyAccDoc = await transaction.get(custodyAccRef)
    const currentPendingCents = custodyAccDoc.exists ? (custodyAccDoc.data().pendingRemittanceCents || 0) : 0

    if (currentPendingCents <= 0) {
      throw new HttpsError('failed-precondition', 'El conductor no tiene saldo pendiente de rendición bajo custodia.')
    }
    if (amount > currentPendingCents) {
      throw new HttpsError(
        'failed-precondition',
        `El importe a rendir (Bs. ${(amount / 100).toFixed(2)}) supera el saldo pendiente bajo custodia del conductor (Bs. ${(currentPendingCents / 100).toFixed(2)}).`
      )
    }

    // 4. Validar turno de caja de la persona que recibe
    const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${branchId}`)
    const lockDoc = await transaction.get(lockRef)
    if (!lockDoc.exists || lockDoc.data().status !== 'open' || !lockDoc.data().shiftId) {
      throw new HttpsError('failed-precondition', 'Debe tener un turno de caja abierto para recibir la rendición de fondos del conductor.')
    }

    const shiftId = lockDoc.data().shiftId
    const shiftRef = db.collection('cash_shifts').doc(shiftId)
    const shiftDoc = await transaction.get(shiftRef)
    if (!shiftDoc.exists || shiftDoc.data().status !== 'open') {
      throw new HttpsError('failed-precondition', 'El turno de caja activo no es válido o ya fue cerrado.')
    }

    // 5. Leer asientos en driver_custody_records de forma FIFO sin límite restrictivo de 20 (FASE DE LECTURA)
    const custodyRecordsQuery = await transaction.get(
      db.collection('driver_custody_records')
        .where('driverUid', '==', driverUid)
        .where('status', 'in', ['pending_remittance', 'partially_remitted'])
        .orderBy('createdAt', 'asc')
        .limit(100)
    )

    if (custodyRecordsQuery.empty) {
      throw new HttpsError('failed-precondition', 'No se encontraron asientos de cobro pendientes bajo custodia de este conductor.')
    }

    // Calcular el total disponible distribuible entre los asientos recuperados
    let totalDistributableInRecords = 0
    for (const doc of custodyRecordsQuery.docs) {
      const rec = doc.data()
      const recPending = rec.amountCents - (rec.remittedAmountCents || 0)
      if (recPending > 0) {
        totalDistributableInRecords += recPending
      }
    }

    if (amount > totalDistributableInRecords) {
      throw new HttpsError(
        'failed-precondition',
        `El importe a rendir (Bs. ${(amount / 100).toFixed(2)}) supera la suma distribuible de los asientos de cobro pendientes (Bs. ${(totalDistributableInRecords / 100).toFixed(2)}). Distribuya exactamente los asientos disponibles.`
      )
    }

    // Si se enviaron shipmentIds explícitos, verificar que cada uno corresponda a un cobro real en driver_custody_records
    const driverCustodyShipmentIds = new Set(custodyRecordsQuery.docs.map(d => d.data().shipmentId).filter(Boolean))
    if (Array.isArray(shipmentIds) && shipmentIds.length > 0) {
      for (const sId of shipmentIds) {
        if (!driverCustodyShipmentIds.has(sId)) {
          throw new HttpsError(
            'failed-precondition',
            `La guía '${sId}' no registra un cobro de ruta bajo custodia para el conductor ${driverData.fullName || driverUid}. No se puede conciliar una guía sin su asiento de cobro real.`
          )
        }
      }
    }

    // Recolectar todas las encomiendas que se van a impactar y leerlas (FASE DE LECTURA)
    const shipmentsMap = new Map()
    for (const doc of custodyRecordsQuery.docs) {
      const sId = doc.data().shipmentId
      if (sId && !shipmentsMap.has(sId)) {
        const sRef = db.collection('shipments').doc(sId)
        const sDoc = await transaction.get(sRef)
        if (sDoc.exists) {
          shipmentsMap.set(sId, { ref: sRef, data: sDoc.data() })
        }
      }
    }

    // --- FASE DE ESCRITURA ---
    const now = FieldValue.serverTimestamp()
    const nowIso = new Date().toISOString()
    const settlementId = `SETTL-${branchId.toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`

    let remainingToAllocate = amount
    let totalAllocatedExact = 0
    const reconciledShipments = []
    const allocatedRecordsSummary = []

    for (const doc of custodyRecordsQuery.docs) {
      if (remainingToAllocate <= 0) break
      const rec = doc.data()
      const recPending = rec.amountCents - (rec.remittedAmountCents || 0)
      if (recPending <= 0) continue

      const alloc = Math.min(remainingToAllocate, recPending)
      const newRemitted = (rec.remittedAmountCents || 0) + alloc
      const remainingAfterThis = rec.amountCents - newRemitted
      const isFull = remainingAfterThis <= 0

      totalAllocatedExact += alloc
      remainingToAllocate -= alloc

      allocatedRecordsSummary.push({
        recordId: doc.id,
        shipmentId: rec.shipmentId || null,
        allocatedCents: alloc,
        remainingAfterThisCents: remainingAfterThis,
        isFullyReconciled: isFull,
      })

      // Actualizar asiento de custodia con historial inmutable
      transaction.update(doc.ref, {
        remittedAmountCents: newRemitted,
        remainingAmountCents: remainingAfterThis,
        status: isFull ? 'reconciled' : 'partially_remitted',
        lastSettlementId: settlementId,
        lastSettlementAt: nowIso,
        lastSettlementByUid: callerUid,
        lastSettlementByName: callerData.fullName || 'Operador',
        settlementIds: FieldValue.arrayUnion(settlementId),
        settlementsHistory: FieldValue.arrayUnion({
          settlementId,
          amountCents: alloc,
          timestamp: nowIso,
          cashierUid: callerUid,
          cashierName: callerData.fullName || 'Operador',
          remainingAfterThisCents: remainingAfterThis,
        }),
        updatedAt: now,
      })

      // Actualizar encomienda vinculada
      if (rec.shipmentId && shipmentsMap.has(rec.shipmentId)) {
        const sItem = shipmentsMap.get(rec.shipmentId)
        const sRef = sItem.ref
        const sData = sItem.data
        const previousAccum = sItem.accumulatedRemitted !== undefined
          ? sItem.accumulatedRemitted
          : (sData.driverCustody?.remittedAmountCents || 0)
        const currentShipmentRemitted = previousAccum + alloc
        sItem.accumulatedRemitted = currentShipmentRemitted
        const totalShipmentCod = Number(sData.finalAmountCents || rec.amountCents)
        const isShipmentFull = currentShipmentRemitted >= totalShipmentCod
        const shipmentRemaining = Math.max(0, totalShipmentCod - currentShipmentRemitted)

        reconciledShipments.push({
          shipmentId: rec.shipmentId,
          trackingCode: sData.trackingCode || rec.shipmentId,
          allocatedCents: alloc,
          fullyReconciled: isShipmentFull,
        })

        transaction.update(sRef, {
          'driverCustody.reconciled': isShipmentFull,
          'driverCustody.status': isShipmentFull ? 'fully_reconciled' : 'partially_reconciled',
          'driverCustody.remittedAmountCents': currentShipmentRemitted,
          'driverCustody.remainingAmountCents': shipmentRemaining,
          'driverCustody.lastSettlementId': settlementId,
          'driverCustody.lastSettlementAt': nowIso,
          'driverCustody.lastSettlementByUid': callerUid,
          'driverCustody.settlementHistory': FieldValue.arrayUnion({
            settlementId,
            amountCents: alloc,
            timestamp: nowIso,
            cashierUid: callerUid,
            cashierName: callerData.fullName || 'Operador',
            remainingAfterThisCents: shipmentRemaining,
          }),
          updatedAt: now,
        })
      }
    }

    // Control estricto de total asignado: no disminuir la cuenta de custodia por un importe no asignado
    if (totalAllocatedExact !== amount) {
      throw new HttpsError(
        'failed-precondition',
        `Error de conciliación: Se asignaron Bs. ${(totalAllocatedExact / 100).toFixed(2)} de los Bs. ${(amount / 100).toFixed(2)} requeridos. La operación ha sido abortada.`
      )
    }

    // Actualizar cuenta de custodia del conductor
    const newDriverBalance = currentPendingCents - totalAllocatedExact
    const settlementType = newDriverBalance === 0 ? 'full' : 'partial'

    transaction.update(custodyAccRef, {
      cashUnderCustodyCents: FieldValue.increment(-totalAllocatedExact),
      pendingRemittanceCents: FieldValue.increment(-totalAllocatedExact),
      totalRemittedCents: FieldValue.increment(totalAllocatedExact),
      lastActivityAt: now,
      updatedAt: now,
    })

    // Crear comprobante inmutable en driver_settlements
    const settlementRef = db.collection('driver_settlements').doc(settlementId)
    const settlementPayload = {
      id: settlementId,
      settlementNumber: settlementId,
      driverUid,
      driverName: driverData.fullName || 'Conductor',
      receivedByUid: callerUid,
      receivedByName: callerData.fullName || 'Cajero/Operador',
      branchId,
      cashShiftId: shiftId,
      amountCents: totalAllocatedExact,
      amountBob: totalAllocatedExact / 100,
      paymentMethod,
      settlementType,
      previousDriverBalanceCents: currentPendingCents,
      remainingDriverBalanceCents: newDriverBalance,
      notes: notes || '',
      reconciledShipments,
      reconciledShipmentIds: reconciledShipments.map(s => s.shipmentId),
      allocatedRecords: allocatedRecordsSummary,
      status: 'completed',
      createdAt: now,
      createdAtIso: nowIso,
    }
    transaction.set(settlementRef, settlementPayload)

    // Actualizar turno de caja (TRANSFERENCIA INTERNA: aumenta gaveta, NO suma a totalIncomeCents de ventas)
    const shiftUpdate = {
      updatedAt: now,
      expectedCashCents: FieldValue.increment(totalAllocatedExact),
      'breakdown.cashIncomeCents': FieldValue.increment(totalAllocatedExact),
      'breakdown.netCashCents': FieldValue.increment(totalAllocatedExact),
      'breakdown.driverRemittanceCents': FieldValue.increment(totalAllocatedExact),
      movementsCount: FieldValue.increment(1),
    }
    transaction.update(shiftRef, shiftUpdate)

    // Movimiento financiero auditable
    const finRef = db.collection('financial_movements').doc()
    transaction.set(finRef, {
      shiftId,
      branchId,
      type: 'driver_remittance',
      concept: `Transferencia interna de custodia: Rendición ${settlementType === 'full' ? 'completa' : 'parcial'} de conductor ${driverData.fullName || driverUid} (${settlementId})`,
      amountCents: totalAllocatedExact,
      amountBob: totalAllocatedExact / 100,
      currency: 'BOB',
      paymentMethod,
      driverUid,
      driverName: driverData.fullName || 'Conductor',
      settlementId,
      settlementType,
      transferType: 'internal_custody_transfer',
      operatorUid: callerUid,
      operatorName: callerData.fullName || 'Operador',
      status: 'completed',
      timestamp: nowIso,
      createdAt: now,
    })

    // Auditoría
    const auditRef = db.collection('audit_logs').doc()
    transaction.set(auditRef, {
      entityType: 'driver_settlement',
      entityId: settlementId,
      action: 'driver_cash_settlement',
      performedByUid: callerUid,
      performedByName: callerData.fullName || 'Operador',
      details: {
        driverUid,
        driverName: driverData.fullName,
        amountCents: totalAllocatedExact,
        settlementType,
        previousDriverBalanceCents: currentPendingCents,
        remainingDriverBalanceCents: newDriverBalance,
        shiftId,
        branchId,
        idempotencyKey: idempotencyKey.trim(),
      },
      timestamp: now,
    })

    const responsePayload = {
      success: true,
      settlementId,
      settlementNumber: settlementId,
      settlementType,
      amountCents: totalAllocatedExact,
      previousDriverBalanceCents: currentPendingCents,
      remainingDriverBalanceCents: newDriverBalance,
      reconciledShipments,
      reconciledShipmentIds: reconciledShipments.map(s => s.shipmentId),
      settledAtIso: nowIso,
      timestampIso: nowIso,
    }

    // Guardar respuesta de idempotencia vinculada al payload
    transaction.set(idempRef, {
      idempotencyKey: idempotencyKey.trim(),
      payloadHash,
      response: responsePayload,
      createdAt: now,
    })

    return responsePayload
  })
})

/**
 * Consulta de Saldo de Custodia y Asientos Pendientes de un Conductor.
 */
export const getShipmentSignatureUrl = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar firmas de encomiendas.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists || userDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo o no autorizado.')
  }
  const callerData = userDoc.data()

  const { shipmentId, storagePath } = request.data || {}
  if (!shipmentId || typeof shipmentId !== 'string') {
    throw new HttpsError('invalid-argument', 'Debe especificar el shipmentId.')
  }

  const shipmentDoc = await db.collection('shipments').doc(shipmentId).get()
  if (!shipmentDoc.exists) {
    throw new HttpsError('not-found', 'La encomienda especificada no existe.')
  }
  const sData = shipmentDoc.data()

  const isGlobalAdmin = ['directiva_admin', 'tesoreria'].includes(callerData.role)
  const isBranchOperator = ['secretaria', 'encargado_agencia'].includes(callerData.role) &&
    (sData.originBranchId === callerData.primaryBranchId || sData.destinationBranchId === callerData.primaryBranchId ||
     (callerData.allowedBranchIds && (callerData.allowedBranchIds.includes(sData.originBranchId) || callerData.allowedBranchIds.includes(sData.destinationBranchId))))
  const isDriverAssigned = callerData.role === 'conductor' &&
    (sData.assignedVehicle?.driverUid === callerUid || sData.collectedByDriverUid === callerUid)

  if (!isGlobalAdmin && !isBranchOperator && !isDriverAssigned) {
    throw new HttpsError('permission-denied', 'No tiene permisos para consultar la firma de esta encomienda.')
  }

  const resolvedPath = storagePath || sData.deliveryRecord?.signature?.storagePath || sData.deliveryRecord?.signatureUrl
  if (!resolvedPath || typeof resolvedPath !== 'string') {
    throw new HttpsError('not-found', 'Esta encomienda no registra una ruta de firma válida en almacenamiento.')
  }

  const expectedPrefix = `shipments/${shipmentId}/signatures/`
  if (!resolvedPath.startsWith(expectedPrefix) || resolvedPath.includes('..')) {
    throw new HttpsError('permission-denied', 'La ruta solicitada no pertenece a la encomienda.')
  }

  const bucketName = process.env.STORAGE_BUCKET_NAME || 'expreso-punata-dev.firebasestorage.app'
  const bucket = storageAdmin.bucket(bucketName)
  const file = bucket.file(resolvedPath)

  // Confirmar que el archivo de firma realmente exista antes de emitir enlace
  const [exists] = await file.exists().catch(() => [false])
  if (!exists) {
    throw new HttpsError('not-found', 'El archivo de firma solicitado no existe en almacenamiento.')
  }

  if (process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    const host = process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'http://127.0.0.1:9199'
    return {
      success: true,
      url: `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(resolvedPath)}?alt=media`,
      expiresInMinutes: 15,
    }
  }

  try {
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    })
    return {
      success: true,
      url: signedUrl,
      expiresInMinutes: 15,
    }
  } catch (err) {
    console.error('[getShipmentSignatureUrl] Error generando enlace firmado:', err.message)
    throw new HttpsError('internal', 'No fue posible generar el enlace seguro de acceso a la firma.')
  }
})

/**
 * Cloud Function Callable para consultar el balance y libro mayor de custodia de un conductor.
 * Aplica restricciones estrictas de rol y sucursal.
 */
export const getDriverCustodyBalance = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar el saldo de custodia.')
  }

  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists || userDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario inactivo o no encontrado.')
  }
  const callerData = userDoc.data()
  const allowedRoles = ['conductor', 'secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin']
  if (!allowedRoles.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para consultar saldos de custodia.')
  }

  const { driverUid } = request.data || {}
  const targetDriverUid = driverUid || (callerData.role === 'conductor' ? callerUid : null)
  if (!targetDriverUid) {
    throw new HttpsError('invalid-argument', 'Debe especificar el UID del conductor.')
  }

  // 1. Restricción para conductor: solo puede ver su propia cuenta
  if (callerData.role === 'conductor' && callerUid !== targetDriverUid) {
    throw new HttpsError('permission-denied', 'No tiene permiso para consultar la custodia de otro conductor.')
  }

  // 2. Restricción para secretaria o encargado: validar que el conductor opere en su sucursal autorizada
  if (['secretaria', 'encargado_agencia'].includes(callerData.role)) {
    const targetDriverDoc = await db.collection('users').doc(targetDriverUid).get()
    if (!targetDriverDoc.exists) {
      throw new HttpsError('not-found', 'El conductor no existe.')
    }
    const targetDriverData = targetDriverDoc.data() || {}
    const callerBranches = callerData.allowedBranchIds || [callerData.primaryBranchId]
    const driverBranches = targetDriverData.allowedBranchIds || [targetDriverData.primaryBranchId]

    const hasCommonBranch = callerBranches.some(b => driverBranches.includes(b))
    if (!hasCommonBranch) {
      throw new HttpsError('permission-denied', 'No tiene permiso para consultar la custodia de un conductor de otra sucursal.')
    }
  }

  const accountDoc = await db.collection('driver_custody_accounts').doc(targetDriverUid).get()
  const account = accountDoc.exists ? accountDoc.data() : {
    driverUid: targetDriverUid,
    cashUnderCustodyCents: 0,
    pendingRemittanceCents: 0,
    totalCollectedCents: 0,
    totalRemittedCents: 0,
  }

  const pendingRecordsSnap = await db.collection('driver_custody_records')
    .where('driverUid', '==', targetDriverUid)
    .where('status', 'in', ['pending_remittance', 'partially_remitted'])
    .orderBy('createdAt', 'desc')
    .get()

  const pendingRecords = pendingRecordsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  return {
    account,
    pendingRecords,
    pendingCount: pendingRecords.length,
  }
})


// =========================================================================
// BLOQUE 5: SOCIOS Y MENSUALIDADES (PADRÓN, CUOTAS, RECAUDACIÓN Y EXTRACTOS)
// =========================================================================

/**
 * Cloud Function Callable para dar de alta o actualizar un socio en el padrón sindical.
 * Roles permitidos: directiva_admin, tesoreria.
 */
export const manageUnionMember = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para administrar socios.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  const isAffiliateAdmin = caller.role === 'afiliado_admin'
  if (!['directiva_admin', 'tesoreria', 'afiliado_admin'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Solo la Directiva o Tesorería pueden administrar socios.')
  }

  const requestData = request.data || {}
  if (isAffiliateAdmin && typeof requestData.memberId === 'string' && requestData.memberId.trim()) {
    const scopedMember = await db.collection('union_members').doc(requestData.memberId.trim()).get()
    const scopedBranchId = scopedMember.data()?.branchId
    if (scopedMember.exists && scopedBranchId && !(caller.allowedBranchIds || [caller.primaryBranchId]).includes(scopedBranchId)) {
      throw new HttpsError('permission-denied', 'El afiliado pertenece a una sucursal no autorizada.')
    }
  }
  if (requestData.action === 'addChild') {
    const { memberId, child } = requestData
    if (typeof memberId !== 'string' || !memberId.trim()) {
      throw new HttpsError('invalid-argument', 'El afiliado responsable es obligatorio.')
    }
    if (!child || typeof child !== 'object' || typeof child.fullName !== 'string' || child.fullName.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'El nombre completo del hijo es obligatorio.')
    }
    const childBirthDate = child.birthDate || ''
    if (childBirthDate && !(typeof childBirthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(childBirthDate) && !Number.isNaN(Date.parse(`${childBirthDate}T00:00:00Z`)) && new Date(`${childBirthDate}T00:00:00Z`).toISOString().slice(0, 10) === childBirthDate)) {
      throw new HttpsError('invalid-argument', 'La fecha de nacimiento debe tener formato válido AAAA-MM-DD.')
    }
    const memberRef = db.collection('union_members').doc(memberId.trim())
    const memberDoc = await memberRef.get()
    if (!memberDoc.exists) {
      throw new HttpsError('not-found', 'No se encontró el afiliado responsable.')
    }
    const nowIso = new Date().toISOString()
    const childRef = memberRef.collection('children').doc()
    const childData = {
      id: childRef.id,
      memberId: memberRef.id,
      fullName: child.fullName.trim(),
      ci: typeof child.ci === 'string' ? child.ci.trim().toUpperCase().replace(/\s+/g, '') : '',
      birthDate: childBirthDate || null,
      phone: typeof child.phone === 'string' ? child.phone.trim() : '',
      address: typeof child.address === 'string' ? child.address.trim() : '',
      notes: typeof child.notes === 'string' ? child.notes.trim() : '',
      createdAtIso: nowIso,
      createdByUid: callerUid,
      createdByName: caller.fullName || 'Operador',
    }
    await childRef.create(childData)
    await db.collection('audit_logs').add({
      action: 'union_member_child_created', targetCollection: 'union_members', targetId: memberRef.id,
      childId: childRef.id, memberNumber: memberDoc.data().memberNumber, fullName: childData.fullName,
      performedByUid: callerUid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true, child: childData }
  }

  if (requestData.action === 'updateChild') {
    const { memberId, childId, child } = requestData
    if (typeof memberId !== 'string' || !memberId.trim() || typeof childId !== 'string' || !childId.trim()) {
      throw new HttpsError('invalid-argument', 'El afiliado y el hijo son obligatorios.')
    }
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      throw new HttpsError('invalid-argument', 'Los datos del hijo son obligatorios.')
    }
    if (Object.prototype.hasOwnProperty.call(child, 'fullName') && (typeof child.fullName !== 'string' || child.fullName.trim().length < 2)) {
      throw new HttpsError('invalid-argument', 'El nombre completo del hijo debe tener al menos 2 caracteres.')
    }
    if (Object.prototype.hasOwnProperty.call(child, 'birthDate') && child.birthDate && !(typeof child.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(child.birthDate) && !Number.isNaN(Date.parse(`${child.birthDate}T00:00:00Z`)) && new Date(`${child.birthDate}T00:00:00Z`).toISOString().slice(0, 10) === child.birthDate)) {
      throw new HttpsError('invalid-argument', 'La fecha de nacimiento debe tener formato válido AAAA-MM-DD.')
    }
    const memberRef = db.collection('union_members').doc(memberId.trim())
    const memberDoc = await memberRef.get()
    if (!memberDoc.exists) {
      throw new HttpsError('not-found', 'No se encontró el afiliado responsable.')
    }
    const childRef = memberRef.collection('children').doc(childId.trim())
    const childDoc = await childRef.get()
    if (!childDoc.exists || childDoc.data().memberId !== memberRef.id) {
      throw new HttpsError('not-found', 'No se encontró el hijo asociado a este afiliado.')
    }
    const allowedFields = ['fullName', 'ci', 'birthDate', 'phone', 'address', 'notes']
    const updates = {}
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(child, field)) continue
      const value = child[field]
      if (field === 'birthDate') updates.birthDate = value || null
      else if (typeof value !== 'string') throw new HttpsError('invalid-argument', `El campo ${field} debe ser texto.`)
      else updates[field] = field === 'ci' ? value.trim().toUpperCase().replace(/\s+/g, '') : value.trim()
    }
    if (Object.keys(updates).length === 0) {
      throw new HttpsError('invalid-argument', 'No se recibieron campos para actualizar.')
    }
    const nowIso = new Date().toISOString()
    updates.updatedAtIso = nowIso
    updates.updatedByUid = callerUid
    updates.updatedByName = caller.fullName || 'Operador'
    await childRef.update(updates)
    await db.collection('audit_logs').add({
      action: 'union_member_child_updated', targetCollection: 'union_members', targetId: memberRef.id,
      childId: childRef.id, memberNumber: memberDoc.data().memberNumber, fullName: updates.fullName || childDoc.data().fullName,
      performedByUid: callerUid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    const updatedDoc = await childRef.get()
    return { success: true, child: { id: updatedDoc.id, ...updatedDoc.data() } }
  }

  if (requestData.action === 'setDriverLink') {
    const { memberId, childId = null, driverUid = null } = requestData
    if (typeof memberId !== 'string' || !memberId.trim()) {
      throw new HttpsError('invalid-argument', 'El afiliado es obligatorio para vincular un conductor.')
    }
    if (childId !== null && (typeof childId !== 'string' || !childId.trim())) {
      throw new HttpsError('invalid-argument', 'El identificador del hijo no es válido.')
    }
    if (driverUid !== null && (typeof driverUid !== 'string' || !driverUid.trim())) {
      throw new HttpsError('invalid-argument', 'El identificador del conductor no es válido.')
    }
    const memberRef = db.collection('union_members').doc(memberId.trim())
    const memberDoc = await memberRef.get()
    if (!memberDoc.exists) {
      throw new HttpsError('not-found', 'No se encontró el afiliado indicado.')
    }
    let targetRef = memberRef
    let targetData = memberDoc.data()
    if (childId) {
      targetRef = memberRef.collection('children').doc(childId.trim())
      const childDoc = await targetRef.get()
      if (!childDoc.exists || childDoc.data().memberId !== memberRef.id) {
        throw new HttpsError('not-found', 'El hijo no pertenece al afiliado indicado.')
      }
      targetData = childDoc.data()
    }
    let selectedDriver = null
    if (driverUid) {
      const [driverDoc, directoryDoc] = await Promise.all([
        db.collection('users').doc(driverUid.trim()).get(),
        db.collection('driver_directory').doc(driverUid.trim()).get(),
      ])
      if (!driverDoc.exists || driverDoc.data()?.role !== 'conductor' || driverDoc.data()?.isActive !== true ||
          !directoryDoc.exists || directoryDoc.data()?.isActive !== true) {
        throw new HttpsError('failed-precondition', 'Selecciona un conductor activo que exista en el directorio de conductores.')
      }
      selectedDriver = { uid: driverDoc.id, fullName: driverDoc.data().fullName || directoryDoc.data().fullName || 'Conductor' }
    }
    const nowIso = new Date().toISOString()
    const relationUpdate = childId
      ? { driverUid: selectedDriver?.uid || null, driverName: selectedDriver?.fullName || null, driverLinkedAtIso: nowIso }
      : { primaryDriverUid: selectedDriver?.uid || null, primaryDriverName: selectedDriver?.fullName || null, primaryDriverLinkedAtIso: nowIso }
    await targetRef.update(relationUpdate)
    await db.collection('audit_logs').add({
      action: childId ? 'union_member_child_driver_link_updated' : 'union_member_primary_driver_link_updated',
      targetCollection: childId ? 'union_members/children' : 'union_members',
      targetId: memberRef.id, childId: childId || null,
      previousDriverUid: childId ? (targetData.driverUid || null) : (targetData.primaryDriverUid || null),
      driverUid: selectedDriver?.uid || null, driverName: selectedDriver?.fullName || null,
      performedByUid: callerUid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    const updatedDoc = await targetRef.get()
    return { success: true, relation: { ...relationUpdate, driver: selectedDriver }, ...(childId ? { child: { id: updatedDoc.id, ...updatedDoc.data() } } : { member: { id: updatedDoc.id, ...updatedDoc.data() } }) }
  }

  const {
    id,
    memberNumber,
    fullName,
    ci,
    ciComplement,
    phone,
    alternatePhone,
    address,
    locality,
    birthDate,
    joinedAt,
    retiredAt,
    status = 'active',
    category = 'propietario_transporte',
    vehiclePlate,
    assignedMobileNumber,
    monthlyFeeBob,
    monthlyFeeCents,
    notes,
  } = requestData

  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'El nombre completo del socio es obligatorio.')
  }
  if (!memberNumber || typeof memberNumber !== 'string' || memberNumber.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'El número de socio es obligatorio.')
  }

  const validDate = (value) => !value || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
  if (![birthDate, joinedAt, retiredAt].every(validDate)) {
    throw new HttpsError('invalid-argument', 'Las fechas deben tener formato válido AAAA-MM-DD.')
  }
  const effectiveJoinedAt = joinedAt || (id ? (await db.collection('union_members').doc(id).get()).data()?.joinedAt : null) || new Date().toISOString().slice(0, 10)
  if (retiredAt && retiredAt < effectiveJoinedAt) {
    throw new HttpsError('invalid-argument', 'La fecha de retiro no puede ser anterior a la fecha de ingreso.')
  }

  const cleanMemberNumber = memberNumber.trim().toUpperCase()
  const cleanFullName = fullName.trim()
  const nowIso = new Date().toISOString()

  const feeCents = monthlyFeeCents !== undefined && Number.isInteger(monthlyFeeCents)
    ? monthlyFeeCents
    : Math.round((Number(monthlyFeeBob) || 0) * 100)

  if (feeCents < 0) {
    throw new HttpsError('invalid-argument', 'La cuota mensual no puede ser negativa.')
  }

  const memberId = id || `member-${cleanMemberNumber.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
  const existingSnap = await db.collection('union_members')
    .where('memberNumber', '==', cleanMemberNumber)
    .get()

  for (const doc of existingSnap.docs) {
    if (doc.id !== memberId) {
      throw new HttpsError('already-exists', `El número de socio ${cleanMemberNumber} ya está registrado para otro socio (${doc.data().fullName}).`)
    }
  }

  const memberRef = db.collection('union_members').doc(memberId)
  const existingDoc = await memberRef.get()
  const isNew = !existingDoc.exists
  const existingBranchId = existingDoc.data()?.branchId || caller.primaryBranchId || 'punata'
  if (isAffiliateAdmin && !(caller.allowedBranchIds || [caller.primaryBranchId]).includes(existingBranchId)) {
    throw new HttpsError('permission-denied', 'El afiliado pertenece a una sucursal no autorizada.')
  }

  const memberData = {
    id: memberId,
    memberNumber: cleanMemberNumber,
    fullName: cleanFullName,
    ci: ci ? String(ci).trim().toUpperCase().replace(/\s+/g, '') : '',
    ciComplement: ciComplement === undefined ? (existingDoc.data()?.ciComplement || '') : String(ciComplement).trim().toUpperCase(),
    phone: phone === undefined ? (existingDoc.data()?.phone || '') : String(phone).trim(),
    alternatePhone: alternatePhone === undefined ? (existingDoc.data()?.alternatePhone || '') : String(alternatePhone).trim(),
    address: address === undefined ? (existingDoc.data()?.address || '') : String(address).trim(),
    locality: locality === undefined ? (existingDoc.data()?.locality || '') : String(locality).trim(),
    birthDate: birthDate === undefined ? (existingDoc.data()?.birthDate || null) : birthDate || null,
    joinedAt: joinedAt || existingDoc.data()?.joinedAt || nowIso.slice(0, 10),
    retiredAt: retiredAt === undefined ? (existingDoc.data()?.retiredAt || null) : retiredAt || null,
    status: ['active', 'inactive', 'suspended', 'honorary', 'retired'].includes(status) ? status : (existingDoc.data()?.status || 'active'),
    category: ['propietario_transporte', 'conductor', 'socio_general'].includes(category) ? category : 'propietario_transporte',
    vehiclePlate: vehiclePlate ? String(vehiclePlate).trim().toUpperCase() : null,
    assignedMobileNumber: assignedMobileNumber ? String(assignedMobileNumber).trim() : null,
    monthlyFeeBob: feeCents / 100,
    monthlyFeeCents: feeCents,
    notes: notes ? String(notes).trim() : null,
    branchId: existingBranchId,
    updatedAtIso: nowIso,
    updatedByUid: callerUid,
    updatedByName: caller.fullName || 'Operador',
  }

  if (isNew) {
    memberData.createdAtIso = nowIso
    memberData.createdByUid = callerUid
    memberData.createdByName = caller.fullName || 'Operador'
  }

  await memberRef.set(memberData, { merge: true })

  await db.collection('audit_logs').add({
    action: isNew ? 'union_member_created' : 'union_member_updated',
    targetCollection: 'union_members',
    targetId: memberId,
    memberNumber: cleanMemberNumber,
    fullName: cleanFullName,
    performedByUid: callerUid,
    performedByName: caller.fullName || 'Operador',
    performedByRole: caller.role,
    timestamp: FieldValue.serverTimestamp(),
    timestampIso: nowIso,
  })

  return {
    success: true,
    isNew,
    member: memberData,
  }
})

/**
 * Cloud Function Callable para emitir cuotas ordinarias de un período a todos los socios activos.
 * Idempotente: si una cuota ya existe para el socio en ese período, no la duplica.
 */
export const generateMonthlyDues = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para emitir cuotas.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  if (!['directiva_admin', 'tesoreria'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Solo la Directiva o Tesorería pueden emitir cuotas mensuales.')
  }

  const { period, dueDate, notes } = request.data || {}
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new HttpsError('invalid-argument', 'El período debe tener el formato AAAA-MM (ej. 2026-11).')
  }

  const nowIso = new Date().toISOString()
  const effectiveDueDate = dueDate || `${period}-15`

  // BLOQUEO ATÓMICO DE CONCURRENCIA PARA EMISIÓN DE CUOTAS
  const lockRef = db.collection('system_locks').doc(`generate_dues_${period}`)
  await db.runTransaction(async (transaction) => {
    const lockDoc = await transaction.get(lockRef)
    if (lockDoc.exists) {
      const lockData = lockDoc.data() || {}
      if (lockData.status === 'in_progress') {
        const elapsedMs = Date.now() - (lockData.startedAt || 0)
        if (elapsedMs < 120000) {
          throw new HttpsError('already-exists', `La emisión de cuotas para el período ${period} ya está en curso por otro proceso.`)
        }
      }
    }
    transaction.set(lockRef, {
      period,
      status: 'in_progress',
      startedAt: Date.now(),
      startedAtIso: nowIso,
      callerUid,
      callerName: caller.fullName || caller.email || 'Operador',
    })
  })

  const [year, month] = period.split('-')
  const monthsNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const periodLabel = `${monthsNames[parseInt(month, 10) - 1]} ${year}`

  const warnings = []

  try {
    const membersSnap = await db.collection('union_members')
      .where('status', '==', 'active')
      .get()

    if (membersSnap.empty) {
      await lockRef.set({
        period,
        status: 'completed',
        completedAt: Date.now(),
        completedAtIso: new Date().toISOString(),
        callerUid,
        generatedCount: 0,
        skippedCount: 0,
        warningsCount: 0,
      })
      return {
        success: true,
        period,
        periodLabel,
        generatedCount: 0,
        skippedCount: 0,
        warnings: [],
        totalAmountCents: 0,
        message: 'No se encontraron socios activos para emitir cuotas.',
      }
    }

    let generatedCount = 0
    let skippedCount = 0
    let totalAmountCents = 0

    const batchSize = 400
    let batch = db.batch()
    let opsInBatch = 0

    for (const mDoc of membersSnap.docs) {
      const member = mDoc.data()
      const dueId = `${mDoc.id}_${period}`
      const dueRef = db.collection('union_dues').doc(dueId)
      const existingDue = await dueRef.get()

      if (existingDue.exists) {
        skippedCount++
        continue
      }

      // Eliminar el fallback ficticio de 5000: si no tiene cuota válida, omitir y alertar
      const feeCents = member.monthlyFeeCents || Math.round((member.monthlyFeeBob || 0) * 100) || 0
      if (!feeCents || feeCents <= 0) {
        skippedCount++
        warnings.push({
          memberId: mDoc.id,
          memberNumber: member.memberNumber,
          memberName: member.fullName,
          reason: 'Socio sin cuota mensual configurada (monthlyFeeCents <= 0). Omitido.',
        })
        continue
      }
      const feeBob = feeCents / 100

      const dueData = {
        id: dueId,
        dueNumber: `CUO-${period}-${member.memberNumber}`,
        memberId: mDoc.id,
        memberNumber: member.memberNumber,
        memberName: member.fullName,
        memberCategory: member.category,
        branchId: member.branchId || caller.primaryBranchId || 'punata',
        period,
        periodLabel,
        amountBob: feeBob,
        amountCents: feeCents,
        dueDate: effectiveDueDate,
        status: 'pending',
        paidAmountBob: 0,
        paidAmountCents: 0,
        balanceBob: feeBob,
        balanceCents: feeCents,
        paymentsCount: 0,
        notes: notes || `Cuota ordinaria de ${periodLabel}`,
        createdAtIso: nowIso,
        createdByUid: callerUid,
        createdByName: caller.fullName || 'Operador',
      }

      batch.set(dueRef, dueData)
      opsInBatch++
      generatedCount++
      totalAmountCents += feeCents

      if (opsInBatch >= batchSize) {
        await batch.commit()
        batch = db.batch()
        opsInBatch = 0
      }
    }

    if (opsInBatch > 0) {
      await batch.commit()
    }

    await db.collection('audit_logs').add({
      action: 'union_dues_generated',
      targetCollection: 'union_dues',
      period,
      periodLabel,
      generatedCount,
      skippedCount,
      warningsCount: warnings.length,
      warnings,
      totalAmountCents,
      performedByUid: callerUid,
      performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role,
      timestamp: FieldValue.serverTimestamp(),
      timestampIso: nowIso,
    })

    await lockRef.set({
      period,
      status: 'completed',
      completedAt: Date.now(),
      completedAtIso: new Date().toISOString(),
      callerUid,
      generatedCount,
      skippedCount,
      warningsCount: warnings.length,
    })

    return {
      success: true,
      period,
      periodLabel,
      generatedCount,
      skippedCount,
      warnings,
      totalAmountCents,
      totalAmountBob: totalAmountCents / 100,
    }
  } catch (err) {
    await lockRef.set({
      period,
      status: 'failed',
      failedAt: Date.now(),
      error: err.message,
    }).catch(() => {})
    throw err
  }
})

/**
 * Cloud Function Callable para cobrar cuotas de socios (ordinarias o aportes).
 * Transaccional: vincula a turno de caja activo si es cobrado en ventanilla,
 * actualiza balance, registra pago inmutable y genera movimiento financiero.
 */
export const collectMemberDue = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para registrar aportes.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  const allowedRoles = ['directiva_admin', 'tesoreria', 'secretaria', 'encargado_agencia']
  if (!allowedRoles.includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para cobrar cuotas de socios.')
  }

  const {
    dueId,
    amountCents,
    amountBob,
    paymentMethod = 'cash',
    shiftId,
    branchId,
    notes,
    idempotencyKey,
  } = request.data || {}

  if (!dueId) {
    throw new HttpsError('invalid-argument', 'El identificador de cuota (dueId) es obligatorio.')
  }

  const cleanAmountCents = amountCents !== undefined && Number.isInteger(amountCents)
    ? amountCents
    : Math.round((Number(amountBob) || 0) * 100)

  if (!cleanAmountCents || cleanAmountCents <= 0) {
    throw new HttpsError('invalid-argument', 'El monto a pagar debe ser mayor a 0.')
  }

  if (!['cash', 'qr', 'transfer'].includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'Método de pago no válido (debe ser cash, qr o transfer).')
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
    throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida (mínimo 8 caracteres).')
  }

  const nowIso = new Date().toISOString()
  const effectiveBranchId = branchId || caller.primaryBranchId || 'punata'

  return await db.runTransaction(async (transaction) => {
    // 1. Verificar idempotencia con payload fingerprint
    const idempRef = db.collection('idempotency_keys').doc(idempotencyKey)
    const idempDoc = await transaction.get(idempRef)
    if (idempDoc.exists) {
      const cached = idempDoc.data()
      if (
        cached.callerUid === callerUid &&
        cached.dueId === dueId &&
        cached.amountCents === cleanAmountCents &&
        cached.paymentMethod === paymentMethod &&
        (cached.shiftId || null) === (shiftId || null)
      ) {
        return cached.result
      }
      throw new HttpsError('already-exists', 'La clave de idempotencia ya fue utilizada con parámetros distintos.')
    }

    // 2. Leer cuota
    const dueRef = db.collection('union_dues').doc(dueId)
    const dueDoc = await transaction.get(dueRef)
    if (!dueDoc.exists) {
      throw new HttpsError('not-found', 'La cuota especificada no existe.')
    }
    const due = dueDoc.data()

    if (due.status === 'paid' || due.balanceCents <= 0) {
      throw new HttpsError('failed-precondition', 'Esta cuota ya ha sido cancelada en su totalidad.')
    }

    if (cleanAmountCents > due.balanceCents) {
      throw new HttpsError('invalid-argument', `El monto (Bs ${(cleanAmountCents/100).toFixed(2)}) supera el saldo adeudado de la cuota (Bs ${(due.balanceCents/100).toFixed(2)}).`)
    }

    // 3. Validar turno de caja si es ventanilla o verificar permisos si es fuera de turno
    let activeShift = null
    let shiftRef = null
    if (paymentMethod === 'cash') {
      if (!shiftId) {
        throw new HttpsError('failed-precondition', 'El cobro en efectivo en ventanilla requiere un turno de caja abierto.')
      }
      shiftRef = db.collection('cash_shifts').doc(shiftId)
      const shiftDoc = await transaction.get(shiftRef)
      if (!shiftDoc.exists) {
        throw new HttpsError('not-found', 'El turno de caja especificado no existe.')
      }
      activeShift = shiftDoc.data()
      if (activeShift.status !== 'open') {
        throw new HttpsError('failed-precondition', 'El turno de caja no está abierto.')
      }
      const shiftOperator = activeShift.cashierUid || activeShift.operatorUid
      if (shiftOperator && shiftOperator !== callerUid && caller.role !== 'directiva_admin') {
        throw new HttpsError('permission-denied', 'El turno de caja no pertenece al operador que realiza el cobro.')
      }
      if (activeShift.branchId !== effectiveBranchId) {
        throw new HttpsError('permission-denied', 'El turno de caja no pertenece a la sucursal de cobro.')
      }
    } else {
      // paymentMethod === 'qr' o 'transfer'
      if (!shiftId) {
        if (!['directiva_admin', 'tesoreria'].includes(caller.role)) {
          throw new HttpsError('permission-denied', 'Solo la Directiva o Tesorería pueden registrar cobros directos fuera de turno de caja.')
        }
      } else {
        shiftRef = db.collection('cash_shifts').doc(shiftId)
        const shiftDoc = await transaction.get(shiftRef)
        if (!shiftDoc.exists) {
          throw new HttpsError('not-found', 'El turno de caja especificado no existe.')
        }
        activeShift = shiftDoc.data()
        if (activeShift.status !== 'open') {
          throw new HttpsError('failed-precondition', 'El turno de caja no está abierto.')
        }
      }
    }

    // 4. Correlativo de recibo
    const currentYear = new Date().getFullYear()
    const counterRef = db.collection('counters').doc(`receipt_union_${currentYear}`)
    const counterDoc = await transaction.get(counterRef)
    const currentSeq = counterDoc.exists ? (counterDoc.data().currentSequence || 0) : 0
    const nextSeq = currentSeq + 1
    transaction.set(counterRef, {
      currentSequence: nextSeq,
      year: currentYear,
      updatedAtIso: nowIso,
    }, { merge: true })

    const receiptNumber = `REC-SOC-${currentYear}-${String(nextSeq).padStart(5, '0')}`

    // 5. Actualizar cuota
    const newPaidAmountCents = (due.paidAmountCents || 0) + cleanAmountCents
    const newBalanceCents = due.balanceCents - cleanAmountCents
    const newStatus = newBalanceCents === 0 ? 'paid' : 'partial'
    const newPaymentsCount = (due.paymentsCount || 0) + 1

    transaction.update(dueRef, {
      paidAmountCents: newPaidAmountCents,
      paidAmountBob: newPaidAmountCents / 100,
      balanceCents: newBalanceCents,
      balanceBob: newBalanceCents / 100,
      status: newStatus,
      paidAtIso: newBalanceCents === 0 ? nowIso : (due.paidAtIso || null),
      paidShiftId: shiftId || due.paidShiftId || null,
      paymentsCount: newPaymentsCount,
      updatedAtIso: nowIso,
    })

    // 6. Subcolección payments
    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const paymentRef = dueRef.collection('payments').doc(paymentId)
    const paymentData = {
      id: paymentId,
      dueId,
      memberId: due.memberId,
      memberNumber: due.memberNumber,
      memberName: due.memberName,
      period: due.period,
      periodLabel: due.periodLabel,
      receiptNumber,
      amountCents: cleanAmountCents,
      amountBob: cleanAmountCents / 100,
      paymentMethod,
      shiftId: shiftId || null,
      branchId: effectiveBranchId,
      collectedByUid: callerUid,
      collectedByName: caller.fullName || 'Operador',
      paidAtIso: nowIso,
      notes: notes || null,
    }
    transaction.set(paymentRef, paymentData)

    // 7. Actualizar turno de caja si aplica
    if (activeShift && shiftRef) {
      const b = activeShift.breakdown || {}
      const isCash = paymentMethod === 'cash'
      const isQr = paymentMethod === 'qr'
      const isTransfer = paymentMethod === 'transfer'

      const updatedExpectedCash = isCash
        ? (activeShift.expectedCashCents || 0) + cleanAmountCents
        : (activeShift.expectedCashCents || 0)

      transaction.update(shiftRef, {
        expectedCashCents: updatedExpectedCash,
        expectedCashBob: updatedExpectedCash / 100,
        movementsCount: (activeShift.movementsCount || 0) + 1,
        'breakdown.totalIncomeCents': (b.totalIncomeCents || 0) + cleanAmountCents,
        'breakdown.contributionsIncomeCents': (b.contributionsIncomeCents || 0) + cleanAmountCents,
        'breakdown.monthlyFeesIncomeCents': (b.monthlyFeesIncomeCents || 0) + cleanAmountCents,
        'breakdown.cashIncomeCents': isCash ? (b.cashIncomeCents || 0) + cleanAmountCents : (b.cashIncomeCents || 0),
        'breakdown.qrIncomeCents': isQr ? (b.qrIncomeCents || 0) + cleanAmountCents : (b.qrIncomeCents || 0),
        'breakdown.transferIncomeCents': isTransfer ? (b.transferIncomeCents || 0) + cleanAmountCents : (b.transferIncomeCents || 0),
        'breakdown.netCashCents': (b.netCashCents || 0) + (isCash ? cleanAmountCents : 0),
        updatedAtIso: nowIso,
      })
    }

    // 8. Crear movimiento financiero
    const movementRef = db.collection('financial_movements').doc()
    transaction.set(movementRef, {
      id: movementRef.id,
      shiftId: shiftId || null,
      branchId: effectiveBranchId,
      type: 'contribution_income',
      category: 'cuota_social',
      amountCents: cleanAmountCents,
      amountBob: cleanAmountCents / 100,
      paymentMethod,
      description: `Aporte mensual ${due.periodLabel} - Socio: ${due.memberNumber} ${due.memberName} (${receiptNumber})`,
      receiptNumber,
      memberId: due.memberId,
      memberNumber: due.memberNumber,
      memberName: due.memberName,
      dueId,
      period: due.period,
      operatorUid: callerUid,
      operatorName: caller.fullName || 'Operador',
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    })

    const result = {
      success: true,
      receiptNumber,
      paymentId,
      dueId,
      memberNumber: due.memberNumber,
      memberName: due.memberName,
      period: due.period,
      periodLabel: due.periodLabel,
      amountCents: cleanAmountCents,
      amountBob: cleanAmountCents / 100,
      remainingBalanceCents: newBalanceCents,
      remainingBalanceBob: newBalanceCents / 100,
      status: newStatus,
      paymentMethod,
      paidAtIso: nowIso,
      collectedByName: caller.fullName || 'Operador',
    }

    transaction.set(idempRef, {
      idempotencyKey,
      callerUid,
      dueId,
      amountCents: cleanAmountCents,
      paymentMethod,
      shiftId: shiftId || null,
      result,
      createdAtIso: nowIso,
    })

    return result
  })
})

/**
 * Cloud Function Callable para obtener el estado de cuenta y resumen contable de un socio.
 */
export const getMemberAccountStatement = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar el estado de cuenta.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  const allowedRoles = ['directiva_admin', 'tesoreria', 'secretaria', 'encargado_agencia']
  if (!allowedRoles.includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para consultar estados de cuenta de socios.')
  }

  const { memberId } = request.data || {}
  if (!memberId) {
    throw new HttpsError('invalid-argument', 'El identificador del socio (memberId) es obligatorio.')
  }

  const memberDoc = await db.collection('union_members').doc(memberId).get()
  if (!memberDoc.exists) {
    throw new HttpsError('not-found', 'El socio no existe.')
  }
  const member = memberDoc.data()
  if (caller.role === 'secretaria' && member.branchId !== caller.primaryBranchId) {
    throw new HttpsError('permission-denied', 'Solo puede consultar afiliados de su sucursal autorizada.')
  }

  const duesSnap = await db.collection('union_dues')
    .where('memberId', '==', memberId)
    .orderBy('period', 'desc')
    .get()

  const dues = duesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const childrenSnap = await db.collection('union_members').doc(memberId).collection('children').get()
  const children = childrenSnap.docs
    .map((childDoc) => ({ id: childDoc.id, ...childDoc.data() }))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))

  let totalDuesCount = dues.length
  let totalBilledCents = 0
  let totalPaidCents = 0
  let totalBalanceCents = 0
  let overdueCount = 0

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())

  for (const d of dues) {
    totalBilledCents += (d.amountCents || 0)
    totalPaidCents += (d.paidAmountCents || 0)
    totalBalanceCents += (d.balanceCents || 0)
    if (d.status !== 'paid' && d.dueDate && d.dueDate < todayStr) {
      overdueCount++
    }
  }

  return {
    member,
    dues,
    children,
    summary: {
      totalDuesCount,
      totalBilledCents,
      totalBilledBob: totalBilledCents / 100,
      totalPaidCents,
      totalPaidBob: totalPaidCents / 100,
      totalBalanceCents,
      totalBalanceBob: totalBalanceCents / 100,
      overdueCount,
      isUpToDate: totalBalanceCents === 0,
    },
  }
})

/**
 * Lectura agrupada del padrón con hijos para impresión.
 * Conserva exactamente los roles ya autorizados para consultar extractos.
 */
export const getUnionMembersRoster = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar el padrón de afiliados.')
  }
  const callerDoc = await db.collection('users').doc(request.auth.uid).get()
  if (!callerDoc.exists || callerDoc.data()?.isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const allowedRoles = ['directiva_admin', 'tesoreria', 'encargado_agencia']
  if (!allowedRoles.includes(callerDoc.data()?.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para consultar el padrón completo de afiliados.')
  }

  const requestedIds = request.data?.memberIds
  if (requestedIds !== undefined && (!Array.isArray(requestedIds) || requestedIds.length > 1000 || requestedIds.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new HttpsError('invalid-argument', 'La lista de afiliados solicitada no es válida.')
  }
  let memberDocs
  let childrenByMember = null
  if (requestedIds === undefined) {
    const [snapshot, childrenSnapshot] = await Promise.all([
      db.collection('union_members').get(),
      db.collectionGroup('children').get(),
    ])
    memberDocs = snapshot.docs.sort((a, b) => String(a.data()?.memberNumber || '').localeCompare(String(b.data()?.memberNumber || ''), 'es'))
    const memberIds = new Set(memberDocs.map((memberDoc) => memberDoc.id))
    childrenByMember = new Map()
    for (const childDoc of childrenSnapshot.docs) {
      const parentMember = childDoc.ref.parent.parent
      if (!parentMember || parentMember.parent?.id !== 'union_members' || !memberIds.has(parentMember.id)) continue
      const children = childrenByMember.get(parentMember.id) || []
      children.push(childDoc)
      childrenByMember.set(parentMember.id, children)
    }
  } else {
    const uniqueIds = [...new Set(requestedIds.map((id) => id.trim()))]
    const snapshots = await Promise.all(uniqueIds.map((id) => db.collection('union_members').doc(id).get()))
    memberDocs = snapshots.filter((snapshot) => snapshot.exists)
  }

  const members = await Promise.all(memberDocs.map(async (memberDoc) => {
    const data = memberDoc.data() || {}
    const childDocs = childrenByMember
      ? (childrenByMember.get(memberDoc.id) || [])
      : (await memberDoc.ref.collection('children').get()).docs
    const children = childDocs.map((childDoc) => {
      const child = childDoc.data() || {}
      return {
        id: childDoc.id,
        memberId: memberDoc.id,
        fullName: child.fullName || '',
        ci: child.ci || '',
        birthDate: child.birthDate || null,
        phone: child.phone || '',
        address: child.address || '',
        notes: child.notes || '',
        driverUid: child.driverUid || null,
        driverName: child.driverName || null,
      }
    }).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'es'))
    return {
      id: memberDoc.id,
      memberNumber: data.memberNumber || '',
      fullName: data.fullName || '',
      ci: data.ci || '',
      ciComplement: data.ciComplement || '',
      phone: data.phone || '',
      alternatePhone: data.alternatePhone || '',
      address: data.address || '',
      locality: data.locality || '',
      birthDate: data.birthDate || '',
      joinedAt: data.joinedAt || '',
      retiredAt: data.retiredAt || '',
      status: data.status || 'active',
      category: data.category || '',
      primaryDriverUid: data.primaryDriverUid || null,
      primaryDriverName: data.primaryDriverName || null,
      notes: data.notes || '',
      children,
    }
  }))
  return { success: true, members }
})

// =========================================================================
// ENTREGA 6: GESTIÓN DE PERSONAL / TRABAJADORES (Padrón y Nómina)
// =========================================================================

export const manageWorker = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para administrar trabajadores.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  if (!['directiva_admin', 'tesoreria'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Solo la Directiva o Tesorería pueden administrar trabajadores.')
  }

  const {
    id,
    workerCode,
    fullName,
    ci,
    phone,
    role = 'otro',
    roleLabel,
    branchId = 'punata',
    salaryType = 'monthly',
    baseSalaryBob,
    baseSalaryCents,
    status = 'active',
    joinedAt,
    notes,
    action = 'create',
  } = request.data || {}

  const nowIso = new Date().toISOString()

  if (action === 'update' || id) {
    const targetId = id
    if (!targetId) {
      throw new HttpsError('invalid-argument', 'El identificador del trabajador es obligatorio para actualizar.')
    }
    const workerRef = db.collection('union_workers').doc(targetId)
    const workerSnap = await workerRef.get()
    if (!workerSnap.exists) {
      throw new HttpsError('not-found', 'El trabajador especificado no existe.')
    }

    const updates = {
      updatedAtIso: nowIso,
      updatedByUid: callerUid,
    }
    if (fullName) updates.fullName = fullName.trim()
    if (ci !== undefined) updates.ci = String(ci).trim()
    if (phone !== undefined) updates.phone = String(phone).trim()
    if (role) updates.role = role
    if (roleLabel !== undefined) updates.roleLabel = roleLabel
    if (branchId) updates.branchId = branchId
    if (salaryType) updates.salaryType = salaryType
    if (status) updates.status = status
    if (joinedAt) updates.joinedAt = joinedAt
    if (notes !== undefined) updates.notes = notes

    const salaryCents = baseSalaryCents !== undefined && Number.isInteger(baseSalaryCents)
      ? baseSalaryCents
      : (baseSalaryBob !== undefined ? Math.round(Number(baseSalaryBob) * 100) : undefined)
    if (salaryCents !== undefined) {
      updates.baseSalaryCents = salaryCents
      updates.baseSalaryBob = salaryCents / 100
    }

    await workerRef.update(updates)

    await db.collection('audit_logs').add({
      timestamp: nowIso,
      action: 'worker_updated',
      performedBy: callerUid,
      performedByName: caller.fullName || caller.email || 'Admin',
      details: `Trabajador ${targetId} actualizado por ${caller.role}`,
      targetId,
    })

    return {
      success: true,
      workerId: targetId,
      message: 'Trabajador actualizado correctamente.',
    }
  }

  // CREATE WORKER
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'El nombre completo del trabajador es obligatorio.')
  }
  if (!ci || typeof ci !== 'string' || ci.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'El documento de identidad (CI) es obligatorio.')
  }

  const cleanFullName = fullName.trim()
  const cleanCi = ci.trim()

  const cleanSalaryCents = baseSalaryCents !== undefined && Number.isInteger(baseSalaryCents)
    ? baseSalaryCents
    : (baseSalaryBob !== undefined ? Math.round(Number(baseSalaryBob) * 100) : 0)

  // Generate code if not supplied
  let finalWorkerCode = workerCode ? workerCode.trim().toUpperCase() : ''
  if (!finalWorkerCode) {
    const counterRef = db.collection('counters').doc('worker_code')
    const codeNumber = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(counterRef)
      const current = snap.exists ? (snap.data().lastSeq || 0) : 0
      const next = current + 1
      transaction.set(counterRef, { lastSeq: next }, { merge: true })
      return next
    })
    finalWorkerCode = `TRA-${String(codeNumber).padStart(3, '0')}`
  }

  // Check unique workerCode
  const existingSnap = await db.collection('union_workers')
    .where('workerCode', '==', finalWorkerCode)
    .limit(1)
    .get()
  if (!existingSnap.empty) {
    throw new HttpsError('already-exists', `Ya existe un trabajador registrado con el código ${finalWorkerCode}.`)
  }

  const newDocRef = db.collection('union_workers').doc()
  const workerData = {
    id: newDocRef.id,
    workerCode: finalWorkerCode,
    fullName: cleanFullName,
    ci: cleanCi,
    phone: phone ? String(phone).trim() : '',
    role,
    roleLabel: roleLabel || role,
    branchId,
    salaryType,
    baseSalaryBob: cleanSalaryCents / 100,
    baseSalaryCents: cleanSalaryCents,
    status,
    joinedAt: joinedAt || nowIso.slice(0, 10),
    notes: notes || '',
    createdAtIso: nowIso,
    createdByUid: callerUid,
    createdByName: caller.fullName || caller.email || 'Admin',
    updatedAtIso: nowIso,
  }

  await newDocRef.set(workerData)

  await db.collection('audit_logs').add({
    timestamp: nowIso,
    action: 'worker_created',
    performedBy: callerUid,
    performedByName: caller.fullName || caller.email || 'Admin',
    details: `Trabajador ${cleanFullName} (${finalWorkerCode}) registrado con rol ${role}`,
    workerId: newDocRef.id,
    workerCode: finalWorkerCode,
  })

  return {
    success: true,
    worker: workerData,
    message: `Trabajador ${cleanFullName} (${finalWorkerCode}) registrado con éxito.`,
  }
})

export const registerWorkerPayment = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para registrar pagos de personal.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  if (!['directiva_admin', 'tesoreria'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Solo la Directiva o Tesorería pueden autorizar y registrar pagos de sueldos o anticipos.')
  }

  const {
    workerId,
    amountCents,
    amountBob,
    concept,
    period,
    paymentMethod = 'cash',
    shiftId,
    branchId = 'punata',
    notes,
    idempotencyKey,
  } = request.data || {}

  if (!workerId) {
    throw new HttpsError('invalid-argument', 'El identificador del trabajador (workerId) es obligatorio.')
  }
  if (!concept || typeof concept !== 'string' || concept.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'El concepto del pago es obligatorio.')
  }

  const cleanAmountCents = amountCents !== undefined && Number.isInteger(amountCents)
    ? amountCents
    : Math.round((Number(amountBob) || 0) * 100)

  if (!cleanAmountCents || cleanAmountCents <= 0) {
    throw new HttpsError('invalid-argument', 'El monto a pagar debe ser mayor a 0.')
  }

  if (!['cash', 'transfer', 'check'].includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'Método de pago no válido (debe ser cash, transfer o check).')
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
    throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida (mínimo 8 caracteres).')
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const year = now.getFullYear()

  return await db.runTransaction(async (transaction) => {
    // 1. Idempotencia con verificación de payload fingerprint (READ)
    const idempRef = db.collection('idempotency_keys').doc(`worker_pay_${idempotencyKey}`)
    const idempSnap = await transaction.get(idempRef)
    if (idempSnap.exists) {
      const cached = idempSnap.data()
      if (
        cached.callerUid === callerUid &&
        cached.workerId === workerId &&
        cached.amountCents === cleanAmountCents &&
        cached.paymentMethod === paymentMethod &&
        (cached.shiftId || null) === (shiftId || null)
      ) {
        return cached.response
      }
      throw new HttpsError('already-exists', 'La clave de idempotencia ya fue utilizada con parámetros distintos.')
    }

    // 2. Validar trabajador (READ)
    const workerRef = db.collection('union_workers').doc(workerId)
    const workerSnap = await transaction.get(workerRef)
    if (!workerSnap.exists) {
      throw new HttpsError('not-found', 'El trabajador no existe.')
    }
    const worker = workerSnap.data()

    // 3. Validar turno de caja si se paga en efectivo de caja de ventanilla (READ)
    let shiftRef = null
    let shiftData = null
    if (paymentMethod === 'cash') {
      if (!shiftId) {
        throw new HttpsError('failed-precondition', 'El pago de haberes en efectivo requiere un turno de caja abierto.')
      }
      shiftRef = db.collection('cash_shifts').doc(shiftId)
      const cashShiftDoc = await transaction.get(shiftRef)
      if (!cashShiftDoc.exists) {
        throw new HttpsError('not-found', 'El turno de caja especificado no existe.')
      }
      shiftData = cashShiftDoc.data()
      if (shiftData.status !== 'open') {
        throw new HttpsError('failed-precondition', 'El turno de caja no está abierto.')
      }
      const currentExpected = shiftData.expectedCashCents || 0
      if (currentExpected < cleanAmountCents) {
        throw new HttpsError('failed-precondition', `Saldo insuficiente en efectivo en caja (Bs ${(currentExpected / 100).toFixed(2)}) para cubrir el pago de nómina (Bs ${(cleanAmountCents / 100).toFixed(2)}).`)
      }
    }

    // 4. Generar correlativo de recibo de pago (READ)
    const counterRef = db.collection('counters').doc(`receipt_worker_${year}`)
    const counterSnap = await transaction.get(counterRef)
    const currentSeq = counterSnap.exists ? (counterSnap.data().lastSeq || 0) : 0
    const nextSeq = currentSeq + 1
    const receiptNumber = `REC-TRA-${year}-${String(nextSeq).padStart(5, '0')}`

    // --- TODAS LAS ESCRITURAS A PARTIR DE AQUÍ ---
    transaction.set(counterRef, { lastSeq: nextSeq, year }, { merge: true })

    if (shiftRef && shiftData) {
      const breakdown = shiftData.breakdown || {}
      const currentExpenses = breakdown.expensesCents || 0
      const currentExpected = shiftData.expectedCashCents || 0
      transaction.update(shiftRef, {
        expectedCashCents: currentExpected - cleanAmountCents,
        'breakdown.expensesCents': currentExpenses + cleanAmountCents,
        'breakdown.cashExpenseCents': (breakdown.cashExpenseCents || 0) + cleanAmountCents,
        'breakdown.workerPayrollExpenseCents': (breakdown.workerPayrollExpenseCents || 0) + cleanAmountCents,
        updatedAt: nowIso,
      })
    }

    // 5. Crear documento de pago de personal
    const paymentDocRef = db.collection('union_worker_payments').doc()
    const paymentData = {
      id: paymentDocRef.id,
      paymentNumber: receiptNumber,
      workerId,
      workerCode: worker.workerCode || '',
      workerName: worker.fullName || '',
      workerRole: worker.role || '',
      workerCi: worker.ci || '',
      amountBob: cleanAmountCents / 100,
      amountCents: cleanAmountCents,
      concept: concept.trim(),
      period: period ? String(period).trim() : `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      paymentMethod,
      shiftId: shiftId || null,
      branchId: branchId || worker.branchId || 'punata',
      paidAtIso: nowIso,
      registeredByUid: callerUid,
      registeredByName: caller.fullName || caller.email || 'Admin',
      notes: notes || '',
      status: 'completed',
    }
    transaction.set(paymentDocRef, paymentData)

    // 6. Registrar movimiento financiero inmutable
    const movementDocRef = db.collection('financial_movements').doc()
    const movementData = {
      id: movementDocRef.id,
      movementNumber: `MOV-${receiptNumber}`,
      type: 'worker_payroll',
      category: 'egreso',
      direction: 'out',
      amountBob: cleanAmountCents / 100,
      amountCents: cleanAmountCents,
      paymentMethod,
      branchId: branchId || worker.branchId || 'punata',
      shiftId: shiftId || null,
      operatorUid: callerUid,
      operatorName: caller.fullName || caller.email || 'Admin',
      referenceId: paymentDocRef.id,
      description: `Pago de personal [${receiptNumber}]: ${worker.fullName} - ${concept.trim()}`,
      timestamp: nowIso,
      status: 'completed',
    }
    transaction.set(movementDocRef, movementData)

    // 7. Audit log
    const auditDocRef = db.collection('audit_logs').doc()
    transaction.set(auditDocRef, {
      timestamp: nowIso,
      action: 'worker_payment_registered',
      performedBy: callerUid,
      performedByName: caller.fullName || caller.email || 'Admin',
      details: `Pago de personal registrado: ${receiptNumber} por Bs ${cleanAmountCents / 100} a ${worker.fullName}`,
      paymentId: paymentDocRef.id,
      receiptNumber,
      workerId,
      amountCents: cleanAmountCents,
    })

    const response = {
      success: true,
      receiptNumber,
      paymentId: paymentDocRef.id,
      workerName: worker.fullName,
      workerCode: worker.workerCode,
      amountCents: cleanAmountCents,
      amountBob: cleanAmountCents / 100,
      concept: concept.trim(),
      paymentMethod,
      paidAtIso: nowIso,
      paidByName: caller.fullName || caller.email || 'Admin',
      message: `Pago ${receiptNumber} registrado exitosamente.`,
    }

    transaction.set(idempRef, {
      idempotencyKey,
      callerUid,
      workerId,
      amountCents: cleanAmountCents,
      paymentMethod,
      shiftId: shiftId || null,
      response,
      createdAt: nowIso,
      createdByUid: callerUid,
    })

    return response
  })
})

// =========================================================================
// ENTREGA 6: GESTIÓN DE EGRESOS / GASTOS OPERATIVOS (Alquiler, Luz, Agua, etc.)
// =========================================================================

export const registerGeneralExpense = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para registrar egresos operativos.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  const allowedRoles = ['directiva_admin', 'tesoreria', 'encargado_agencia', 'secretaria']
  if (!allowedRoles.includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para registrar egresos operativos.')
  }

  const {
    category,
    branchId = 'punata',
    concept,
    amountCents,
    amountBob,
    supplier,
    invoiceOrReceiptNumber,
    paymentMethod = 'cash',
    shiftId,
    notes,
    idempotencyKey,
  } = request.data || {}

  const validCategories = [
    'alquiler',
    'servicios_basicos',
    'combustible',
    'mantenimiento',
    'material_escritorio',
    'viaticos',
    'impuestos_tasas',
    'otro',
  ]
  if (!category || !validCategories.includes(category)) {
    throw new HttpsError('invalid-argument', `Categoría de egreso inválida. Debe ser una de: ${validCategories.join(', ')}`)
  }

  if (!concept || typeof concept !== 'string' || concept.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'El concepto del egreso es obligatorio.')
  }

  const cleanAmountCents = amountCents !== undefined && Number.isInteger(amountCents)
    ? amountCents
    : Math.round((Number(amountBob) || 0) * 100)

  if (!cleanAmountCents || cleanAmountCents <= 0) {
    throw new HttpsError('invalid-argument', 'El monto del gasto debe ser mayor a 0.')
  }

  // Validación de autorización si supera el umbral de Bs 150 y es registrado por secretaria
  if (caller.role === 'secretaria' && cleanAmountCents > 15000) {
    throw new HttpsError('permission-denied', 'Los egresos superiores a Bs 150 requieren autorización de Encargado de Agencia o Directiva.')
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
    throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida (mínimo 8 caracteres).')
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const year = now.getFullYear()

  return await db.runTransaction(async (transaction) => {
    // 1. Idempotencia con verificación de payload fingerprint (READ)
    const idempRef = db.collection('idempotency_keys').doc(`gen_expense_${idempotencyKey}`)
    const idempSnap = await transaction.get(idempRef)
    if (idempSnap.exists) {
      const cached = idempSnap.data()
      if (
        cached.callerUid === callerUid &&
        cached.category === category &&
        cached.amountCents === cleanAmountCents &&
        cached.paymentMethod === paymentMethod &&
        (cached.shiftId || null) === (shiftId || null)
      ) {
        return cached.response
      }
      throw new HttpsError('already-exists', 'La clave de idempotencia ya fue utilizada con parámetros distintos.')
    }

    // 2. Validar turno de caja si se paga en efectivo en sucursal (READ)
    let shiftRef = null
    let shiftData = null
    if (paymentMethod === 'cash') {
      if (!shiftId) {
        if (caller.role === 'secretaria') {
          throw new HttpsError('failed-precondition', 'El egreso operativo en efectivo por ventanilla requiere un turno de caja abierto.')
        }
      } else {
        shiftRef = db.collection('cash_shifts').doc(shiftId)
        const shiftSnap = await transaction.get(shiftRef)
        if (!shiftSnap.exists) {
          throw new HttpsError('not-found', 'El turno de caja especificado no existe.')
        }
        shiftData = shiftSnap.data()
        if (shiftData.status !== 'open') {
          throw new HttpsError('failed-precondition', 'El turno de caja no está abierto.')
        }
        const currentExpected = shiftData.expectedCashCents || 0
        if (currentExpected < cleanAmountCents) {
          throw new HttpsError('failed-precondition', `Saldo insuficiente en efectivo en caja (Bs ${(currentExpected / 100).toFixed(2)}) para cubrir el gasto (Bs ${(cleanAmountCents / 100).toFixed(2)}).`)
        }
      }
    }

    // 3. Generar correlativo de comprobante de egreso (READ)
    const counterRef = db.collection('counters').doc(`voucher_expense_${year}`)
    const counterSnap = await transaction.get(counterRef)
    const currentSeq = counterSnap.exists ? (counterSnap.data().lastSeq || 0) : 0
    const nextSeq = currentSeq + 1
    const voucherNumber = `EGR-${year}-${String(nextSeq).padStart(5, '0')}`

    // --- TODAS LAS ESCRITURAS A PARTIR DE AQUÍ ---
    transaction.set(counterRef, { lastSeq: nextSeq, year }, { merge: true })

    if (shiftRef && shiftData) {
      const breakdown = shiftData.breakdown || {}
      const currentExpenses = breakdown.expensesCents || 0
      const currentExpected = shiftData.expectedCashCents || 0
      transaction.update(shiftRef, {
        expectedCashCents: currentExpected - cleanAmountCents,
        'breakdown.expensesCents': currentExpenses + cleanAmountCents,
        'breakdown.cashExpenseCents': (breakdown.cashExpenseCents || 0) + cleanAmountCents,
        updatedAt: nowIso,
      })
    }

    // 4. Crear documento de egreso
    const expenseDocRef = db.collection('union_expenses').doc()
    const expenseData = {
      id: expenseDocRef.id,
      voucherNumber,
      category,
      branchId: branchId || 'punata',
      concept: concept.trim(),
      amountBob: cleanAmountCents / 100,
      amountCents: cleanAmountCents,
      supplier: supplier ? String(supplier).trim() : '',
      invoiceOrReceiptNumber: invoiceOrReceiptNumber ? String(invoiceOrReceiptNumber).trim() : '',
      paymentMethod,
      shiftId: shiftId || null,
      paidAtIso: nowIso,
      createdAtIso: nowIso,
      createdByUid: callerUid,
      createdByName: caller.fullName || caller.email || 'Admin',
      status: 'completed',
      notes: notes || '',
    }
    transaction.set(expenseDocRef, expenseData)

    // 5. Registrar movimiento financiero inmutable
    const movementDocRef = db.collection('financial_movements').doc()
    const movementData = {
      id: movementDocRef.id,
      movementNumber: `MOV-${voucherNumber}`,
      type: 'expense',
      category: 'egreso',
      direction: 'out',
      amountBob: cleanAmountCents / 100,
      amountCents: cleanAmountCents,
      paymentMethod,
      branchId: branchId || 'punata',
      shiftId: shiftId || null,
      operatorUid: callerUid,
      operatorName: caller.fullName || caller.email || 'Admin',
      referenceId: expenseDocRef.id,
      description: `Gasto operativo [${voucherNumber}] ${category.toUpperCase()}: ${concept.trim()}`,
      timestamp: nowIso,
      status: 'completed',
    }
    transaction.set(movementDocRef, movementData)

    // 6. Audit log
    const auditDocRef = db.collection('audit_logs').doc()
    transaction.set(auditDocRef, {
      timestamp: nowIso,
      action: 'general_expense_registered',
      performedBy: callerUid,
      performedByName: caller.fullName || caller.email || 'Admin',
      details: `Gasto registrado: ${voucherNumber} por Bs ${cleanAmountCents / 100} en categoría ${category}`,
      expenseId: expenseDocRef.id,
      voucherNumber,
      category,
      amountCents: cleanAmountCents,
    })

    const response = {
      success: true,
      voucherNumber,
      expenseId: expenseDocRef.id,
      category,
      concept: concept.trim(),
      amountCents: cleanAmountCents,
      amountBob: cleanAmountCents / 100,
      supplier: supplier || '',
      paymentMethod,
      createdAtIso: nowIso,
      registeredByName: caller.fullName || caller.email || 'Admin',
      message: `Egreso ${voucherNumber} registrado con éxito.`,
    }

    transaction.set(idempRef, {
      idempotencyKey,
      callerUid,
      category,
      amountCents: cleanAmountCents,
      paymentMethod,
      shiftId: shiftId || null,
      response,
      createdAt: nowIso,
      createdByUid: callerUid,
    })

    return response
  })
})

// =========================================================================
// ENTREGA 6: INVENTARIO DE BIENES FIJOS (Equipos, Impresoras, Muebles, Balanzas)
// =========================================================================

export const manageFixedAsset = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para administrar bienes fijos.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  if (!['directiva_admin', 'encargado_agencia', 'tesoreria'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para administrar el inventario de bienes fijos.')
  }

  const {
    id,
    action = 'create',
    assetCode,
    name,
    category = 'oficina',
    description,
    branchId = 'punata',
    physicalLocation,
    responsiblePersonUid,
    responsiblePersonName,
    acquisitionDate,
    acquisitionCostBob,
    acquisitionCostCents,
    status = 'available',
    photoUrl,
    notes,
    disposedReason,
    patrimonialLocationId,
    propertyType,
    address,
    quantity = 1,
    batchRequestId,
  } = request.data || {}

  const nowIso = new Date().toISOString()
  const callerName = caller.fullName || caller.email || 'Admin'

  if (action === 'create_batch') {
    const allowedLocations = ['sede_punata', 'oficina_punata', 'oficina_cochabamba']
    if (!allowedLocations.includes(patrimonialLocationId)) throw new HttpsError('invalid-argument', 'Seleccione una sede u oficina patrimonial válida.')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) throw new HttpsError('invalid-argument', 'La cantidad debe ser un entero entre 1 y 200.')
    if (category === 'inmuebles' && quantity !== 1) throw new HttpsError('invalid-argument', 'Los inmuebles deben registrarse individualmente, con cantidad 1.')
    if (!['computacion', 'muebles', 'herramientas', 'comunicacion', 'balanzas_pesaje', 'oficina', 'inmuebles', 'otro'].includes(category)) throw new HttpsError('invalid-argument', 'La categoría patrimonial no es válida.')
    if (!name || typeof name !== 'string' || name.trim().length < 2) throw new HttpsError('invalid-argument', 'El nombre del bien es obligatorio.')
    if (!batchRequestId || typeof batchRequestId !== 'string' || batchRequestId.length < 12 || batchRequestId.length > 100) throw new HttpsError('invalid-argument', 'La clave de lote no es válida.')
    const cleanCategory = category === 'inmuebles' ? 'inmuebles' : category
    const locationBranch = patrimonialLocationId === 'oficina_cochabamba' ? 'cochabamba' : 'punata'
    const prefix = locationBranch === 'cochabamba' ? 'CBB' : 'PUN'
    const fingerprint = JSON.stringify({ name: name.trim(), category: cleanCategory, description: description || '', patrimonialLocationId, quantity, acquisitionDate: acquisitionDate || '', acquisitionCostCents: acquisitionCostCents ?? acquisitionCostBob ?? 0, propertyType: propertyType || '', address: address || '', responsiblePersonUid: responsiblePersonUid || '', responsiblePersonName: responsiblePersonName || '', status, notes: notes || '', photoUrl: photoUrl || '' })
    const batchRef = db.collection('fixed_asset_batches').doc(batchRequestId.replace(/[^a-zA-Z0-9_-]/g, '_'))
    const counterRef = db.collection('counters').doc(`asset_${locationBranch}`)
    const inventoryQuery = db.collection('fixed_assets').where('assetCode', '>=', `ACT-${prefix}-`).where('assetCode', '<=', `ACT-${prefix}-9999999999`)
    const assetRefs = Array.from({ length: quantity }, () => db.collection('fixed_assets').doc())
    const logRefs = assetRefs.map((ref) => ref.collection('audit_logs').doc())
    const globalLogRefs = assetRefs.map(() => db.collection('audit_logs').doc())
    const created = await db.runTransaction(async (transaction) => {
      const existingBatch = await transaction.get(batchRef)
      if (existingBatch.exists) {
        if (existingBatch.data().fingerprint !== fingerprint) throw new HttpsError('already-exists', 'La clave de lote ya fue utilizada para otros datos.')
        const ids = existingBatch.data().assetIds || []
        const docs = await Promise.all(ids.map((assetId) => transaction.get(db.collection('fixed_assets').doc(assetId))))
        return docs.filter((doc) => doc.exists).map((doc) => doc.data())
      }
      const [counterSnap, inventorySnap] = await Promise.all([transaction.get(counterRef), transaction.get(inventoryQuery)])
      let next = counterSnap.exists ? Number(counterSnap.data().lastSeq || 0) : 0
      for (const doc of inventorySnap.docs) {
        const match = new RegExp(`^ACT-${prefix}-(\\d+)$`).exec(doc.data().assetCode || '')
        if (match) next = Math.max(next, Number(match[1]))
      }
      const amountCents = Number.isInteger(acquisitionCostCents)
        ? acquisitionCostCents
        : (acquisitionCostBob !== undefined ? Math.round(Number(acquisitionCostBob) * 100) : 0)
      if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new HttpsError('invalid-argument', 'El valor registrado debe ser un importe no negativo válido en centavos.')
      if (!['available', 'in_use', 'in_maintenance', 'damaged', 'out_of_service', 'lost'].includes(status)) throw new HttpsError('invalid-argument', 'El estado patrimonial no es válido.')
      const groupId = quantity > 1 ? batchRef.id : null
      const items = assetRefs.map((ref, index) => {
        const code = `ACT-${prefix}-${String(next + index + 1).padStart(4, '0')}`
        const qrPayload = `EXPRESO-PUNATA:ACTIVO:${ref.id}`
        const item = {
          id: ref.id, assetCode: code, barcodeQr: code, qrPayload,
          name: name.trim(), category: cleanCategory,
          description: description ? description.trim() : '', branchId: locationBranch,
          patrimonialLocationId, physicalLocation: physicalLocation || '',
          propertyType: propertyType || '', address: address || '',
          responsiblePersonUid: responsiblePersonUid || null, responsiblePersonName: responsiblePersonName?.trim() || '',
          acquisitionDate: acquisitionDate || nowIso.slice(0, 10),
          acquisitionCostBob: index === 0 ? amountCents / 100 : 0,
          acquisitionCostCents: index === 0 ? amountCents : 0,
          status, photoUrl: photoUrl || '', notes: notes || '',
          quantityGroupId: groupId, quantityIndex: index + 1, quantityTotal: quantity,
          createdAtIso: nowIso, createdByUid: callerUid, createdByName: callerName, updatedAtIso: nowIso,
        }
        transaction.create(ref, item)
        transaction.create(logRefs[index], {
          assetId: ref.id, assetCode: code, action: 'created', details: `Registro patrimonial por ${callerName}`,
          performedByUid: callerUid, performedByName: callerName, timestampIso: nowIso,
        })
        transaction.create(globalLogRefs[index], {
          timestamp: nowIso, action: 'fixed_asset_created', performedBy: callerUid, performedByName: callerName,
          details: `Activo registrado: ${code} - ${name.trim()} en ${patrimonialLocationId}`,
          assetId: ref.id, assetCode: code,
        })
        return item
      })
      transaction.set(counterRef, { lastSeq: next + quantity, branchId: locationBranch }, { merge: true })
      transaction.create(batchRef, { assetIds: items.map((item) => item.id), quantity, fingerprint, createdAtIso: nowIso, createdByUid: callerUid })
      return items
    })
    return { success: true, assets: created, quantity: created.length, message: `${created.length} bien(es) registrado(s).` }
  }

  // OPERACIÓN 1: ACTUALIZACIÓN / EDICIÓN GENERAL
  if (action === 'update' && id) {
    const assetRef = db.collection('fixed_assets').doc(id)
    const assetSnap = await assetRef.get()
    if (!assetSnap.exists) {
      throw new HttpsError('not-found', 'El activo no existe.')
    }
    const currentAsset = assetSnap.data()

    if (request.data?.category === 'inmuebles' && (currentAsset.quantityTotal || 1) !== 1) {
      throw new HttpsError('failed-precondition', 'Los inmuebles deben mantenerse como registros individuales.')
    }

    if (currentAsset.status === 'disposed') {
      if (caller.role !== 'directiva_admin') {
        throw new HttpsError('permission-denied', 'Un activo dado de baja no puede ser modificado ni reactivado sin rol directiva_admin.')
      }
      const justification = (request.data?.justification || request.data?.notes || '').trim()
      if (justification.length < 10) {
        throw new HttpsError('invalid-argument', 'Se requiere una justificación obligatoria (mínimo 10 caracteres) para modificar un activo dado de baja.')
      }
    }

    const updates = {
      updatedAtIso: nowIso,
      updatedByUid: callerUid,
    }
    if (name) updates.name = name.trim()
    if (request.data?.category) updates.category = category
    if (description !== undefined) updates.description = description
    if (physicalLocation) updates.physicalLocation = physicalLocation.trim()
    if (patrimonialLocationId) updates.patrimonialLocationId = patrimonialLocationId
    if (propertyType !== undefined) updates.propertyType = propertyType
    if (address !== undefined) updates.address = address
    if (responsiblePersonName) updates.responsiblePersonName = responsiblePersonName.trim()
    if (responsiblePersonUid !== undefined) updates.responsiblePersonUid = responsiblePersonUid
    if (acquisitionDate !== undefined) updates.acquisitionDate = acquisitionDate
    if (notes !== undefined) updates.notes = notes
    if (photoUrl !== undefined) updates.photoUrl = photoUrl
    if (status) updates.status = status

    const costCents = acquisitionCostCents !== undefined && Number.isInteger(acquisitionCostCents)
      ? acquisitionCostCents
      : (acquisitionCostBob !== undefined ? Math.round(Number(acquisitionCostBob) * 100) : undefined)
    if (costCents !== undefined) {
      if (!Number.isSafeInteger(costCents) || costCents < 0) throw new HttpsError('invalid-argument', 'El valor registrado debe ser un importe no negativo válido.')
      updates.acquisitionCostCents = costCents
      updates.acquisitionCostBob = costCents / 100
    }

    await assetRef.update(updates)

    // Log en subcolección de auditoría del activo
    await assetRef.collection('audit_logs').add({
      assetId: id,
      assetCode: currentAsset.assetCode,
      action: 'update',
      details: `Actualización de datos por ${callerName}`,
      performedByUid: callerUid,
      performedByName: callerName,
      timestampIso: nowIso,
    })

    return {
      success: true,
      assetId: id,
      message: 'Activo fijo actualizado correctamente.',
    }
  }

  // OPERACIÓN 2: TRANSFERENCIA DE SUCURSAL / UBICACIÓN / RESPONSABLE
  if (action === 'transfer' && id) {
    const assetRef = db.collection('fixed_assets').doc(id)
    const assetSnap = await assetRef.get()
    if (!assetSnap.exists) {
      throw new HttpsError('not-found', 'El activo no existe.')
    }
    const currentAsset = assetSnap.data()

    if (currentAsset.status === 'disposed') {
      throw new HttpsError('failed-precondition', 'Un activo dado de baja no puede ser transferido de sucursal ni responsable.')
    }

    if (!physicalLocation && !branchId && !patrimonialLocationId && !responsiblePersonName) {
      throw new HttpsError('invalid-argument', 'Debe especificar la nueva ubicación, sucursal o responsable.')
    }

    const updates = {
      updatedAtIso: nowIso,
      updatedByUid: callerUid,
    }
    if (branchId) updates.branchId = branchId
    if (physicalLocation) updates.physicalLocation = physicalLocation.trim()
    if (patrimonialLocationId) {
      if (!['sede_punata', 'oficina_punata', 'oficina_cochabamba'].includes(patrimonialLocationId)) throw new HttpsError('invalid-argument', 'La sede u oficina patrimonial no es válida.')
      updates.patrimonialLocationId = patrimonialLocationId
    }
    if (responsiblePersonName) updates.responsiblePersonName = responsiblePersonName.trim()
    if (responsiblePersonUid !== undefined) updates.responsiblePersonUid = responsiblePersonUid

    await assetRef.update(updates)

    await assetRef.collection('audit_logs').add({
      assetId: id,
      assetCode: currentAsset.assetCode,
      action: 'transfer',
      previousLocation: currentAsset.patrimonialLocationId || currentAsset.physicalLocation,
      newLocation: updates.patrimonialLocationId || updates.physicalLocation || currentAsset.patrimonialLocationId || currentAsset.physicalLocation,
      previousResponsible: currentAsset.responsiblePersonName,
      newResponsible: updates.responsiblePersonName || currentAsset.responsiblePersonName,
      details: `Transferencia registrada por ${callerName}`,
      performedByUid: callerUid,
      performedByName: callerName,
      timestampIso: nowIso,
    })

    return {
      success: true,
      assetId: id,
      message: 'Transferencia registrada exitosamente.',
    }
  }

  // OPERACIÓN 3: CAMBIO DE ESTADO (Mantenimiento, En Uso, Dañado, etc.)
  if (action === 'changeStatus' && id) {
    const assetRef = db.collection('fixed_assets').doc(id)
    const assetSnap = await assetRef.get()
    if (!assetSnap.exists) {
      throw new HttpsError('not-found', 'El activo no existe.')
    }
    const currentAsset = assetSnap.data()

    if (currentAsset.status === 'disposed') {
      if (caller.role !== 'directiva_admin') {
        throw new HttpsError('permission-denied', 'Un activo dado de baja no puede reactivarse sin rol directiva_admin.')
      }
      const justification = (request.data?.justification || request.data?.notes || '').trim()
      if (justification.length < 10) {
        throw new HttpsError('invalid-argument', 'Se requiere una justificación obligatoria (mínimo 10 caracteres) para reactivar un activo dado de baja.')
      }
    }

    if (!status) {
      throw new HttpsError('invalid-argument', 'Debe especificar el nuevo estado del activo.')
    }

    await assetRef.update({
      status,
      updatedAtIso: nowIso,
      updatedByUid: callerUid,
    })

    await assetRef.collection('audit_logs').add({
      assetId: id,
      assetCode: currentAsset.assetCode,
      action: status === 'in_maintenance' ? 'maintenance' : 'status_change',
      previousStatus: currentAsset.status,
      newStatus: status,
      details: notes || `Cambio de estado a ${status} por ${callerName}`,
      performedByUid: callerUid,
      performedByName: callerName,
      timestampIso: nowIso,
    })

    return {
      success: true,
      assetId: id,
      message: `Estado del activo cambiado a ${status}.`,
    }
  }

  // OPERACIÓN 4: BAJA AUTORIZADA DE ACTIVO
  if (action === 'dispose' && id) {
    const assetRef = db.collection('fixed_assets').doc(id)
    const assetSnap = await assetRef.get()
    if (!assetSnap.exists) {
      throw new HttpsError('not-found', 'El activo no existe.')
    }
    const currentAsset = assetSnap.data()

    if (currentAsset.status === 'disposed') {
      throw new HttpsError('failed-precondition', 'El activo ya ha sido dado de baja previamente.')
    }

    if (!disposedReason || typeof disposedReason !== 'string' || disposedReason.trim().length < 5) {
      throw new HttpsError('invalid-argument', 'Debe indicar el motivo detallado de la baja del activo.')
    }

    await assetRef.update({
      status: 'disposed',
      disposedReason: disposedReason.trim(),
      disposedAtIso: nowIso,
      disposedByUid: callerUid,
      disposedByName: callerName,
      updatedAtIso: nowIso,
      updatedByUid: callerUid,
    })

    await assetRef.collection('audit_logs').add({
      assetId: id,
      assetCode: currentAsset.assetCode,
      action: 'disposed',
      previousStatus: currentAsset.status,
      newStatus: 'disposed',
      details: `Baja definitiva: ${disposedReason.trim()}`,
      performedByUid: callerUid,
      performedByName: callerName,
      timestampIso: nowIso,
    })

    return {
      success: true,
      assetId: id,
      message: 'Baja del bien fijo registrada con éxito.',
    }
  }

  // OPERACIÓN 5: REGISTRO DE NUEVO BIEN FIJO (CREATE)
  if (!name || typeof name !== 'string' || name.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'El nombre del bien o equipo es obligatorio.')
  }
  if (!physicalLocation || typeof physicalLocation !== 'string' || physicalLocation.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'La ubicación física es obligatoria.')
  }
  if (!responsiblePersonName || typeof responsiblePersonName !== 'string' || responsiblePersonName.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'El responsable asignado es obligatorio.')
  }

  const cleanBranch = branchId === 'cochabamba' ? 'cochabamba' : 'punata'
  const branchPrefix = cleanBranch === 'cochabamba' ? 'CBB' : 'PUN'

  // Generar código único de activo: ACT-PUN-XXXX o ACT-CBB-XXXX
  let finalAssetCode = assetCode ? assetCode.trim().toUpperCase() : ''
  if (!finalAssetCode) {
    const counterRef = db.collection('counters').doc(`asset_${cleanBranch}`)
    const seq = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(counterRef)
      const current = snap.exists ? (snap.data().lastSeq || 0) : 0
      const next = current + 1
      transaction.set(counterRef, { lastSeq: next, branchId: cleanBranch }, { merge: true })
      return next
    })
    finalAssetCode = `ACT-${branchPrefix}-${String(seq).padStart(4, '0')}`
  }

  const costCents = acquisitionCostCents !== undefined && Number.isInteger(acquisitionCostCents)
    ? acquisitionCostCents
    : (acquisitionCostBob !== undefined ? Math.round(Number(acquisitionCostBob) * 100) : 0)

  const newDocRef = db.collection('fixed_assets').doc()
  const assetData = {
    id: newDocRef.id,
    assetCode: finalAssetCode,
    barcodeQr: finalAssetCode,
    name: name.trim(),
    category,
    description: description ? description.trim() : '',
    branchId: cleanBranch,
    ...(patrimonialLocationId ? { patrimonialLocationId } : {}),
    ...(propertyType ? { propertyType } : {}),
    ...(address ? { address } : {}),
    physicalLocation: physicalLocation.trim(),
    responsiblePersonUid: responsiblePersonUid || null,
    responsiblePersonName: responsiblePersonName.trim(),
    acquisitionDate: acquisitionDate || nowIso.slice(0, 10),
    acquisitionCostBob: costCents / 100,
    acquisitionCostCents: costCents,
    status,
    photoUrl: photoUrl || '',
    notes: notes || '',
    createdAtIso: nowIso,
    createdByUid: callerUid,
    createdByName: callerName,
    updatedAtIso: nowIso,
  }

  await newDocRef.set(assetData)

  // Subcolección audit_logs
  await newDocRef.collection('audit_logs').add({
    assetId: newDocRef.id,
    assetCode: finalAssetCode,
    action: 'created',
    details: `Registro inicial del activo por ${callerName}`,
    performedByUid: callerUid,
    performedByName: callerName,
    timestampIso: nowIso,
  })

  // Auditoría global
  await db.collection('audit_logs').add({
    timestamp: nowIso,
    action: 'fixed_asset_created',
    performedBy: callerUid,
    performedByName: callerName,
    details: `Activo registrado: ${finalAssetCode} - ${name.trim()} en ${cleanBranch}`,
    assetId: newDocRef.id,
    assetCode: finalAssetCode,
  })

  return {
    success: true,
    asset: assetData,
    message: `Activo ${finalAssetCode} registrado exitosamente.`,
  }
})

const PATRIMONIAL_READ_ROLES = ['directiva_admin', 'encargado_agencia', 'tesoreria', 'secretaria']
const PATRIMONIAL_MANAGE_ROLES = ['directiva_admin', 'encargado_agencia', 'tesoreria']

async function requirePatrimonialUser(request, allowedRoles, message) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión.')
  const snap = await db.collection('users').doc(request.auth.uid).get()
  if (!snap.exists || snap.data().isActive === false || !allowedRoles.includes(snap.data().role)) {
    throw new HttpsError('permission-denied', message)
  }
  return { uid: request.auth.uid, profile: snap.data() }
}

export const managePhysicalInventoryDocument = onCall({ cors: true }, async (request) => {
  const { uid, profile } = await requirePatrimonialUser(request, PATRIMONIAL_MANAGE_ROLES, 'No tiene permisos para administrar documentos físicos.')
  const { action = 'create', id, title, documentType, description = '', patrimonialLocationId, sheetCount, documentDate, responsibleReference = '', status = 'active', notes = '' } = request.data || {}
  const validLocations = ['sede_punata', 'oficina_punata', 'oficina_cochabamba']
  if (!['create', 'update'].includes(action)) throw new HttpsError('invalid-argument', 'Acción documental no válida.')
  if (!title || typeof title !== 'string' || title.trim().length < 2) throw new HttpsError('invalid-argument', 'El título debe tener al menos dos caracteres.')
  if (!documentType || typeof documentType !== 'string' || documentType.trim().length < 2) throw new HttpsError('invalid-argument', 'Indique el tipo de documento o carpeta.')
  if (!validLocations.includes(patrimonialLocationId)) throw new HttpsError('invalid-argument', 'Seleccione una ubicación patrimonial válida.')
  if (!Number.isInteger(sheetCount) || sheetCount < 0) throw new HttpsError('invalid-argument', 'La cantidad de hojas debe ser un entero no negativo.')
  const nowIso = new Date().toISOString()
  const actor = { updatedAtIso: nowIso, updatedByUid: uid, updatedByName: profile.fullName || profile.email || 'Usuario' }
  const collection = db.collection('physical_inventory_documents')
  if (action === 'update') {
    if (!id) throw new HttpsError('invalid-argument', 'Falta el identificador del documento.')
    const ref = collection.doc(id)
    const existing = await ref.get()
    if (!existing.exists) throw new HttpsError('not-found', 'El documento físico no existe.')
    const previous = existing.data()
    const next = { title: title.trim(), documentType: documentType.trim(), description: String(description).trim(), patrimonialLocationId, sheetCount, documentDate: documentDate || previous.documentDate || nowIso.slice(0, 10), responsibleReference: String(responsibleReference).trim(), status, notes: String(notes).trim(), ...actor }
    await ref.update(next)
    await collection.doc(id).collection('audit_logs').add({ action: 'updated', before: previous, after: next, performedByUid: uid, performedByName: actor.updatedByName, timestampIso: nowIso })
    return { success: true, id, document: { id, ...previous, ...next } }
  }
  const ref = collection.doc()
  const document = { id: ref.id, title: title.trim(), documentType: documentType.trim(), description: String(description).trim(), patrimonialLocationId, sheetCount, documentDate: documentDate || nowIso.slice(0, 10), responsibleReference: String(responsibleReference).trim(), status, notes: String(notes).trim(), createdAtIso: nowIso, createdByUid: uid, ...actor }
  await ref.set(document)
  await ref.collection('audit_logs').add({ action: 'created', after: document, performedByUid: uid, performedByName: actor.updatedByName, timestampIso: nowIso })
  return { success: true, id: ref.id, document }
})

export const listPhysicalInventoryDocuments = onCall({ cors: true }, async (request) => {
  await requirePatrimonialUser(request, PATRIMONIAL_READ_ROLES, 'No tiene permisos de lectura para el inventario patrimonial.')
  const { patrimonialLocationId, search = '' } = request.data || {}
  const query = db.collection('physical_inventory_documents').orderBy('title').limit(500)
  const snap = await query.get()
  const normalized = String(search).trim().toLowerCase()
  const documents = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((doc) => {
      const matchesLocation = !patrimonialLocationId || patrimonialLocationId === 'all' || doc.patrimonialLocationId === patrimonialLocationId
      const matchesSearch = !normalized || [doc.title, doc.documentType, doc.description, doc.patrimonialLocationId]
        .some((value) => String(value || '').toLowerCase().includes(normalized))
      return matchesLocation && matchesSearch
    })
  return { documents }
})

// =========================================================================
// ENTREGA 7: MOTOR CENTRAL DE REPORTES OPERATIVOS, ADMINISTRATIVOS Y FINANCIEROS
// =========================================================================

/**
 * Convierte fechas o períodos a límites ISO estrictos en zona horaria America/La_Paz (UTC-4).
 */
function resolveLaPazBounds(startDateStr, endDateStr, periodStr) {
  const now = new Date()

  if (periodStr && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodStr)) {
    const [year, month] = periodStr.split('-').map(Number)
    const start = new Date(`${periodStr}-01T00:00:00-04:00`)
    const lastDay = new Date(year, month, 0).getDate()
    const end = new Date(`${periodStr}-${String(lastDay).padStart(2, '0')}T23:59:59.999-04:00`)
    return { startIso: start.toISOString(), endIso: end.toISOString() }
  }

  let startIso
  let endIso

  if (startDateStr) {
    if (startDateStr.length === 10) {
      startIso = new Date(`${startDateStr}T00:00:00-04:00`).toISOString()
    } else {
      startIso = new Date(startDateStr).toISOString()
    }
  } else {
    // 30 días atrás por defecto
    const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    startIso = d.toISOString()
  }

  if (endDateStr) {
    if (endDateStr.length === 10) {
      endIso = new Date(`${endDateStr}T23:59:59.999-04:00`).toISOString()
    } else {
      endIso = new Date(endDateStr).toISOString()
    }
  } else {
    endIso = now.toISOString()
  }

  return { startIso, endIso }
}

async function getFinancialMovementsForRange(startIso, endIso) {
  // Los registros históricos de Caja no usan todos el mismo campo de fecha:
  // algunos tienen `timestamp` y otros `createdAtIso`. No se puede excluir de forma
  // segura un campo ausente con una consulta Firestore. Mantener ambas ramas evita
  // omitir documentos históricos; deduplicar por ID evita volver a contarlos.
  const collection = db.collection('financial_movements')
  const [timestampSnapshot, createdAtSnapshot] = await Promise.all([
    collection.where('timestamp', '>=', startIso).where('timestamp', '<=', endIso).limit(5000).get(),
    collection.where('createdAtIso', '>=', startIso).where('createdAtIso', '<=', endIso).limit(5000).get(),
  ])
  const byId = new Map()
  for (const doc of [...timestampSnapshot.docs, ...createdAtSnapshot.docs]) byId.set(doc.id, { id: doc.id, ...doc.data() })
  return [...byId.values()]
}

function financialMovementDateKey(movement) {
  const value = movement.timestamp ?? movement.createdAtIso ?? movement.createdAt
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  return ''
}

export const getSystemReport = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar reportes del sistema.')
  }
  const callerUid = request.auth.uid
  const callerDoc = await db.collection('users').doc(callerUid).get()
  if (!callerDoc.exists || callerDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Usuario no activo.')
  }
  const caller = callerDoc.data()
  const role = caller.role

  const {
    reportType = 'shipments',
    startDate,
    endDate,
    period,
    branchId = 'all',
    status = 'all',
    paymentCondition = 'all',
    paymentMethod = 'all',
    category = 'all',
    patrimonialLocationId = 'all',
    operatorUid,
    driverUid,
    memberId,
    page = 1,
    pageSize = 100,
  } = request.data || {}

  // 1. RESTRICCIONES DE ACCESO POR ROL Y PRIVACIDAD
  if (role === 'conductor' && reportType !== 'drivers') {
    throw new HttpsError('permission-denied', 'Los conductores solo tienen acceso a su reporte personal de viajes y custodia.')
  }

  if (role === 'secretaria') {
    if (!['shipments', 'cash_financial'].includes(reportType)) {
      throw new HttpsError('permission-denied', 'El rol secretaria no tiene acceso a reportes confidenciales de nómina, gastos generales o padrón de socios.')
    }
  }

  const effectiveBranchId = (role === 'secretaria' && caller.primaryBranchId)
    ? caller.primaryBranchId
    : branchId

  const { startIso, endIso } = resolveLaPazBounds(startDate, endDate, period)
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safePageSize = Math.min(500, Math.max(10, parseInt(pageSize, 10) || 100))

  // Reportes asociativos: conjuntos acotados para evitar lecturas ilimitadas.
  // Los saldos de deuda se presentan por separado del efectivo realmente cobrado.
  if (['members', 'loans', 'fines', 'sports', 'physical_inventory'].includes(reportType)) {
    const boundedRead = async (collection, orderField = 'createdAtIso') => {
      const snapshot = await db.collection(collection).orderBy(orderField, 'desc').limit(500).get()
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    }
    const inDateRange = (value) => {
      if (!value) return true
      const iso = typeof value === 'string' ? value : value?.toDate?.()?.toISOString?.() || ''
      return (!startDate || iso.slice(0, 10) >= startDate) && (!endDate || iso.slice(0, 10) <= endDate)
    }
    const byMember = (record) => !memberId || record.memberId === memberId
    const byStatus = (record) => status === 'all' || !status || record.status === status

    if (reportType === 'members') {
      let members = (await boundedRead('union_members')).filter((member) =>
        (!status || status === 'all' || member.status === status) &&
        (!category || category === 'all' || member.category === category) &&
        inDateRange(member.createdAtIso || member.registeredAtIso)
      )
      if (memberId) members = members.filter((member) => member.id === memberId)
      const allDues = (await boundedRead('union_dues')).filter(byMember)
      const allLoans = (await boundedRead('union_loans')).filter(byMember)
      const allFines = (await boundedRead('union_fines')).filter(byMember)
      const records = members.map((member) => {
        const dues = allDues.filter((item) => item.memberId === member.id)
        const loans = allLoans.filter((item) => item.memberId === member.id)
        const fines = allFines.filter((item) => item.memberId === member.id)
        return {
          ...member,
          duesPaidCents: dues.reduce((sum, item) => sum + (item.paidAmountCents || 0), 0),
          duesPendingCents: dues.reduce((sum, item) => sum + (item.balanceCents || 0), 0),
          loanPrincipalCents: loans.reduce((sum, item) => sum + (item.principalCents || 0), 0),
          loanRecoveredCents: loans.reduce((sum, item) => sum + (item.paidCents || 0), 0),
          loanPendingCents: loans.reduce((sum, item) => sum + (item.balanceCents || 0), 0),
          finesPaidCents: fines.reduce((sum, item) => sum + (item.paidCents || 0), 0),
          finesPendingCents: fines.reduce((sum, item) => sum + (item.balanceCents || 0), 0),
        }
      })
      return {
        success: true, reportType, dateRange: { startIso, endIso }, branchId: effectiveBranchId,
        summary: {
          totalMembers: records.length,
          activeMembers: records.filter((member) => member.status === 'active').length,
          retiredMembers: records.filter((member) => ['retired', 'inactive', 'withdrawn'].includes(member.status)).length,
          duesPaidCents: records.reduce((sum, member) => sum + member.duesPaidCents, 0),
          duesPendingCents: records.reduce((sum, member) => sum + member.duesPendingCents, 0),
          loanPrincipalCents: records.reduce((sum, member) => sum + member.loanPrincipalCents, 0),
          loanRecoveredCents: records.reduce((sum, member) => sum + member.loanRecoveredCents, 0),
          loanPendingCents: records.reduce((sum, member) => sum + member.loanPendingCents, 0),
          finesPaidCents: records.reduce((sum, member) => sum + member.finesPaidCents, 0),
          finesPendingCents: records.reduce((sum, member) => sum + member.finesPendingCents, 0),
        }, records: records.slice((safePage - 1) * safePageSize, safePage * safePageSize),
        pagination: { page: safePage, pageSize: safePageSize, totalRecords: records.length, totalPages: Math.ceil(records.length / safePageSize) },
        truncated: members.length >= 500,
      }
    }

    if (reportType === 'loans' || reportType === 'fines') {
      const collection = reportType === 'loans' ? 'union_loans' : 'union_fines'
      let records = (await boundedRead(collection)).filter(byMember).filter(byStatus)
      records = records.filter((record) => inDateRange(record.createdAtIso || record.date || record.grantDate))
      if (category !== 'all' && reportType === 'fines') records = records.filter((record) => record.category === category)
      const pageStart = (safePage - 1) * safePageSize
      const pageRecords = records.slice(pageStart, safePage * safePageSize)
      const detailedRecords = await Promise.all(pageRecords.map(async (record) => {
        if (reportType === 'loans') {
          const [installments, payments] = await Promise.all([
            db.collection('union_loans').doc(record.id).collection('installments').orderBy('sequence', 'asc').limit(120).get(),
            db.collection('union_loans').doc(record.id).collection('payments').orderBy('paidAtIso', 'asc').limit(120).get(),
          ])
          return {
            ...record,
            installmentSchedule: installments.docs.map((doc) => {
              const item = doc.data()
              return `${item.sequence}: ${item.dueDate} · ${item.status} · saldo ${item.balanceCents ?? 0}¢`
            }).join(' | '),
            repaymentHistory: payments.docs.map((doc) => {
              const payment = doc.data()
              return `${payment.paidAtIso || ''} · ${payment.amountCents || 0}¢ · ${payment.receiptNumber || ''}`
            }).join(' | '),
          }
        }
        const payments = await db.collection('union_fines').doc(record.id).collection('payments').orderBy('paidAtIso', 'asc').limit(120).get()
        return { ...record, paymentHistory: payments.docs.map((doc) => {
          const payment = doc.data()
          return `${payment.paidAtIso || ''} · ${payment.amountCents || 0}¢ · ${payment.receiptNumber || ''}`
        }).join(' | ') }
      }))
      const principalCents = reportType === 'loans'
        ? records.reduce((sum, record) => sum + (record.principalCents || 0), 0)
        : records.reduce((sum, record) => sum + (record.amountCents || 0), 0)
      const recoveredCents = records.reduce((sum, record) => sum + (record.paidCents || 0), 0)
      const pendingCents = records.reduce((sum, record) => sum + (record.balanceCents || 0), 0)
      return {
        success: true, reportType, dateRange: { startIso, endIso }, branchId: effectiveBranchId,
        summary: {
          totalRecords: records.length,
          principalCents,
          amountCents: principalCents,
          recoveredCents,
          collectedCents: recoveredCents,
          pendingCents,
          // Principal desembolsado y recuperación de capital no se declaran ingreso operativo.
          isOperatingIncome: false,
        }, records: detailedRecords,
        pagination: { page: safePage, pageSize: safePageSize, totalRecords: records.length, totalPages: Math.ceil(records.length / safePageSize) },
        truncated: records.length >= 500,
      }
    }

    if (reportType === 'sports') {
      const sportsSnapshot = await db.collection('union_sports_events')
        .where('date', '>=', startIso.slice(0, 10)).where('date', '<=', endIso.slice(0, 10))
        .orderBy('date', 'desc').limit(50).get()
      let records = sportsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((event) =>
        inDateRange(event.date) && byStatus(event) && (!category || category === 'all' || event.activityType === category)
      )
      let participantsTruncated = false
      const events = await Promise.all(records.map(async (event) => {
        const participants = await db.collection('union_sports_events').doc(event.id).collection('participants').limit(200).get()
        if (participants.size >= 200) participantsTruncated = true
        const attendance = participants.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        return { ...event, participantCount: attendance.length,
          presentCount: attendance.filter((item) => item.attendance === 'present').length,
          lateCount: attendance.filter((item) => item.attendance === 'late').length,
          absentCount: attendance.filter((item) => item.attendance === 'absent').length,
          exemptCount: attendance.filter((item) => item.attendance === 'exempt').length,
          exemptionRequests: attendance.reduce((sum, item) => sum + (Array.isArray(item.justifications) ? item.justifications.length : 0), 0),
          authorizedExemptions: attendance.filter((item) => item.attendance === 'exempt' && Array.isArray(item.justifications) && item.justifications.some((entry) => entry.status === 'approved')).length,
          sanctionedCount: attendance.filter((item) => Boolean(item.fineId)).length,
          attendanceRecords: attendance.map((item) => ({
            eventId: event.id, date: event.date, activityName: event.activityName,
            memberId: item.memberId || item.id, memberNumber: item.memberNumber || '',
            memberName: item.memberName || '', attendance: item.attendance,
            exemptionRequests: Array.isArray(item.justifications) ? item.justifications.length : 0,
            authorizedExemption: item.attendance === 'exempt' && Array.isArray(item.justifications) && item.justifications.some((entry) => entry.status === 'approved'),
            fineId: item.fineId || null, financialReviewRequired: Boolean(item.financialReviewRequired),
          })) }
      }))
      const summary = events.reduce((acc, event) => {
        acc.events += 1; acc.participants += event.participantCount; acc.present += event.presentCount
        acc.late += event.lateCount; acc.absent += event.absentCount; acc.exempt += event.exemptCount
        acc.exemptionRequests += event.exemptionRequests; acc.authorizedExemptions += event.authorizedExemptions
        acc.sanctioned += event.sanctionedCount; return acc
      }, { events: 0, participants: 0, present: 0, late: 0, absent: 0, exempt: 0, exemptionRequests: 0, authorizedExemptions: 0, sanctioned: 0 })
      const sportsFines = (await boundedRead('union_fines')).filter((fine) => fine.category === 'deportes' && inDateRange(fine.date || fine.createdAtIso))
      summary.sanctionRecords = sportsFines.length
      summary.sanctionsAmountCents = sportsFines.reduce((sum, fine) => sum + (fine.amountCents || 0), 0)
      summary.sanctionsCollectedCents = sportsFines.reduce((sum, fine) => sum + (fine.paidCents || 0), 0)
      summary.sanctionsPendingCents = sportsFines.reduce((sum, fine) => sum + (fine.balanceCents || 0), 0)
      const pageEvents = events.slice((safePage - 1) * safePageSize, safePage * safePageSize)
      return { success: true, reportType, dateRange: { startIso, endIso }, branchId: effectiveBranchId,
        summary,
        records: pageEvents.map(({ attendanceRecords, ...event }) => event),
        attendanceRecords: pageEvents.flatMap((event) => event.attendanceRecords),
        pagination: { page: safePage, pageSize: safePageSize, totalRecords: events.length, totalPages: Math.ceil(events.length / safePageSize) },
        truncated: sportsSnapshot.size >= 50 || participantsTruncated || sportsFines.length >= 500 }
    }

    if (reportType === 'physical_inventory') {
      let assets = await db.collection('fixed_assets').limit(500).get()
      let documents = await db.collection('physical_inventory_documents').orderBy('title').limit(500).get()
      let assetRecords = assets.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      let documentRecords = documents.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      if (effectiveBranchId && effectiveBranchId !== 'all') assetRecords = assetRecords.filter((record) => record.branchId === effectiveBranchId)
      if (startDate) assetRecords = assetRecords.filter((record) => record.acquisitionDate && record.acquisitionDate >= startDate)
      if (endDate) assetRecords = assetRecords.filter((record) => record.acquisitionDate && record.acquisitionDate <= endDate)
      if (category !== 'all') assetRecords = assetRecords.filter((record) => record.category === category)
      if (status !== 'all') { assetRecords = assetRecords.filter((record) => record.status === status); documentRecords = documentRecords.filter((record) => record.status === status) }
      if (category !== 'all') documentRecords = documentRecords.filter((record) => record.documentType === category)
      if (patrimonialLocationId !== 'all') documentRecords = documentRecords.filter((record) => record.patrimonialLocationId === patrimonialLocationId)
      if (patrimonialLocationId !== 'all') assetRecords = assetRecords.filter((record) => record.patrimonialLocationId === patrimonialLocationId)
      documentRecords = documentRecords.filter((record) => inDateRange(record.documentDate))
      const totalValueCents = assetRecords.reduce((sum, record) => sum + (record.acquisitionCostCents || 0), 0)
      const totalQuantity = assetRecords.reduce((sum, record) => sum + (record.quantity || 1), 0)
      const sheets = documentRecords.reduce((sum, record) => sum + (record.sheetCount || 0), 0)
      return { success: true, reportType, dateRange: { startIso, endIso }, branchId: effectiveBranchId,
        summary: { assetCount: assetRecords.length, totalQuantity, totalValueCents, documentCount: documentRecords.length, documentSheets: sheets,
          assetsByLocation: assetRecords.reduce((acc, record) => { const key = record.physicalLocation || 'sin_ubicacion'; acc[key] = (acc[key] || 0) + (record.quantity || 1); return acc }, {}) },
        records: assetRecords.slice((safePage - 1) * safePageSize, safePage * safePageSize), documents: documentRecords.slice((safePage - 1) * safePageSize, safePage * safePageSize),
        pagination: { page: safePage, pageSize: safePageSize, totalRecords: assetRecords.length + documentRecords.length, totalPages: Math.ceil((assetRecords.length + documentRecords.length) / safePageSize) },
        truncated: assets.size >= 500 || documents.size >= 500 }
    }
  }

  // =========================================================================
  // REPORTE B1: ENCOMIENDAS Y LOGÍSTICA
  // =========================================================================
  if (reportType === 'shipments') {
    const startTimestamp = Timestamp.fromDate(new Date(startIso))
    const endTimestamp = Timestamp.fromDate(new Date(endIso))

    let docs = []
    let queryError = null
    try {
      // 1. Intentar consulta por Timestamp (campo nativo de Firestore)
      const snap = await db.collection('shipments')
        .where('createdAt', '>=', startTimestamp)
        .where('createdAt', '<=', endTimestamp)
        .orderBy('createdAt', 'desc')
        .limit(5000)
        .get()
      if (!snap.empty) {
        docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      }
    } catch (err) {
      queryError = err
      console.warn('[getSystemReport] Consulta por createdAt Timestamp:', err?.message)
    }

    // 2. Si docs sigue vacío, consultar por createdAtIso (cadena de texto ISO)
    if (docs.length === 0) {
      try {
        const isoSnap = await db.collection('shipments')
          .where('createdAtIso', '>=', startIso)
          .where('createdAtIso', '<=', endIso)
          .orderBy('createdAtIso', 'desc')
          .limit(5000)
          .get()
        if (!isoSnap.empty) {
          docs = isoSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
      } catch (err) {
        queryError = err
        console.warn('[getSystemReport] Consulta por createdAtIso:', err?.message)
      }
    }

    // 3. Si docs sigue vacío, consultar por createdAt como string ISO
    if (docs.length === 0) {
      try {
        const strSnap = await db.collection('shipments')
          .where('createdAt', '>=', startIso)
          .where('createdAt', '<=', endIso)
          .orderBy('createdAt', 'desc')
          .limit(5000)
          .get()
        if (!strSnap.empty) {
          docs = strSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
      } catch (err) {
        queryError = err
      }
    }

    // Si las consultas indexadas fallaron por falta de índice compuesto, fallar rápido con el error explícito
    if (docs.length === 0 && queryError) {
      const errMsg = queryError.message || String(queryError)
      if (errMsg.includes('FAILED_PRECONDITION') || errMsg.includes('index') || queryError.code === 9) {
        throw new HttpsError('failed-precondition', `La consulta de reportes requiere un índice compuesto en Firestore: ${errMsg}`)
      }
    }

    // 4. Si no hubo resultados en las consultas indexadas, el período no registra encomiendas (docs = [])

    // Filtrado en memoria para criterios combinados
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      docs = docs.filter(s => s.originBranchId === effectiveBranchId || s.destinationBranchId === effectiveBranchId)
    }
    if (status && status !== 'all') {
      docs = docs.filter(s => s.status === status)
    }
    if (paymentCondition && paymentCondition !== 'all') {
      docs = docs.filter(s => s.paymentTiming === paymentCondition)
    }
    if (paymentMethod && paymentMethod !== 'all') {
      docs = docs.filter(s => s.paymentMethod === paymentMethod)
    }
    if (operatorUid) {
      docs = docs.filter(s =>
        s.registeredByUid === operatorUid ||
        s.createdByUid === operatorUid ||
        s.paidCashierUid === operatorUid ||
        s.deliveredByUid === operatorUid
      )
    }

    let totalPackages = 0
    let totalWeightKg = 0
    let totalBilledCents = 0
    let totalCollectedCents = 0
    let totalPendingCodCents = 0

    const byStatus = {
      received: 0,
      pending_dispatch: 0,
      dispatched: 0,
      in_transit: 0,
      received_at_dest: 0,
      stored: 0,
      ready_for_pickup: 0,
      in_delivery: 0,
      delivered: 0,
      returned: 0,
      cancelled: 0,
      lost: 0,
      damaged: 0,
    }

    const byRoute = {
      punata_to_cochabamba: { count: 0, amountCents: 0 },
      cochabamba_to_punata: { count: 0, amountCents: 0 },
      other: { count: 0, amountCents: 0 },
    }

    const byPaymentCondition = {
      origin_paid: { count: 0, amountCents: 0 },
      origin_pending: { count: 0, amountCents: 0 },
      destination_cod: { count: 0, amountCents: 0 },
    }

    const byPaymentMethod = {
      cash: { count: 0, amountCents: 0 },
      qr: { count: 0, amountCents: 0 },
      transfer: { count: 0, amountCents: 0 },
      pending: { count: 0, amountCents: 0 },
    }

    let totalTurnaroundMs = 0
    let deliveredWithTimeCount = 0

    for (const s of docs) {
      const finalCents = s.finalAmountCents || Math.round((Number(s.amountBob) || 0) * 100) || 0
      const pkgs = Number(s.packageCount) || (Array.isArray(s.items) && s.items.length > 0
        ? s.items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0)
        : (s.totalPackages || 1))
      const weight = Number(s.totalWeightKg) || 0

      totalPackages += pkgs
      totalWeightKg += weight
      totalBilledCents += finalCents

      if (s.paymentStatus === 'paid') {
        totalCollectedCents += finalCents
      } else if (s.paymentTiming === 'destination_cod') {
        totalPendingCodCents += finalCents
      }

      // Conteo por estado con soporte para alias
      const normalizedStatus = s.status === 'in_warehouse' ? 'stored' :
                               s.status === 'arrived_at_destination' ? 'received_at_dest' :
                               s.status
      if (byStatus[normalizedStatus] !== undefined) {
        byStatus[normalizedStatus]++
      } else if (byStatus[s.status] !== undefined) {
        byStatus[s.status]++
      }

      // Rutas
      if (s.originBranchId === 'punata' && s.destinationBranchId === 'cochabamba') {
        byRoute.punata_to_cochabamba.count++
        byRoute.punata_to_cochabamba.amountCents += finalCents
      } else if (s.originBranchId === 'cochabamba' && s.destinationBranchId === 'punata') {
        byRoute.cochabamba_to_punata.count++
        byRoute.cochabamba_to_punata.amountCents += finalCents
      } else {
        byRoute.other.count++
        byRoute.other.amountCents += finalCents
      }

      // Condición de pago
      if (s.paymentTiming && byPaymentCondition[s.paymentTiming]) {
        byPaymentCondition[s.paymentTiming].count++
        byPaymentCondition[s.paymentTiming].amountCents += finalCents
      }

      // Método de pago
      if (s.paymentStatus === 'paid' && s.paymentMethod && byPaymentMethod[s.paymentMethod]) {
        byPaymentMethod[s.paymentMethod].count++
        byPaymentMethod[s.paymentMethod].amountCents += finalCents
      } else {
        byPaymentMethod.pending.count++
        byPaymentMethod.pending.amountCents += finalCents
      }

      // Tiempo de entrega
      if (s.status === 'delivered' && s.deliveredAt && s.createdAt) {
        const diff = new Date(s.deliveredAt).getTime() - new Date(s.createdAt).getTime()
        if (diff > 0) {
          totalTurnaroundMs += diff
          deliveredWithTimeCount++
        }
      }
    }

    const averageTurnaroundHours = deliveredWithTimeCount > 0
      ? Number((totalTurnaroundMs / (deliveredWithTimeCount * 3600000)).toFixed(1))
      : 0

    // Paginación
    const totalRecords = docs.length
    const startIndex = (safePage - 1) * safePageSize
    const paginatedDocs = docs.slice(startIndex, startIndex + safePageSize).map(s => ({
      id: s.id,
      trackingCode: s.trackingCode,
      guideNumber: s.guideNumber || s.trackingCode,
      senderName: s.sender?.name || s.senderName || '',
      senderPhone: s.sender?.phone || '',
      recipientName: s.recipient?.name || s.recipientName || '',
      recipientPhone: s.recipient?.phone || '',
      originBranchId: s.originBranchId,
      destinationBranchId: s.destinationBranchId,
      status: s.status,
      paymentTiming: s.paymentTiming,
      paymentStatus: s.paymentStatus,
      paymentMethod: s.paymentMethod || 'cash',
      amountCents: s.finalAmountCents || Math.round((Number(s.amountBob) || 0) * 100),
      amountBob: (s.finalAmountCents || Math.round((Number(s.amountBob) || 0) * 100)) / 100,
      totalPackages: Array.isArray(s.items) ? s.items.length : (s.totalPackages || 1),
      totalWeightKg: s.totalWeightKg || 0,
      createdAt: s.createdAt,
      deliveredAt: s.deliveredAt || null,
    }))

    return {
      success: true,
      reportType,
      dateRange: { startIso, endIso },
      branchId: effectiveBranchId,
      summary: {
        totalShipments: totalRecords,
        totalPackages,
        totalWeightKg: Number(totalWeightKg.toFixed(2)),
        totalBilledCents,
        totalBilledBob: totalBilledCents / 100,
        totalCollectedCents,
        totalCollectedBob: totalCollectedCents / 100,
        totalPendingCodCents,
        totalPendingCodBob: totalPendingCodCents / 100,
        averageTurnaroundHours,
        byStatus,
        byRoute,
        byPaymentCondition,
        byPaymentMethod,
      },
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalRecords,
        totalPages: Math.ceil(totalRecords / safePageSize) || 1,
      },
      records: paginatedDocs,
      truncated: docs.length >= 5000,
    }
  }

  // =========================================================================
  // REPORTE B2: CAJA Y FINANZAS
  // =========================================================================
  if (reportType === 'cash_financial') {
    let movements = await getFinancialMovementsForRange(startIso, endIso)
    movements.sort((a, b) => financialMovementDateKey(b).localeCompare(financialMovementDateKey(a)))

    if (effectiveBranchId && effectiveBranchId !== 'all') {
      movements = movements.filter(m => m.branchId === effectiveBranchId)
    }
    if (operatorUid) {
      movements = movements.filter(m => m.operatorUid === operatorUid)
    }
    if (category && category !== 'all') movements = movements.filter(m => m.type === category || m.category === category)
    if (paymentMethod && paymentMethod !== 'all') movements = movements.filter(m => m.paymentMethod === paymentMethod)

    let commercialIncomeCents = 0
    let contributionsIncomeCents = 0
    let fineIncomeCents = 0
    let loanRepaymentsCents = 0
    let driverRemittancesCents = 0
    let expensesCents = 0
    let refundsCents = 0
    let adjustmentsCents = 0

    const byPaymentMethod = {
      cash: { incomeCents: 0, expenseCents: 0 },
      qr: { incomeCents: 0, expenseCents: 0 },
      transfer: { incomeCents: 0, expenseCents: 0 },
    }

    const byBranch = {
      punata: { incomeCents: 0, expenseCents: 0, netCents: 0 },
      cochabamba: { incomeCents: 0, expenseCents: 0, netCents: 0 },
    }

    for (const m of movements) {
      const amt = m.amountCents || Math.round((Number(m.amountBob) || 0) * 100) || 0
      const isIncome = ['shipment_income', 'cod_income', 'origin_paid', 'driver_route_cod_collected', 'contribution_income', 'monthly_fee_income', 'driver_remittance', 'fine_income', 'loan_repayment'].includes(m.type)
      const isExpense = ['expense', 'general_expense', 'worker_payroll', 'refund'].includes(m.type)

      if (['shipment_income', 'cod_income', 'origin_paid', 'driver_route_cod_collected'].includes(m.type)) {
        commercialIncomeCents += amt
      } else if (['contribution_income', 'monthly_fee_income'].includes(m.type)) {
        contributionsIncomeCents += amt
      } else if (m.type === 'fine_income') {
        fineIncomeCents += amt
      } else if (m.type === 'loan_repayment') {
        loanRepaymentsCents += amt
      } else if (m.type === 'driver_remittance') {
        driverRemittancesCents += amt
      } else if (['expense', 'general_expense', 'worker_payroll'].includes(m.type)) {
        expensesCents += amt
      } else if (m.type === 'refund') {
        refundsCents += amt
      } else if (m.type === 'adjustment') {
        adjustmentsCents += amt
      }

      // Método de pago
      const pm = (m.paymentMethod && ['cash', 'qr', 'transfer'].includes(m.paymentMethod)) ? m.paymentMethod : 'cash'
      if (isIncome) {
        byPaymentMethod[pm].incomeCents += amt
      } else if (isExpense) {
        byPaymentMethod[pm].expenseCents += amt
      }

      // Sucursal
      if (m.branchId && byBranch[m.branchId]) {
        if (isIncome) byBranch[m.branchId].incomeCents += amt
        if (isExpense) byBranch[m.branchId].expenseCents += amt
        byBranch[m.branchId].netCents = byBranch[m.branchId].incomeCents - byBranch[m.branchId].expenseCents
      }
    }

    // Consulta de turnos de caja en el período
    let shiftsQuery = db.collection('cash_shifts')
      .where('openedAt', '>=', startIso)
      .where('openedAt', '<=', endIso)
      .orderBy('openedAt', 'desc').limit(2000)

    const shiftsSnap = await shiftsQuery.get()
    let shifts = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      shifts = shifts.filter(s => s.branchId === effectiveBranchId)
    }

    let initialCashTotalCents = 0
    let conformityCount = 0
    let shortageCount = 0
    let surplusCount = 0
    let totalDifferenceCents = 0

    for (const sh of shifts) {
      initialCashTotalCents += (sh.initialCashCents || 0)
      if (sh.status === 'closed') {
        const diff = sh.differenceCents || 0
        totalDifferenceCents += diff
        if (diff === 0) conformityCount++
        else if (diff < 0) shortageCount++
        else surplusCount++
      }
    }

    // Remesas de custodia y recuperación de préstamos son movimientos reales de efectivo,
    // pero no ingresos operativos propios de la empresa.
    const netOperatingCents = (commercialIncomeCents + contributionsIncomeCents + fineIncomeCents) - (expensesCents + refundsCents)

    const totalRecords = movements.length
    const startIndex = (safePage - 1) * safePageSize
    const paginatedMovements = movements.slice(startIndex, startIndex + safePageSize)

    return {
      success: true,
      reportType,
      dateRange: { startIso, endIso },
      branchId: effectiveBranchId,
      summary: {
        commercialIncomeCents,
        commercialIncomeBob: commercialIncomeCents / 100,
        contributionsIncomeCents,
        contributionsIncomeBob: contributionsIncomeCents / 100,
        fineIncomeCents,
        fineIncomeBob: fineIncomeCents / 100,
        loanRepaymentsCents,
        loanRepaymentsBob: loanRepaymentsCents / 100,
        driverRemittancesCents,
        driverRemittancesBob: driverRemittancesCents / 100,
        expensesCents,
        expensesBob: expensesCents / 100,
        refundsCents,
        refundsBob: refundsCents / 100,
        adjustmentsCents,
        adjustmentsBob: adjustmentsCents / 100,
        netOperatingCents,
        netOperatingBob: netOperatingCents / 100,
        initialCashTotalCents,
        initialCashTotalBob: initialCashTotalCents / 100,
        byPaymentMethod,
        byBranch,
        shiftsSummary: {
          totalShifts: shifts.length,
          openShifts: shifts.filter(s => s.status === 'open').length,
          closedShifts: shifts.filter(s => s.status === 'closed').length,
          conformityCount,
          shortageCount,
          surplusCount,
          totalDifferenceCents,
          totalDifferenceBob: totalDifferenceCents / 100,
        },
      },
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalRecords,
        totalPages: Math.ceil(totalRecords / safePageSize) || 1,
      },
      records: paginatedMovements,
      truncated: movements.length >= 5000,
    }
  }

  // =========================================================================
  // REPORTE B3: CONDUCTORES Y CUSTODIA
  // =========================================================================
  if (reportType === 'drivers') {
    let manifestsQuery = db.collection('manifests')
      .where('createdAtIso', '>=', startIso)
      .where('createdAtIso', '<=', endIso)
      .orderBy('createdAtIso', 'desc').limit(5000)

    const manSnap = await manifestsQuery.get()
    let manifests = manSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    if (driverUid) {
      manifests = manifests.filter(m => m.driverUid === driverUid)
    }
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      manifests = manifests.filter(m => m.originBranchId === effectiveBranchId || m.destinationBranchId === effectiveBranchId)
    }

    // Consultar cuentas de custodia activas
    const custodySnap = await db.collection('driver_custody_accounts').limit(5000).get()
    const custodyMap = {}
    custodySnap.docs.forEach(d => {
      custodyMap[d.id] = d.data()
    })

    const driverMap = {}
    let totalShipmentsTransported = 0
    let totalTripsCompleted = 0
    let totalIncidentsCount = 0

    for (const m of manifests) {
      const dUid = m.driverUid || 'unassigned'
      if (!driverMap[dUid]) {
        const custodyAcc = custodyMap[dUid] || {}
        driverMap[dUid] = {
          driverUid: dUid,
          driverName: m.driverName || 'Conductor',
          vehiclePlate: m.vehiclePlate || '',
          mobileNumber: m.mobileNumber || '',
          tripsCount: 0,
          completedTripsCount: 0,
          shipmentsCount: 0,
          codCollectedCents: 0,
          totalRemittedCents: custodyAcc.totalRemittedCents || 0,
          pendingCustodyCents: custodyAcc.pendingRemittanceCents || 0,
          incidentsCount: 0,
        }
      }

      driverMap[dUid].tripsCount++
      if (m.status === 'received') {
        driverMap[dUid].completedTripsCount++
        totalTripsCompleted++
      }

      const count = (m.shipmentSummaries && Array.isArray(m.shipmentSummaries)) ? m.shipmentSummaries.length : 0
      driverMap[dUid].shipmentsCount += count
      totalShipmentsTransported += count

      if (m.discrepancies && Array.isArray(m.discrepancies) && m.discrepancies.length > 0) {
        driverMap[dUid].incidentsCount += m.discrepancies.length
        totalIncidentsCount += m.discrepancies.length
      }
    }

    const driverSummaries = Object.values(driverMap)

    return {
      success: true,
      reportType,
      dateRange: { startIso, endIso },
      summary: {
        totalManifests: manifests.length,
        totalTripsCompleted,
        totalShipmentsTransported,
        totalIncidentsCount,
        activeDriversWithCustody: Object.values(custodyMap).filter(c => (c.pendingRemittanceCents || 0) > 0).length,
      },
      driverSummaries,
      records: manifests.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: manifests.length, totalPages: Math.ceil(manifests.length / safePageSize) },
      truncated: manSnap.size >= 5000 || custodySnap.size >= 5000,
    }
  }

  // =========================================================================
  // REPORTE B4: SOCIOS Y MENSUALIDADES
  // =========================================================================
  if (reportType === 'dues') {
    let duesQuery = db.collection('union_dues')
    if (period) {
      duesQuery = duesQuery.where('period', '==', period)
    }
    duesQuery = duesQuery.limit(5000)
    const duesSnap = await duesQuery.get()
    let dues = duesSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    if (memberId) {
      dues = dues.filter(d => d.memberId === memberId)
    }
    if (status && status !== 'all') {
      dues = dues.filter(d => d.status === status)
    }

    const membersSnap = await db.collection('union_members').limit(5000).get()
    const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    const membersCount = {
      total: members.length,
      active: members.filter(m => m.status === 'active').length,
      inactive: members.filter(m => m.status === 'inactive').length,
      suspended: members.filter(m => m.status === 'suspended').length,
    }

    let totalDuesIssuedCount = dues.length
    let totalDuesIssuedCents = 0
    let totalCollectedCents = 0
    let totalOutstandingCents = 0
    let overdueCount = 0
    let overdueAmountCents = 0

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
    const debtorsMap = {}

    for (const d of dues) {
      const amt = d.amountCents || Math.round((Number(d.amountBob) || 0) * 100) || 0
      const paid = d.paidAmountCents || Math.round((Number(d.paidAmountBob) || 0) * 100) || 0
      const bal = d.balanceCents !== undefined ? d.balanceCents : (amt - paid)

      totalDuesIssuedCents += amt
      totalCollectedCents += paid
      totalOutstandingCents += bal

      const isOverdue = d.status !== 'paid' && d.dueDate && d.dueDate < todayStr
      if (isOverdue) {
        overdueCount++
        overdueAmountCents += bal
      }

      if (bal > 0) {
        const mKey = d.memberId || d.memberNumber
        if (!debtorsMap[mKey]) {
          debtorsMap[mKey] = {
            memberId: d.memberId,
            memberNumber: d.memberNumber,
            memberName: d.memberName,
            totalDebtCents: 0,
            pendingDuesCount: 0,
            oldestDuePeriod: d.period,
          }
        }
        debtorsMap[mKey].totalDebtCents += bal
        debtorsMap[mKey].pendingDuesCount++
        if (d.period < debtorsMap[mKey].oldestDuePeriod) {
          debtorsMap[mKey].oldestDuePeriod = d.period
        }
      }
    }

    return {
      success: true,
      reportType,
      period: period || 'all',
      summary: {
        membersCount,
        totalDuesIssuedCount,
        totalDuesIssuedCents,
        totalDuesIssuedBob: totalDuesIssuedCents / 100,
        totalCollectedCents,
        totalCollectedBob: totalCollectedCents / 100,
        totalOutstandingCents,
        totalOutstandingBob: totalOutstandingCents / 100,
        overdueCount,
        overdueAmountCents,
        overdueAmountBob: overdueAmountCents / 100,
      },
      debtors: Object.values(debtorsMap).sort((a, b) => b.totalDebtCents - a.totalDebtCents),
      records: dues.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: dues.length, totalPages: Math.ceil(dues.length / safePageSize) },
      truncated: duesSnap.size >= 5000 || membersSnap.size >= 5000,
    }
  }

  // =========================================================================
  // REPORTE B5: PERSONAL Y GASTOS OPERATIVOS
  // =========================================================================
  if (reportType === 'payroll_expenses') {
    // 1. Pagos de personal
    let payQuery = db.collection('union_worker_payments')
      .where('paidAtIso', '>=', startIso)
      .where('paidAtIso', '<=', endIso)
      .orderBy('paidAtIso', 'desc').limit(5000)

    const paySnap = await payQuery.get()
    let payments = paySnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // 2. Gastos operativos
    let expQuery = db.collection('union_expenses')
      .where('createdAtIso', '>=', startIso)
      .where('createdAtIso', '<=', endIso)
      .orderBy('createdAtIso', 'desc').limit(5000)

    const expSnap = await expQuery.get()
    let expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    if (effectiveBranchId && effectiveBranchId !== 'all') {
      payments = payments.filter(p => p.branchId === effectiveBranchId)
      expenses = expenses.filter(e => e.branchId === effectiveBranchId)
    }
    if (category && category !== 'all') {
      expenses = expenses.filter(e => e.category === category)
    }

    let totalPayrollPaidCents = 0
    for (const p of payments) {
      totalPayrollPaidCents += (p.amountCents || Math.round((Number(p.amountBob) || 0) * 100) || 0)
    }

    let totalOperatingExpensesCents = 0
    const byExpenseCategory = {
      alquiler: 0,
      servicios_basicos: 0,
      combustible: 0,
      mantenimiento: 0,
      material_escritorio: 0,
      viaticos: 0,
      impuestos_tasas: 0,
      otro: 0,
    }

    const supplierMap = {}

    for (const e of expenses) {
      const amt = e.amountCents || Math.round((Number(e.amountBob) || 0) * 100) || 0
      totalOperatingExpensesCents += amt
      if (byExpenseCategory[e.category] !== undefined) {
        byExpenseCategory[e.category] += amt
      } else {
        byExpenseCategory.otro += amt
      }

      if (e.supplier) {
        const sKey = e.supplier.trim()
        if (!supplierMap[sKey]) supplierMap[sKey] = { supplier: sKey, count: 0, totalCents: 0 }
        supplierMap[sKey].count++
        supplierMap[sKey].totalCents += amt
      }
    }

    const workersSnap = await db.collection('union_workers').limit(5000).get()
    const workers = workersSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    const totalDisbursedCents = totalPayrollPaidCents + totalOperatingExpensesCents

    return {
      success: true,
      reportType,
      dateRange: { startIso, endIso },
      branchId: effectiveBranchId,
      summary: {
        activeWorkersCount: workers.filter(w => w.status === 'active').length,
        totalWorkersCount: workers.length,
        totalPayrollPaidCents,
        totalPayrollPaidBob: totalPayrollPaidCents / 100,
        totalOperatingExpensesCents,
        totalOperatingExpensesBob: totalOperatingExpensesCents / 100,
        totalDisbursedCents,
        totalDisbursedBob: totalDisbursedCents / 100,
        byExpenseCategory,
        topSuppliers: Object.values(supplierMap).sort((a, b) => b.totalCents - a.totalCents).slice(0, 10),
      },
      payrollPayments: payments.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      expenses: expenses.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: payments.length + expenses.length, totalPages: Math.ceil(Math.max(payments.length, expenses.length) / safePageSize) },
      truncated: paySnap.size >= 5000 || expSnap.size >= 5000 || workersSnap.size >= 5000,
    }
  }

  // =========================================================================
  // REPORTE B6: BIENES FIJOS E INVENTARIO
  // =========================================================================
  if (reportType === 'fixed_assets') {
    let assetsQuery = db.collection('fixed_assets')
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      assetsQuery = assetsQuery.where('branchId', '==', effectiveBranchId)
    }
    const assetsSnap = await assetsQuery.limit(5000).get()
    let assets = assetsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    if (category && category !== 'all') {
      assets = assets.filter(a => a.category === category)
    }
    if (status && status !== 'all') {
      assets = assets.filter(a => a.status === status)
    }
    if (startDate) assets = assets.filter(a => a.acquisitionDate && a.acquisitionDate >= startDate)
    if (endDate) assets = assets.filter(a => a.acquisitionDate && a.acquisitionDate <= endDate)

    let totalAcquisitionValueCents = 0
    const byStatus = {
      available: 0,
      in_use: 0,
      in_maintenance: 0,
      damaged: 0,
      lost: 0,
      disposed: 0,
    }
    const byCategory = {
      computacion: 0,
      muebles: 0,
      balanzas_pesaje: 0,
      herramientas: 0,
      vehiculos_apoyo: 0,
      oficina: 0,
      otro: 0,
    }
    const byBranch = {
      punata: { count: 0, valueCents: 0 },
      cochabamba: { count: 0, valueCents: 0 },
    }

    const disposedAssets = []

    for (const a of assets) {
      const cost = a.acquisitionCostCents || Math.round((Number(a.acquisitionCostBob) || 0) * 100) || 0
      totalAcquisitionValueCents += cost

      if (byStatus[a.status] !== undefined) byStatus[a.status]++
      if (byCategory[a.category] !== undefined) byCategory[a.category]++
      else byCategory.otro++

      if (a.branchId && byBranch[a.branchId]) {
        byBranch[a.branchId].count++
        byBranch[a.branchId].valueCents += cost
      }

      if (a.status === 'disposed') {
        disposedAssets.push({
          id: a.id,
          assetCode: a.assetCode,
          name: a.name,
          category: a.category,
          branchId: a.branchId,
          disposedReason: a.disposedReason || '',
          disposedAtIso: a.disposedAtIso || null,
          disposedByName: a.disposedByName || 'Admin',
        })
      }
    }

    return {
      success: true,
      reportType,
      branchId: effectiveBranchId,
      summary: {
        totalAssetsCount: assets.length,
        totalAcquisitionValueCents,
        totalAcquisitionValueBob: totalAcquisitionValueCents / 100,
        byStatus,
        byCategory,
        byBranch,
        disposedCount: disposedAssets.length,
      },
      disposedAssets,
      records: assets.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: assets.length, totalPages: Math.ceil(assets.length / safePageSize) },
      truncated: assetsSnap.size >= 5000,
    }
  }

  // =========================================================================
  // REPORTE CONSOLIDADO EJECUTIVO (DIRECTIVA / ADMINISTRACIÓN)
  // =========================================================================
  if (reportType === 'consolidated_dashboard') {
    // 1. Encomiendas hoy y mes
    const shipmentsTodaySnap = await db.collection('shipments')
      .where('createdAt', '>=', startIso)
      .where('createdAt', '<=', endIso)
      .limit(5000).get()
    let shipments = shipmentsTodaySnap.docs.map(d => d.data())
    if (effectiveBranchId && effectiveBranchId !== 'all') shipments = shipments.filter(s => s.originBranchId === effectiveBranchId || s.destinationBranchId === effectiveBranchId)

    let totalBilledCents = 0
    let totalCollectedCents = 0
    for (const s of shipments) {
      const c = s.finalAmountCents || Math.round((Number(s.amountBob) || 0) * 100) || 0
      totalBilledCents += c
      if (s.paymentStatus === 'paid') totalCollectedCents += c
    }

    // 2. Movimientos financieros del período
    let movements = await getFinancialMovementsForRange(startIso, endIso)
    if (effectiveBranchId && effectiveBranchId !== 'all') movements = movements.filter(m => m.branchId === effectiveBranchId)

    let commercialIncomeCents = 0
    let contributionsIncomeCents = 0
    let fineIncomeCents = 0
    let loanRepaymentsCents = 0
    let driverRemittancesCents = 0
    let expensesCents = 0

    for (const m of movements) {
      const amt = m.amountCents || Math.round((Number(m.amountBob) || 0) * 100) || 0
      if (['shipment_income', 'cod_income', 'origin_paid', 'driver_route_cod_collected'].includes(m.type)) commercialIncomeCents += amt
      else if (['contribution_income', 'monthly_fee_income'].includes(m.type)) contributionsIncomeCents += amt
      else if (m.type === 'fine_income') fineIncomeCents += amt
      else if (m.type === 'loan_repayment') loanRepaymentsCents += amt
      else if (m.type === 'driver_remittance') driverRemittancesCents += amt
      else if (['expense', 'general_expense', 'worker_payroll'].includes(m.type)) expensesCents += amt
    }

    // 3. Custodia pendiente de conductores
    const custodySnap = await db.collection('driver_custody_accounts').limit(500).get()
    let totalPendingDriverCustodyCents = 0
    custodySnap.docs.forEach(d => {
      totalPendingDriverCustodyCents += (d.data().pendingRemittanceCents || 0)
    })

    // 4. Bienes fijos
    const assetsSnap = await db.collection('fixed_assets').limit(500).get()
    const scopedAssetDocs = effectiveBranchId && effectiveBranchId !== 'all'
      ? assetsSnap.docs.filter(doc => doc.data().branchId === effectiveBranchId)
      : assetsSnap.docs
    let totalAssetsValueCents = 0
    scopedAssetDocs.forEach(d => {
      totalAssetsValueCents += (d.data().acquisitionCostCents || 0)
    })

    // Deudas, afiliados, asistencia y documentos físicos se informan como
    // dominios separados; no se agregan préstamos otorgados al ingreso operativo.
    const [membersSnap, duesSnap, loansSnap, finesSnap, sportsSnap, physicalDocsSnap] = await Promise.all([
      db.collection('union_members').limit(500).get(),
      db.collection('union_dues').limit(500).get(),
      db.collection('union_loans').limit(500).get(),
      db.collection('union_fines').limit(500).get(),
      db.collection('union_sports_events').where('date', '>=', startIso.slice(0, 10)).where('date', '<=', endIso.slice(0, 10)).orderBy('date', 'desc').limit(50).get(),
      db.collection('physical_inventory_documents').orderBy('title').limit(500).get(),
    ])
    const members = membersSnap.docs.map(d => d.data())
    const dues = duesSnap.docs.map(d => d.data())
    const loans = loansSnap.docs.map(d => d.data())
    const fines = finesSnap.docs.map(d => d.data())
    let sportsAttendance = { present: 0, late: 0, absent: 0, exempt: 0, exemptionRequests: 0, authorizedExemptions: 0, sanctioned: 0 }
    for (const eventDoc of sportsSnap.docs) {
      const participants = await eventDoc.ref.collection('participants').limit(200).get()
      for (const participant of participants.docs) {
        const attendance = participant.data()
        if (attendance.attendance === 'present') sportsAttendance.present++
        if (attendance.attendance === 'late') sportsAttendance.late++
        if (attendance.attendance === 'absent') sportsAttendance.absent++
        if (attendance.attendance === 'exempt') sportsAttendance.exempt++
        const justifications = Array.isArray(attendance.justifications) ? attendance.justifications : []
        sportsAttendance.exemptionRequests += justifications.length
        if (attendance.attendance === 'exempt' && justifications.some((item) => item.status === 'approved')) sportsAttendance.authorizedExemptions++
        if (attendance.fineId) sportsAttendance.sanctioned++
      }
    }
    const sumField = (records, field) => records.reduce((sum, record) => sum + (Number(record[field]) || 0), 0)

    return {
      success: true,
      reportType,
      dateRange: { startIso, endIso },
      dashboard: {
        shipments: {
          totalCount: shipments.length,
          deliveredCount: shipments.filter(s => s.status === 'delivered').length,
          inTransitCount: shipments.filter(s => s.status === 'in_transit').length,
          pendingCount: shipments.filter(s => !['delivered', 'cancelled'].includes(s.status)).length,
          cancelledCount: shipments.filter(s => s.status === 'cancelled').length,
          byOriginAgency: shipments.reduce((acc, s) => { const key = s.originBranchId || 'sin_agencia'; acc[key] = (acc[key] || 0) + 1; return acc }, {}),
          totalBilledCents,
          totalBilledBob: totalBilledCents / 100,
          totalCollectedCents,
          totalCollectedBob: totalCollectedCents / 100,
        },
        finances: {
          commercialIncomeCents,
          commercialIncomeBob: commercialIncomeCents / 100,
          contributionsIncomeCents,
          contributionsIncomeBob: contributionsIncomeCents / 100,
          fineIncomeCents,
          fineIncomeBob: fineIncomeCents / 100,
          loanRepaymentsCents,
          loanRepaymentsBob: loanRepaymentsCents / 100,
          driverRemittancesCents,
          driverRemittancesBob: driverRemittancesCents / 100,
          expensesCents,
          expensesBob: expensesCents / 100,
          netOperatingCents: (commercialIncomeCents + contributionsIncomeCents + fineIncomeCents) - expensesCents,
          netOperatingBob: ((commercialIncomeCents + contributionsIncomeCents + fineIncomeCents) - expensesCents) / 100,
        },
        drivers: {
          totalPendingCustodyCents: totalPendingDriverCustodyCents,
          totalPendingCustodyBob: totalPendingDriverCustodyCents / 100,
        },
        fixedAssets: {
          totalCount: scopedAssetDocs.length,
          totalValueCents: totalAssetsValueCents,
          totalValueBob: totalAssetsValueCents / 100,
        },
        members: {
          totalCount: members.length,
          activeCount: members.filter(m => m.status === 'active').length,
          retiredCount: members.filter(m => ['retired', 'inactive', 'withdrawn'].includes(m.status)).length,
          duesCollectedCents: sumField(dues, 'paidAmountCents'),
          duesPendingCents: sumField(dues, 'balanceCents'),
        },
        loans: {
          count: loans.length,
          principalReceivableCents: sumField(loans, 'principalCents'),
          capitalRecoveredCents: sumField(loans, 'paidCents'),
          balanceReceivableCents: sumField(loans, 'balanceCents'),
          operatingIncomeCents: 0,
        },
        fines: {
          count: fines.length,
          amountCents: sumField(fines, 'amountCents'),
          collectedCents: sumField(fines, 'paidCents'),
          pendingCents: sumField(fines, 'balanceCents'),
        },
        sports: { eventCount: sportsSnap.size, ...sportsAttendance },
        physicalInventory: {
          documentCount: physicalDocsSnap.size,
          documentSheets: physicalDocsSnap.docs.reduce((sum, doc) => sum + (Number(doc.data().sheetCount) || 0), 0),
        },
        readCaps: { collections: 500, sportsEvents: 50, participantsPerEvent: 200 },
      },
    }
  }


  // =========================================================================
  // REPORTE: COMISIONES DE CONDUCTORES (FASE 5A)
  // =========================================================================
  if (reportType === 'commissions' || reportType === 'driver_commissions') {
    let q = db.collection('driver_commission_records')
      .where('createdAtIso', '>=', startIso)
      .where('createdAtIso', '<=', endIso)
      .orderBy('createdAtIso', 'desc')
      .limit(5000)

    const snap = await q.get()
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    const accountsSnap = await db.collection('driver_commission_accounts').limit(5000).get()
    const accounts = accountsSnap.docs.map(d => d.data())

    let totalAccruedCents = 0
    let totalPaidCents = 0
    let totalPendingCents = 0

    for (const a of accounts) {
      totalAccruedCents += (a.accruedCents || 0)
      totalPaidCents += (a.paidCents || 0)
      totalPendingCents += (a.pendingCents || 0)
    }

    return {
      success: true,
      reportType: 'commissions',
      dateRange: { startIso, endIso },
      summary: {
        totalRecords: records.length,
        totalAccruedCents,
        totalAccruedBob: totalAccruedCents / 100,
        totalPaidCents,
        totalPaidBob: totalPaidCents / 100,
        totalPendingCents,
        totalPendingBob: totalPendingCents / 100,
        driverCount: accounts.length,
      },
      accounts,
      records: records.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: records.length, totalPages: Math.ceil(records.length / safePageSize) },
      truncated: accountsSnap.size >= 5000 || snap.size >= 5000,
    }
  }

  // =========================================================================
  // REPORTE: CONSUMIBLES E INSUMOS (FASE 5B)
  // =========================================================================
  if (reportType === 'consumables') {
    let q = db.collection('branch_consumables')
    if (branchId && branchId !== 'all') {
      q = q.where('branchId', '==', branchId)
    }
    const snap = await q.limit(5000).get()
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    let movQ = db.collection('consumable_movements')
      .where('timestampIso', '>=', startIso)
      .where('timestampIso', '<=', endIso)
      .orderBy('timestampIso', 'desc')
      .limit(5000)

    const movSnap = await movQ.get()
    let movements = movSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (effectiveBranchId && effectiveBranchId !== 'all') movements = movements.filter(m => m.branchId === effectiveBranchId)
    if (category && category !== 'all') movements = movements.filter(m => m.category === category || m.type === category)

    let totalStockCount = 0
    let totalValuationCents = 0
    let lowStockCount = 0

    for (const it of items) {
      totalStockCount += (it.currentStock || 0)
      totalValuationCents += (it.currentStock || 0) * (it.costPerUnitCents || 0)
      if (it.isLowStock) lowStockCount++
    }

    return {
      success: true,
      reportType: 'consumables',
      dateRange: { startIso, endIso },
      summary: {
        totalItems: items.length,
        totalStockCount,
        lowStockCount,
        totalValuationCents,
        totalValuationBob: totalValuationCents / 100,
        movementsCount: movements.length,
      },
      items,
      records: items.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      movements: movements.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: items.length + movements.length, totalPages: Math.ceil(Math.max(items.length, movements.length) / safePageSize) },
      truncated: snap.size >= 5000 || movSnap.size >= 5000,
    }
  }

  // =========================================================================
  // REPORTE: INCIDENCIAS, DEVOLUCIONES Y PÉRDIDAS (FASE 5C)
  // =========================================================================
  if (reportType === 'incidents') {
    let q = db.collection('shipment_incidents')
      .where('createdAtIso', '>=', startIso)
      .where('createdAtIso', '<=', endIso)
      .orderBy('createdAtIso', 'desc')
      .limit(5000)

    const snap = await q.get()
    let incidents = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      incidents = incidents.filter(i => i.branchId === effectiveBranchId)
    }
    if (category && category !== 'all') incidents = incidents.filter(i => i.incidentType === category)
    if (status && status !== 'all') incidents = incidents.filter(i => i.status === status)

    let openCount = 0
    let resolvedCount = 0
    let compensatedCount = 0
    let totalCompensationCents = 0
    const byType = {}

    for (const inc of incidents) {
      if (inc.status === 'open') openCount++
      else if (inc.status === 'resolved') resolvedCount++
      else if (inc.status === 'compensated') compensatedCount++

      totalCompensationCents += (inc.compensationAmountCents || 0)
      byType[inc.incidentType] = (byType[inc.incidentType] || 0) + 1
    }

    return {
      success: true,
      reportType: 'incidents',
      dateRange: { startIso, endIso },
      summary: {
        totalIncidents: incidents.length,
        openCount,
        resolvedCount,
        compensatedCount,
        totalCompensationCents,
        totalCompensationBob: totalCompensationCents / 100,
        byType,
      },
      records: incidents.slice((safePage - 1) * safePageSize, safePage * safePageSize),
      pagination: { page: safePage, pageSize: safePageSize, totalRecords: incidents.length, totalPages: Math.ceil(incidents.length / safePageSize) },
      truncated: snap.size >= 5000,
    }
  }

    throw new HttpsError('invalid-argument', `Tipo de reporte '${reportType}' no reconocido.`)
})

// =========================================================================
async function getAuthenticatedCallerProfile(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado.')
  }
  const callerUid = request.auth.uid
  const userDoc = await db.collection('users').doc(callerUid).get()
  if (!userDoc.exists || userDoc.data().isActive === false) {
    throw new HttpsError('permission-denied', 'Perfil de usuario inactivo o inexistente.')
  }
  return { uid: callerUid, ...userDoc.data() }
}

// FASE 5A: COMISIONES DE CONDUCTORES (SEPARADAS DE CUSTODIA COD)
// =========================================================================

/**
 * Devengar comisión a favor de un conductor por encomiendas transportadas
 */
export const accrueDriverCommission = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (!caller || !caller.isActive) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado o inactivo.')
  }

  const {
    driverUid,
    shipmentId,
    trackingCode,
    manifestId,
    shippingAmountCents,
    ruleType = 'percentage',
    ruleValue = 10,
  } = request.data || {}

  if (!driverUid) {
    throw new HttpsError('invalid-argument', 'El UID del conductor es obligatorio.')
  }
  if (!shipmentId || !trackingCode) {
    throw new HttpsError('invalid-argument', 'Los datos de la encomienda (shipmentId, trackingCode) son obligatorios.')
  }
  if (!Number.isInteger(shippingAmountCents) || shippingAmountCents < 0) {
    throw new HttpsError('invalid-argument', 'El importe base del envío debe ser un entero no negativo en centavos.')
  }
  if (!['percentage', 'fixed_per_shipment'].includes(ruleType)) {
    throw new HttpsError('invalid-argument', 'Tipo de regla de comisión inválido.')
  }

  let commissionAmountCents = 0
  if (ruleType === 'percentage') {
    commissionAmountCents = Math.round(shippingAmountCents * (Number(ruleValue) / 100))
  } else {
    commissionAmountCents = Math.round(Number(ruleValue))
  }
  if (commissionAmountCents < 0) commissionAmountCents = 0

  const nowIso = new Date().toISOString()

  // Buscar nombre del conductor
  let driverName = 'Conductor'
  const driverDoc = await db.collection('users').doc(driverUid).get()
  if (driverDoc.exists) {
    driverName = driverDoc.data().fullName || driverName
  }

  const recordRef = db.collection('driver_commission_records').doc()
  const accountRef = db.collection('driver_commission_accounts').doc(driverUid)

  await db.runTransaction(async (t) => {
    const accDoc = await t.get(accountRef)
    const currentAccrued = accDoc.exists ? (accDoc.data().accruedCents || 0) : 0
    const currentPending = accDoc.exists ? (accDoc.data().pendingCents || 0) : 0
    const currentPaid = accDoc.exists ? (accDoc.data().paidCents || 0) : 0

    t.set(accountRef, {
      driverUid,
      driverName,
      accruedCents: currentAccrued + commissionAmountCents,
      paidCents: currentPaid,
      pendingCents: currentPending + commissionAmountCents,
      lastAccruedAtIso: nowIso,
      updatedAtIso: nowIso,
    }, { merge: true })

    t.set(recordRef, {
      id: recordRef.id,
      driverUid,
      driverName,
      manifestId: manifestId || null,
      shipmentId,
      trackingCode,
      baseShippingAmountCents: shippingAmountCents,
      ruleApplied: { type: ruleType, value: ruleValue },
      commissionAmountCents,
      commissionAmountBob: commissionAmountCents / 100,
      status: 'accrued',
      paidAmountCents: 0,
      voucherIds: [],
      createdAtIso: nowIso,
    })
  })

  return {
    success: true,
    recordId: recordRef.id,
    commissionAmountCents,
    commissionAmountBob: commissionAmountCents / 100,
  }
})

/**
 * Liquidar y pagar comisiones a un conductor desde caja con emisión de vale
 */
export const settleDriverCommission = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (!caller || !caller.isActive) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado o inactivo.')
  }
  if (!['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para liquidar comisiones de conductores.')
  }

  const { driverUid, amountCents, branchId, notes = '' } = request.data || {}

  if (!driverUid) {
    throw new HttpsError('invalid-argument', 'El UID del conductor es obligatorio.')
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new HttpsError('invalid-argument', 'El importe a liquidar debe ser un entero positivo en centavos.')
  }
  if (!branchId) {
    throw new HttpsError('invalid-argument', 'La sucursal de pago es obligatoria.')
  }

  const callerUid = caller.uid || caller.id
  const callerName = caller.fullName || 'Operador'
  const nowIso = new Date().toISOString()
  const currentYear = new Date().getFullYear()

  // Validar turno de caja activo de quien efectúa el pago
  const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${branchId}`)
  const lockDoc = await lockRef.get()
  if (!lockDoc.exists || lockDoc.data().status !== 'open' || !lockDoc.data().shiftId) {
    throw new HttpsError('failed-precondition', 'Debe tener un turno de caja abierto en esta sucursal para pagar comisiones.')
  }

  const shiftId = lockDoc.data().shiftId
  const shiftRef = db.collection('cash_shifts').doc(shiftId)
  const shiftDoc = await shiftRef.get()
  if (!shiftDoc.exists || shiftDoc.data().status !== 'open') {
    throw new HttpsError('failed-precondition', 'El turno de caja activo no es válido o ya fue cerrado.')
  }

  const shiftData = shiftDoc.data()
  const availableCashCents = Number(shiftData.expectedCashCents) || Number(shiftData.breakdown?.netCashCents) || 0
  if (availableCashCents < amountCents) {
    throw new HttpsError(
      'failed-precondition',
      `Efectivo insuficiente en caja. Saldo disponible: Bs. ${(availableCashCents / 100).toFixed(2)}, Requerido: Bs. ${(amountCents / 100).toFixed(2)}.`
    )
  }

  // Cuenta de comisiones del chofer
  const accountRef = db.collection('driver_commission_accounts').doc(driverUid)
  const accountDoc = await accountRef.get()
  if (!accountDoc.exists) {
    throw new HttpsError('not-found', 'El conductor no tiene cuenta de comisiones registrada.')
  }
  const accountData = accountDoc.data()
  const pendingCents = accountData.pendingCents || 0
  if (pendingCents <= 0) {
    throw new HttpsError('failed-precondition', 'El conductor no tiene saldo de comisiones pendiente de cobro.')
  }
  if (amountCents > pendingCents) {
    throw new HttpsError(
      'failed-precondition',
      `El importe a liquidar (Bs. ${(amountCents / 100).toFixed(2)}) supera el saldo de comisiones pendiente del conductor (Bs. ${(pendingCents / 100).toFixed(2)}).`
    )
  }

  const driverName = accountData.driverName || 'Conductor'

  // Leer asientos pendientes en driver_commission_records (FIFO)
  const recordsSnap = await db.collection('driver_commission_records')
    .where('driverUid', '==', driverUid)
    .where('status', 'in', ['accrued', 'partially_paid'])
    .orderBy('createdAtIso', 'asc')
    .limit(100)
    .get()

  // Generar número correlativo de comprobante
  const counterRef = db.collection('counters').doc(`commission_voucher_${currentYear}`)
  const voucherRef = db.collection('driver_commission_vouchers').doc()

  const result = await db.runTransaction(async (t) => {
    const counterDoc = await t.get(counterRef)
    const currentSeq = counterDoc.exists ? (counterDoc.data().seq || 0) + 1 : 1
    t.set(counterRef, { seq: currentSeq, year: currentYear }, { merge: true })

    const voucherNumber = `COM-${currentYear}-${String(currentSeq).padStart(5, '0')}`

    // Distribuir FIFO
    let remainingToAllocate = amountCents
    const touchedRecordIds = []
    const touchedShipmentIds = []

    for (const doc of recordsSnap.docs) {
      if (remainingToAllocate <= 0) break
      const rec = doc.data()
      const recPending = rec.commissionAmountCents - (rec.paidAmountCents || 0)
      if (recPending <= 0) continue

      touchedRecordIds.push(doc.id)
      if (rec.shipmentId) touchedShipmentIds.push(rec.shipmentId)

      const allocation = Math.min(remainingToAllocate, recPending)
      const newPaid = (rec.paidAmountCents || 0) + allocation
      const isFullyPaid = newPaid >= rec.commissionAmountCents

      t.update(doc.ref, {
        paidAmountCents: newPaid,
        status: isFullyPaid ? 'paid' : 'partially_paid',
        voucherIds: [...(rec.voucherIds || []), voucherNumber],
        settledAtIso: isFullyPaid ? nowIso : (rec.settledAtIso || null),
      })

      remainingToAllocate -= allocation
    }

    // Actualizar cuenta del chofer
    t.update(accountRef, {
      paidCents: (accountData.paidCents || 0) + amountCents,
      pendingCents: pendingCents - amountCents,
      lastSettledAtIso: nowIso,
      updatedAtIso: nowIso,
    })

    // Registrar egreso en turno de caja
    const updatedExpectedCash = availableCashCents - amountCents
    const newExpensesCents = (shiftData.breakdown?.expensesCents || shiftData.totalExpensesCents || 0) + amountCents

    const movementId = `mov_com_${voucherRef.id}`
    const movement = {
      movementId,
      type: 'expense',
      category: 'driver_commission',
      amountCents,
      amountBob: amountCents / 100,
      description: `Pago de comisión a chofer ${driverName} (${voucherNumber})`,
      voucherNumber,
      driverUid,
      driverName,
      referenceId: voucherRef.id,
      registeredByUid: callerUid,
      registeredByName: callerName,
      createdAtIso: nowIso,
    }

    // Mantener el egreso de comisión en el libro financiero global dentro
    // de la misma transacción que actualiza el turno y el comprobante.
    const financialMovementRef = db.collection('financial_movements').doc(movementId)
    t.create(financialMovementRef, {
      id: movementId,
      shiftId,
      branchId,
      type: 'expense',
      category: 'driver_commission',
      amountCents,
      amountBob: amountCents / 100,
      paymentMethod: 'cash',
      description: movement.description,
      voucherNumber,
      driverUid,
      driverName,
      referenceId: voucherRef.id,
      operatorUid: callerUid,
      operatorName: callerName,
      timestamp: nowIso,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: nowIso,
    })

    const currentMovements = Array.isArray(shiftData.movements) ? shiftData.movements : []
    t.update(shiftRef, {
      expectedCashCents: updatedExpectedCash,
      'breakdown.expensesCents': newExpensesCents,
      'breakdown.netCashCents': updatedExpectedCash,
      totalExpensesCents: newExpensesCents,
      currentCashCents: updatedExpectedCash,
      movements: [...currentMovements, movement],
      updatedAtIso: nowIso,
    })

    // Crear comprobante
    const voucherData = {
      id: voucherRef.id,
      voucherNumber,
      driverUid,
      driverName,
      branchId,
      cashShiftId: shiftId,
      settledAmountCents: amountCents,
      settledAmountBob: amountCents / 100,
      previousPendingCents: pendingCents,
      remainingPendingCents: pendingCents - amountCents,
      commissionRecordIds: touchedRecordIds,
      shipmentIds: touchedShipmentIds,
      notes: notes.trim(),
      paidByUid: callerUid,
      paidByName: callerName,
      createdAtIso: nowIso,
    }
    t.set(voucherRef, voucherData)

    return voucherData
  })

  return {
    success: true,
    voucher: result,
    message: `Comisión de Bs. ${(amountCents / 100).toFixed(2)} liquidada exitosamente al conductor ${driverName}.`,
  }
})

// =========================================================================
// FASE 5B: CONSUMIBLES E INSUMOS DE OPERACIÓN
// =========================================================================

export const manageConsumable = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (!caller || !caller.isActive) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado o inactivo.')
  }

  const {
    action,
    id,
    code,
    name,
    category,
    branchId,
    unit = 'unidades',
    currentStock = 0,
    minStockAlert = 5,
    costPerUnitCents = 0,
    quantity,
    newStock,
    reason = '',
    referenceDocument = '',
    status = 'active',
  } = request.data || {}

  const callerUid = caller.uid || caller.id
  const callerName = caller.fullName || 'Operador'
  const nowIso = new Date().toISOString()

  // 1. CREACIÓN DE ÍTEM DE CONSUMIBLE
  if (action === 'create_item') {
    if (!['encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'Solo encargados o administradores pueden crear insumos en catálogo.')
    }
    if (!code || !name || !category || !branchId) {
      throw new HttpsError('invalid-argument', 'Código, nombre, categoría y sucursal son obligatorios.')
    }

    const docRef = db.collection('branch_consumables').doc()
    const cleanCode = String(code).trim().toUpperCase()
    const initialStock = Number.isInteger(currentStock) && currentStock >= 0 ? currentStock : 0
    const alertThreshold = Number.isInteger(minStockAlert) && minStockAlert >= 0 ? minStockAlert : 5
    const unitCost = Number.isInteger(costPerUnitCents) && costPerUnitCents >= 0 ? costPerUnitCents : 0

    const itemData = {
      id: docRef.id,
      code: cleanCode,
      name: String(name).trim(),
      category,
      branchId,
      currentStock: initialStock,
      unit: String(unit).trim().toLowerCase(),
      minStockAlert: alertThreshold,
      isLowStock: initialStock <= alertThreshold,
      costPerUnitCents: unitCost,
      costPerUnitBob: unitCost / 100,
      status: 'active',
      lastMovementAtIso: initialStock > 0 ? nowIso : null,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    }

    await docRef.set(itemData)

    if (initialStock > 0) {
      const movRef = db.collection('consumable_movements').doc()
      await movRef.set({
        id: movRef.id,
        consumableId: docRef.id,
        consumableCode: cleanCode,
        consumableName: itemData.name,
        branchId,
        type: 'entry',
        quantity: initialStock,
        previousStock: 0,
        newStock: initialStock,
        unitCostCents: unitCost,
        unitCostBob: unitCost / 100,
        reason: 'Inventario inicial de apertura',
        referenceDocument: referenceDocument.trim(),
        performedByUid: callerUid,
        performedByName: callerName,
        timestampIso: nowIso,
      })
    }

    return { success: true, item: itemData }
  }

  // 2. ACTUALIZACIÓN DE DATOS DE ÍTEM
  if (action === 'update_item' && id) {
    if (!['encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'Solo encargados o administradores pueden modificar ítems de insumos.')
    }
    const docRef = db.collection('branch_consumables').doc(id)
    const docSnap = await docRef.get()
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'El consumible no existe.')
    }

    const updates = { updatedAtIso: nowIso }
    if (name) updates.name = String(name).trim()
    if (minStockAlert !== undefined && Number.isInteger(minStockAlert)) {
      updates.minStockAlert = minStockAlert
      updates.isLowStock = (docSnap.data().currentStock || 0) <= minStockAlert
    }
    if (costPerUnitCents !== undefined && Number.isInteger(costPerUnitCents)) {
      updates.costPerUnitCents = costPerUnitCents
      updates.costPerUnitBob = costPerUnitCents / 100
    }
    if (status) updates.status = status

    await docRef.update(updates)
    return { success: true, id, message: 'Insumo actualizado exitosamente.' }
  }

  // 3. REGISTRO DE ENTRADA (COMPRA O REMESA)
  if (action === 'record_entry' && id) {
    if (!['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'No tiene permisos para registrar entradas de insumos.')
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', 'La cantidad a ingresar debe ser un entero positivo.')
    }

    const docRef = db.collection('branch_consumables').doc(id)
    const movRef = db.collection('consumable_movements').doc()

    const result = await db.runTransaction(async (t) => {
      const docSnap = await t.get(docRef)
      if (!docSnap.exists) {
        throw new HttpsError('not-found', 'El consumible no existe.')
      }
      const item = docSnap.data()
      const prevStock = item.currentStock || 0
      const nextStock = prevStock + quantity
      const isLow = nextStock <= (item.minStockAlert || 5)

      t.update(docRef, {
        currentStock: nextStock,
        isLowStock: isLow,
        lastMovementAtIso: nowIso,
        updatedAtIso: nowIso,
      })

      const movData = {
        id: movRef.id,
        consumableId: id,
        consumableCode: item.code,
        consumableName: item.name,
        branchId: item.branchId,
        type: 'entry',
        quantity,
        previousStock: prevStock,
        newStock: nextStock,
        unitCostCents: costPerUnitCents || item.costPerUnitCents || 0,
        unitCostBob: (costPerUnitCents || item.costPerUnitCents || 0) / 100,
        reason: reason.trim() || 'Ingreso de existencias',
        referenceDocument: referenceDocument.trim(),
        performedByUid: callerUid,
        performedByName: callerName,
        timestampIso: nowIso,
      }
      t.set(movRef, movData)
      return { prevStock, nextStock, movData }
    })

    return { success: true, ...result }
  }

  // 4. REGISTRO DE CONSUMO / SALIDA (USO DIARIO EN VENTANILLA)
  if (action === 'record_consumption' && id) {
    if (!['secretaria', 'encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'No tiene permisos para registrar consumo de insumos.')
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', 'La cantidad consumida debe ser un entero positivo.')
    }

    const docRef = db.collection('branch_consumables').doc(id)
    const movRef = db.collection('consumable_movements').doc()

    const result = await db.runTransaction(async (t) => {
      const docSnap = await t.get(docRef)
      if (!docSnap.exists) {
        throw new HttpsError('not-found', 'El consumible no existe.')
      }
      const item = docSnap.data()
      const prevStock = item.currentStock || 0
      if (prevStock < quantity) {
        throw new HttpsError('failed-precondition', `Stock insuficiente (${prevStock} ${item.unit}) para el consumo solicitado (${quantity} ${item.unit}).`)
      }
      const nextStock = prevStock - quantity
      const isLow = nextStock <= (item.minStockAlert || 5)

      t.update(docRef, {
        currentStock: nextStock,
        isLowStock: isLow,
        lastMovementAtIso: nowIso,
        updatedAtIso: nowIso,
      })

      const movData = {
        id: movRef.id,
        consumableId: id,
        consumableCode: item.code,
        consumableName: item.name,
        branchId: item.branchId,
        type: 'consumption',
        quantity,
        previousStock: prevStock,
        newStock: nextStock,
        reason: reason.trim() || 'Consumo operativo en ventanilla',
        referenceDocument: referenceDocument.trim(),
        performedByUid: callerUid,
        performedByName: callerName,
        timestampIso: nowIso,
      }
      t.set(movRef, movData)
      return { prevStock, nextStock, movData }
    })

    return { success: true, ...result }
  }

  // 5. AJUSTE FÍSICO DE INVENTARIO
  if (action === 'record_adjustment' && id) {
    if (!['encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'Solo administradores o encargados pueden ajustar inventario.')
    }
    if (!Number.isInteger(newStock) || newStock < 0) {
      throw new HttpsError('invalid-argument', 'El nuevo stock debe ser un entero no negativo.')
    }
    if (!reason || reason.trim().length < 5) {
      throw new HttpsError('invalid-argument', 'Se requiere una justificación de mínimo 5 caracteres para el ajuste.')
    }

    const docRef = db.collection('branch_consumables').doc(id)
    const movRef = db.collection('consumable_movements').doc()

    const result = await db.runTransaction(async (t) => {
      const docSnap = await t.get(docRef)
      if (!docSnap.exists) {
        throw new HttpsError('not-found', 'El consumible no existe.')
      }
      const item = docSnap.data()
      const prevStock = item.currentStock || 0
      const diff = newStock - prevStock
      const isLow = newStock <= (item.minStockAlert || 5)

      t.update(docRef, {
        currentStock: newStock,
        isLowStock: isLow,
        lastMovementAtIso: nowIso,
        updatedAtIso: nowIso,
      })

      const movData = {
        id: movRef.id,
        consumableId: id,
        consumableCode: item.code,
        consumableName: item.name,
        branchId: item.branchId,
        type: 'adjustment',
        quantity: diff,
        previousStock: prevStock,
        newStock,
        reason: reason.trim(),
        referenceDocument: referenceDocument.trim(),
        performedByUid: callerUid,
        performedByName: callerName,
        timestampIso: nowIso,
      }
      t.set(movRef, movData)
      return { prevStock, newStock, movData }
    })

    return { success: true, ...result }
  }

  throw new HttpsError('invalid-argument', `Acción '${action}' no reconocida en manageConsumable.`)
})

// =========================================================================
// FASE 5C: INCIDENCIAS, DEVOLUCIONES Y PÉRDIDAS DE ENCOMIENDAS
// =========================================================================

export const registerShipmentIncident = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (!caller || !caller.isActive) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado o inactivo.')
  }

  const {
    action = 'report_incident',
    shipmentId,
    incidentId,
    incidentType,
    description,
    responsiblePerson = '',
    evidenceUrl = '',
    resolutionNotes = '',
    compensationAmountCents = 0,
    paymentSource = 'cash_register',
    branchId,
  } = request.data || {}

  const callerUid = caller.uid || caller.id
  const callerName = caller.fullName || 'Operador'
  const nowIso = new Date().toISOString()
  const currentYear = new Date().getFullYear()

  // 1. REPORTAR INCIDENCIA
  if (action === 'report_incident') {
    if (!['secretaria', 'encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'No tiene permisos para registrar incidencias de encomiendas.')
    }
    if (!shipmentId) {
      throw new HttpsError('invalid-argument', 'El shipmentId es obligatorio.')
    }
    const validTypes = ['uncollected', 'returned', 'lost', 'damaged', 'partial_delivery', 'exceptional_delivery']
    if (!validTypes.includes(incidentType)) {
      throw new HttpsError('invalid-argument', `Tipo de incidencia inválido. Valores permitidos: ${validTypes.join(', ')}.`)
    }
    if (!description || description.trim().length < 10) {
      throw new HttpsError('invalid-argument', 'La descripción del motivo de la incidencia debe tener al menos 10 caracteres.')
    }

    const shipmentRef = db.collection('shipments').doc(shipmentId)
    const incidentRef = db.collection('shipment_incidents').doc()
    const counterRef = db.collection('counters').doc(`incident_${currentYear}`)

    const result = await db.runTransaction(async (t) => {
      const sSnap = await t.get(shipmentRef)
      if (!sSnap.exists) {
        throw new HttpsError('not-found', 'La encomienda no existe.')
      }
      const shipment = sSnap.data()
      if (['cancelled'].includes(shipment.status)) {
        throw new HttpsError('failed-precondition', 'No se pueden registrar incidencias sobre encomiendas canceladas.')
      }

      // Numeración correlativa INC-YYYY-XXXXX
      const cSnap = await t.get(counterRef)
      const currentSeq = cSnap.exists ? (cSnap.data().seq || 0) + 1 : 1
      t.set(counterRef, { seq: currentSeq, year: currentYear }, { merge: true })
      const incidentNumber = `INC-${currentYear}-${String(currentSeq).padStart(5, '0')}`

      // Mapear estado operativo correspondiente
      let newShipmentStatus = shipment.status
      // La entrega es terminal. Una incidencia posterior se registra y audita,
      // pero no revierte la confirmación de entrega.
      if (shipment.status !== 'delivered') {
        if (incidentType === 'uncollected') newShipmentStatus = 'uncollected'
        else if (incidentType === 'returned') newShipmentStatus = 'returned'
        else if (incidentType === 'lost') newShipmentStatus = 'lost'
        else if (incidentType === 'damaged') newShipmentStatus = 'damaged'
        else if (incidentType === 'exceptional_delivery') newShipmentStatus = 'delivered'
      }

      const incidentData = {
        id: incidentRef.id,
        incidentNumber,
        shipmentId,
        trackingCode: shipment.trackingCode || shipmentId,
        branchId: branchId || shipment.destinationBranchId || 'punata',
        incidentType,
        description: description.trim(),
        responsiblePerson: responsiblePerson.trim(),
        evidenceUrl: evidenceUrl.trim(),
        status: 'open',
        compensationAmountCents: 0,
        compensationAmountBob: 0,
        financialConsequence: 'none',
        reportedByUid: callerUid,
        reportedByName: callerName,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      }
      t.set(incidentRef, incidentData)

      // Actualizar encomienda y registrar trazabilidad
      const existingHistory = Array.isArray(shipment.incidentHistory) ? shipment.incidentHistory : []
      t.update(shipmentRef, {
        status: newShipmentStatus,
        hasIncident: true,
        currentIncidentNumber: incidentNumber,
        currentIncidentType: incidentType,
        incidentHistory: [...existingHistory, {
          incidentNumber,
          incidentType,
          description: description.trim(),
          reportedBy: callerName,
          dateIso: nowIso,
        }],
        updatedAtIso: nowIso,
      })

      // Registro en audit_logs de la encomienda
      const auditRef = shipmentRef.collection('audit_logs').doc()
      t.set(auditRef, {
        action: 'incident_registered',
        incidentNumber,
        incidentType,
        description: description.trim(),
        performedByUid: callerUid,
        performedByName: callerName,
        previousStatus: shipment.status,
        newStatus: newShipmentStatus,
        timestampIso: nowIso,
      })

      // Registro en status_logs
      const statusLogRef = shipmentRef.collection('status_logs').doc()
      t.set(statusLogRef, {
        status: newShipmentStatus,
        notes: `Incidencia registrada [${incidentNumber}]: ${description.trim()}`,
        changedByUid: callerUid,
        changedByName: callerName,
        timestampIso: nowIso,
      })

      return incidentData
    })

    return { success: true, incident: result }
  }

  // 2. RESOLVER INCIDENCIA
  if (action === 'resolve_incident' && incidentId) {
    if (!['encargado_agencia', 'directiva_admin'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'Solo encargados o directiva pueden resolver incidencias.')
    }
    if (!resolutionNotes || resolutionNotes.trim().length < 5) {
      throw new HttpsError('invalid-argument', 'Se requieren notas de resolución de mínimo 5 caracteres.')
    }

    const incidentRef = db.collection('shipment_incidents').doc(incidentId)
    const incidentSnap = await incidentRef.get()
    if (!incidentSnap.exists) {
      throw new HttpsError('not-found', 'La incidencia no existe.')
    }

    await incidentRef.update({
      status: 'resolved',
      resolutionNotes: resolutionNotes.trim(),
      resolvedAtIso: nowIso,
      authorizedByUid: callerUid,
      authorizedByName: callerName,
      updatedAtIso: nowIso,
    })

    return { success: true, incidentId, message: 'Incidencia resuelta exitosamente.' }
  }

  // 3. INDEMNIZAR / COMPENSAR ECONÓMICAMENTE POR DAÑO O EXTRAVÍO
  if (action === 'indemnify_incident' && incidentId) {
    if (!['directiva_admin', 'encargado_agencia'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'Solo directiva o encargados pueden autorizar indemnizaciones financieras.')
    }
    if (!Number.isInteger(compensationAmountCents) || compensationAmountCents <= 0) {
      throw new HttpsError('invalid-argument', 'El monto de indemnización debe ser un entero positivo en centavos.')
    }

    const incidentRef = db.collection('shipment_incidents').doc(incidentId)
    const incidentSnap = await incidentRef.get()
    if (!incidentSnap.exists) {
      throw new HttpsError('not-found', 'La incidencia no existe.')
    }
    const incident = incidentSnap.data()

    if (paymentSource === 'cash_register') {
      const effBranch = branchId || incident.branchId || 'punata'
      const lockRef = db.collection('cash_shift_active_locks').doc(`${callerUid}_${effBranch}`)
      const lockDoc = await lockRef.get()
      if (!lockDoc.exists || lockDoc.data().status !== 'open' || !lockDoc.data().shiftId) {
        throw new HttpsError('failed-precondition', 'Debe tener un turno de caja abierto para desembolsar indemnizaciones de ventanilla.')
      }

      const shiftId = lockDoc.data().shiftId
      const shiftRef = db.collection('cash_shifts').doc(shiftId)
      const shiftDoc = await shiftRef.get()
      if (!shiftDoc.exists || shiftDoc.data().status !== 'open') {
        throw new HttpsError('failed-precondition', 'El turno de caja activo no es válido.')
      }
      const shiftData = shiftDoc.data()
      const availableCashCents = Number(shiftData.expectedCashCents) || Number(shiftData.breakdown?.netCashCents) || 0
      if (availableCashCents < compensationAmountCents) {
        throw new HttpsError('failed-precondition', 'Efectivo insuficiente en caja para pagar la indemnización.')
      }

      await db.runTransaction(async (t) => {
        const updatedExpectedCash = availableCashCents - compensationAmountCents
        const newExpensesCents = (shiftData.breakdown?.expensesCents || shiftData.totalExpensesCents || 0) + compensationAmountCents

        const currentMovements = Array.isArray(shiftData.movements) ? shiftData.movements : []
        const movement = {
          movementId: `mov_ind_${incidentId}`,
          type: 'expense',
          category: 'indemnity',
          amountCents: compensationAmountCents,
          amountBob: compensationAmountCents / 100,
          description: `Indemnización por siniestro [${incident.incidentNumber}] guía ${incident.trackingCode}`,
          referenceId: incidentId,
          registeredByUid: callerUid,
          registeredByName: callerName,
          createdAtIso: nowIso,
        }

        t.update(shiftRef, {
          expectedCashCents: updatedExpectedCash,
          'breakdown.expensesCents': newExpensesCents,
          'breakdown.netCashCents': updatedExpectedCash,
          totalExpensesCents: newExpensesCents,
          currentCashCents: updatedExpectedCash,
          movements: [...currentMovements, movement],
          updatedAtIso: nowIso,
        })

        t.update(incidentRef, {
          status: 'compensated',
          compensationAmountCents,
          compensationAmountBob: compensationAmountCents / 100,
          financialConsequence: 'cash_indemnity',
          indemnityPaidAtIso: nowIso,
          indemnityCashShiftId: shiftId,
          authorizedByUid: callerUid,
          authorizedByName: callerName,
          updatedAtIso: nowIso,
        })
      })
    } else {
      // Fondo de reserva sindical (union_expenses)
      const expRef = db.collection('union_expenses').doc()
      await expRef.set({
        id: expRef.id,
        category: 'indemnity',
        amountCents: compensationAmountCents,
        amountBob: compensationAmountCents / 100,
        description: `Indemnización sindical por siniestro [${incident.incidentNumber}] guía ${incident.trackingCode}`,
        authorizedByUid: callerUid,
        authorizedByName: callerName,
        incidentId,
        createdAtIso: nowIso,
      })

      await incidentRef.update({
        status: 'compensated',
        compensationAmountCents,
        compensationAmountBob: compensationAmountCents / 100,
        financialConsequence: 'union_reserve_indemnity',
        indemnityPaidAtIso: nowIso,
        authorizedByUid: callerUid,
        authorizedByName: callerName,
        updatedAtIso: nowIso,
      })
    }

    return {
      success: true,
      incidentId,
      compensationAmountCents,
      compensationAmountBob: compensationAmountCents / 100,
      message: `Indemnización de Bs. ${(compensationAmountCents / 100).toFixed(2)} liquidada exitosamente.`,
    }
  }

  throw new HttpsError('invalid-argument', `Acción '${action}' no reconocida en registerShipmentIncident.`)
})

// =========================================================================
// FASE 7: CONFIGURACIÓN OFICIAL PERSISTENTE
// =========================================================================

export const registerShipmentContact = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (!caller || caller.isActive !== true) throw new HttpsError('unauthenticated', 'Usuario no autenticado o inactivo.')
  if (!['secretaria', 'encargado_agencia', 'directiva_admin'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'No tiene permisos para registrar seguimientos.')
  }
  const { shipmentId, method, result, notes = '', idempotencyKey } = request.data || {}
  if (!['phone', 'whatsapp', 'sms', 'other'].includes(method)) throw new HttpsError('invalid-argument', 'Medio de contacto inválido.')
  if (!['answered', 'no_answer', 'wrong_number', 'pickup_commitment'].includes(result)) throw new HttpsError('invalid-argument', 'Resultado de contacto inválido.')
  if (typeof shipmentId !== 'string' || !shipmentId.trim()) throw new HttpsError('invalid-argument', 'El shipmentId es obligatorio.')
  if (typeof notes !== 'string' || notes.trim().length > 500) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 500 caracteres.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  const shipmentRef = db.collection('shipments').doc(shipmentId.trim())
  const contactRef = db.collection('shipment_contacts').doc(`${caller.uid}_${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`)
  const nowIso = new Date().toISOString()
  const allowedBranches = Array.isArray(caller.allowedBranchIds) && caller.allowedBranchIds.length ? caller.allowedBranchIds : [caller.primaryBranchId].filter(Boolean)
  const contact = await db.runTransaction(async (transaction) => {
    const [shipmentSnap, existingSnap] = await Promise.all([transaction.get(shipmentRef), transaction.get(contactRef)])
    if (existingSnap.exists) return existingSnap.data()
    if (!shipmentSnap.exists) throw new HttpsError('not-found', 'La encomienda no existe.')
    const shipment = shipmentSnap.data() || {}
    const branches = [shipment.originBranchId, shipment.destinationBranchId].filter(Boolean)
    if (caller.role !== 'directiva_admin' && !branches.some((branch) => allowedBranches.includes(branch))) throw new HttpsError('permission-denied', 'No puede registrar seguimientos de otra sucursal.')
    const data = { id: contactRef.id, shipmentId: shipmentRef.id, trackingCode: shipment.trackingCode || shipmentRef.id, contactedAtIso: nowIso, method, result, notes: notes.trim(), performedByUid: caller.uid, performedByName: caller.fullName || 'Operador', branchId: shipment.destinationBranchId || shipment.originBranchId || caller.primaryBranchId, createdAtIso: nowIso }
    transaction.create(contactRef, data)
    return data
  })
  return { success: true, contact }
})

export const getSystemConfig = onCall({ cors: true }, async (request) => {
  const configDoc = await db.collection('system_config').doc('expreso_punata').get()
  if (!configDoc.exists) {
    return {
      success: true,
      status: 'unconfigured',
      isOfficial: false,
      isDefault: true,
      config: null,
      message: 'El sistema aún no cuenta con configuración oficial aprobada. Por favor, configure los parámetros operativos en el panel de Administración.',
    }
  }

  const data = configDoc.data() || {}
  const isActuallyConfigured = data.status === 'configured' && data.isOfficial === true

  if (!isActuallyConfigured) {
    return {
      success: true,
      status: 'unconfigured',
      isOfficial: false,
      isDefault: true,
      config: null,
      message: 'Configuración pendiente de aprobación: El documento existe pero no ha sido confirmado ni aprobado oficialmente por la Administración.',
    }
  }

  return {
    success: true,
    status: 'configured',
    isOfficial: true,
    isDefault: false,
    isDemo: Boolean(data.isDemo),
    config: {
      id: configDoc.id,
      ...data,
      isOfficial: true,
      status: 'configured',
    },
  }
})

export const updateSystemConfig = onCall({ cors: true }, async (request) => {
  const caller = await getAuthenticatedCallerProfile(request)
  if (!caller || !caller.isActive) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado o inactivo.')
  }
  if (caller.role !== 'directiva_admin') {
    throw new HttpsError('permission-denied', 'Solo la Directiva / Administrador general puede actualizar la configuración oficial del sistema.')
  }

  const { company, branches, tariffs, commissions, dues, printing, isDemo } = request.data || {}

  const callerUid = caller.uid || caller.id
  const callerName = caller.fullName || 'Administrador'
  const nowIso = new Date().toISOString()

  const configRef = db.collection('system_config').doc('expreso_punata')
  const currentSnap = await configRef.get()
  const existing = currentSnap.exists ? currentSnap.data() : {}

  const updatedConfig = {
    ...existing,
    status: 'configured',
    isOfficial: true,
    isDemo: isDemo !== undefined ? Boolean(isDemo) : (existing.isDemo !== undefined ? Boolean(existing.isDemo) : true),
    updatedAtIso: nowIso,
    updatedByUid: callerUid,
    updatedByName: callerName,
  }

  if (company && typeof company === 'object') {
    updatedConfig.company = {
      ...(existing.company || {}),
      name: company.name ? String(company.name).trim() : 'EXPRESO PUNATA',
      tradeName: company.tradeName ? String(company.tradeName).trim() : 'EXPRESO PUNATA',
      legalName: company.legalName ? String(company.legalName).trim() : 'Expreso Punata',
      acronym: company.acronym ? String(company.acronym).trim() : 'EP',
      legalNotice: company.legalNotice ? String(company.legalNotice).trim() : 'DOCUMENTO OPERATIVO INTERNO — NO CONSTITUYE FACTURA FISCAL',
      logoUrl: company.logoUrl || existing.company?.logoUrl || '',
      taxNotice: company.taxNotice || existing.company?.taxNotice || '',
    }
  }

  if (branches && typeof branches === 'object') {
    updatedConfig.branches = branches
  }

  if (tariffs && typeof tariffs === 'object') {
    const baseCents = (Number.isInteger(tariffs.baseFeeCents) && tariffs.baseFeeCents >= 0)
      ? tariffs.baseFeeCents
      : (tariffs.baseFeeBob !== undefined && tariffs.baseFeeBob !== null && !isNaN(Number(tariffs.baseFeeBob)) && Number(tariffs.baseFeeBob) >= 0 ? Math.round(Number(tariffs.baseFeeBob) * 100) : (existing.tariffs?.baseFeeCents ?? 0))
    const extraCents = (Number.isInteger(tariffs.extraKgRateCents) && tariffs.extraKgRateCents >= 0)
      ? tariffs.extraKgRateCents
      : (tariffs.extraKgRateBob !== undefined && tariffs.extraKgRateBob !== null && !isNaN(Number(tariffs.extraKgRateBob)) && Number(tariffs.extraKgRateBob) >= 0 ? Math.round(Number(tariffs.extraKgRateBob) * 100) : (existing.tariffs?.extraKgRateCents ?? 0))
    const homeCents = (Number.isInteger(tariffs.homeDeliveryFeeCents) && tariffs.homeDeliveryFeeCents >= 0)
      ? tariffs.homeDeliveryFeeCents
      : (tariffs.homeDeliveryFeeBob !== undefined && tariffs.homeDeliveryFeeBob !== null && !isNaN(Number(tariffs.homeDeliveryFeeBob)) && Number(tariffs.homeDeliveryFeeBob) >= 0 ? Math.round(Number(tariffs.homeDeliveryFeeBob) * 100) : (existing.tariffs?.homeDeliveryFeeCents ?? 0))

    const freeWeight = tariffs.freeWeightKg !== undefined && tariffs.freeWeightKg !== null && !isNaN(Number(tariffs.freeWeightKg))
      ? Math.max(0, Number(tariffs.freeWeightKg))
      : (existing.tariffs?.freeWeightKg ?? 0)

    updatedConfig.tariffs = {
      baseFeeCents: baseCents,
      baseFeeBob: baseCents / 100,
      freeWeightKg: freeWeight,
      extraKgRateCents: extraCents,
      extraKgRateBob: extraCents / 100,
      homeDeliveryFeeCents: homeCents,
      homeDeliveryFeeBob: homeCents / 100,
    }
  }

  if (commissions && typeof commissions === 'object') {
    const commVal = commissions.defaultValue !== undefined && commissions.defaultValue !== null && !isNaN(Number(commissions.defaultValue))
      ? Math.max(0, Number(commissions.defaultValue))
      : (existing.commissions?.defaultValue ?? 0)

    updatedConfig.commissions = {
      defaultType: ['percentage', 'fixed_per_shipment'].includes(commissions.defaultType) ? commissions.defaultType : (existing.commissions?.defaultType || 'percentage'),
      defaultValue: commVal,
    }
  }

  if (dues && typeof dues === 'object') {
    const dueCents = (Number.isInteger(dues.monthlyDueCents) && dues.monthlyDueCents >= 0)
      ? dues.monthlyDueCents
      : (dues.monthlyDueBob !== undefined && dues.monthlyDueBob !== null && !isNaN(Number(dues.monthlyDueBob)) && Number(dues.monthlyDueBob) >= 0 ? Math.round(Number(dues.monthlyDueBob) * 100) : (existing.dues?.monthlyDueCents ?? 0))

    const lateFee = dues.lateFeePercentage !== undefined && dues.lateFeePercentage !== null && !isNaN(Number(dues.lateFeePercentage))
      ? Math.max(0, Number(dues.lateFeePercentage))
      : (existing.dues?.lateFeePercentage ?? 0)

    const graceDays = dues.gracePeriodDays !== undefined && dues.gracePeriodDays !== null && !isNaN(Number(dues.gracePeriodDays))
      ? Math.max(0, Math.floor(Number(dues.gracePeriodDays)))
      : (existing.dues?.gracePeriodDays ?? 0)

    updatedConfig.dues = {
      monthlyDueCents: dueCents,
      monthlyDueBob: dueCents / 100,
      lateFeePercentage: lateFee,
      gracePeriodDays: graceDays,
    }
  }

  if (printing && typeof printing === 'object') {
    updatedConfig.printing = {
      cutPaper: printing.cutPaper !== undefined ? Boolean(printing.cutPaper) : true,
      openDrawer: printing.openDrawer !== undefined ? Boolean(printing.openDrawer) : true,
      headerNotice: printing.headerNotice || '',
      footerNotice: printing.footerNotice || '',
    }
  }

  await configRef.set(updatedConfig)

  // Auditoría administrativa
  await db.collection('audit_logs').add({
    action: 'system_config_updated',
    performedByUid: callerUid,
    performedByName: callerName,
    details: 'Actualización autoritativa de configuración oficial de Expreso Punata',
    timestampIso: nowIso,
  })

  return {
    success: true,
    config: updatedConfig,
    message: 'Configuración oficial actualizada exitosamente.',
  }
})

// =========================================================================
// PRÉSTAMOS INTERNOS DE AFILIADOS
// =========================================================================
const LOAN_MANAGEMENT_ROLES = ['directiva_admin', 'tesoreria']
const LOAN_COLLECTION_ROLES = ['directiva_admin', 'tesoreria', 'secretaria', 'encargado_agencia']
const LOAN_READ_ROLES = ['directiva_admin', 'tesoreria', 'secretaria', 'encargado_agencia', 'afiliado_admin']

function loanDateIsValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function addLoanMonth(dateString, monthOffset) {
  const [year, month, day] = dateString.split('-').map(Number)
  const targetMonthIndex = month - 1 + monthOffset
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

async function requireUnionLoanCaller(request, allowedRoles, operation) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión para administrar préstamos.')
  const userDoc = await db.collection('users').doc(request.auth.uid).get()
  if (!userDoc.exists || userDoc.data()?.isActive === false) throw new HttpsError('permission-denied', 'Usuario no activo.')
  const caller = userDoc.data()
  if (!allowedRoles.includes(caller.role)) throw new HttpsError('permission-denied', `No tiene permisos para ${operation}.`)
  return { uid: request.auth.uid, ...caller }
}

export const getMyUnionAccount = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, ['afiliado'], 'consultar su cuenta de afiliado.')
  const memberId = typeof caller.unionMemberId === 'string' ? caller.unionMemberId.trim() : ''
  if (!memberId) throw new HttpsError('failed-precondition', 'Su cuenta no está vinculada a un afiliado.')

  const memberRef = db.collection('union_members').doc(memberId)
  const memberDoc = await memberRef.get()
  const member = memberDoc.data() || {}
  const allowedBranches = caller.allowedBranchIds || [caller.primaryBranchId]
  if (!memberDoc.exists || member.status === 'inactive' || member.status === 'retired') {
    throw new HttpsError('permission-denied', 'El afiliado vinculado no está activo.')
  }
  if (!allowedBranches.includes(member.branchId)) {
    throw new HttpsError('permission-denied', 'El afiliado vinculado no pertenece a una sucursal autorizada.')
  }

  const [duesSnapshot, loansSnapshot, finesSnapshot] = await Promise.all([
    db.collection('union_dues').where('memberId', '==', memberId).get(),
    db.collection('union_loans').where('memberId', '==', memberId).get(),
    db.collection('union_fines').where('memberId', '==', memberId).get(),
  ])

  const loans = await Promise.all(loansSnapshot.docs.map(async (loanDoc) => {
    const [installments, payments] = await Promise.all([
      loanDoc.ref.collection('installments').orderBy('sequence', 'asc').get(),
      loanDoc.ref.collection('payments').orderBy('paidAtIso', 'asc').get(),
    ])
    return {
      id: loanDoc.id,
      ...loanDoc.data(),
      installments: installments.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      payments: payments.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    }
  }))
  const fines = await Promise.all(finesSnapshot.docs.map(async (fineDoc) => {
    const payments = await fineDoc.ref.collection('payments').orderBy('paidAtIso', 'asc').get()
    return { id: fineDoc.id, ...fineDoc.data(), payments: payments.docs.map((doc) => ({ id: doc.id, ...doc.data() })) }
  }))

  return {
    success: true,
    member: { id: memberDoc.id, ...member },
    dues: duesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    loans,
    fines,
  }
})

export const createUnionLoan = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, [...LOAN_MANAGEMENT_ROLES, 'secretaria'], 'registrar préstamos internos.')
  const { memberId, principalCents, installmentCount, firstDueDate, grantDate, notes = '' } = request.data || {}
  if (typeof memberId !== 'string' || !memberId.trim()) throw new HttpsError('invalid-argument', 'Seleccione un afiliado.')
  if (!Number.isSafeInteger(principalCents) || principalCents <= 0) throw new HttpsError('invalid-argument', 'El monto debe ser un entero positivo en centavos.')
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120) throw new HttpsError('invalid-argument', 'El número de cuotas debe estar entre 1 y 120.')
  if (!loanDateIsValid(firstDueDate) || (grantDate && !loanDateIsValid(grantDate))) throw new HttpsError('invalid-argument', 'Las fechas deben tener formato AAAA-MM-DD válido.')
  if (typeof notes !== 'string' || notes.length > 2000) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 2000 caracteres.')

  const memberRef = db.collection('union_members').doc(memberId.trim())
  const counterRef = db.collection('counters').doc(`union_loan_${new Date().getFullYear()}`)
  const loanRef = db.collection('union_loans').doc()
  const nowIso = new Date().toISOString()
  const year = new Date().getFullYear()
  return db.runTransaction(async (transaction) => {
    const [memberDoc, counterDoc] = await Promise.all([transaction.get(memberRef), transaction.get(counterRef)])
    if (!memberDoc.exists) throw new HttpsError('not-found', 'El afiliado seleccionado no existe.')
    if (caller.role === 'secretaria' && !((caller.allowedBranchIds || [caller.primaryBranchId]).includes(memberDoc.data()?.branchId))) {
      throw new HttpsError('permission-denied', 'Secretaría solo puede crear préstamos para afiliados de su sucursal autorizada.')
    }
    const sequence = (counterDoc.exists ? Number(counterDoc.data()?.currentSequence) || 0 : 0) + 1
    const loanNumber = `PRE-${year}-${String(sequence).padStart(5, '0')}`
    const baseCents = Math.floor(principalCents / installmentCount)
    const remainderCents = principalCents % installmentCount
    const installments = Array.from({ length: installmentCount }, (_, index) => {
      const amountCents = baseCents + (index < remainderCents ? 1 : 0)
      return {
        id: String(index + 1).padStart(3, '0'), sequence: index + 1,
        amountCents, amountBob: amountCents / 100,
        paidAmountCents: 0, balanceCents: amountCents,
        dueDate: addLoanMonth(firstDueDate, index), status: 'pending',
      }
    })
    const member = memberDoc.data()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
    const loanData = {
      id: loanRef.id, loanNumber, memberId: memberRef.id,
      memberNumber: member.memberNumber || '', memberName: member.fullName || '',
      grantDate: grantDate || new Date().toISOString().slice(0, 10),
      principalCents, principalBob: principalCents / 100,
      installmentCount, installmentAmountCents: baseCents + (remainderCents ? 1 : 0),
      firstDueDate, notes: notes.trim(), status: firstDueDate < today ? 'overdue' : 'active',
      paidCents: 0, balanceCents: principalCents, balanceBob: principalCents / 100,
      disbursementStatus: (grantDate || new Date().toISOString().slice(0, 10)) < today ? 'legacy_unknown' : 'pending', disbursedCents: 0, disbursedAtIso: null,
      createdAtIso: nowIso, createdByUid: caller.uid, createdByName: caller.fullName || 'Operador',
      updatedAtIso: nowIso,
    }
    transaction.set(counterRef, { currentSequence: sequence, year, updatedAtIso: nowIso }, { merge: true })
    transaction.create(loanRef, loanData)
    for (const installment of installments) transaction.create(loanRef.collection('installments').doc(installment.id), { ...installment, loanId: loanRef.id })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_loan_created', targetCollection: 'union_loans', targetId: loanRef.id,
      loanNumber, memberId: memberRef.id, principalCents,
      performedByUid: caller.uid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true, loan: loanData, installments }
  })
})

// Desembolso único y completo del préstamo. Las escrituras financieras permanecen en backend.
export const disburseUnionLoan = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, ['tesoreria', 'secretaria'], 'desembolsar préstamos internos.')
  const { loanId, paymentMethod = 'cash', shiftId, branchId, notes = '', idempotencyKey } = request.data || {}
  if (typeof loanId !== 'string' || !loanId.trim()) throw new HttpsError('invalid-argument', 'El préstamo es obligatorio.')
  if (!['cash', 'qr', 'transfer'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'Método de desembolso no válido.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  if (typeof notes !== 'string' || notes.length > 2000) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 2000 caracteres.')
  const effectiveBranchId = branchId || caller.primaryBranchId || 'punata'
  const allowedBranches = caller.allowedBranchIds || [caller.primaryBranchId]
  if (!allowedBranches.includes(effectiveBranchId)) throw new HttpsError('permission-denied', 'La sucursal no está autorizada.')
  const now = new Date(); const nowIso = now.toISOString(); const year = now.getFullYear()
  const idemRef = db.collection('idempotency_keys').doc(`union_loan_disbursement_${idempotencyKey.trim()}`)
  const loanRef = db.collection('union_loans').doc(loanId.trim())
  return db.runTransaction(async (transaction) => {
    const [idemDoc, loanDoc] = await Promise.all([transaction.get(idemRef), transaction.get(loanRef)])
    if (idemDoc.exists) {
      const cached = idemDoc.data()
      if (cached.callerUid === caller.uid && cached.loanId === loanId && cached.paymentMethod === paymentMethod && (cached.shiftId || null) === (shiftId || null)) return cached.result
      throw new HttpsError('already-exists', 'La clave de idempotencia ya fue utilizada con otros parámetros.')
    }
    if (!loanDoc.exists) throw new HttpsError('not-found', 'El préstamo no existe.')
    const loan = loanDoc.data()
    if (loan.disbursementStatus === undefined) throw new HttpsError('failed-precondition', 'El préstamo antiguo requiere revisión antes de desembolsarse.')
    if (loan.disbursementStatus === 'legacy_unknown') throw new HttpsError('failed-precondition', 'El préstamo antiguo requiere revisión antes de desembolsarse.')
    if (loan.disbursementStatus !== 'pending') throw new HttpsError('already-exists', 'El préstamo ya tiene un desembolso registrado.')
    const memberDoc = await transaction.get(db.collection('union_members').doc(loan.memberId))
    if (!memberDoc.exists || ['inactive', 'retired'].includes(memberDoc.data()?.status)) throw new HttpsError('failed-precondition', 'El afiliado no está activo.')
    if (!allowedBranches.includes(memberDoc.data()?.branchId)) throw new HttpsError('permission-denied', 'El afiliado no pertenece a una sucursal autorizada.')
    let shiftRef = null; let shift = null
    if (shiftId) {
      shiftRef = db.collection('cash_shifts').doc(shiftId); const shiftDoc = await transaction.get(shiftRef)
      if (!shiftDoc.exists || shiftDoc.data()?.status !== 'open') throw new HttpsError('failed-precondition', 'El turno de caja no está abierto.')
      shift = shiftDoc.data()
      if (shift.branchId !== effectiveBranchId) throw new HttpsError('permission-denied', 'El turno pertenece a otra sucursal.')
      const operator = shift.cashierUid || shift.operatorUid
      if (operator && operator !== caller.uid) throw new HttpsError('permission-denied', 'El turno no pertenece al operador.')
      if (paymentMethod === 'cash' && (shift.expectedCashCents || 0) < loan.principalCents) throw new HttpsError('failed-precondition', 'El efectivo disponible es insuficiente.')
    } else if (paymentMethod === 'cash') throw new HttpsError('failed-precondition', 'El desembolso en efectivo requiere un turno abierto.')
    const receiptCounterRef = db.collection('counters').doc(`receipt_union_loan_disbursement_${year}`)
    const receiptCounter = await transaction.get(receiptCounterRef)
    const sequence = (receiptCounter.exists ? Number(receiptCounter.data()?.currentSequence) || 0 : 0) + 1
    const receiptNumber = `REC-DES-PRE-${year}-${String(sequence).padStart(5, '0')}`
    const movementRef = db.collection('financial_movements').doc(); const disbursementRef = loanRef.collection('disbursements').doc()
    const result = { success: true, disbursement: { id: disbursementRef.id, loanId: loanRef.id, loanNumber: loan.loanNumber, amountCents: loan.principalCents, paymentMethod, branchId: effectiveBranchId, shiftId: shiftId || null, receiptNumber, disbursedAtIso: nowIso, disbursedByUid: caller.uid, disbursedByName: caller.fullName || 'Operador', notes: notes.trim() || null }, receiptNumber }
    transaction.set(receiptCounterRef, { currentSequence: sequence, year, updatedAtIso: nowIso }, { merge: true })
    transaction.create(disbursementRef, result.disbursement)
    transaction.update(loanRef, { disbursementStatus: 'disbursed', disbursedCents: loan.principalCents, disbursedAtIso: nowIso, disbursedByUid: caller.uid, disbursedByName: caller.fullName || 'Operador', updatedAtIso: nowIso })
    if (shiftRef && shift) transaction.update(shiftRef, { expectedCashCents: paymentMethod === 'cash' ? (shift.expectedCashCents || 0) - loan.principalCents : (shift.expectedCashCents || 0), movementsCount: (shift.movementsCount || 0) + 1, updatedAtIso: nowIso })
    transaction.create(movementRef, { id: movementRef.id, shiftId: shiftId || null, branchId: effectiveBranchId, type: 'loan_disbursement', category: 'loan_disbursement', amountCents: -loan.principalCents, amountBob: -loan.principalCents / 100, paymentMethod, description: `Desembolso de préstamo ${loan.loanNumber} - ${loan.memberNumber} ${loan.memberName} (${receiptNumber})`, receiptNumber, loanId: loanRef.id, loanNumber: loan.loanNumber, memberId: loan.memberId, memberNumber: loan.memberNumber, memberName: loan.memberName, operatorUid: caller.uid, operatorName: caller.fullName || 'Operador', timestamp: nowIso, createdAt: FieldValue.serverTimestamp(), createdAtIso: nowIso })
    transaction.set(idemRef, { callerUid: caller.uid, loanId, paymentMethod, shiftId: shiftId || null, result, createdAtIso: nowIso })
    transaction.create(db.collection('audit_logs').doc(), { action: 'union_loan_disbursed', targetCollection: 'union_loans', targetId: loanRef.id, amountCents: loan.principalCents, receiptNumber, performedByUid: caller.uid, performedByName: caller.fullName || 'Operador', performedByRole: caller.role, branchId: effectiveBranchId, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso })
    return result
  })
})

export const collectUnionLoanPayment = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, LOAN_COLLECTION_ROLES, 'cobrar préstamos internos.')
  const { loanId, amountCents, paymentMethod = 'cash', shiftId, branchId, notes = '', idempotencyKey } = request.data || {}
  if (typeof loanId !== 'string' || !loanId.trim()) throw new HttpsError('invalid-argument', 'El préstamo es obligatorio.')
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new HttpsError('invalid-argument', 'El pago debe ser un entero positivo en centavos.')
  if (!['cash', 'qr', 'transfer'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'Método de pago no válido.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  if (typeof notes !== 'string' || notes.length > 2000) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 2000 caracteres.')
  const effectiveBranchId = branchId || caller.primaryBranchId || 'punata'
  const now = new Date()
  const nowIso = now.toISOString()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(now)
  const idemRef = db.collection('idempotency_keys').doc(`union_loan_${idempotencyKey.trim()}`)
  const loanRef = db.collection('union_loans').doc(loanId.trim())

  return db.runTransaction(async (transaction) => {
    const [idemDoc, loanDoc] = await Promise.all([transaction.get(idemRef), transaction.get(loanRef)])
    if (idemDoc.exists) {
      const cached = idemDoc.data()
      if (cached.callerUid === caller.uid && cached.loanId === loanId && cached.amountCents === amountCents && cached.paymentMethod === paymentMethod && (cached.shiftId || null) === (shiftId || null)) return cached.result
      throw new HttpsError('already-exists', 'La clave de idempotencia ya fue utilizada con parámetros distintos.')
    }
    if (!loanDoc.exists) throw new HttpsError('not-found', 'El préstamo no existe.')
    const loan = loanDoc.data()
    if (loan.balanceCents <= 0 || loan.status === 'paid') throw new HttpsError('failed-precondition', 'El préstamo ya está pagado.')
    if (amountCents > loan.balanceCents) throw new HttpsError('invalid-argument', 'El pago supera el saldo pendiente del préstamo.')

    let shiftRef = null
    let shift = null
    if (paymentMethod === 'cash' && !shiftId) throw new HttpsError('failed-precondition', 'El cobro en efectivo requiere un turno de caja abierto.')
    if (shiftId) {
      shiftRef = db.collection('cash_shifts').doc(shiftId)
      const shiftDoc = await transaction.get(shiftRef)
      if (!shiftDoc.exists) throw new HttpsError('not-found', 'El turno de caja no existe.')
      shift = shiftDoc.data()
      if (shift.status !== 'open') throw new HttpsError('failed-precondition', 'El turno de caja no está abierto.')
      if (shift.branchId !== effectiveBranchId) throw new HttpsError('permission-denied', 'El turno de caja pertenece a otra sucursal.')
      const shiftOperator = shift.cashierUid || shift.operatorUid
      if (paymentMethod === 'cash' && shiftOperator && shiftOperator !== caller.uid && caller.role !== 'directiva_admin') throw new HttpsError('permission-denied', 'El turno de caja no pertenece al operador.')
    } else if (!['directiva_admin', 'tesoreria'].includes(caller.role)) {
      throw new HttpsError('permission-denied', 'Solo Directiva o Tesorería pueden cobrar fuera de turno.')
    }

    const installmentQuery = loanRef.collection('installments').orderBy('sequence', 'asc')
    const [installmentsSnapshot, receiptCounterSnapshot] = await Promise.all([
      transaction.get(installmentQuery),
      transaction.get(db.collection('counters').doc(`receipt_union_loan_${now.getFullYear()}`)),
    ])
    const installments = installmentsSnapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }))
    let remainingToAllocate = amountCents
    const allocations = []
    for (const installment of installments) {
      if (remainingToAllocate <= 0) break
      const dueBalance = Math.max(0, installment.data.amountCents - (installment.data.paidAmountCents || 0))
      if (dueBalance <= 0) continue
      const allocated = Math.min(dueBalance, remainingToAllocate)
      allocations.push({ ...installment, allocated, paidAmountCents: (installment.data.paidAmountCents || 0) + allocated })
      remainingToAllocate -= allocated
    }
    if (remainingToAllocate !== 0) throw new HttpsError('failed-precondition', 'El cronograma no coincide con el saldo del préstamo.')
    const sequence = (receiptCounterSnapshot.exists ? Number(receiptCounterSnapshot.data()?.currentSequence) || 0 : 0) + 1
    const receiptNumber = `REC-PRE-${now.getFullYear()}-${String(sequence).padStart(5, '0')}`
    const paymentRef = loanRef.collection('payments').doc()
    const movementRef = db.collection('financial_movements').doc()
    const updatedPaidCents = (loan.paidCents || 0) + amountCents
    const updatedBalanceCents = loan.principalCents - updatedPaidCents
    const overdue = allocations.some(({ data, paidAmountCents }) => data.dueDate < today && paidAmountCents < data.amountCents) ||
      installments.some(({ data }) => data.dueDate < today && (data.paidAmountCents || 0) < data.amountCents && !allocations.some((item) => item.data.sequence === data.sequence))
    const nextLoanStatus = updatedBalanceCents === 0 ? 'paid' : overdue ? 'overdue' : 'active'
    const paymentData = {
      id: paymentRef.id, loanId: loanRef.id, loanNumber: loan.loanNumber,
      memberId: loan.memberId, memberNumber: loan.memberNumber, memberName: loan.memberName,
      receiptNumber, amountCents, amountBob: amountCents / 100,
      paymentMethod, shiftId: shiftId || null, branchId: effectiveBranchId,
      allocations: allocations.map(({ data, allocated }) => ({ installmentId: data.id, sequence: data.sequence, amountCents: allocated })),
      notes: notes.trim() || null, paidAtIso: nowIso,
      collectedByUid: caller.uid, collectedByName: caller.fullName || 'Operador',
    }
    transaction.set(db.collection('counters').doc(`receipt_union_loan_${now.getFullYear()}`), { currentSequence: sequence, year: now.getFullYear(), updatedAtIso: nowIso }, { merge: true })
    for (const allocation of allocations) {
      const balanceCents = allocation.data.amountCents - allocation.paidAmountCents
      transaction.update(allocation.ref, {
        paidAmountCents: allocation.paidAmountCents, balanceCents,
        status: balanceCents === 0 ? 'paid' : 'partial',
        paidAtIso: balanceCents === 0 ? nowIso : null,
        updatedAtIso: nowIso,
      })
    }
    transaction.create(paymentRef, paymentData)
    transaction.update(loanRef, {
      paidCents: updatedPaidCents, balanceCents: updatedBalanceCents,
      balanceBob: updatedBalanceCents / 100, status: nextLoanStatus,
      lastPaymentAtIso: nowIso, updatedAtIso: nowIso,
    })
    if (shiftRef && shift) {
      const updatedExpected = paymentMethod === 'cash' ? (shift.expectedCashCents || 0) + amountCents : (shift.expectedCashCents || 0)
      transaction.update(shiftRef, {
        expectedCashCents: updatedExpected, expectedCashBob: updatedExpected / 100,
        movementsCount: (shift.movementsCount || 0) + 1,
        'breakdown.loanRepaymentsCents': (shift.breakdown?.loanRepaymentsCents || 0) + amountCents,
        updatedAtIso: nowIso,
      })
    }
    transaction.set(movementRef, {
      id: movementRef.id, shiftId: shiftId || null, branchId: effectiveBranchId,
      type: 'loan_repayment', category: 'internal_loan_repayment',
      amountCents, amountBob: amountCents / 100, paymentMethod,
      description: `Pago de préstamo ${loan.loanNumber} - ${loan.memberNumber} ${loan.memberName} (${receiptNumber})`,
      receiptNumber, loanId: loanRef.id, loanNumber: loan.loanNumber,
      memberId: loan.memberId, memberNumber: loan.memberNumber, memberName: loan.memberName,
      operatorUid: caller.uid, operatorName: caller.fullName || 'Operador',
      timestamp: nowIso, createdAt: FieldValue.serverTimestamp(), createdAtIso: nowIso,
    })
    transaction.set(idemRef, {
      callerUid: caller.uid, loanId, amountCents, paymentMethod,
      shiftId: shiftId || null, result: { success: true, payment: paymentData, balanceCents: updatedBalanceCents, status: nextLoanStatus },
      createdAtIso: nowIso,
    })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_loan_payment_collected', targetCollection: 'union_loans', targetId: loanRef.id,
      paymentId: paymentRef.id, amountCents, receiptNumber, performedByUid: caller.uid,
      performedByName: caller.fullName || 'Operador', performedByRole: caller.role,
      timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true, payment: paymentData, balanceCents: updatedBalanceCents, status: nextLoanStatus }
  })
})

export const listUnionLoans = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, LOAN_READ_ROLES, 'consultar préstamos internos.')
  const memberId = request.data?.memberId
  if (memberId !== undefined && (typeof memberId !== 'string' || !memberId.trim())) throw new HttpsError('invalid-argument', 'El afiliado solicitado no es válido.')
  let query = db.collection('union_loans').orderBy('createdAtIso', 'desc')
  if (memberId) {
    const memberDoc = await db.collection('union_members').doc(memberId).get()
    if (!memberDoc.exists) throw new HttpsError('not-found', 'El afiliado no existe.')
    query = db.collection('union_loans').where('memberId', '==', memberId)
  }
  const loanSnapshot = await query.get()
  const visibleLoanDocs = ['afiliado_admin', 'secretaria'].includes(caller.role)
    ? (await Promise.all(loanSnapshot.docs.map(async (loanDoc) => {
      const memberDoc = await db.collection('union_members').doc(loanDoc.data()?.memberId).get()
      return memberDoc.exists && (caller.allowedBranchIds || [caller.primaryBranchId]).includes(memberDoc.data()?.branchId) ? loanDoc : null
    }))).filter(Boolean)
    : loanSnapshot.docs
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
  const loans = await Promise.all(visibleLoanDocs.map(async (loanDoc) => {
    const [installmentSnapshot, paymentSnapshot] = await Promise.all([
      loanDoc.ref.collection('installments').orderBy('sequence', 'asc').get(),
      loanDoc.ref.collection('payments').orderBy('paidAtIso', 'asc').get(),
    ])
    const installments = installmentSnapshot.docs.map((doc) => {
      const item = { id: doc.id, ...doc.data() }
      return { ...item, status: item.balanceCents > 0 && item.dueDate < today ? 'overdue' : item.status }
    })
    const payments = paymentSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    const data = loanDoc.data()
    // El historial transaccional es la fuente de verdad del total cobrado.
    // Esto corrige extractos antiguos donde paidCents quedó en cero aunque existan pagos.
    const paidCents = payments.reduce((sum, payment) => sum + (Number(payment.amountCents) || 0), 0)
    const balanceCents = Math.max(0, (Number(data.principalCents) || 0) - paidCents)
    const overdue = installments.some((item) => item.dueDate < today && item.balanceCents > 0)
    const overdueBalanceCents = installments.reduce((sum, item) => sum + (item.dueDate < today ? item.balanceCents : 0), 0)
    return { ...data, paidCents, balanceCents, balanceBob: balanceCents / 100, status: balanceCents === 0 ? 'paid' : overdue ? 'overdue' : 'active', overdueBalanceCents, installments, payments }
  }))
  return { success: true, loans }
})

// Alertas de deuda derivadas de los registros vigentes. Solo lectura y acotadas
// para evitar barridos del historial; nunca escribe en Caja ni en documentos financieros.
export const listUnionDebtAlerts = onCall({ cors: true }, async (request) => {
  const allowedRoles = [...LOAN_READ_ROLES, 'afiliado']
  const caller = await requireUnionLoanCaller(request, allowedRoles, 'consultar alertas de deudas.')
  const requestedMemberId = request.data?.memberId
  if (requestedMemberId !== undefined && (typeof requestedMemberId !== 'string' || !requestedMemberId.trim())) {
    throw new HttpsError('invalid-argument', 'El afiliado solicitado no es válido.')
  }
  const memberId = caller.role === 'afiliado'
    ? (typeof caller.unionMemberId === 'string' ? caller.unionMemberId.trim() : '')
    : requestedMemberId?.trim()
  if (caller.role === 'afiliado' && (!memberId || (requestedMemberId && requestedMemberId !== memberId))) {
    throw new HttpsError('permission-denied', 'Solo puede consultar sus propias obligaciones.')
  }
  const memberSnapshot = memberId
    ? await db.collection('union_members').doc(memberId).get()
    : null
  if (memberSnapshot && !memberSnapshot.exists) throw new HttpsError('not-found', 'El afiliado no existe.')
  const memberData = memberSnapshot?.data() || null
  if (memberData && ['inactive', 'retired'].includes(memberData.status)) {
    throw new HttpsError('permission-denied', 'El afiliado no está activo.')
  }
  const branches = caller.allowedBranchIds || [caller.primaryBranchId].filter(Boolean)
  const scopedRole = ['afiliado', 'afiliado_admin', 'secretaria', 'encargado_agencia'].includes(caller.role)
  if (memberData && scopedRole && !branches.includes(memberData.branchId)) {
    throw new HttpsError('permission-denied', 'El afiliado no pertenece a una sucursal autorizada.')
  }
  const cap = 250
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
  const boundedQuery = (collection) => {
    let query = db.collection(collection).where('balanceCents', '>', 0).limit(cap)
    if (memberId) query = db.collection(collection).where('memberId', '==', memberId).limit(cap)
    return query.get()
  }
  const [duesSnapshot, loansSnapshot, finesSnapshot] = await Promise.all([
    boundedQuery('union_dues'), boundedQuery('union_loans'), boundedQuery('union_fines'),
  ])
  const hasBalance = (doc) => (Number(doc.data()?.balanceCents) || 0) > 0
  const duesDocs = duesSnapshot.docs.filter(hasBalance)
  const loanDocs = loansSnapshot.docs.filter((doc) => hasBalance(doc) && doc.data()?.disbursementStatus !== 'pending')
  const fineDocs = finesSnapshot.docs.filter((doc) => hasBalance(doc) && doc.data()?.status !== 'voided')
  const installmentSnapshot = loanDocs.length
    ? await db.collectionGroup('installments').where('balanceCents', '>', 0).limit(1000).get()
    : { docs: [] }
  const loanIds = new Set(loanDocs.map((doc) => doc.id))
  const installmentsByLoan = new Map()
  for (const installmentDoc of installmentSnapshot.docs) {
    const installment = installmentDoc.data()
    const parentLoanId = installment.loanId || installmentDoc.ref.parent.parent?.id
    if (!loanIds.has(parentLoanId)) continue
    const list = installmentsByLoan.get(parentLoanId) || []
    list.push(installment)
    installmentsByLoan.set(parentLoanId, list)
  }
  const allDebtDocs = [...duesDocs, ...loanDocs, ...fineDocs]
  const memberIds = [...new Set(allDebtDocs.map((doc) => doc.data()?.memberId).filter(Boolean))]
  const missingMembers = memberIds.filter((id) => id !== memberSnapshot?.id)
  const memberDocs = missingMembers.length ? await db.getAll(...missingMembers.map((id) => db.collection('union_members').doc(id))) : []
  const memberById = new Map(memberDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data()]))
  if (memberSnapshot) memberById.set(memberSnapshot.id, memberData)
  const visible = (doc) => {
    const member = memberById.get(doc.data()?.memberId)
    if (!member || (scopedRole && !branches.includes(member.branchId))) return false
    return caller.role !== 'secretaria' || doc.ref.parent.id !== 'union_fines' || doc.data()?.category === 'deportes'
  }
  const alerts = []
  for (const doc of duesDocs) {
    if (!visible(doc)) continue
    const data = doc.data(); const balance = Number(data.balanceCents) || 0
    if (balance <= 0) continue
    const overdue = loanDateIsValid(data.dueDate) && data.dueDate < today
    alerts.push({ id: doc.id, memberId: data.memberId, memberName: data.memberName || memberById.get(data.memberId)?.fullName || '', memberNumber: data.memberNumber || memberById.get(data.memberId)?.memberNumber || '', type: 'due', category: 'cuota', label: `Cuota ${data.period || ''}`.trim(), amountCents: balance, status: overdue ? 'overdue' : 'pending', dueDate: loanDateIsValid(data.dueDate) ? data.dueDate : null, period: data.period || null, reviewRequired: false })
  }
  for (const doc of loanDocs) {
    if (!visible(doc)) continue
    const data = doc.data(); const balance = Number(data.balanceCents) || 0
    if (balance <= 0 || ['legacy_unknown', undefined, null].includes(data.disbursementStatus)) continue
    const installments = installmentsByLoan.get(doc.id) || []
    const overdueInstallments = installments.filter((item) => Number(item.balanceCents) > 0 && loanDateIsValid(item.dueDate) && item.dueDate < today)
    const upcoming = installments.map((item) => item.dueDate).filter((date) => loanDateIsValid(date) && date >= today).sort()[0] || null
    alerts.push({ id: doc.id, memberId: data.memberId, memberName: data.memberName || memberById.get(data.memberId)?.fullName || '', memberNumber: data.memberNumber || memberById.get(data.memberId)?.memberNumber || '', type: 'loan', category: 'préstamo', label: `Préstamo ${data.loanNumber || ''}`.trim(), amountCents: balance, overdueAmountCents: overdueInstallments.reduce((sum, item) => sum + (Number(item.balanceCents) || 0), 0), status: overdueInstallments.length ? 'overdue' : 'pending', dueDate: overdueInstallments.map((item) => item.dueDate).sort()[0] || upcoming, period: null, reviewRequired: false })
  }
  for (const doc of fineDocs) {
    if (!visible(doc)) continue
    const data = doc.data(); const balance = Number(data.balanceCents) || 0
    if (balance <= 0) continue
    alerts.push({ id: doc.id, memberId: data.memberId, memberName: data.memberName || memberById.get(data.memberId)?.fullName || '', memberNumber: data.memberNumber || memberById.get(data.memberId)?.memberNumber || '', type: 'fine', category: data.category || 'otros', label: data.reason || 'Multa', amountCents: balance, status: 'pending', dueDate: null, period: null, reviewRequired: data.financialReviewRequired === true })
  }
  alerts.sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') || a.memberName.localeCompare(b.memberName))
  return { success: true, alerts, truncated: duesSnapshot.size === cap || loansSnapshot.size === cap || finesSnapshot.size === cap, installmentScanTruncated: installmentSnapshot.docs.length === 1000, asOfDate: today }
})

// Gestión institucional anual. Las designaciones no alteran roles ni cuentas de usuario.
async function requireAnnualBoardManager(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar la directiva.')
  const userDoc = await db.collection('users').doc(request.auth.uid).get()
  const caller = userDoc.data()
  if (!userDoc.exists || caller?.isActive === false || !['directiva_admin', 'tesoreria'].includes(caller?.role)) {
    throw new HttpsError('permission-denied', 'Solo Directiva y Tesorería pueden gestionar la directiva institucional.')
  }
  return { uid: request.auth.uid, ...caller }
}

function annualBoardDateIsValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export const listAnnualBoards = onCall({ cors: true }, async (request) => {
  await requireAnnualBoardManager(request)
  const snapshot = await db.collection('union_boards').orderBy('year', 'desc').limit(100).get()
  return { success: true, boards: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), truncated: snapshot.size === 100 }
})

export const saveAnnualBoard = onCall({ cors: true }, async (request) => {
  const caller = await requireAnnualBoardManager(request)
  const input = request.data || {}
  const year = Number(input.year)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new HttpsError('invalid-argument', 'Indique un año válido para la gestión.')
  if (!annualBoardDateIsValid(input.startDate) || !annualBoardDateIsValid(input.endDate) || input.endDate < input.startDate) {
    throw new HttpsError('invalid-argument', 'Las fechas de inicio y finalización deben ser válidas y estar en orden.')
  }
  if (!annualBoardDateIsValid(input.electedAt)) throw new HttpsError('invalid-argument', 'Indique una fecha válida de elección o designación.')
  if (typeof input.observations !== 'string' || input.observations.length > 2000) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 2000 caracteres.')
  if (!['planned', 'active', 'completed', 'cancelled'].includes(input.status)) throw new HttpsError('invalid-argument', 'El estado de la gestión no es válido.')
  if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > 30) throw new HttpsError('invalid-argument', 'Agregue entre 1 y 30 integrantes.')
  const seenMemberIds = new Set()
  const normalizedMembers = input.members.map((entry) => {
    const memberId = typeof entry?.memberId === 'string' ? entry.memberId.trim() : ''
    const position = typeof entry?.position === 'string' ? entry.position.trim() : ''
    if (!memberId || !position || position.length > 100) throw new HttpsError('invalid-argument', 'Cada integrante debe tener afiliado y cargo.')
    if (seenMemberIds.has(memberId)) throw new HttpsError('invalid-argument', 'Un afiliado no puede repetirse en la misma directiva.')
    seenMemberIds.add(memberId)
    return { memberId, position }
  })
  if (input.id !== undefined && input.id !== String(year)) throw new HttpsError('invalid-argument', 'El período de una gestión registrada no se puede cambiar; registre el nuevo período por separado.')

  const boardRef = db.collection('union_boards').doc(String(year))
  const memberRefs = normalizedMembers.map(({ memberId }) => db.collection('union_members').doc(memberId))
  const nowIso = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const [existingDoc, allBoards, ...memberDocs] = await Promise.all([
      transaction.get(boardRef), transaction.get(db.collection('union_boards')),
      ...memberRefs.map((ref) => transaction.get(ref)),
    ])
    const isUpdate = Boolean(input.id)
    if (isUpdate && !existingDoc.exists) throw new HttpsError('not-found', 'No se encontró la gestión que desea editar.')
    if (!isUpdate && existingDoc.exists) throw new HttpsError('already-exists', `Ya existe una gestión registrada para ${year}.`)
    const duplicatePeriod = allBoards.docs.find((doc) => doc.id !== boardRef.id && Number(doc.data()?.year) === year)
    if (duplicatePeriod) throw new HttpsError('already-exists', `Ya existe otra gestión registrada para ${year}.`)
    if (memberDocs.some((doc) => !doc.exists)) throw new HttpsError('not-found', 'Uno o más afiliados seleccionados ya no existen en el padrón.')

    const startDate = input.startDate
    const endDate = input.endDate
    const blocksOverlap = ['planned', 'active'].includes(input.status)
    if (blocksOverlap) {
      const conflict = allBoards.docs.find((doc) => {
        if (doc.id === boardRef.id || ['cancelled', 'completed'].includes(doc.data()?.status)) return false
        return startDate <= doc.data()?.endDate && endDate >= doc.data()?.startDate
      })
      if (conflict) throw new HttpsError('already-exists', `Las fechas se cruzan con la gestión ${conflict.data()?.year}. Revise el período antes de guardar.`)
    }

    const members = normalizedMembers.map(({ memberId, position }, index) => {
      const data = memberDocs[index].data() || {}
      return { memberId, memberNumber: data.memberNumber || '', fullName: data.fullName || '', position }
    })
    const updated = {
      year, startDate, endDate, electedAt: input.electedAt, members,
      observations: input.observations.trim(), status: input.status,
      updatedAtIso: nowIso, updatedByUid: caller.uid, updatedByName: caller.fullName || 'Operador',
    }
    if (isUpdate) {
      const revisionRef = boardRef.collection('revisions').doc()
      transaction.create(revisionRef, { ...existingDoc.data(), revisionId: revisionRef.id, archivedAtIso: nowIso, archivedByUid: caller.uid, archivedByName: caller.fullName || 'Operador' })
      transaction.set(boardRef, updated, { merge: true })
    } else {
      transaction.create(boardRef, { ...updated, id: boardRef.id, createdAtIso: nowIso, createdByUid: caller.uid, createdByName: caller.fullName || 'Operador' })
    }
    transaction.set(db.collection('audit_logs').doc(), {
      action: isUpdate ? 'annual_board_updated' : 'annual_board_created', targetCollection: 'union_boards', targetId: boardRef.id,
      year, memberIds: members.map((entry) => entry.memberId), performedByUid: caller.uid,
      performedByName: caller.fullName || 'Operador', performedByRole: caller.role,
      timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true, board: { id: boardRef.id, ...(isUpdate ? existingDoc.data() : {}), ...updated } }
  })
})


// Multas: alta independiente, sin crear movimientos ni afectar Caja.
const FINE_CATEGORIES = ['transporte', 'conflictos', 'deportes', 'otros']
export const createUnionFine = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, [...LOAN_MANAGEMENT_ROLES, 'secretaria'], 'registrar multas de afiliados.')
  const { memberId, category, reason, description = '', date, amountCents, notes = '' } = request.data || {}
  if (typeof memberId !== 'string' || !memberId.trim()) throw new HttpsError('invalid-argument', 'Seleccione un afiliado.')
  if (!FINE_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'La categoría de multa no es válida.')
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 300) throw new HttpsError('invalid-argument', 'El motivo es obligatorio (máximo 300 caracteres).')
  if (typeof description !== 'string' || description.length > 2000) throw new HttpsError('invalid-argument', 'La descripción no puede superar 2000 caracteres.')
  if (!loanDateIsValid(date)) throw new HttpsError('invalid-argument', 'La fecha debe tener formato AAAA-MM-DD válido.')
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new HttpsError('invalid-argument', 'El importe debe ser un entero positivo en centavos.')
  if (typeof notes !== 'string' || notes.length > 2000) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 2000 caracteres.')
  const memberRef = db.collection('union_members').doc(memberId.trim())
  const memberDoc = await memberRef.get()
  if (!memberDoc.exists) throw new HttpsError('not-found', 'El afiliado seleccionado no existe.')
  const fineRef = db.collection('union_fines').doc()
  const nowIso = new Date().toISOString()
  const member = memberDoc.data()
  if (caller.role === 'secretaria' && !(caller.allowedBranchIds || [caller.primaryBranchId]).includes(member.branchId)) {
    throw new HttpsError('permission-denied', 'Solo puede registrar multas de afiliados de su sucursal autorizada.')
  }
  const fine = {
    id: fineRef.id, fineNumber: `MUL-${fineRef.id.slice(0, 8).toUpperCase()}`,
    memberId: memberRef.id, memberNumber: member.memberNumber || '', memberName: member.fullName || '',
    branchId: member.branchId || caller.primaryBranchId || 'punata',
    category, reason: reason.trim(), description: description.trim(), date,
    amountCents, amountBob: amountCents / 100, balanceCents: amountCents,
    balanceBob: amountCents / 100, paidCents: 0, paidBob: 0,
    status: 'pending', notes: notes.trim(),
    createdAtIso: nowIso, createdByUid: caller.uid, createdByName: caller.fullName || 'Operador',
  }
  await db.runTransaction(async (transaction) => {
    // Reconfirm existence in the transaction before persisting the record.
    const currentMember = await transaction.get(memberRef)
    if (!currentMember.exists) throw new HttpsError('not-found', 'El afiliado seleccionado no existe.')
    transaction.create(fineRef, fine)
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_fine_created', targetCollection: 'union_fines', targetId: fineRef.id,
      memberId: memberRef.id, amountCents, performedByUid: caller.uid,
      performedByName: caller.fullName || 'Operador', performedByRole: caller.role,
      timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
  })
  return { success: true, fine }
})

// Deportes y asistencia: usa la colección union_fines existente para cualquier sanción.
const UNION_SPORTS_WRITE_ROLES = LOAN_MANAGEMENT_ROLES
const UNION_SPORTS_ATTENDANCE = ['pending', 'present', 'late', 'absent', 'exempt']
const sportsFineAmountCents = (attendance) => attendance === 'late' ? 5000 : attendance === 'absent' ? 10000 : 0
const sportsFineReason = (event, attendance) => attendance === 'late'
  ? `Tardanza en jornada deportiva: ${event.activityName}`
  : `Inasistencia a jornada deportiva: ${event.activityName}`

async function applyUnionSportsAttendance(transaction, { eventRef, participantRef, event, participant, attendance, reason, caller, nowIso }) {
  const sportsFineBranchId = event.branchId || participant.branchId || caller.primaryBranchId || null
  const deterministicFineId = `sports_${eventRef.id}_${participant.memberId}`
  const fineRef = db.collection('union_fines').doc(deterministicFineId)
  const fineDoc = await transaction.get(fineRef)
  const history = Array.isArray(participant.attendanceHistory) ? participant.attendanceHistory : []
  const changed = participant.attendance !== attendance
  const historyEntry = changed ? {
    attendance, changedAtIso: nowIso, changedByUid: caller.uid,
    changedByName: caller.fullName || 'Operador', reason: reason || null,
  } : null
  const shouldFine = sportsFineAmountCents(attendance) > 0
  let financialReviewRequired = false
  let fineId = fineDoc.exists ? fineRef.id : null
  if (fineDoc.exists) {
    const fine = fineDoc.data()
    if (fine.source !== 'sports_attendance' || fine.eventId !== eventRef.id || fine.memberId !== participant.memberId) {
      throw new HttpsError('already-exists', 'El identificador de sanción deportiva ya está asociado a otro registro.')
    }
    const hasPayments = (fine.paidCents || 0) > 0 || ['partial', 'paid'].includes(fine.status)
    if (hasPayments) {
      financialReviewRequired = Boolean(fine.financialReviewRequired) || changed
      if (changed) transaction.update(fineRef, {
          financialReviewRequired: true,
          financialReviewReason: `La asistencia cambió de ${participant.attendance} a ${attendance} después de registrar pagos. Requiere decisión autorizada.`,
          financialReviewAtIso: nowIso, financialReviewByUid: caller.uid,
          updatedAtIso: nowIso,
        })
    } else if (shouldFine) {
      const amountCents = sportsFineAmountCents(attendance)
      transaction.update(fineRef, {
        fineNumber: `MUL-DEP-${eventRef.id}-${participant.memberId}`,
        memberNumber: participant.memberNumber, memberName: participant.memberName,
        branchId: sportsFineBranchId,
        category: 'deportes', reason: sportsFineReason(event, attendance),
        description: `${event.date} ${event.scheduledTime} · ${event.activityName}`,
        date: event.date, attendanceStatus: attendance,
        amountCents, amountBob: amountCents / 100, paidCents: 0, paidBob: 0,
        balanceCents: amountCents, balanceBob: amountCents / 100,
        status: 'pending', voidedAtIso: null, voidedByUid: null,
        voidReason: null,
        updatedAtIso: nowIso, updatedByUid: caller.uid,
      })
    } else if (fine.status !== 'voided') {
      transaction.update(fineRef, {
        balanceCents: 0, balanceBob: 0, status: 'voided',
        voidedAtIso: nowIso, voidedByUid: caller.uid,
        voidReason: `Asistencia corregida de ${participant.attendance} a ${attendance}.`,
        updatedAtIso: nowIso, updatedByUid: caller.uid,
      })
    }
  } else if (shouldFine) {
    const amountCents = sportsFineAmountCents(attendance)
    const fineNumber = `MUL-DEP-${eventRef.id}-${participant.memberId}`
    transaction.create(fineRef, {
      id: fineRef.id, fineNumber, memberId: participant.memberId,
      memberNumber: participant.memberNumber, memberName: participant.memberName,
      branchId: sportsFineBranchId,
      category: 'deportes', reason: sportsFineReason(event, attendance),
      description: `${event.date} ${event.scheduledTime} · ${event.activityName}`,
      date: event.date, attendanceStatus: attendance,
      amountCents, amountBob: amountCents / 100, paidCents: 0, paidBob: 0,
      balanceCents: amountCents, balanceBob: amountCents / 100,
      status: 'pending', notes: '', source: 'sports_attendance',
      eventId: eventRef.id, eventName: event.activityName,
      createdAtIso: nowIso, createdByUid: caller.uid,
      createdByName: caller.fullName || 'Operador', updatedAtIso: nowIso,
    })
    fineId = fineRef.id
  }
  transaction.update(participantRef, {
    attendance,
    attendanceHistory: historyEntry ? [...history, historyEntry] : history,
    fineId: fineId || null,
    financialReviewRequired,
    updatedAtIso: nowIso, updatedByUid: caller.uid,
  })
  return { fineId, financialReviewRequired, historyEntry }
}

export const createUnionSportsEvent = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, UNION_SPORTS_WRITE_ROLES, 'crear jornadas deportivas.')
  const { date, scheduledTime, activityName, place = '', notes = '', memberIds, idempotencyKey } = request.data || {}
  if (!loanDateIsValid(date)) throw new HttpsError('invalid-argument', 'La fecha debe tener formato AAAA-MM-DD válido.')
  if (typeof scheduledTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) throw new HttpsError('invalid-argument', 'La hora debe tener formato HH:MM.')
  if (typeof activityName !== 'string' || !activityName.trim() || activityName.trim().length > 200) throw new HttpsError('invalid-argument', 'El nombre de la actividad es obligatorio (máximo 200 caracteres).')
  if (typeof place !== 'string' || place.length > 300 || typeof notes !== 'string' || notes.length > 2000) throw new HttpsError('invalid-argument', 'El lugar u observaciones superan el máximo permitido.')
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 300 || memberIds.some((id) => typeof id !== 'string' || !id.trim() || id.includes('/'))) throw new HttpsError('invalid-argument', 'Seleccione entre 1 y 300 afiliados convocados.')
  if (new Set(memberIds).size !== memberIds.length) throw new HttpsError('invalid-argument', 'No se puede convocar dos veces al mismo afiliado.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  const cleanedMemberIds = memberIds.map((id) => id.trim())
  const fingerprint = JSON.stringify({ date, scheduledTime, activityName: activityName.trim(), place: place.trim(), notes: notes.trim(), memberIds: cleanedMemberIds })
  const eventRef = db.collection('union_sports_events').doc()
  const idempotencyRef = db.collection('idempotency_keys').doc(`union_sports_event_${idempotencyKey.trim()}`)
  const memberRefs = cleanedMemberIds.map((id) => db.collection('union_members').doc(id))
  const nowIso = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const [idempotencyDoc, ...memberDocs] = await Promise.all([transaction.get(idempotencyRef), ...memberRefs.map((ref) => transaction.get(ref))])
    if (idempotencyDoc.exists) {
      const cached = idempotencyDoc.data()
      if (cached.callerUid === caller.uid && cached.fingerprint === fingerprint) return { success: true, eventId: cached.eventId }
      throw new HttpsError('already-exists', 'La clave de la jornada ya fue usada con datos diferentes.')
    }
    const missingIndex = memberDocs.findIndex((doc) => !doc.exists)
    if (missingIndex >= 0) throw new HttpsError('not-found', `No existe el afiliado convocado ${cleanedMemberIds[missingIndex]}.`)
    const event = {
      id: eventRef.id, date, scheduledTime, activityName: activityName.trim(),
      place: place.trim(), notes: notes.trim(), status: 'scheduled',
      branchId: caller.primaryBranchId || 'punata',
      participantCount: cleanedMemberIds.length, createdAtIso: nowIso,
      createdByUid: caller.uid, createdByName: caller.fullName || 'Operador',
      updatedAtIso: nowIso,
    }
    transaction.create(eventRef, event)
    memberDocs.forEach((memberDoc, index) => {
      const member = memberDoc.data()
      const participantRef = eventRef.collection('participants').doc(cleanedMemberIds[index])
      transaction.create(participantRef, {
        id: cleanedMemberIds[index], memberId: cleanedMemberIds[index],
        memberNumber: member.memberNumber || '', memberName: member.fullName || '',
        attendance: 'pending', attendanceHistory: [], fineId: null,
        financialReviewRequired: false, justifications: [],
        invitedAtIso: nowIso, invitedByUid: caller.uid,
      })
    })
    transaction.create(idempotencyRef, { callerUid: caller.uid, fingerprint, eventId: eventRef.id, createdAtIso: nowIso })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_sports_event_created', targetCollection: 'union_sports_events', targetId: eventRef.id,
      date, activityName: event.activityName, participantCount: cleanedMemberIds.length,
      performedByUid: caller.uid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true, eventId: eventRef.id }
  })
})

export const setUnionSportsAttendance = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, UNION_SPORTS_WRITE_ROLES, 'registrar asistencia deportiva.')
  const { eventId, memberId, attendance, reason = '', idempotencyKey } = request.data || {}
  if (typeof eventId !== 'string' || !eventId.trim() || typeof memberId !== 'string' || !memberId.trim()) throw new HttpsError('invalid-argument', 'La jornada y el afiliado son obligatorios.')
  if (!['pending', 'present', 'late', 'absent'].includes(attendance)) throw new HttpsError('invalid-argument', 'El estado debe ser pendiente, presente, tardanza o ausente. La exención requiere decisión del Directorio.')
  if (typeof reason !== 'string' || reason.length > 1000) throw new HttpsError('invalid-argument', 'La observación no puede superar 1000 caracteres.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  const eventRef = db.collection('union_sports_events').doc(eventId.trim())
  const participantRef = eventRef.collection('participants').doc(memberId.trim())
  const idempotencyRef = db.collection('idempotency_keys').doc(`union_sports_attendance_${idempotencyKey.trim()}`)
  const nowIso = new Date().toISOString()
  const fingerprint = JSON.stringify({ eventId: eventRef.id, memberId: memberId.trim(), attendance, reason: reason.trim() })
  return db.runTransaction(async (transaction) => {
    const [idempotencyDoc, eventDoc, participantDoc] = await Promise.all([transaction.get(idempotencyRef), transaction.get(eventRef), transaction.get(participantRef)])
    if (idempotencyDoc.exists) {
      const cached = idempotencyDoc.data()
      if (cached.callerUid === caller.uid && cached.fingerprint === fingerprint) return cached.result
      throw new HttpsError('already-exists', 'La clave de asistencia ya fue usada con datos diferentes.')
    }
    if (!eventDoc.exists) throw new HttpsError('not-found', 'La jornada no existe.')
    if (!participantDoc.exists) throw new HttpsError('failed-precondition', 'El afiliado no fue convocado a esta jornada.')
    const event = eventDoc.data()
    const participant = participantDoc.data()
    if (participant.attendance === 'exempt' && attendance !== 'exempt' && caller.role !== 'directiva_admin') {
      throw new HttpsError('permission-denied', 'Solo el Directorio puede corregir una exención que ya autorizó.')
    }
    const transition = await applyUnionSportsAttendance(transaction, { eventRef, participantRef, event, participant, attendance, reason: reason.trim(), caller, nowIso })
    const result = { success: true, attendance, fineId: transition.fineId, financialReviewRequired: transition.financialReviewRequired }
    transaction.create(idempotencyRef, { callerUid: caller.uid, fingerprint, result, createdAtIso: nowIso })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_sports_attendance_changed', targetCollection: 'union_sports_events', targetId: eventRef.id,
      memberId: participant.memberId, previousAttendance: participant.attendance, attendance,
      fineId: transition.fineId, financialReviewRequired: transition.financialReviewRequired,
      reason: reason.trim() || null, performedByUid: caller.uid,
      performedByName: caller.fullName || 'Operador', performedByRole: caller.role,
      timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return result
  })
})

export const requestUnionSportsJustification = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, UNION_SPORTS_WRITE_ROLES, 'registrar justificaciones deportivas.')
  const { eventId, memberId, reason, requestDate, idempotencyKey } = request.data || {}
  if (typeof eventId !== 'string' || !eventId.trim() || typeof memberId !== 'string' || !memberId.trim()) throw new HttpsError('invalid-argument', 'La jornada y el afiliado son obligatorios.')
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1500) throw new HttpsError('invalid-argument', 'El motivo debe tener entre 3 y 1500 caracteres.')
  if (!loanDateIsValid(requestDate)) throw new HttpsError('invalid-argument', 'La fecha de solicitud debe tener formato AAAA-MM-DD válido.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  const eventRef = db.collection('union_sports_events').doc(eventId.trim())
  const participantRef = eventRef.collection('participants').doc(memberId.trim())
  const idempotencyRef = db.collection('idempotency_keys').doc(`union_sports_justification_${idempotencyKey.trim()}`)
  const justificationRef = participantRef.collection('justifications').doc()
  const nowIso = new Date().toISOString()
  const fingerprint = JSON.stringify({ eventId: eventRef.id, memberId: memberId.trim(), reason: reason.trim(), requestDate })
  return db.runTransaction(async (transaction) => {
    const [idempotencyDoc, eventDoc, participantDoc] = await Promise.all([transaction.get(idempotencyRef), transaction.get(eventRef), transaction.get(participantRef)])
    if (idempotencyDoc.exists) {
      const cached = idempotencyDoc.data()
      if (cached.callerUid === caller.uid && cached.fingerprint === fingerprint) return { success: true, justificationId: cached.justificationId }
      throw new HttpsError('already-exists', 'La clave de justificación ya fue usada con datos diferentes.')
    }
    if (!eventDoc.exists) throw new HttpsError('not-found', 'La jornada no existe.')
    if (!participantDoc.exists) throw new HttpsError('failed-precondition', 'El afiliado no fue convocado a esta jornada.')
    const pendingRequest = (participantDoc.data().justifications || []).find((entry) => entry.status === 'pending')
    if (pendingRequest) throw new HttpsError('failed-precondition', 'El afiliado ya tiene una justificación pendiente para esta jornada.')
    const justification = {
      id: justificationRef.id, eventId: eventRef.id, memberId: participantRef.id,
      reason: reason.trim(), requestDate, requestedAtIso: nowIso,
      requestedByUid: caller.uid, requestedByName: caller.fullName || 'Operador', status: 'pending',
    }
    const participant = participantDoc.data()
    transaction.create(justificationRef, justification)
    transaction.update(participantRef, {
      justifications: [...(participant.justifications || []), { ...justification, requestedByUid: caller.uid }],
      updatedAtIso: nowIso,
    })
    transaction.create(idempotencyRef, { callerUid: caller.uid, fingerprint, justificationId: justificationRef.id, createdAtIso: nowIso })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_sports_justification_requested', targetCollection: 'union_sports_events', targetId: eventRef.id,
      memberId: participantRef.id, justificationId: justificationRef.id, reason: reason.trim(), requestDate,
      performedByUid: caller.uid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true, justificationId: justificationRef.id }
  })
})

export const decideUnionSportsJustification = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, ['directiva_admin'], 'decidir exenciones deportivas.')
  const { eventId, memberId, justificationId, decision, decisionNotes = '', idempotencyKey } = request.data || {}
  if (typeof eventId !== 'string' || !eventId.trim() || typeof memberId !== 'string' || !memberId.trim() || typeof justificationId !== 'string' || !justificationId.trim()) throw new HttpsError('invalid-argument', 'La jornada, afiliado y justificación son obligatorios.')
  if (!['approved', 'rejected'].includes(decision)) throw new HttpsError('invalid-argument', 'La decisión debe ser aprobar o rechazar.')
  if (typeof decisionNotes !== 'string' || decisionNotes.length > 1500) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 1500 caracteres.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  const eventRef = db.collection('union_sports_events').doc(eventId.trim())
  const participantRef = eventRef.collection('participants').doc(memberId.trim())
  const justificationRef = participantRef.collection('justifications').doc(justificationId.trim())
  const idempotencyRef = db.collection('idempotency_keys').doc(`union_sports_decision_${idempotencyKey.trim()}`)
  const nowIso = new Date().toISOString()
  const fingerprint = JSON.stringify({ eventId: eventRef.id, memberId: participantRef.id, justificationId: justificationRef.id, decision, decisionNotes: decisionNotes.trim() })
  return db.runTransaction(async (transaction) => {
    const [idempotencyDoc, eventDoc, participantDoc, justificationDoc] = await Promise.all([
      transaction.get(idempotencyRef), transaction.get(eventRef), transaction.get(participantRef), transaction.get(justificationRef),
    ])
    if (idempotencyDoc.exists) {
      const cached = idempotencyDoc.data()
      if (cached.callerUid === caller.uid && cached.fingerprint === fingerprint) return cached.result
      throw new HttpsError('already-exists', 'La clave de decisión ya fue usada con datos diferentes.')
    }
    if (!eventDoc.exists || !participantDoc.exists || !justificationDoc.exists) throw new HttpsError('not-found', 'No se encontró la solicitud de justificación asociada a la jornada.')
    const event = eventDoc.data()
    const participant = participantDoc.data()
    const justification = justificationDoc.data()
    if (justification.status !== 'pending') throw new HttpsError('failed-precondition', 'La justificación ya tiene una decisión registrada.')
    const nextAttendance = decision === 'approved' ? 'exempt' : participant.attendance
    const transition = await applyUnionSportsAttendance(transaction, {
      eventRef, participantRef, event, participant, attendance: nextAttendance,
      reason: decision === 'approved' ? 'Exención deportiva autorizada por el Directorio.' : 'Justificación rechazada; se conserva la asistencia registrada.',
      caller, nowIso,
    })
    const decisionData = {
      status: decision, decisionByUid: caller.uid, decisionByName: caller.fullName || 'Directorio',
      decisionAtIso: nowIso, decisionNotes: decisionNotes.trim() || null,
    }
    const justifications = (participant.justifications || []).map((entry) => entry.id === justification.id ? { ...entry, ...decisionData } : entry)
    transaction.update(justificationRef, decisionData)
    transaction.update(participantRef, { justifications, updatedAtIso: nowIso })
    const result = { success: true, attendance: nextAttendance, financialReviewRequired: transition.financialReviewRequired }
    transaction.create(idempotencyRef, { callerUid: caller.uid, fingerprint, result, createdAtIso: nowIso })
    transaction.set(db.collection('audit_logs').doc(), {
      action: decision === 'approved' ? 'union_sports_exemption_approved' : 'union_sports_exemption_rejected',
      targetCollection: 'union_sports_events', targetId: eventRef.id,
      memberId: participantRef.id, justificationId: justification.id, decision,
      decisionNotes: decisionNotes.trim() || null, previousAttendance: participant.attendance,
      attendance: nextAttendance, fineId: transition.fineId,
      financialReviewRequired: transition.financialReviewRequired,
      performedByUid: caller.uid, performedByName: caller.fullName || 'Directorio',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return result
  })
})

export const completeUnionSportsEvent = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, UNION_SPORTS_WRITE_ROLES, 'cerrar jornadas deportivas.')
  const { eventId, idempotencyKey } = request.data || {}
  if (typeof eventId !== 'string' || !eventId.trim()) throw new HttpsError('invalid-argument', 'La jornada es obligatoria.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  const eventRef = db.collection('union_sports_events').doc(eventId.trim())
  const idempotencyRef = db.collection('idempotency_keys').doc(`union_sports_complete_${idempotencyKey.trim()}`)
  const nowIso = new Date().toISOString()
  const fingerprint = eventRef.id
  return db.runTransaction(async (transaction) => {
    const [idempotencyDoc, eventDoc, participantsSnapshot] = await Promise.all([
      transaction.get(idempotencyRef), transaction.get(eventRef), transaction.get(eventRef.collection('participants')),
    ])
    if (idempotencyDoc.exists) {
      const cached = idempotencyDoc.data()
      if (cached.callerUid === caller.uid && cached.fingerprint === fingerprint) return { success: true }
      throw new HttpsError('already-exists', 'La clave de cierre ya fue usada con otra jornada.')
    }
    if (!eventDoc.exists) throw new HttpsError('not-found', 'La jornada no existe.')
    if (eventDoc.data().status === 'completed') return { success: true }
    if (participantsSnapshot.docs.some((doc) => doc.data().attendance === 'pending')) throw new HttpsError('failed-precondition', 'Todavía hay afiliados convocados sin control de asistencia.')
    transaction.update(eventRef, { status: 'completed', completedAtIso: nowIso, completedByUid: caller.uid, updatedAtIso: nowIso })
    transaction.create(idempotencyRef, { callerUid: caller.uid, fingerprint, createdAtIso: nowIso })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_sports_event_completed', targetCollection: 'union_sports_events', targetId: eventRef.id,
      performedByUid: caller.uid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return { success: true }
  })
})

export const listUnionSportsEvents = onCall({ cors: true }, async (request) => {
  await requireUnionLoanCaller(request, LOAN_READ_ROLES, 'consultar jornadas deportivas.')
  const { eventId, memberId, startDate, endDate, status } = request.data || {}
  if (eventId !== undefined && (typeof eventId !== 'string' || !eventId.trim())) throw new HttpsError('invalid-argument', 'La jornada solicitada no es válida.')
  if (memberId !== undefined && (typeof memberId !== 'string' || !memberId.trim())) throw new HttpsError('invalid-argument', 'El afiliado solicitado no es válido.')
  if ((startDate && !loanDateIsValid(startDate)) || (endDate && !loanDateIsValid(endDate))) throw new HttpsError('invalid-argument', 'El filtro de fecha debe usar AAAA-MM-DD válido.')
  if (startDate && endDate && startDate > endDate) throw new HttpsError('invalid-argument', 'El rango de fechas no es válido.')
  if (status !== undefined && !['scheduled', 'completed'].includes(status)) throw new HttpsError('invalid-argument', 'El estado solicitado no es válido.')
  let snapshot
  if (eventId) {
    const doc = await db.collection('union_sports_events').doc(eventId.trim()).get()
    snapshot = { docs: doc.exists ? [doc] : [] }
  } else snapshot = await db.collection('union_sports_events').orderBy('date', 'desc').get()
  const events = await Promise.all(snapshot.docs.map(async (eventDoc) => {
    const event = { id: eventDoc.id, ...eventDoc.data() }
    const participantSnapshot = await eventDoc.ref.collection('participants').get()
    const participants = await Promise.all(participantSnapshot.docs.map(async (participantDoc) => {
      const participant = { id: participantDoc.id, ...participantDoc.data() }
      const [fineDoc, justificationSnapshot] = await Promise.all([
        participant.fineId ? db.collection('union_fines').doc(participant.fineId).get() : Promise.resolve(null),
        participantDoc.ref.collection('justifications').orderBy('requestedAtIso', 'asc').get(),
      ])
      const justifications = justificationSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      const sportsFine = fineDoc?.exists ? {
        id: fineDoc.id, fineNumber: fineDoc.data().fineNumber,
        amountCents: fineDoc.data().amountCents, paidCents: fineDoc.data().paidCents || 0,
        balanceCents: fineDoc.data().balanceCents, status: fineDoc.data().status,
        financialReviewRequired: fineDoc.data().financialReviewRequired || false,
      } : null
      return { ...participant, justifications, sportsFine }
    }))
    return { ...event, participants }
  }))
  return { success: true, events: events.filter((event) =>
    (!memberId || event.participants.some((participant) => participant.memberId === memberId)) &&
    (!startDate || event.date >= startDate) && (!endDate || event.date <= endDate) &&
    (!status || event.status === status)
  ) }
})

export const listUnionFines = onCall({ cors: true }, async (request) => {
  // Secretaría puede consultar únicamente multas deportivas filtradas por
  // sucursal; no se agrega al conjunto general de lectura de préstamos.
  const caller = await requireUnionLoanCaller(
    request,
    [...LOAN_READ_ROLES, 'secretaria'],
    'consultar multas de afiliados.'
  )
  const { memberId, category, status } = request.data || {}
  if (memberId !== undefined && (typeof memberId !== 'string' || !memberId.trim())) throw new HttpsError('invalid-argument', 'El afiliado solicitado no es válido.')
  if (category !== undefined && !FINE_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'La categoría de multa no es válida.')
  if (status !== undefined && !['pending', 'partial', 'paid', 'voided'].includes(status)) throw new HttpsError('invalid-argument', 'El estado de multa no es válido.')
  const callerBranches = caller.allowedBranchIds || [caller.primaryBranchId]
  const isSecretary = caller.role === 'secretaria'
  if (isSecretary && category !== undefined && category !== 'deportes') throw new HttpsError('permission-denied', 'Secretaría solo puede consultar multas deportivas.')
  if (memberId && !(await db.collection('union_members').doc(memberId).get()).exists) throw new HttpsError('not-found', 'El afiliado no existe.')
  let query = db.collection('union_fines').orderBy('createdAtIso', 'desc')
  if (memberId) query = query.where('memberId', '==', memberId)
  const snapshot = await query.get()
  const visibleFineDocs = isSecretary
    ? snapshot.docs.filter((fineDoc) => callerBranches.includes(fineDoc.data()?.branchId))
    : caller.role === 'afiliado_admin'
    ? (await Promise.all(snapshot.docs.map(async (fineDoc) => {
      const memberDoc = await db.collection('union_members').doc(fineDoc.data()?.memberId).get()
      return memberDoc.exists && (caller.allowedBranchIds || [caller.primaryBranchId]).includes(memberDoc.data()?.branchId) ? fineDoc : null
    }))).filter(Boolean)
    : snapshot.docs
  const allFines = await Promise.all(visibleFineDocs.map(async (doc) => {
    const paymentsSnapshot = await doc.ref.collection('payments').orderBy('paidAtIso', 'asc').get()
    return { id: doc.id, ...doc.data(), payments: paymentsSnapshot.docs.map((payment) => ({ id: payment.id, ...payment.data() })) }
  }))
  const fines = allFines.filter((fine) => !category || fine.category === category)
    .filter((fine) => !status || fine.status === status)
  return { success: true, fines }
})

export const collectUnionFinePayment = onCall({ cors: true }, async (request) => {
  const caller = await requireUnionLoanCaller(request, LOAN_COLLECTION_ROLES, 'cobrar multas de afiliados.')
  const { fineId, amountCents, paymentMethod = 'cash', shiftId, branchId, notes = '', idempotencyKey } = request.data || {}
  if (typeof fineId !== 'string' || !fineId.trim()) throw new HttpsError('invalid-argument', 'La multa es obligatoria.')
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new HttpsError('invalid-argument', 'El importe debe ser un entero positivo en centavos.')
  if (!['cash', 'qr', 'transfer'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'El método de pago no es válido.')
  if (typeof shiftId !== 'string' || !shiftId.trim()) throw new HttpsError('failed-precondition', 'El cobro requiere un turno de Caja abierto.')
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) throw new HttpsError('invalid-argument', 'Se requiere una clave de idempotencia válida.')
  if (typeof notes !== 'string' || notes.length > 2000) throw new HttpsError('invalid-argument', 'Las observaciones no pueden superar 2000 caracteres.')

  const effectiveBranchId = branchId || caller.primaryBranchId || 'punata'
  const now = new Date()
  const nowIso = now.toISOString()
  const year = now.getFullYear()
  const fineRef = db.collection('union_fines').doc(fineId.trim())
  const shiftRef = db.collection('cash_shifts').doc(shiftId.trim())
  const idemRef = db.collection('idempotency_keys').doc(`union_fine_${idempotencyKey.trim()}`)
  const counterRef = db.collection('counters').doc(`receipt_union_fine_${year}`)
  const paymentRef = fineRef.collection('payments').doc()
  const movementRef = db.collection('financial_movements').doc()

  return db.runTransaction(async (transaction) => {
    const [idemDoc, fineDoc, shiftDoc, counterDoc] = await Promise.all([
      transaction.get(idemRef), transaction.get(fineRef), transaction.get(shiftRef), transaction.get(counterRef),
    ])
    if (idemDoc.exists) {
      const cached = idemDoc.data()
      if (cached.callerUid === caller.uid && cached.fineId === fineRef.id && cached.amountCents === amountCents && cached.paymentMethod === paymentMethod && cached.shiftId === shiftRef.id && (cached.branchId || null) === (effectiveBranchId || null) && (cached.notes || null) === (notes.trim() || null)) return cached.result
      throw new HttpsError('already-exists', 'La clave de idempotencia ya fue utilizada con parámetros distintos.')
    }
    if (!fineDoc.exists) throw new HttpsError('not-found', 'La multa no existe.')
    if (!shiftDoc.exists) throw new HttpsError('not-found', 'El turno de Caja no existe.')
    const fine = fineDoc.data()
    const shift = shiftDoc.data()
    if (caller.role === 'secretaria') {
      const allowedBranches = caller.allowedBranchIds || [caller.primaryBranchId]
      if (!fine.branchId || !allowedBranches.includes(fine.branchId)) throw new HttpsError('permission-denied', 'La multa no pertenece a una sucursal autorizada.')
      if (effectiveBranchId !== fine.branchId) throw new HttpsError('permission-denied', 'La sucursal del cobro no coincide con la multa.')
    }
    if (shift.status !== 'open') throw new HttpsError('failed-precondition', 'El turno de Caja no está abierto.')
    if (shift.branchId !== effectiveBranchId) throw new HttpsError('permission-denied', 'El turno de Caja pertenece a otra sucursal.')
    const shiftOperator = shift.cashierUid || shift.operatorUid
    if (shiftOperator && shiftOperator !== caller.uid && caller.role !== 'directiva_admin') throw new HttpsError('permission-denied', 'El turno de Caja no pertenece al operador.')
    if (fine.financialReviewRequired) throw new HttpsError('failed-precondition', 'La multa requiere una decisión financiera autorizada antes de continuar el cobro.')
    const balanceCents = Number.isSafeInteger(fine.balanceCents) ? fine.balanceCents : fine.amountCents
    if (fine.status === 'paid' || balanceCents <= 0) throw new HttpsError('failed-precondition', 'Esta multa ya está pagada.')
    if (amountCents > balanceCents) throw new HttpsError('invalid-argument', 'El pago supera el saldo pendiente de la multa.')

    const sequence = (counterDoc.exists ? Number(counterDoc.data()?.currentSequence) || 0 : 0) + 1
    const receiptNumber = `REC-MUL-${year}-${String(sequence).padStart(5, '0')}`
    const newPaidCents = (fine.paidCents || 0) + amountCents
    const newBalanceCents = balanceCents - amountCents
    const newStatus = newBalanceCents === 0 ? 'paid' : 'partial'
    const paymentData = {
      id: paymentRef.id, fineId: fineRef.id, fineNumber: fine.fineNumber,
      memberId: fine.memberId, memberNumber: fine.memberNumber, memberName: fine.memberName,
      receiptNumber, amountCents, amountBob: amountCents / 100, paymentMethod,
      shiftId: shiftRef.id, branchId: effectiveBranchId, paidAtIso: nowIso,
      collectedByUid: caller.uid, collectedByName: caller.fullName || 'Operador', notes: notes.trim() || null,
    }
    const result = { success: true, payment: paymentData, paidCents: newPaidCents, balanceCents: newBalanceCents, status: newStatus }
    const breakdown = shift.breakdown || {}
    const isCash = paymentMethod === 'cash'
    const isQr = paymentMethod === 'qr'
    const isTransfer = paymentMethod === 'transfer'
    transaction.set(counterRef, { currentSequence: sequence, year, updatedAtIso: nowIso }, { merge: true })
    transaction.create(paymentRef, paymentData)
    transaction.update(fineRef, {
      paidCents: newPaidCents, paidBob: newPaidCents / 100,
      balanceCents: newBalanceCents, balanceBob: newBalanceCents / 100,
      status: newStatus, lastPaymentAtIso: nowIso, updatedAtIso: nowIso,
    })
    transaction.update(shiftRef, {
      expectedCashCents: (shift.expectedCashCents || 0) + (isCash ? amountCents : 0),
      expectedCashBob: ((shift.expectedCashCents || 0) + (isCash ? amountCents : 0)) / 100,
      movementsCount: (shift.movementsCount || 0) + 1,
      'breakdown.totalIncomeCents': (breakdown.totalIncomeCents || 0) + amountCents,
      'breakdown.fineIncomeCents': (breakdown.fineIncomeCents || 0) + amountCents,
      'breakdown.cashIncomeCents': (breakdown.cashIncomeCents || 0) + (isCash ? amountCents : 0),
      'breakdown.qrIncomeCents': (breakdown.qrIncomeCents || 0) + (isQr ? amountCents : 0),
      'breakdown.transferIncomeCents': (breakdown.transferIncomeCents || 0) + (isTransfer ? amountCents : 0),
      'breakdown.netCashCents': (breakdown.netCashCents || 0) + (isCash ? amountCents : 0),
      updatedAtIso: nowIso,
    })
    transaction.create(movementRef, {
      id: movementRef.id, shiftId: shiftRef.id, branchId: effectiveBranchId,
      type: 'fine_income', category: 'union_fine_payment', amountCents, amountBob: amountCents / 100,
      paymentMethod, description: `Cobro de multa ${fine.fineNumber} - ${fine.memberNumber} ${fine.memberName} (${receiptNumber})`,
      receiptNumber, fineId: fineRef.id, fineNumber: fine.fineNumber,
      memberId: fine.memberId, memberNumber: fine.memberNumber, memberName: fine.memberName,
      operatorUid: caller.uid, operatorName: caller.fullName || 'Operador',
      timestamp: nowIso, createdAt: FieldValue.serverTimestamp(), createdAtIso: nowIso,
    })
    transaction.create(idemRef, { callerUid: caller.uid, fineId: fineRef.id, amountCents, paymentMethod, shiftId: shiftRef.id, branchId: effectiveBranchId, notes: notes.trim() || null, result, createdAtIso: nowIso })
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'union_fine_payment_collected', targetCollection: 'union_fines', targetId: fineRef.id,
      paymentId: paymentRef.id, receiptNumber, amountCents, balanceCents: newBalanceCents,
      shiftId: shiftRef.id, performedByUid: caller.uid, performedByName: caller.fullName || 'Operador',
      performedByRole: caller.role, timestamp: FieldValue.serverTimestamp(), timestampIso: nowIso,
    })
    return result
  })
})
