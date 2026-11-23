import { onCall, HttpsError } from 'firebase-functions/v2/https'

const isOperationId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value)
const isUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && !['.', '..'].includes(value)
const canDeleteInEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true'
  && Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST)
  && (process.env.GCLOUD_PROJECT || '').startsWith('demo-')

async function assertNoResponsibilities(tx, db, uid) {
  const query = (collection, field) => tx.get(db.collection(collection).where(field, '==', uid))
  const account = collection => tx.get(db.collection(collection).doc(uid))
  const [locks, shifts, manifests, commission, custody, custodyRecords, tickets, assets, assignedShipments, collectedShipments] = await Promise.all([
    query('cash_shift_active_locks', 'operatorUid'),
    query('cash_shifts', 'operatorUid'),
    query('manifests', 'driverUid'),
    account('driver_commission_accounts'),
    account('driver_custody_accounts'),
    query('driver_custody_records', 'driverUid'),
    query('passenger_ticket_operations', 'driverUid'),
    query('fixed_assets', 'responsiblePersonUid'),
    query('shipments', 'assignedVehicle.driverUid'),
    query('shipments', 'collectedByDriverUid'),
  ])
  const block = message => { throw new HttpsError('failed-precondition', message) }
  if (locks.docs.some(doc => doc.data().status === 'open') || shifts.docs.some(doc => doc.data().status === 'open')) block('La cuenta tiene caja abierta.')
  if (manifests.docs.some(doc => ['dispatched', 'in_transit'].includes(doc.data().status))) block('El conductor tiene un manifiesto o traslado activo.')
  if (assignedShipments.docs.some(doc => doc.data().status === 'in_transit')) block('El conductor tiene una encomienda en tránsito.')
  if (collectedShipments.docs.some(doc => {
    const custody = doc.data().driverCustody
    return custody?.inCustody === true && custody.reconciled !== true
  })) block('El conductor tiene guías con cobros bajo custodia.')
  if (Number(commission.data()?.pendingCents || 0) > 0) block('El conductor tiene comisiones pendientes de liquidación.')
  if (Number(custody.data()?.cashUnderCustodyCents || 0) > 0 || Number(custody.data()?.pendingRemittanceCents || 0) > 0 || custodyRecords.docs.some(doc => ['pending_remittance', 'partially_remitted'].includes(doc.data().status))) block('El conductor tiene cobros de encomiendas bajo custodia.')
  if (assets.docs.some(doc => doc.data().status !== 'disposed')) block('La cuenta figura como responsable de un bien patrimonial vigente.')
  if (tickets.docs.some(doc => {
    const ticket = doc.data()
    return ticket.paymentStatus !== 'cancelled' && !ticket.cancelledAtIso && (['pending_boarding', 'partially_used'].includes(ticket.useStatus) || Number(ticket.pendingSettlementCents || 0) > 0)
  })) block('El conductor tiene pasajes pendientes de embarque o liquidación.')
}

async function markRetry(db, op, audit) {
  await db.runTransaction(async tx => {
    const current = await tx.get(op)
    if (current.data()?.status === 'completed') return
    tx.update(op, { status: 'retry_required' })
    tx.update(audit, { result: 'retry_required' })
  })
}

