import { onCall, HttpsError } from 'firebase-functions/v2/https'

const ROUTES = ['punata-cochabamba', 'cochabamba-punata']
const KEYS = ['commission', ...ROUTES, 'loan', 'sports']
export const commercialSettingsRef = (db, key) => db.collection('commercial_settings').doc(key)

export function localBusinessDay(instant = new Date()) {
  const date = new Date(instant)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(date) : null
}

export function effectiveCommercialRule(settings, day) {
  return settings?.releases?.find(rule => rule.effectiveFrom <= day) || null
}

function validateRule(key, input) {
  const { effectiveFrom, enabled } = input || {}
  const date = typeof effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ? new Date(effectiveFrom + 'T00:00:00Z') : null
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== effectiveFrom) throw new HttpsError('invalid-argument', 'Vigencia: seleccione una fecha válida.')
  if (typeof enabled !== 'boolean') throw new HttpsError('invalid-argument', 'Estado: indique si la regla está habilitada.')
  if (!enabled) return { effectiveFrom, enabled }
  if (key === 'commission') {
    const { type, value, base } = input
    if (!['percentage', 'fixed_per_shipment'].includes(type)) throw new HttpsError('invalid-argument', 'Modalidad: seleccione importe fijo o porcentaje.')
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > (type === 'percentage' ? 100 : 100000) || Math.abs(Math.round(value * 100) - value * 100) > 1e-7) throw new HttpsError('invalid-argument', 'Valor: indique un importe positivo con hasta dos decimales dentro del límite.')
    if (type === 'percentage' && base !== 'shippingFeeCents') throw new HttpsError('invalid-argument', 'Base: seleccione flete tarifario registrado.')
    return { effectiveFrom, enabled, type, value, base: type === 'percentage' ? base : null }
  }
  if (key === 'loan') {
    const { maxInstallments, maxPrincipalCents } = input
    if (!Number.isInteger(maxInstallments) || maxInstallments < 1 || maxInstallments > 120) throw new HttpsError('invalid-argument', 'Cuotas máximas: indique un entero de 1 a 120.')
    if (!Number.isSafeInteger(maxPrincipalCents) || maxPrincipalCents < 1) throw new HttpsError('invalid-argument', 'Capital máximo: indique un importe válido en centavos.')
    return { effectiveFrom, enabled, maxInstallments, maxPrincipalCents }
  }
  if (key === 'sports') {
    const { lateFineCents, absentFineCents } = input
    if (![lateFineCents, absentFineCents].every(value => Number.isSafeInteger(value) && value >= 0)) throw new HttpsError('invalid-argument', 'Tardanza e inasistencia: indique importes no negativos en centavos.')
    return { effectiveFrom, enabled, lateFineCents, absentFineCents }
  }
  const { baseFeeCents, freeWeightKg, extraKgRateCents, homeDeliveryFeeCents } = input
  for (const [field, value] of Object.entries({ baseFeeCents, extraKgRateCents, homeDeliveryFeeCents })) {
    if (!Number.isSafeInteger(value) || value < (field === 'baseFeeCents' ? 1 : 0) || value > 10000000) throw new HttpsError('invalid-argument', `${field}: ingrese un importe válido en centavos.`)
  }
  if (typeof freeWeightKg !== 'number' || !Number.isFinite(freeWeightKg) || freeWeightKg < 0 || freeWeightKg > 10000) throw new HttpsError('invalid-argument', 'Peso incluido: indique un valor de 0 a 10000 kg.')
  return { effectiveFrom, enabled, baseFeeCents, freeWeightKg, extraKgRateCents, homeDeliveryFeeCents }
}

function requireCommercialAdmin(profile) {
  if (profile?.isActive !== true || profile.role !== 'afiliado_admin'
    || !['punata', 'cochabamba'].includes(profile.primaryBranchId)
    || !['punata', 'cochabamba'].every(branch => Array.isArray(profile.allowedBranchIds) && profile.allowedBranchIds.includes(branch))) {
    throw new HttpsError('permission-denied', 'La configuración comercial requiere un administrador del cliente con alcance institucional.')
  }
}

