import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { verifySupportSession } from './supportAccess.js'

const KINDS = ['contributions', 'catalogs', 'reports', 'notifications']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
const ADMIN = profile => profile?.isActive === true && profile.role === 'afiliado_admin'
  && ['punata', 'cochabamba'].includes(profile.primaryBranchId)
  && ['punata', 'cochabamba'].every(id => profile.allowedBranchIds?.includes(id))
const SUPPORT = profile => profile?.isActive === true && profile.role === 'soporte_pachax'

const CATALOGS = {
  fixedAssetCategories: ['computacion', 'muebles', 'herramientas', 'comunicacion', 'balanzas_pesaje', 'oficina', 'otro', 'inmuebles'],
  consumableCategories: ['thermal_rolls', 'security_seals', 'tape', 'packaging_boxes', 'envelopes', 'labels', 'other'],
  workerRoles: ['secretaria', 'estibador', 'chofer_relevo', 'limpieza', 'seguridad', 'administrativo', 'encargado', 'otro'],
  consumableUnits: ['unidades', 'rollos', 'cajas', 'paquetes', 'sobres', 'metros', 'litros', 'pares'],
}
const OPTIONAL_REPORT_COLUMNS = {
  members: ['memberNumber', 'fullName', 'category', 'branchId', 'status'],
  loans: ['loanNumber', 'memberNumber', 'memberName', 'status', 'disbursementStatus'],
  fines: ['fineNumber', 'memberNumber', 'memberName', 'category', 'status'],
  sports: ['memberNumber', 'memberName', 'eventName', 'status', 'attendanceStatus'],
  physical_inventory: ['assetCode', 'name', 'category', 'branchId', 'status'],
  commissions: ['driverName', 'branchId', 'status', 'period'],
  consumables: ['code', 'name', 'category', 'unit', 'branchId'],
  incidents: ['trackingCode', 'status', 'originBranchId', 'destinationBranchId', 'createdAtIso'],
}
const CATALOG_LABELS = {
  fixedAssetCategories: ['Computación y Sistemas', 'Muebles y Enseres', 'Herramientas y Repuestos', 'Equipos de Comunicación', 'Balanzas y Básculas', 'Material y Oficina', 'Otros Activos', 'Inmuebles'],
  consumableCategories: ['Rollos Térmicos (80/58mm)', 'Precintos de Seguridad', 'Cinta de Embalar', 'Cajas de Cartón', 'Sobres Manila', 'Etiquetas Autoadhesivas', 'Otros Insumos'],
  workerRoles: ['Secretaria de Ventanilla', 'Estibador / Carga y Descarga', 'Chofer de Relevo / Operaciones', 'Personal de Limpieza', 'Seguridad y Custodia', 'Personal Administrativo', 'Encargado de Agencia', 'Otro Personal Operativo'],
  consumableUnits: ['unidades', 'rollos', 'cajas', 'paquetes', 'sobres', 'metros', 'litros', 'pares'],
}

function fail(message) { throw new HttpsError('invalid-argument', message) }
function validate(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Configuración inválida.')
  if (kind === 'contributions') {
    const { concept, amountCents, periodicity, effectiveFrom, branchIds, category, enabled } = value
    if (typeof concept !== 'string' || concept.trim().length < 2 || concept.trim().length > 80) fail('El concepto debe tener de 2 a 80 caracteres.')
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100000000) fail('El importe debe ser positivo y estar expresado en centavos.')
    if (!['monthly'].includes(periodicity)) fail('El módulo de emisión admite periodicidad mensual.')
    if (typeof effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || new Date(`${effectiveFrom}T00:00:00Z`).toISOString().slice(0, 10) !== effectiveFrom) fail('Seleccione una vigencia válida.')
    if (!Array.isArray(branchIds) || !branchIds.length || branchIds.some(id => !['punata', 'cochabamba'].includes(id))) fail('Seleccione una o ambas agencias.')
    if (!['all', 'propietario_transporte', 'conductor', 'socio_general'].includes(category)) fail('Seleccione una categoría de afiliado válida.')
    if (typeof enabled !== 'boolean') fail('Indique si la política está activa.')
    return { concept: concept.trim(), amountCents, periodicity, effectiveFrom, branchIds: [...new Set(branchIds)], category, enabled }
  }
  if (kind === 'catalogs') {
    const clean = {}
    for (const [catalog, ids] of Object.entries(CATALOGS)) {
      const items = value[catalog]
      if (!Array.isArray(items) || items.length !== ids.length) fail(`El catálogo ${catalog} debe conservar todas sus opciones históricas.`)
      const map = new Map(items.map(item => [item?.id, item]))
      if (ids.some(id => !map.has(id))) fail(`No se pueden borrar ni agregar opciones de ${catalog}.`)
      clean[catalog] = ids.map(id => {
        const item = map.get(id)
        if (typeof item.label !== 'string' || item.label.trim().length < 2 || item.label.length > 60 || typeof item.active !== 'boolean') fail(`Etiqueta o estado inválido en ${catalog}.`)
        return { id, label: item.label.trim(), active: item.active }
      })
    }
    return clean
  }
  if (kind === 'reports') {
    const columns = value.optionalColumns
    if (!columns || typeof columns !== 'object' || Array.isArray(columns)) fail('Columnas de reportes inválidas.')
    const clean = {}
    for (const [report, allowed] of Object.entries(OPTIONAL_REPORT_COLUMNS)) {
      const chosen = columns[report] ?? allowed
      if (!Array.isArray(chosen) || chosen.some(key => !allowed.includes(key)) || new Set(chosen).size !== chosen.length) fail(`Columnas no admitidas para ${report}.`)
      clean[report] = chosen
    }
    const order = value.order
    if (order !== 'source' && order !== 'alphabetical') fail('Orden de presentación inválido.')
    return { optionalColumns: clean, order }
  }
  if (kind === 'notifications') {
    if (typeof value.shipmentRegisteredVisible !== 'boolean' || typeof value.unreadShipmentAlertsVisible !== 'boolean') fail('Preferencias de avisos inválidas.')
    return { shipmentRegisteredVisible: value.shipmentRegisteredVisible, unreadShipmentAlertsVisible: value.unreadShipmentAlertsVisible }
  }
  fail('Configuración desconocida.')
}

