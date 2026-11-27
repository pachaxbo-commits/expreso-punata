import { commercialSettingsRef, effectiveCommercialRule, localBusinessDay } from './commercialSettings.js'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { createSupportCleanupFunctions } from './supportCleanup.js'
import { inFirebaseEmulators, verifySupportSession } from './supportAccess.js'
const CONFIG_FIELDS = {
  tradeName: 'company.tradeName',
  legalName: 'company.legalName',
  logoUrl: 'company.logoUrl',
  legalNotice: 'company.legalNotice',
  passengerNotice: 'documentNotices.passengers',
  contributionsNotice: 'documentNotices.contributions',
  personnelNotice: 'documentNotices.personnel',
  inventoryNotice: 'documentNotices.inventory',
  reportDatePreset: 'reportPreferences.datePreset',
  punataName: 'branches.punata.name',
  punataAddress: 'branches.punata.address',
  punataPhone: 'branches.punata.phone',
  cochabambaName: 'branches.cochabamba.name',
  cochabambaAddress: 'branches.cochabamba.address',
  cochabambaPhone: 'branches.cochabamba.phone',
}

const EVERYDAY_FIELDS = new Set(['tradeName', 'legalName', 'logoUrl',
  'punataName', 'punataAddress', 'punataPhone', 'cochabambaName', 'cochabambaAddress', 'cochabambaPhone'])

function validateInstitutionalValue(field, value, restoring) {
  const max = field.endsWith('Phone') ? 24 : field === 'logoUrl' ? 1000 : field.endsWith('Notice') ? 160 : 100
  if (value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new HttpsError('invalid-argument', `El campo ${field} admite hasta ${max} caracteres en una línea.`)
  if ((field === 'tradeName' || field.endsWith('Name')) && value.length < 2 && !(restoring && !value)) throw new HttpsError('invalid-argument', 'Ingrese un nombre de al menos dos caracteres.')
  if (field.endsWith('Phone') && value && (!/^[+0-9 ()-]+$/.test(value) || value.replace(/\D/g, '').length < 7)) throw new HttpsError('invalid-argument', 'El teléfono debe incluir al menos siete dígitos.')
  if (field === 'reportDatePreset' && !['', 'today', 'this_week', 'this_month', 'last_month'].includes(value)) {
    throw new HttpsError('invalid-argument', 'Período de reportes: seleccione un período admitido.')
  }
  if (field === 'logoUrl' && value) {
    const url = URL.parse(value)
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new HttpsError('invalid-argument', 'El logotipo requiere una URL HTTPS pública sin credenciales ni parámetros.')
  }
}

function requireInstitutionalEditor(profile, request, allowBoardAdmin = false) {
  if (allowBoardAdmin && profile?.role === 'directiva_admin' && profile.isActive === true) return
  if (profile?.role === 'afiliado_admin' && profile.isActive === true && ['punata', 'cochabamba'].includes(profile.primaryBranchId)
    && ['punata', 'cochabamba'].every(branch => Array.isArray(profile.allowedBranchIds) && profile.allowedBranchIds.includes(branch))) return
  if (profile?.role !== 'soporte_pachax' || profile.isActive !== true) throw new HttpsError('permission-denied', 'Se requiere una cuenta autorizada para configuración institucional.')
  if (!inEmulators() && !request.auth.token?.firebase?.sign_in_second_factor) throw new HttpsError('permission-denied', 'Se requiere autenticación multifactor.')
}

function configValue(config, key) {
  const value = CONFIG_FIELDS[key].split('.').reduce((obj, part) => obj?.[part], config)
  return typeof value === 'string' ? value : ''
}
const inEmulators = inFirebaseEmulators

async function authorize(db, request, recent = false, authAdmin = null) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
  const profile = await db.collection('users').doc(request.auth.uid).get()
  if (!profile.exists || profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) {
    throw new HttpsError('permission-denied', 'Acceso exclusivo de Soporte PACHAX.')
  }
  await verifySupportSession(authAdmin, request, recent)
}

