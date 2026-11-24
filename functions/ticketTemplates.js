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
const TEMPLATE_FIELD_IDS = ['title', 'subtitle', 'number', 'tracking', 'timestamp', 'branch', 'sender', 'senderPhone', 'recipient', 'recipientPhone', 'route', 'items', 'financials', 'payment', 'operator', 'driver', 'dispatch', 'signatures', 'footer', 'qr', 'passenger', 'travelDate', 'vehicle', 'quantity', 'fare', 'settlement', 'paymentVerification']
const TEMPLATE_DOCS = {
  shipment_guide: ['title', 'number', 'tracking', 'timestamp', 'branch', 'sender', 'senderPhone', 'recipient', 'recipientPhone', 'route', 'items', 'financials', 'payment', 'operator', 'driver', 'footer', 'qr'],
  package_label: ['title', 'number', 'tracking', 'branch', 'items', 'qr'], dispatch_manifest: ['title', 'number', 'timestamp', 'branch', 'route', 'items', 'financials', 'operator', 'driver', 'dispatch', 'footer'],
  delivery_proof: ['title', 'number', 'timestamp', 'branch', 'tracking', 'sender', 'senderPhone', 'recipient', 'recipientPhone', 'route', 'items', 'operator', 'signatures', 'footer', 'qr'],
  payment_receipt: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'recipient', 'items', 'financials', 'payment', 'operator', 'footer'], cash_shift_close: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'items', 'financials', 'payment', 'operator', 'signatures', 'footer'],
  driver_settlement: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'driver', 'items', 'financials', 'payment', 'operator', 'signatures', 'footer'], financial_report: ['title', 'number', 'timestamp', 'branch', 'items', 'financials', 'operator', 'footer'],
  discrepancy_act: ['title', 'number', 'timestamp', 'branch', 'tracking', 'sender', 'recipient', 'items', 'operator', 'signatures', 'footer'], member_due_receipt: ['title', 'number', 'timestamp', 'branch', 'sender', 'financials', 'payment', 'operator', 'footer'],
  worker_payroll_receipt: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'recipient', 'items', 'financials', 'payment', 'operator', 'signatures', 'footer'], general_expense_voucher: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'recipient', 'items', 'financials', 'payment', 'operator', 'signatures', 'footer'],
  commission_voucher: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'recipient', 'items', 'financials', 'payment', 'operator', 'footer'], fixed_asset_label: ['title', 'subtitle', 'number', 'branch', 'items', 'qr', 'footer'], test_page: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'items', 'operator', 'footer'],
  passenger_ticket: ['title', 'subtitle', 'number', 'timestamp', 'branch', 'passenger', 'travelDate', 'route', 'driver', 'vehicle', 'quantity', 'fare', 'paymentVerification', 'settlement', 'qr', 'footer'],
}
TEMPLATE_DOCS.passenger_ticket = ['title', 'number', 'timestamp', 'branch', 'passenger', 'travelDate', 'route', 'driver', 'vehicle', 'quantity', 'fare', 'paymentVerification', 'settlement', 'qr', 'footer']
const TEMPLATE_REQUIRED = Object.fromEntries(Object.keys(TEMPLATE_DOCS).map(type => [type, type === 'shipment_guide' ? ['title', 'tracking', 'timestamp', 'route', 'footer'] : type === 'passenger_ticket' ? ['title', 'number', 'travelDate', 'route', 'quantity', 'fare', 'paymentVerification', 'footer'] : ['title', 'number', ...(type === 'fixed_asset_label' || type === 'package_label' || type === 'test_page' ? [] : ['timestamp']), ...(type === 'package_label' ? [] : ['footer'])]]))

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
  const getDocumentPrintTemplate = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    const documentType = request.data?.documentType
    if (!Object.hasOwn(TEMPLATE_DOCS, documentType)) throw new HttpsError('invalid-argument', 'Tipo de comprobante no permitido.')
    const profile = (await db.collection('users').doc(request.auth.uid).get()).data()
    if (profile?.isActive !== true) throw new HttpsError('permission-denied', 'Se requiere un perfil activo.')
    const ref = db.doc(`ticket_templates/${documentType}`)
    const [snap, histories] = await Promise.all([ref.get(), ref.collection('history').orderBy('version', 'desc').limit(20).get()])
    return { documentType, template: snap.exists ? snap.data().template : null, version: snap.exists ? snap.data().version : 0,
      history: histories.docs.map(doc => ({ version: doc.data().version, action: doc.data().action, timestampIso: doc.data().timestampIso, uid: doc.data().uid, restoredFrom: doc.data().restoredFrom || null })), canEdit: isTemplateWriter(profile, isOperationalAdmin) }
  })

  const saveDocumentPrintTemplate = onCall({ cors: true }, async request => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Inicie sesión.')
    recentAuth(request)
    const documentType = request.data?.documentType
    if (!Object.hasOwn(TEMPLATE_DOCS, documentType)) throw new HttpsError('invalid-argument', 'Tipo de comprobante no permitido.')
    const caller = (await db.collection('users').doc(request.auth.uid).get()).data()
    if (!isTemplateWriter(caller, isOperationalAdmin)) throw new HttpsError('permission-denied', 'El perfil no puede administrar plantillas.')
    if (caller.role === 'soporte_pachax') await verifySupportSession(authAdmin, request, true)
    const { action = 'save', template: rawTemplate, expectedVersion, restoreVersion } = request.data || {}
    if (!['save', 'restore'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new HttpsError('invalid-argument', 'Versión u operación no válidas.')
    const ref = db.doc(`ticket_templates/${documentType}`)
    const validate = raw => {
      if (!raw || typeof raw !== 'object' || raw.documentType !== documentType) throw new HttpsError('invalid-argument', 'Plantilla inválida.')
      if (!['58mm', '80mm'].includes(raw.paperFormat) || !Number.isFinite(raw.marginsMm) || raw.marginsMm < 0 || raw.marginsMm > 6 || !['compact', 'normal', 'large'].includes(raw.fontSize) || !['solid', 'dashed', 'none'].includes(raw.separator)) throw new HttpsError('invalid-argument', 'Formato o presentación no válida.')
      if (typeof raw.secondCopyEnabled !== 'boolean' || !['continuous', 'page_break'].includes(raw.cutBetweenCopies) || !['driver', 'none'].includes(raw.cutAtEnd) || !['partial', 'full'].includes(raw.cutPreference) || !Array.isArray(raw.copies) || raw.copies.length !== 2) throw new HttpsError('invalid-argument', 'Configuración de copias/corte no válida.')
      const copies = raw.copies.map((copy, index) => {
        if (!copy || typeof copy !== 'object' || !Array.isArray(copy.visibleFields)) throw new HttpsError('invalid-argument', 'Copia inválida.')
        const allowed = new Set(TEMPLATE_DOCS[documentType])
        const visibleFields = [...new Set([...copy.visibleFields.filter(id => typeof id === 'string' && TEMPLATE_FIELD_IDS.includes(id) && allowed.has(id)), ...TEMPLATE_REQUIRED[documentType]])]
        const requestedOrder = Array.isArray(copy.order) ? copy.order.filter(id => typeof id === 'string' && allowed.has(id) && visibleFields.includes(id)) : visibleFields
        const order = [...new Set([...requestedOrder, ...visibleFields])]
        const fieldStyles = {}
        for (const [id, style] of Object.entries(copy.fieldStyles || {})) if (allowed.has(id) && style && typeof style === 'object') fieldStyles[id] = { bold: style.bold === true, alignment: ['left', 'center', 'right'].includes(style.alignment) ? style.alignment : 'left' }
        return { label: index ? documentType === 'shipment_guide' ? 'COPIA AGENCIA' : documentType === 'passenger_ticket' ? 'PASAJE DEL CHOFER' : 'COPIA 2' : documentType === 'passenger_ticket' ? 'COMPROBANTE DE OFICINA' : 'CLIENTE', visibleFields, order, showBranchContact: copy.showBranchContact === true, showLogo: copy.showLogo === true, fieldStyles, compact: index === 1 || copy.compact === true }
      })
      return { documentType, version: 0, paperFormat: raw.paperFormat, marginsMm: raw.marginsMm, fontSize: raw.fontSize, separator: raw.separator,
        secondCopyEnabled: raw.secondCopyEnabled, cutBetweenCopies: raw.cutBetweenCopies, cutAtEnd: raw.cutAtEnd, cutPreference: raw.cutPreference, copies }
    }
    return db.runTransaction(async tx => {
      const current = await tx.get(ref)
      const source = action === 'restore' && Number.isSafeInteger(restoreVersion) ? await tx.get(ref.collection('history').doc(String(restoreVersion))) : null
      const currentVersion = current.exists ? Number(current.data()?.version) || 0 : 0
      if (currentVersion !== expectedVersion) throw new HttpsError('aborted', 'Otra persona guardó una versión. Recargue antes de continuar.')
      if (action === 'restore' && !source?.exists) throw new HttpsError('not-found', 'No se encontró la versión solicitada.')
      const template = validate(action === 'restore' ? source.data()?.template : rawTemplate)
      const version = currentVersion + 1, timestampIso = new Date().toISOString(), uid = request.auth.uid
      const entry = { version, action, template: { ...template, version }, uid, timestampIso, restoredFrom: action === 'restore' ? restoreVersion : null }
      tx.set(ref, { template: entry.template, version, updatedAtIso: timestampIso, updatedByUid: uid })
      tx.create(ref.collection('history').doc(String(version)), entry)
      tx.create(db.collection('audit_logs').doc(), { action: action === 'restore' ? 'DOCUMENT_PRINT_TEMPLATE_RESTORED' : 'DOCUMENT_PRINT_TEMPLATE_SAVED', entityType: 'ticket_template', entityId: documentType, version, restoredFrom: entry.restoredFrom, uid, timestampIso })
      return { success: true, version, template: entry.template }
    })
  })

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

  return { getShipmentTicketTemplate, saveShipmentTicketTemplate, getDocumentPrintTemplate, saveDocumentPrintTemplate }
}