export function createCommercialFunctions(db) {
  const getCommercialSettings = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const profile = (await db.collection('users').doc(request.auth.uid).get()).data()
    let canEdit = true
    if (profile?.role === 'soporte_pachax' && profile.isActive === true) {
      canEdit = false
      if (!(process.env.FUNCTIONS_EMULATOR === 'true' && process.env.FIRESTORE_EMULATOR_HOST && (process.env.GCLOUD_PROJECT || '').startsWith('demo-'))
        && !request.auth.token?.firebase?.sign_in_second_factor) throw new HttpsError('permission-denied', 'Se requiere autenticación multifactor.')
    } else requireCommercialAdmin(profile)
    const official = (await db.collection('system_config').doc('expreso_punata').get()).data()
    const configured = official?.status === 'configured' && official?.isOfficial === true
    const items = await Promise.all(KEYS.map(async key => {
      const ref = commercialSettingsRef(db, key)
      const [current, history] = await Promise.all([ref.get(), ref.collection('history').orderBy('version', 'desc').limit(25).get()])
      const data = current.data()
      const legacy = configured ? key === 'commission'
        ? { type: official.commissions?.defaultType || null, value: official.commissions?.defaultValue ?? null }
        : ROUTES.includes(key) ? official.tariffs || null : null : null
      return { key, legacy, version: data?.version || 0, draft: data?.draft || null, effective: effectiveCommercialRule(data, localBusinessDay()), releases: data?.releases || [], history: history.docs.map(doc => doc.data()) }
    }))
    return { canEdit, automaticPricingEnabled: process.env.ENABLE_AUTOMATIC_PARCEL_PRICING === 'true', items }
  })

  const updateCommercialSettings = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const { key, action, expectedVersion, reason, rule, restoreVersion, confirmation } = request.data || {}
    const time = request.auth.token?.auth_time
    if (!Number.isFinite(time) || Date.now() / 1000 - time > 300 || time > Date.now() / 1000 + 30) throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
    if (!KEYS.includes(key) || !['draft', 'publish', 'restore'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
      || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500 || confirmation !== true
      || (action === 'restore' && (!Number.isSafeInteger(restoreVersion) || restoreVersion < 1))) throw new HttpsError('invalid-argument', 'Confirme la operación, versión y motivo.')
    const ref = commercialSettingsRef(db, key)
    return db.runTransaction(async tx => {
      const [profile, current, official] = await Promise.all([
        tx.get(db.collection('users').doc(request.auth.uid)), tx.get(ref), tx.get(db.collection('system_config').doc('expreso_punata')),
      ])
      requireCommercialAdmin(profile.data())
      const before = current.data() || { version: 0, draft: null, releases: [] }
      if (before.version !== expectedVersion) throw new HttpsError('aborted', 'Otro administrador modificó la regla. Recargue antes de guardar.')
      const historical = action === 'restore' ? (await tx.get(ref.collection('history').doc(String(restoreVersion)))).data() : null
      if (action === 'restore' && !historical) throw new HttpsError('not-found', 'La versión histórica ya no está disponible.')
      const next = validateRule(key, action === 'restore' ? { ...historical.rule, effectiveFrom: rule?.effectiveFrom } : rule)
      const publish = action === 'publish'
      if (publish && (official.data()?.status !== 'configured' || official.data()?.isOfficial !== true)) throw new HttpsError('failed-precondition', 'Configure primero la institución oficialmente.')
      if (publish && next.effectiveFrom < localBusinessDay()) throw new HttpsError('invalid-argument', 'Vigencia: no se permiten publicaciones retroactivas.')
      const version = before.version + 1
      const releases = publish
        ? [...before.releases.filter(item => item.effectiveFrom !== next.effectiveFrom), { ...next, version }].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
        : before.releases
      if (releases.length > 100) throw new HttpsError('resource-exhausted', 'Se alcanzó el límite de vigencias para esta regla.')
      const entry = { version, action, rule: next, previous: before.draft, reason: reason.trim(), performedByUid: request.auth.uid, timestampIso: new Date().toISOString(), restoredFrom: historical?.version || null }
      tx.set(ref, { version, draft: next, releases })
      tx.create(ref.collection('history').doc(String(version)), entry)
      tx.create(db.collection('audit_logs').doc(), { ...entry, action: 'COMMERCIAL_SETTING_' + action.toUpperCase(), entityType: 'commercial_settings', entityId: key })
      return { success: true, version }
    })
  })
  return { getCommercialSettings, updateCommercialSettings }
}
