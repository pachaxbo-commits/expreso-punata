import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { verifySupportSession } from './supportAccess.js'

const FIELD_IDS = new Set([
  'sender', 'senderPhone', 'recipient', 'recipientPhone', 'origin', 'destination', 'createdAt',
  'description', 'packageCount', 'weight', 'amount', 'paymentCondition', 'operator', 'driver',
  'deliveryType', 'status', 'qr',
])
const REQUIRED_FIELDS = ['createdAt', 'destination']
const DEFAULT_CUSTOMER_FIELDS = ['sender', 'senderPhone', 'recipient', 'recipientPhone', 'origin', 'destination', 'createdAt', 'description', 'packageCount', 'weight', 'amount', 'paymentCondition', 'operator', 'driver', 'deliveryType', 'status', 'qr']
const DEFAULT_AGENCY_FIELDS = ['sender', 'recipient', 'destination', 'createdAt', 'description', 'packageCount', 'weight', 'qr']
const TEMPLATE_REF = 'ticket_templates/shipment_guide'

function sanitizeCopy(input, fallback) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsError('invalid-argument', 'Plantilla de copia inválida.')
  const normalizeIds = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && FIELD_IDS.has(id)))] : [...fallback]
  const visibleFields = [...new Set([...normalizeIds(input.visibleFields), ...REQUIRED_FIELDS])]
  const order = [...new Set([...normalizeIds(input.order).filter(id => visibleFields.includes(id)), ...visibleFields])]
  const fieldStyles = {}
  if (input.fieldStyles && typeof input.fieldStyles === 'object' && !Array.isArray(input.fieldStyles)) {
    for (const [id, value] of Object.entries(input.fieldStyles)) {
      if (!FIELD_IDS.has(id) || !value || typeof value !== 'object') continue
      fieldStyles[id] = {
        bold: value.bold === true,
        alignment: ['left', 'center', 'right'].includes(value.alignment) ? value.alignment : 'left',
      }
    }
  }
  const cleanText = (value, max) => typeof value === 'string'
    ? value.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, max)
    : ''
  return {
    visibleFields,
    order,
    fieldStyles,
    headerText: cleanText(input.headerText, 120),
    footerText: cleanText(input.footerText, 180),
  }
}

export function validateShipmentTicketTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsError('invalid-argument', 'Plantilla inválida.')
  const marginsMm = Number(input.marginsMm)
  if (!Number.isFinite(marginsMm) || marginsMm < 0 || marginsMm > 6) throw new HttpsError('invalid-argument', 'El margen debe estar entre 0 y 6 mm.')
  if (!['58mm', '80mm'].includes(input.paperFormat)) throw new HttpsError('invalid-argument', 'Papel permitido: 58 mm u 80 mm.')
  if (!['compact', 'normal', 'large'].includes(input.fontSize)) throw new HttpsError('invalid-argument', 'Tamaño de letra no válido.')
  if (!['solid', 'dashed', 'none'].includes(input.separator) || !['compact', 'normal', 'wide'].includes(input.spacing)) throw new HttpsError('invalid-argument', 'Apariencia no válida.')
  if (typeof input.secondCopyEnabled !== 'boolean' || !['page_break', 'continuous'].includes(input.betweenCopies)) throw new HttpsError('invalid-argument', 'Configuración de copias no válida.')
  return {
    documentType: 'shipment_guide',
    version: Number.isSafeInteger(input.version) && input.version >= 0 ? input.version : 0,
    paperFormat: input.paperFormat,
    marginsMm,
    fontSize: input.fontSize,
    separator: input.separator,
    spacing: input.spacing,
    secondCopyEnabled: input.secondCopyEnabled,
    betweenCopies: input.betweenCopies,
    customer: sanitizeCopy(input.customer, DEFAULT_CUSTOMER_FIELDS),
    agency: sanitizeCopy(input.agency, DEFAULT_AGENCY_FIELDS),
  }
}

function isTemplateWriter(profile, isOperationalAdmin) {
  return profile?.isActive === true && (
    profile.role === 'soporte_pachax' || isOperationalAdmin(profile)
  )
}

function recentAuth(request) {
  const now = Date.now() / 1000
  const authTime = request.auth?.token?.auth_time
  if (!Number.isFinite(authTime) || now - authTime > 300 || authTime > now + 30) throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para guardar la plantilla.')
}

export function createTicketTemplateFunctions(db, authAdmin, isOperationalAdmin) {
  const getShipmentTicketTemplate = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const profile = (await db.collection('users').doc(request.auth.uid).get()).data()
    if (profile?.isActive !== true) throw new HttpsError('permission-denied', 'Se requiere un perfil activo.')
    const snap = await db.doc(TEMPLATE_REF).get()
    const histories = await db.doc(TEMPLATE_REF).collection('history').orderBy('version', 'desc').limit(20).get()
    return {
      template: snap.exists ? snap.data().template : null,
      version: snap.exists ? snap.data().version : 0,
      history: histories.docs.map(doc => ({ version: doc.data().version, action: doc.data().action, timestampIso: doc.data().timestampIso, uid: doc.data().uid, restoredFrom: doc.data().restoredFrom || null })),
      canEdit: isTemplateWriter(profile, isOperationalAdmin),
    }
  })

  const saveShipmentTicketTemplate = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    recentAuth(request)
    const callerRef = db.collection('users').doc(request.auth.uid)
    const caller = (await callerRef.get()).data()
    if (!isTemplateWriter(caller, isOperationalAdmin)) throw new HttpsError('permission-denied', 'El perfil no puede administrar plantillas.')
    if (caller.role === 'soporte_pachax') await verifySupportSession(authAdmin, request, true)

    const { action = 'save', template: rawTemplate, expectedVersion, restoreVersion } = request.data || {}
    if (!['save', 'restore'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new HttpsError('invalid-argument', 'Versión u operación no válidas.')
    const ref = db.doc(TEMPLATE_REF)
    return db.runTransaction(async tx => {
      const [current, source] = await Promise.all([
        tx.get(ref),
        action === 'restore' && Number.isSafeInteger(restoreVersion) ? tx.get(ref.collection('history').doc(String(restoreVersion))) : Promise.resolve(null),
      ])
      const currentVersion = current.exists ? Number(current.data()?.version) || 0 : 0
      if (currentVersion !== expectedVersion) throw new HttpsError('aborted', 'Otra persona guardó una versión. Recargue antes de continuar.')
      if (action === 'restore' && !source?.exists) throw new HttpsError('not-found', 'No se encontró la versión solicitada.')
      const template = validateShipmentTicketTemplate(action === 'restore' ? source.data()?.template : rawTemplate)
      const version = currentVersion + 1
      const timestampIso = new Date().toISOString()
      const historyRef = ref.collection('history').doc(String(version))
      const auditRef = db.collection('audit_logs').doc()
      const saved = { ...template, version }
      const entry = { version, action, template: saved, uid: request.auth.uid, timestampIso, restoredFrom: action === 'restore' ? restoreVersion : null }
      tx.set(ref, { template: saved, version, updatedAtIso: timestampIso, updatedByUid: request.auth.uid })
      tx.create(historyRef, entry)
      tx.create(auditRef, { action: action === 'restore' ? 'SHIPMENT_TICKET_TEMPLATE_RESTORED' : 'SHIPMENT_TICKET_TEMPLATE_SAVED', entityType: 'ticket_template', entityId: 'shipment_guide', version, restoredFrom: entry.restoredFrom, uid: request.auth.uid, timestampIso })
      return { success: true, version, template: saved }
    })
  })

  return { getShipmentTicketTemplate, saveShipmentTicketTemplate }
}