export function createUserSecurityFunctions(db, authAdmin, isOperationalAdmin) {
  const adminRevokeUserSessions = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const caller = await db.collection('users').doc(request.auth.uid).get()
    if (!caller.exists || caller.data()?.isActive !== true || !isOperationalAdmin(caller.data())) throw new HttpsError('permission-denied', 'Solo la administración puede revocar sesiones.')
    const authTime = request.auth.token?.auth_time
    const now = Date.now() / 1000
    if (!Number.isFinite(authTime) || now - authTime > 300 || authTime > now + 30) throw new HttpsError('failed-precondition', 'Vuelva a iniciar sesión para confirmar la operación.')
    const { targetUid, reason, confirmation } = request.data || {}
    if (!isUid(targetUid) || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500 || confirmation !== true) throw new HttpsError('invalid-argument', 'Confirme la operación e indique un motivo de al menos 10 caracteres.')
    const target = await db.collection('users').doc(targetUid).get()
    if (!target.exists) throw new HttpsError('not-found', 'El perfil no existe.')
    if (target.data()?.role === 'soporte_pachax') throw new HttpsError('permission-denied', 'La cuenta técnica requiere el procedimiento de PACHAX.')
    const audit = db.collection('audit_logs').doc()
    const timestamp = new Date().toISOString()
    await audit.create({ entityType: 'user_profile', entityId: targetUid, action: 'USER_SESSIONS_REVOKED', performedByUid: request.auth.uid, branchId: target.data()?.primaryBranchId || null, reason: reason.trim(), timestampIso: timestamp, result: 'pending' })
    try {
      await authAdmin.revokeRefreshTokens(targetUid)
      await audit.update({ result: 'success' })
      return { success: true, auditId: audit.id }
    } catch (error) {
      await audit.update({ result: 'failed' }).catch(() => {})
      throw new HttpsError('internal', 'No se pudo completar la revocación; revise la auditoría.')
    }
  })
  const adminRetireUser = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const { targetUid, reason, confirmation, operationId } = request.data || {}
    const authTime = request.auth.token?.auth_time
    if (!Number.isFinite(authTime) || Date.now() / 1000 - authTime > 300 || authTime > Date.now() / 1000 + 30) throw new HttpsError('failed-precondition', 'Vuelva a iniciar sesión.')
    if (!isUid(targetUid) || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500 || confirmation !== true || !isOperationId(operationId)) throw new HttpsError('invalid-argument', 'Confirme la cuenta y proporcione un motivo válido.')
    if (targetUid === request.auth.uid) throw new HttpsError('failed-precondition', 'Otra cuenta administradora debe realizar la baja.')
    const op = db.collection('user_retirement_operations').doc(operationId)
    const target = db.collection('users').doc(targetUid)
    const audit = db.collection('audit_logs').doc(`retire-${operationId}`)
    const reservation = await db.runTransaction(async tx => {
      await tx.get(db.collection('system_locks').doc('admin_management'))
      const caller = await tx.get(db.collection('users').doc(request.auth.uid))
      if (!caller.exists || caller.data()?.isActive !== true || !isOperationalAdmin(caller.data())) throw new HttpsError('permission-denied', 'Solo la administración puede dar de baja usuarios.')
      const prior = await tx.get(op)
      if (prior.exists) {
        const value = prior.data()
        if (value.targetUid !== targetUid || value.reason !== reason.trim()) throw new HttpsError('already-exists', 'Identificador de operación ya utilizado.')
        return value
      }
      const profile = await tx.get(target)
      if (!profile.exists) throw new HttpsError('not-found', 'El perfil no existe.')
      const data = profile.data()
      if (['syncing', 'failed', 'retiring', 'retired', 'auth_deleted'].includes(data.syncStatus)) throw new HttpsError('failed-precondition', 'Ya existe una baja en curso; reintente la operación original.')
      if (data.role === 'soporte_pachax') throw new HttpsError('permission-denied', 'La cuenta técnica requiere un procedimiento independiente.')
      await assertNoResponsibilities(tx, db, targetUid)
      if (data.isActive === true && data.role === 'afiliado_admin' && isOperationalAdmin(data)) {
        const admins = await tx.get(db.collection('users').where('role', 'in', ['directiva_admin', 'afiliado_admin']).where('isActive', '==', true))
        if (!admins.docs.some(doc => doc.id !== targetUid && doc.data().role === 'afiliado_admin' && isOperationalAdmin(doc.data()) && !['syncing', 'failed', 'retiring', 'retired'].includes(doc.data().syncStatus))) throw new HttpsError('failed-precondition', 'No se puede retirar al último administrador activo.')
      }
      const record = { targetUid, actorUid: request.auth.uid, reason: reason.trim(), status: 'pending', previousRole: data.role || null, branchId: data.primaryBranchId || null, createdAtIso: new Date().toISOString() }
      tx.set(db.collection('system_locks').doc('admin_management'), { modifiedUid: targetUid, lastUpdateAt: new Date() }, { merge: true })
      tx.update(target, { isActive: false, syncStatus: 'retiring', retirementOperationId: operationId })
      tx.create(op, record)
      tx.create(audit, { entityType: 'user_profile', entityId: targetUid, action: 'USER_RETIRED', performedByUid: request.auth.uid, reason: record.reason, branchId: record.branchId, previousRole: record.previousRole, result: 'pending', timestampIso: record.createdAtIso })
      return record
    })
    if (reservation.status === 'completed') return { success: true, operationId, disposition: 'disabled', message: 'Acceso retirado; identidad y perfil conservados para revisión de referencias.' }
    try {
      const user = await authAdmin.getUser(targetUid)
      await authAdmin.updateUser(targetUid, { disabled: true })
      await authAdmin.setCustomUserClaims(targetUid, { ...(user.customClaims || {}), isActive: false })
      await authAdmin.revokeRefreshTokens(targetUid)
      await db.runTransaction(async tx => {
        const [profile, operation] = await Promise.all([tx.get(target), tx.get(op)])
        if (operation.data()?.status === 'completed') return
        if (profile.data()?.retirementOperationId !== operationId || profile.data()?.syncStatus !== 'retiring') throw new HttpsError('aborted', 'La reserva de baja cambió.')
        tx.update(target, { isActive: false, syncStatus: 'retired' })
        tx.update(op, { status: 'completed', completedAtIso: new Date().toISOString(), completedByUid: request.auth.uid })
        tx.update(audit, { result: 'success', completedByUid: request.auth.uid })
      })
      return { success: true, operationId, disposition: 'disabled', message: 'Acceso retirado; identidad y perfil conservados para revisión de referencias.' }
    } catch (error) {
      await markRetry(db, op, audit).catch(() => {})
      throw new HttpsError('unavailable', 'Baja incompleta; reintente con el mismo identificador. El perfil permanece inactivo.')
    }
  })
  const adminDeleteRetiredUser = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const { targetUid, operationId, reason, confirmation } = request.data || {}
    const now = Date.now() / 1000, authTime = request.auth.token?.auth_time
    if (!Number.isFinite(authTime) || now - authTime > 300 || authTime > now + 30) throw new HttpsError('failed-precondition', 'Vuelva a iniciar sesión.')
    if (!isUid(targetUid) || !isOperationId(operationId) || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500 || confirmation !== true) throw new HttpsError('invalid-argument', 'Confirme la operación y el motivo.')
    if (!canDeleteInEmulator()) throw new HttpsError('failed-precondition', 'Eliminación bloqueada: las responsabilidades operativas aún no están verificadas para producción.')
    const profileRef = db.collection('users').doc(targetUid), opRef = db.collection('user_deletion_operations').doc(operationId), auditRef = db.collection('audit_logs').doc(`delete-${operationId}`)
    const result = await db.runTransaction(async tx => {
      await tx.get(db.collection('system_locks').doc('admin_management'))
      const caller = await tx.get(db.collection('users').doc(request.auth.uid))
      if (caller.data()?.isActive !== true || !isOperationalAdmin(caller.data())) throw new HttpsError('permission-denied', 'Solo la administración puede eliminar cuentas.')
      const prior = await tx.get(opRef)
      if (prior.exists) {
        const op = prior.data()
        if (op.targetUid !== targetUid || op.reason !== reason.trim()) throw new HttpsError('already-exists', 'Identificador asociado a otra operación.')
        if (op.status !== 'completed') {
          const profile = (await tx.get(profileRef)).data()
          if (profile?.authDeletionOperationId !== operationId || profile.syncStatus !== 'retired'
            || profile.isActive !== false || profile.emulatorDeletionEligible !== true
            || ['afiliado_admin', 'directiva_admin', 'soporte_pachax'].includes(profile.role)) {
            throw new HttpsError('failed-precondition', 'La cuenta ya no cumple los requisitos de eliminación.')
          }
          await assertNoResponsibilities(tx, db, targetUid)
        }
        return op
      }
      const profile = await tx.get(profileRef)
      const p = profile.data()
      if (!profile.exists) throw new HttpsError('not-found', 'Perfil no encontrado.')
      if (p.role === 'soporte_pachax') throw new HttpsError('permission-denied', 'Las cuentas técnicas están protegidas.')
      if (p.role === 'afiliado_admin' || p.role === 'directiva_admin') throw new HttpsError('failed-precondition', 'La eliminación de administradores está bloqueada.')
      if (p.isActive !== false || p.syncStatus !== 'retired' || p.emulatorDeletionEligible !== true) throw new HttpsError('failed-precondition', 'La cuenta debe estar de baja y ser un caso sintético verificable.')
      if (p.authDeletionOperationId) throw new HttpsError('failed-precondition', 'Ya existe una operación de eliminación para esta cuenta.')
      await assertNoResponsibilities(tx, db, targetUid)
      const op = { targetUid, reason: reason.trim(), status: 'pending', createdBy: request.auth.uid, createdAtIso: new Date().toISOString() }
      tx.create(opRef, op)
      tx.create(auditRef, { action: 'USER_AUTH_DELETION', entityType: 'user_profile', entityId: targetUid, performedByUid: request.auth.uid, reason: op.reason, result: 'pending', timestampIso: op.createdAtIso })
      tx.update(profileRef, { authDeletionOperationId: operationId })
      return op
    })
    if (result.status === 'completed') return { success: true, operationId, status: 'completed' }
    try {
      let identity
      try { identity = await authAdmin.getUser(targetUid) } catch (error) { if (error.code !== 'auth/user-not-found') throw error }
      if (identity && !identity.disabled) throw new Error('La identidad aún está habilitada.')
      if (identity) {
        try { await authAdmin.deleteUser(targetUid) } catch (error) { if (error.code !== 'auth/user-not-found') throw error }
      }
      try { await authAdmin.getUser(targetUid); throw new Error('La identidad todavía existe.') } catch (error) { if (error.code !== 'auth/user-not-found') throw error }
      await db.runTransaction(async tx => {
        const [profile, operation] = await Promise.all([tx.get(profileRef), tx.get(opRef)])
        if (operation.data()?.status === 'completed') return
        if (profile.data()?.authDeletionOperationId !== operationId || profile.data()?.isActive !== false) throw new Error('El perfil cambió durante la eliminación.')
        tx.update(profileRef, { syncStatus: 'auth_deleted' })
        tx.update(opRef, { status: 'completed', completedAtIso: new Date().toISOString(), completedByUid: request.auth.uid })
        tx.update(auditRef, { result: 'success', completedByUid: request.auth.uid })
      })
      return { success: true, operationId, status: 'completed' }
    } catch (error) {
      await markRetry(db, opRef, auditRef).catch(() => {})
      throw new HttpsError('unavailable', 'Eliminación pendiente; reintente la misma operación.')
    }
  })
  const getUserDeletionStatus = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const caller = await db.collection('users').doc(request.auth.uid).get()
    if (caller.data()?.isActive !== true || !isOperationalAdmin(caller.data())) throw new HttpsError('permission-denied', 'Solo la administración puede consultar operaciones.')
    const { operationId, targetUid, kind = 'deletion' } = request.data || {}
    if (!['retirement', 'deletion'].includes(kind)) throw new HttpsError('invalid-argument', 'Tipo de operación inválido.')
    const readOperation = async (id, type) => {
      if (!isOperationId(id)) return null
      const operation = await db.collection(`user_${type}_operations`).doc(id).get()
      if (!operation.exists) return null
      const value = operation.data()
      return { operationId: id, targetUid: value.targetUid, status: value.status, reason: value.reason }
    }
    if (operationId !== undefined) {
      if (!isOperationId(operationId)) throw new HttpsError('invalid-argument', 'Identificador inválido.')
      const operation = await readOperation(operationId, kind)
      if (!operation) throw new HttpsError('not-found', 'Operación no encontrada.')
      return operation
    }
    if (!isUid(targetUid)) throw new HttpsError('invalid-argument', 'Usuario inválido.')
    const profile = (await db.collection('users').doc(targetUid).get()).data()
    if (!profile) throw new HttpsError('not-found', 'Perfil no encontrado.')
    const [retirement, deletion] = await Promise.all([
      readOperation(profile.retirementOperationId, 'retirement'),
      readOperation(profile.authDeletionOperationId, 'deletion'),
    ])
    const deletionBlockedReason = !canDeleteInEmulator() ? 'Eliminación de Auth disponible únicamente en emuladores de demostración.'
      : ['afiliado_admin', 'directiva_admin', 'soporte_pachax'].includes(profile.role) ? 'La cuenta está protegida.'
      : profile.emulatorDeletionEligible !== true ? 'La cuenta no está marcada como sintética.'
      : profile.syncStatus !== 'retired' ? 'La cuenta debe estar dada de baja.'
      : null
    return { retirement, deletion, deletionBlockedReason }
  })
  return { adminRevokeUserSessions, adminRetireUser, adminDeleteRetiredUser, getUserDeletionStatus }
}
