import { commercialSettingsRef, effectiveCommercialRule, localBusinessDay } from './commercialSettings.js'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { createSupportCleanupFunctions } from './supportCleanup.js'
const CONFIG_FIELDS = {
  tradeName: 'company.tradeName',
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

function requireInstitutionalEditor(profile, request) {
  if (profile?.role === 'afiliado_admin' && profile.isActive === true && ['punata', 'cochabamba'].includes(profile.primaryBranchId)
    && ['punata', 'cochabamba'].every(branch => Array.isArray(profile.allowedBranchIds) && profile.allowedBranchIds.includes(branch))) return
  if (profile?.role !== 'soporte_pachax' || profile.isActive !== true) throw new HttpsError('permission-denied', 'Se requiere una cuenta autorizada para configuración institucional.')
  if (!inEmulators() && !request.auth.token?.firebase?.sign_in_second_factor) throw new HttpsError('permission-denied', 'Se requiere autenticación multifactor.')
}

function configValue(config, key) {
  const value = CONFIG_FIELDS[key].split('.').reduce((obj, part) => obj?.[part], config)
  return typeof value === 'string' ? value : ''
}
const inEmulators = () => process.env.FUNCTIONS_EMULATOR === 'true' && Boolean(process.env.FIRESTORE_EMULATOR_HOST) && (process.env.GCLOUD_PROJECT || '').startsWith('demo-')

async function authorize(db, request, recent = false) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
  const profile = await db.collection('users').doc(request.auth.uid).get()
  if (!profile.exists || profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) {
    throw new HttpsError('permission-denied', 'Acceso exclusivo de Soporte PACHAX.')
  }
  if (!inEmulators() && !request.auth.token?.firebase?.sign_in_second_factor) {
    throw new HttpsError('permission-denied', 'Se requiere autenticación multifactor.')
  }
  if (recent && (!Number.isFinite(request.auth.token?.auth_time) || Date.now() / 1000 - request.auth.token.auth_time > 300 || request.auth.token.auth_time > Date.now() / 1000 + 30)) {
    throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
  }
}

export function createSupportFunctions(db) {
  const cleanup = createSupportCleanupFunctions(db, (request, recent = false) => authorize(db, request, recent))
  const getSupportOverview = onCall({ cors: true }, async request => {
    await authorize(db, request)
    const config = await db.collection('system_config').doc('expreso_punata').get()
    const versioned = effectiveCommercialRule((await commercialSettingsRef(db, 'commission').get()).data(), localBusinessDay())
    const c = versioned ? { defaultType: versioned.enabled ? versioned.type : null, defaultValue: versioned.value } : config.data()?.commissions || {}
    const value = Number(c.defaultValue)
    const validRule = ['percentage', 'fixed_per_shipment'].includes(c.defaultType) && Number.isFinite(value) && value > 0 && (c.defaultType !== 'percentage' || value <= 100)
    return { services: { functions: 'disponible', firestore: 'disponible' }, commissionsConfigured: config.data()?.status === 'configured' && config.data()?.isOfficial === true && validRule, cleanupEnvironment: inEmulators() ? 'emulador' : 'no disponible en producción' }
  })
  const getSupportConfiguration = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    requireInstitutionalEditor((await db.collection('users').doc(request.auth.uid).get()).data(), request)
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
    const authTime = request.auth.token?.auth_time
    if (!Number.isFinite(authTime) || Date.now() / 1000 - authTime > 300 || authTime > Date.now() / 1000 + 30) throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
    const { field, value, expectedValue, expectedVersion, reason, confirmation, restoreHistoryId } = request.data || {}
    if (!Object.hasOwn(CONFIG_FIELDS, field) || (!restoreHistoryId && typeof value !== 'string') || typeof expectedValue !== 'string' || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500 || confirmation !== true) throw new HttpsError('invalid-argument', 'Confirme la modificación e indique un motivo válido.')
    if (restoreHistoryId !== undefined && (typeof restoreHistoryId !== 'string' || !/^[a-zA-Z0-9]{20}$/.test(restoreHistoryId))) throw new HttpsError('invalid-argument', 'Versión histórica inválida.')
    const configRef = db.collection('system_config').doc('expreso_punata')
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
  const listSupportDiagnostics = onCall({ cors: true }, async request => {
    await authorize(db, request)
    const logs = await db.collection('support_diagnostics').orderBy('createdAtIso', 'desc').limit(30).get()
    return { entries: logs.docs.map(doc => { const d = doc.data(); return { id: doc.id, module: d.module, operation: d.operation, code: d.code, branchId: d.branchId, correlationId: d.correlationId, status: d.status, createdAtIso: d.createdAtIso } }) }
  })
  const recordSupportDiagnostic = onCall({ cors: true }, async request => {
    await authorize(db, request, true)
    const { module, operation, code, branchId, correlationId, status } = request.data || {}
    const safeIdentifier = x => typeof x === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(x)
    if (![module, operation, code, correlationId].every(safeIdentifier) || !['punata', 'cochabamba', ''].includes(branchId) || !['pendiente', 'investigando', 'resuelto'].includes(status)) throw new HttpsError('invalid-argument', 'Utilice identificadores técnicos válidos y una agencia admitida.')
    const entry = { module, operation, code, branchId: branchId || null, correlationId, status, createdAtIso: new Date().toISOString() }
    const ref = db.collection('support_diagnostics').doc()
    await db.runTransaction(async tx => {
      const profile = await tx.get(db.collection('users').doc(request.auth.uid))
      if (profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
      tx.create(ref, entry)
      tx.create(db.collection('audit_logs').doc(), { action: 'SUPPORT_DIAGNOSTIC_RECORDED', uid: request.auth.uid, diagnosticId: ref.id, createdAtIso: entry.createdAtIso })
    })
    return { success: true, id: ref.id }
  })
  return { getSupportOverview, getSupportConfiguration, updateSupportConfiguration, listSupportDiagnostics, recordSupportDiagnostic, ...cleanup }
}
