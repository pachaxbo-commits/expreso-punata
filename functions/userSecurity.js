import { onCall, HttpsError } from 'firebase-functions/v2/https'

export function createUserSecurityFunctions(db, authAdmin, isOperationalAdmin) {
  const adminRevokeUserSessions = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const caller = await db.collection('users').doc(request.auth.uid).get()
    if (!caller.exists || caller.data()?.isActive !== true || !isOperationalAdmin(caller.data())) throw new HttpsError('permission-denied', 'Solo la administración puede revocar sesiones.')
    const authTime = request.auth.token?.auth_time
    const now = Date.now() / 1000
    if (!Number.isFinite(authTime) || now - authTime > 300 || authTime > now + 30) throw new HttpsError('failed-precondition', 'Vuelva a iniciar sesión para confirmar la operación.')
    const { targetUid, reason, confirmation } = request.data || {}
    if (typeof targetUid !== 'string' || !targetUid || targetUid.includes('/') || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500 || confirmation !== true) throw new HttpsError('invalid-argument', 'Confirme la operación e indique un motivo de al menos 10 caracteres.')
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
    if (typeof targetUid !== 'string' || !targetUid || targetUid.includes('/') || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500 || confirmation !== true || !/^[a-zA-Z0-9_-]{12,80}$/.test(operationId || '')) throw new HttpsError('invalid-argument', 'Confirme la cuenta y proporcione un motivo válido.')
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
        if (value.targetUid !== targetUid || value.actorUid !== request.auth.uid || value.reason !== reason.trim()) throw new HttpsError('already-exists', 'Identificador de operación ya utilizado.')
        return value
      }
      const profile = await tx.get(target)
      if (!profile.exists) throw new HttpsError('not-found', 'El perfil no existe.')
      const data = profile.data()
      if (data.syncStatus === 'retiring') throw new HttpsError('failed-precondition', 'Ya existe una baja en curso; reintente la operación original.')
      if (data.role === 'soporte_pachax') throw new HttpsError('permission-denied', 'La cuenta técnica requiere un procedimiento independiente.')
      const locks = await tx.get(db.collection('cash_shift_active_locks').where('operatorUid', '==', targetUid))
      if (locks.docs.some(doc => doc.data().status === 'open')) throw new HttpsError('failed-precondition', 'La cuenta tiene un candado de caja abierto; resuélvalo antes de la baja.')
      const shifts = await tx.get(db.collection('cash_shifts').where('operatorUid', '==', targetUid))
      if (shifts.docs.some(doc => doc.data().status === 'open')) throw new HttpsError('failed-precondition', 'La cuenta tiene un turno de caja abierto.')
      const manifests = await tx.get(db.collection('manifests').where('driverUid', '==', targetUid))
      if (manifests.docs.some(doc => ['dispatched', 'in_transit'].includes(doc.data().status))) throw new HttpsError('failed-precondition', 'El conductor tiene un manifiesto o traslado activo.')
      const commission = await tx.get(db.collection('driver_commission_accounts').doc(targetUid))
      if (Number(commission.data()?.pendingCents || 0) > 0) throw new HttpsError('failed-precondition', 'El conductor tiene comisiones pendientes de liquidación.')
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
        const profile = await tx.get(target)
        if (profile.data()?.retirementOperationId !== operationId) throw new HttpsError('aborted', 'La reserva de baja cambió.')
        tx.update(target, { isActive: false, syncStatus: 'retired' })
        tx.update(op, { status: 'completed', completedAtIso: new Date().toISOString() })
        tx.update(audit, { result: 'success' })
      })
      return { success: true, operationId, disposition: 'disabled', message: 'Acceso retirado; identidad y perfil conservados para revisión de referencias.' }
    } catch (error) {
      await audit.update({ result: 'retry_required' }).catch(() => {})
      throw new HttpsError('unavailable', 'Baja incompleta; reintente con el mismo identificador. El perfil permanece inactivo.')
    }
  })
  return { adminRevokeUserSessions, adminRetireUser }
}
