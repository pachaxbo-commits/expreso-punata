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
  return { adminRevokeUserSessions }
}