const defaults = {
  contributions: { draft: null, effective: null, releases: [] },
  catalogs: { value: Object.fromEntries(Object.entries(CATALOGS).map(([key, ids]) => [key, ids.map((id, index) => ({ id, label: CATALOG_LABELS[key][index], active: true }))])) },
  reports: { value: { optionalColumns: OPTIONAL_REPORT_COLUMNS, order: 'source' } },
  notifications: { value: { shipmentRegisteredVisible: true, unreadShipmentAlertsVisible: true } },
}

export function createB4SettingsFunctions(db, authAdmin = null) {
  const getB4Settings = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const profile = (await db.collection('users').doc(request.auth.uid).get()).data()
    const readOperational = profile?.isActive === true && ['directiva_admin', 'tesoreria', 'encargado_agencia', 'secretaria'].includes(profile.role)
    if (!ADMIN(profile) && !SUPPORT(profile) && !readOperational) throw new HttpsError('permission-denied', 'Sin acceso a configuraciones del Centro de Soporte.')
    if (SUPPORT(profile)) await verifySupportSession(authAdmin, request)
    const snapshots = await Promise.all(KINDS.map(kind => db.collection('b4_settings').doc(kind).get()))
    const items = await Promise.all(KINDS.map(async (kind, i) => {
      if (kind === 'contributions' && !ADMIN(profile)) return { kind, version: 0, draft: null, effective: null, releases: [], history: [], canEdit: false }
      const snap = snapshots[i]
      const history = await db.collection('b4_settings').doc(kind).collection('history').orderBy('version', 'desc').limit(30).get()
      return { kind, ...(defaults[kind]), ...(snap.data() || {}), version: snap.data()?.version || 0, history: history.docs.map(doc => doc.data()), canEdit: kind === 'contributions' ? ADMIN(profile) : ADMIN(profile) || SUPPORT(profile) }
    }))
    return { items }
  })

  const updateB4Settings = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const authTime = request.auth.token?.auth_time
    if (!Number.isFinite(authTime) || Date.now() / 1000 - authTime > 300 || authTime > Date.now() / 1000 + 30) throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
    const callerProfile = (await db.collection('users').doc(request.auth.uid).get()).data()
    if (SUPPORT(callerProfile)) await verifySupportSession(authAdmin, request, true)
    const { kind, action, value, expectedVersion, reason, restoreVersion, confirmation } = request.data || {}
    if (!KINDS.includes(kind) || !['save', 'publish', 'restore'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
      || typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 500 || confirmation !== true
      || (action === 'restore' && (!Number.isSafeInteger(restoreVersion) || restoreVersion < 1))) throw new HttpsError('invalid-argument', 'Confirme el cambio, versión y motivo.')
    const ref = db.collection('b4_settings').doc(kind)
    return db.runTransaction(async tx => {
      const [profileSnap, currentSnap] = await Promise.all([tx.get(db.collection('users').doc(request.auth.uid)), tx.get(ref)])
      const profile = profileSnap.data()
      if (kind === 'contributions' ? !ADMIN(profile) : (!ADMIN(profile) && !SUPPORT(profile))) throw new HttpsError('permission-denied', 'El perfil no puede modificar esta configuración.')
      const before = { ...defaults[kind], ...(currentSnap.data() || {}), version: currentSnap.data()?.version || 0 }
      if (before.version !== expectedVersion) throw new HttpsError('aborted', 'La configuración cambió en otra sesión. Recargue antes de guardar.')
      let nextValue = action === 'restore' ? null : validate(kind, value)
      let source
      if (action === 'restore') {
        source = (await tx.get(ref.collection('history').doc(String(restoreVersion)))).data()
        if (!source) throw new HttpsError('not-found', 'No se encontró la versión histórica.')
        nextValue = validate(kind, source.value)
      }
      if (kind === 'contributions' && action === 'publish' && nextValue.effectiveFrom < today()) throw new HttpsError('invalid-argument', 'No se permiten publicaciones retroactivas.')
      const version = before.version + 1
      let after
      if (kind === 'contributions') {
        const draft = action === 'publish' ? nextValue : action === 'restore' ? nextValue : nextValue
        const releases = action === 'publish'
          ? [...before.releases.filter(item => item.effectiveFrom !== draft.effectiveFrom || item.category !== draft.category), { ...draft, version }].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
          : before.releases
        after = { draft, effective: action === 'publish' ? draft : before.effective, releases }
      } else after = { value: nextValue }
      const entry = { version, kind, action, value: nextValue, reason: reason.trim(), uid: request.auth.uid, timestampIso: new Date().toISOString(), restoredFrom: source?.version || null }
      tx.set(ref, { ...after, version })
      tx.create(ref.collection('history').doc(String(version)), entry)
      tx.create(db.collection('audit_logs').doc(), { action: `B4_SETTING_${kind.toUpperCase()}_${action.toUpperCase()}`, entityType: 'b4_settings', entityId: kind, ...entry })
      return { success: true, version }
    })
  })
  return { getB4Settings, updateB4Settings }
}

export const b4Catalogs = CATALOGS
export const b4OptionalReportColumns = OPTIONAL_REPORT_COLUMNS