export function createSupportFunctions(db, authAdmin = null) {
  const authorizeSupport = (request, recent = false) => authorize(db, request, recent, authAdmin)
  const cleanup = createSupportCleanupFunctions(db, authorizeSupport)
  const getSupportOverview = onCall({ cors: true }, async request => {
    await authorizeSupport(request)
    const config = await db.collection('system_config').doc('expreso_punata').get()
    const versioned = effectiveCommercialRule((await commercialSettingsRef(db, 'commission').get()).data(), localBusinessDay())
    const c = versioned ? { defaultType: versioned.enabled ? versioned.type : null, defaultValue: versioned.value } : config.data()?.commissions || {}
    const value = Number(c.defaultValue)
    const validRule = ['percentage', 'fixed_per_shipment'].includes(c.defaultType) && Number.isFinite(value) && value > 0 && (c.defaultType !== 'percentage' || value <= 100)
    return { services: { functions: 'disponible', firestore: 'disponible' }, commissionsConfigured: config.data()?.status === 'configured' && config.data()?.isOfficial === true && validRule, cleanupEnvironment: inEmulators() ? 'emulador' : 'no disponible en producción' }
  })
  const getSupportConfiguration = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const profile = (await db.collection('users').doc(request.auth.uid).get()).data()
    requireInstitutionalEditor(profile, request, true)
    if (profile?.role === 'soporte_pachax') await authorizeSupport(request)
    const [config, history] = await Promise.all([
      db.collection('system_config').doc('expreso_punata').get(),
      db.collection('support_config_history').orderBy('createdAtIso', 'desc').limit(20).get(),
    ])
    if (!config.exists || config.data()?.status !== 'configured' || config.data()?.isOfficial !== true) throw new HttpsError('failed-precondition', 'La configuración institucional oficial aún no está habilitada.')
    const data = config.data()
    return { versions: data.institutionalVersions || {}, values: Object.fromEntries(Object.keys(CONFIG_FIELDS).map(key => [key, configValue(data, key)])), history: history.docs.map(doc => ({ id: doc.id, ...doc.data() })) }
  })
  const updateSupportConfiguration = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    if (request.data?.changes !== undefined) {
      const { changes } = request.data
      const uid = request.auth.uid
      if (!Array.isArray(changes) || !changes.length || changes.length > EVERYDAY_FIELDS.size ||
          new Set(changes.map(change => change?.field)).size !== changes.length ||
          changes.some(change => !EVERYDAY_FIELDS.has(change?.field) || typeof change.value !== 'string' ||
            typeof change.expectedValue !== 'string' || !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 0)) {
        throw new HttpsError('invalid-argument', 'Revise los datos de empresa y agencias.')
      }
      const configRef = db.collection('system_config').doc('expreso_punata')
      return db.runTransaction(async tx => {
        const [profile, config] = await Promise.all([tx.get(db.collection('users').doc(uid)), tx.get(configRef)])
        if (profile.data()?.role === 'soporte_pachax') throw new HttpsError('permission-denied', 'La edición cotidiana corresponde a la administración.')
        requireInstitutionalEditor(profile.data(), request, true)
        const current = config.data()
        if (current?.status !== 'configured' || current.isOfficial !== true) throw new HttpsError('failed-precondition', 'No existe una configuración oficial activa.')
        const patch = {}
        for (const { field, value, expectedValue, expectedVersion } of changes) {
          const previous = configValue(current, field)
          const version = current.institutionalVersions?.[field] || 0
          if (previous !== expectedValue || version !== expectedVersion) throw new HttpsError('aborted', 'Los datos cambiaron. Recargue la configuración antes de guardar.')
          const next = value.trim()
          if (next === previous) continue
          validateInstitutionalValue(field, next, false)
          patch[CONFIG_FIELDS[field]] = next
          if (field === 'tradeName') patch['company.name'] = next
          patch[`institutionalVersions.${field}`] = version + 1
          const entry = { field, previous, value: next, version: version + 1, restoredFrom: null, reason: 'Edición de empresa y agencias', uid, createdAtIso: new Date().toISOString() }
          tx.create(db.collection('support_config_history').doc(), entry)
          tx.create(db.collection('audit_logs').doc(), { action: 'SUPPORT_CONFIG_UPDATED', entityType: 'system_config', entityId: 'expreso_punata', ...entry })
        }
        if (Object.keys(patch).length) tx.update(configRef, patch)
        return { success: true }
      })
    }
    const authTime = request.auth.token?.auth_time
    if (!Number.isFinite(authTime) || Date.now() / 1000 - authTime > 300 || authTime > Date.now() / 1000 + 30) throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
    const { field, value, expectedValue, expectedVersion, reason, confirmation, restoreHistoryId } = request.data || {}
    if (!Object.hasOwn(CONFIG_FIELDS, field) || (!restoreHistoryId && typeof value !== 'string') || typeof expectedValue !== 'string' || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500 || confirmation !== true) throw new HttpsError('invalid-argument', 'Confirme la modificación e indique un motivo válido.')
    if (restoreHistoryId !== undefined && (typeof restoreHistoryId !== 'string' || !/^[a-zA-Z0-9]{20}$/.test(restoreHistoryId))) throw new HttpsError('invalid-argument', 'Versión histórica inválida.')
    const configRef = db.collection('system_config').doc('expreso_punata')
    const currentProfile = (await db.collection('users').doc(request.auth.uid).get()).data()
    if (currentProfile?.role === 'soporte_pachax') await authorizeSupport(request, true)
    const historyRef = db.collection('support_config_history').doc()
    const auditRef = db.collection('audit_logs').doc()
    return db.runTransaction(async tx => {
      const [profile, config] = await Promise.all([tx.get(db.collection('users').doc(request.auth.uid)), tx.get(configRef)])
      requireInstitutionalEditor(profile.data(), request)
      if (!config.exists || config.data()?.status !== 'configured' || config.data()?.isOfficial !== true) throw new HttpsError('failed-precondition', 'No existe una configuración oficial activa.')
      const previous = configValue(config.data(), field)
      const version = config.data().institutionalVersions?.[field] || 0
      if (previous !== expectedValue || (expectedVersion ?? 0) !== version) throw new HttpsError('aborted', 'El valor cambió; recargue la configuración.')
      const historical = restoreHistoryId && (await tx.get(db.collection('support_config_history').doc(restoreHistoryId))).data()
      if (restoreHistoryId && historical?.field !== field) throw new HttpsError('not-found', 'No se encontró la versión para este campo.')
      const next = (historical ? historical.previous : value).trim()
      validateInstitutionalValue(field, next, Boolean(historical))
      if (previous === next) throw new HttpsError('failed-precondition', 'El valor no cambió.')
      const entry = { field, previous, value: next, version: version + 1, restoredFrom: restoreHistoryId || null, reason: reason.trim(), uid: request.auth.uid, createdAtIso: new Date().toISOString() }
      tx.update(configRef, { [CONFIG_FIELDS[field]]: next, [`institutionalVersions.${field}`]: version + 1 })
      tx.create(historyRef, entry)
      tx.create(auditRef, { action: 'SUPPORT_CONFIG_UPDATED', entityType: 'system_config', entityId: 'expreso_punata', ...entry })
      return { success: true, historyId: historyRef.id }
    })
  })
  const allowedDiagnosticModules = ['auth', 'cash', 'shipments', 'tickets', 'configuration', 'users', 'support', 'printing', 'reports', 'other']
  const allowedDiagnosticCodes = new Set(['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'out-of-range', 'unavailable', 'deadline-exceeded', 'network-request-failed', 'internal', 'resource-exhausted', 'not-found', 'already-exists', 'aborted', 'cancelled', 'unknown', 'user-disabled', 'user-not-found', 'wrong-password', 'invalid-credential', 'too-many-requests', 'email-already-in-use', 'print_failed'])
  const safeOperation = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
    && !/(password|contrase(?:n|ñ)a|token|email|phone|document|signature|\bname\b|\buid\b|\bqr\b)/i.test(value)
  const containsSensitiveText = value => /@|\b(password|contrase(?:n|ñ)a|token|secret|cvv|qr|documento|firma)\b|\d{7,}|(?:^|\s)bearer\s|eyJ[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{32,}/i.test(value)
  const sensitiveIdentifier = value => /@|\b(password|contrase(?:n|ñ)a|token|secret|cvv|qr|documento|firma)\b|\d{7,}|bearer|eyJ[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}/i.test(value)
  const pruneExpiredDiagnostics = async nowIso => {
    for (const collection of ['support_diagnostics', 'support_diagnostic_limits']) {
      const expired = await db.collection(collection).where('expiresAtIso', '<=', nowIso).limit(100).get()
      if (!expired.empty) { const batch = db.batch(); expired.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit() }
    }
  }
  const listSupportDiagnostics = onCall({ cors: true }, async request => {
    await authorizeSupport(request)
    await pruneExpiredDiagnostics(new Date().toISOString())
    const { module, from, to, severity, correlationId } = request.data || {}
    if ((module && !allowedDiagnosticModules.includes(module)) || (severity && !['info', 'warning', 'error', 'critical'].includes(severity))
      || (from && (typeof from !== 'string' || !Number.isFinite(Date.parse(from)))) || (to && (typeof to !== 'string' || !Number.isFinite(Date.parse(to))))
      || (correlationId && !/^[A-Za-z0-9_-]{8,64}$/.test(correlationId))) throw new HttpsError('invalid-argument', 'Filtros de diagnóstico inválidos.')
    const direct = correlationId ? await db.collection('support_diagnostics').doc(correlationId).get() : null
    const logs = direct?.exists ? { docs: [direct] } : await db.collection('support_diagnostics').orderBy('createdAtIso', 'desc').limit(200).get()
    const entries = logs.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(d =>
      (!module || d.module === module) && (!severity || d.severity === severity)
      && (!from || d.createdAtIso >= from) && (!to || d.createdAtIso <= to)
      && (!correlationId || d.correlationId === correlationId)).map(d => ({
      id: d.id, module: d.module, operation: d.operation, code: d.code, category: d.category,
      messageSafe: d.messageSafe, severity: d.severity, branchId: d.branchId, correlationId: d.correlationId,
      frontendVersion: d.frontendVersion, backendRevision: d.backendRevision, operationState: d.operationState,
      status: d.status, supportObservation: d.supportObservation, createdAtIso: d.createdAtIso,
    }))
    return { entries, summary: { total: entries.length, open: entries.filter(d => d.status === 'pendiente').length, investigating: entries.filter(d => d.status === 'investigando').length, resolved: entries.filter(d => d.status === 'resuelto').length } }
  })
  const reportClientDiagnostic = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Se requiere una sesión para registrar el incidente.')
    const { module, operation, code, category, correlationId, frontendVersion } = request.data || {}
    const allowedCategories = ['authentication', 'permission', 'query', 'cloud_function', 'network', 'validation', 'unexpected', 'printing']
    if (!allowedDiagnosticModules.includes(module) || !allowedCategories.includes(category)
      || !safeOperation(operation) || !allowedDiagnosticCodes.has(code)
      || !/^[A-Za-z0-9_-]{8,64}$/.test(correlationId || '')
      || sensitiveIdentifier(correlationId)
      || (frontendVersion !== undefined && (typeof frontendVersion !== 'string' || !/^[A-Za-z0-9.+_-]{1,32}$/.test(frontendVersion)))) {
      throw new HttpsError('invalid-argument', 'Metadatos técnicos inválidos.')
    }
    const safeMessages = {
      authentication: 'Falló una operación de autenticación.', permission: 'La operación fue rechazada por permisos.',
      query: 'Falló una consulta de datos.', cloud_function: 'Falló una operación del servidor.',
      network: 'La conexión o el servicio no respondió.', validation: 'Los datos no superaron la validación.',
      unexpected: 'Ocurrió un error inesperado.', printing: 'Falló una operación de impresión detectable por la aplicación.',
    }
    const profileRef = db.collection('users').doc(request.auth.uid)
    const now = new Date()
    const createdAtIso = now.toISOString()
    const ref = db.collection('support_diagnostics').doc(correlationId)
    const limitRef = db.collection('support_diagnostic_limits').doc(`${request.auth.uid}_${createdAtIso.slice(0, 16).replace(/[-T:]/g, '')}`)
    const entry = await db.runTransaction(async tx => {
      const [profile, limit, existing] = await Promise.all([tx.get(profileRef), tx.get(limitRef), tx.get(ref)])
      const userProfile = profile.data()
      if (!profile.exists || userProfile?.isActive !== true || !['directiva_admin', 'afiliado_admin', 'afiliado', 'secretaria', 'tesoreria', 'encargado_agencia', 'conductor'].includes(userProfile?.role)) throw new HttpsError('permission-denied', 'Esta identidad no puede registrar diagnósticos operativos.')
      if ((limit.data()?.count || 0) >= 20) throw new HttpsError('resource-exhausted', 'Se alcanzó el límite temporal de diagnósticos.')
      if (existing.exists) throw new HttpsError('already-exists', 'El identificador de incidencia ya existe.')
      const branchId = ['punata', 'cochabamba'].includes(userProfile.primaryBranchId) ? userProfile.primaryBranchId : null
      const record = { module, operation, code, category, severity: ['permission', 'cloud_function', 'unexpected'].includes(category) ? 'error' : 'warning', messageSafe: safeMessages[category], correlationId, frontendVersion: frontendVersion || null, backendRevision: process.env.K_REVISION || null, branchId, status: 'pendiente', operationState: ['permission', 'validation'].includes(category) ? 'rejected' : 'failed', actorUid: request.auth.uid, createdAtIso, expiresAtIso: new Date(now.getTime() + 45 * 86400000).toISOString() }
      tx.create(ref, record)
      tx.set(limitRef, { count: (limit.data()?.count || 0) + 1, expiresAtIso: new Date(now.getTime() + 2 * 60000).toISOString() }, { merge: true })
      return record
    })
    await pruneExpiredDiagnostics(createdAtIso)
    return { success: true, id: ref.id, correlationId: entry.correlationId }
  })
  const updateSupportDiagnostic = onCall({ cors: true }, async request => {
    await authorizeSupport(request, true)
    const { id, status, observation } = request.data || {}
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id) || !['pendiente', 'investigando', 'resuelto'].includes(status)
      || (observation !== undefined && (typeof observation !== 'string' || observation.length > 500 || containsSensitiveText(observation)))) {
      throw new HttpsError('invalid-argument', 'Estado u observación inválidos; no incluya datos personales ni secretos.')
    }
    const ref = db.collection('support_diagnostics').doc(id)
    const auditRef = db.collection('audit_logs').doc()
    await db.runTransaction(async tx => {
      const [profile, diagnostic] = await Promise.all([tx.get(db.collection('users').doc(request.auth.uid)), tx.get(ref)])
      if (profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
      if (!diagnostic.exists) throw new HttpsError('not-found', 'No se encontró la incidencia.')
      const safeObservation = observation?.trim()
      tx.update(ref, { status, ...(safeObservation ? { supportObservation: safeObservation } : {}), reviewedAtIso: new Date().toISOString(), reviewedByUid: request.auth.uid })
      tx.create(auditRef, { action: 'SUPPORT_DIAGNOSTIC_REVIEWED', uid: request.auth.uid, diagnosticId: id, status, observationAdded: Boolean(safeObservation), createdAtIso: new Date().toISOString() })
    })
    return { success: true }
  })
  const recordSupportDiagnostic = onCall({ cors: true }, async request => {
    await authorizeSupport(request, true)
    const { module, operation, code, correlationId, status } = request.data || {}
    const safeIdentifier = x => typeof x === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(x)
    if (![module, operation, code, correlationId].every(safeIdentifier) || [module, operation, code, correlationId].some(sensitiveIdentifier) || !['pendiente', 'investigando', 'resuelto'].includes(status)) throw new HttpsError('invalid-argument', 'Utilice identificadores técnicos válidos y un estado admitido.')
    const entry = { module, operation, code, branchId: null, correlationId, severity: 'info', messageSafe: 'Observación técnica registrada por soporte.', category: 'unexpected', status, createdAtIso: new Date().toISOString(), expiresAtIso: new Date(Date.now() + 45 * 86400000).toISOString() }
    const ref = db.collection('support_diagnostics').doc(correlationId)
    await db.runTransaction(async tx => {
      const profile = await tx.get(db.collection('users').doc(request.auth.uid))
      if (profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
      tx.create(ref, entry)
      tx.create(db.collection('audit_logs').doc(), { action: 'SUPPORT_DIAGNOSTIC_RECORDED', uid: request.auth.uid, diagnosticId: ref.id, createdAtIso: entry.createdAtIso })
    })
    return { success: true, id: ref.id }
  })
  return { getSupportOverview, getSupportConfiguration, updateSupportConfiguration, listSupportDiagnostics, recordSupportDiagnostic, reportClientDiagnostic, updateSupportDiagnostic, ...cleanup }
}
