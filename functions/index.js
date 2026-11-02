import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

if (getApps().length === 0) {
  initializeApp()
}

const db = getFirestore()

// Tarifas canónicas oficiales en centavos
const TARIFFS = {
  baseFeeCents: 1500, // Bs. 15.00
  freeWeightKg: 3,
  extraKgRateCents: 200, // Bs. 2.00 por kg adicional
  homeDeliveryFeeCents: 1200, // Bs. 12.00
}

/**
 * Cloud Function Callable para la creación atómica, segura e idempotente de encomiendas.
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
  if (deliveryType === 'home' && (!deliveryAddress || deliveryAddress.trim().length < 5)) {
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

  // 10. Cálculo canónico del costo en centavos enteros
  const chargeableExcessWeightKg = Math.max(0, Math.round((totalWeightKg - TARIFFS.freeWeightKg) * 100) / 100)
  const baseFeeCents = TARIFFS.baseFeeCents
  const weightSurchargeCents = Math.round(chargeableExcessWeightKg * TARIFFS.extraKgRateCents)
  const homeDeliveryFeeCents = deliveryType === 'home' ? TARIFFS.homeDeliveryFeeCents : 0
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
      const existingTrackingCode = idempDoc.data().trackingCode
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

      // Condición de cobro
      paymentTiming,
      paymentStatus: isPaid ? 'paid' : 'pending',
      paymentMethod: isPaid ? paymentMethod : null,
      paidAt: isPaid ? nowIso : null,
      paidCashierUid: isPaid ? callerUid : null,
      paidCashierName: isPaid ? (userProfile.fullName || 'Secretaria') : null,

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

    // E. Escribir operaciones atómicas en la transacción
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
      createdAt: FieldValue.serverTimestamp(),
      callerUid,
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
