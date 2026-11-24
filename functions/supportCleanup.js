import crypto from 'node:crypto'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { CLEANUP_INVENTORY, CLEANUP_RELATIONS, CLEANUP_DELETABLE_COLLECTIONS } from './cleanupInventory.js'

const PROVENANCE = 'support_cleanup_provenance'
const PLANS = 'support_cleanup_plans'
const OPERATIONS = 'support_cleanup_operations'
const BACKUPS = 'support_cleanup_backups'
const RESTORES = 'support_cleanup_restores'
const PROVENANCE_SECRET = 'pachax-cleanup-provenance-v1-emulator-only'
const PLAN_TTL_MS = 30 * 60 * 1000
const SCAN_LIMIT = 501
const MAX_PLAN_RECORDS = 450
const WRITE_BATCH_SIZE = 150

const inEmulators = () => process.env.FUNCTIONS_EMULATOR === 'true'
  && Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  && (process.env.GCLOUD_PROJECT || '').startsWith('demo-')

function stable(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return { __timestamp: value.toDate().toISOString() }
  if (Buffer.isBuffer(value)) return { __bytes: value.toString('base64') }
  if (Array.isArray(value)) return value.map(stable)
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
}

export function cleanupDataHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(data))).digest('hex')
}

function pathId(path) { return crypto.createHash('sha256').update(path).digest('hex') }
function provenanceSignature(path, contentHash, datasetId) {
  return crypto.createHmac('sha256', PROVENANCE_SECRET).update(`${path}\0${contentHash}\0${datasetId}`).digest('hex')
}
function getAtPath(data, field) { return typeof field === 'string' ? field.split('.').reduce((value, key) => value?.[key], data) : undefined }
function stringValues(value) { return typeof value === 'string' && value ? [value] : [] }
function datesFrom(item, data) { return (item.dateFields || []).flatMap(field => stringValues(getAtPath(data, field))).sort() }
function branchFrom(item, data) { return (item.branchFields || []).map(field => getAtPath(data, field)).find(value => typeof value === 'string') || null }
function amountFrom(item, data) { return (item.amountFields || []).reduce((sum, field) => sum + (Number.isSafeInteger(getAtPath(data, field)) ? getAtPath(data, field) : 0), 0) }
function validateFilters(input = {}) {
  const categories = input.categories
  if (!Array.isArray(categories) || !categories.length || categories.length > CLEANUP_INVENTORY.length
    || categories.some(value => typeof value !== 'string' || !CLEANUP_INVENTORY.some(item => item.category === value))) {
    throw new HttpsError('invalid-argument', 'Seleccione categorías presentes en el inventario operativo.')
  }
  const ids = input.ids === undefined ? [] : input.ids
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(value => typeof value !== 'string' || !value.trim() || value.includes('/'))) {
    throw new HttpsError('invalid-argument', 'Los identificadores concretos no son válidos.')
  }
  const branchId = input.branchId || ''
  if (branchId && !['punata', 'cochabamba'].includes(branchId)) throw new HttpsError('invalid-argument', 'Agencia no válida.')
  const from = input.from || ''
  const to = input.to || ''
  for (const date of [from, to]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw new HttpsError('invalid-argument', 'Use fechas con formato AAAA-MM-DD.')
  if (from && to && from > to) throw new HttpsError('invalid-argument', 'El rango de fechas está invertido.')
  if (input.origin && !['all', 'verified', 'unknown'].includes(input.origin)) throw new HttpsError('invalid-argument', 'Filtro de procedencia no válido.')
  const dependencyType = input.dependencyType || ''
  if (dependencyType && !['all', 'manifiesto', 'sin_dependencias', 'financiera', 'operativa'].includes(dependencyType)) throw new HttpsError('invalid-argument', 'Tipo de dependencia no válido.')
  return { categories: [...new Set(categories)].sort(), ids: [...new Set(ids.map(value => value.trim()))].sort(), branchId, from, to, status: typeof input.status === 'string' ? input.status.slice(0, 60) : '', origin: input.origin || 'all', dependencyType }
}

function filterMatches(item, doc, filters, provenance) {
  const data = doc.data
  if (filters.ids.length && !filters.ids.includes(doc.id)) return false
  if (filters.branchId && !(item.branchFields || []).some(field => getAtPath(data, field) === filters.branchId)) return false
  if (filters.status && getAtPath(data, item.statusField || 'status') !== filters.status) return false
  const dates = datesFrom(item, data)
  if (filters.from && (!dates.length || dates.every(date => date.slice(0, 10) < filters.from))) return false
  if (filters.to && (!dates.length || dates.every(date => date.slice(0, 10) > filters.to))) return false
  if (filters.origin === 'verified' && !provenance) return false
  if (filters.origin === 'unknown' && provenance) return false
  if (filters.dependencyType === 'manifiesto' && item.collection !== 'manifests' && !data.manifestId && !data.assignedVehicle?.manifestId) return false
  if (filters.dependencyType === 'sin_dependencias' && ['manifests'].includes(item.collection)) return false
  if (filters.dependencyType === 'financiera' && !['financial_movements', 'cash_shifts', 'driver_settlements', 'driver_commission_records', 'passenger_ticket_operations', 'union_dues', 'union_loans', 'union_fines', 'union_worker_payments', 'union_expenses'].includes(item.collection)) return false
  if (filters.dependencyType === 'operativa' && !['shipments', 'manifests', 'shipment_incidents', 'shipment_contacts', 'shipment_notifications'].includes(item.collection)) return false
  return true
}

function previewRecord(node) {
  const { descriptor, id, data, path, origin, protectedReason } = node
  return {
    path, collection: descriptor.collection, category: descriptor.category, label: descriptor.label,
    id, recognizedId: getAtPath(data, descriptor.idField) || data.trackingCode || data.manifestNumber || id,
    origin, branchId: branchFrom(descriptor, data), date: datesFrom(descriptor, data)[0] || null,
    status: data[descriptor.statusField || 'status'] ?? null, amountCents: amountFrom(descriptor, data),
    protected: Boolean(protectedReason || !descriptor.deletable), reason: protectedReason || descriptor.protectedReason || null,
    autoIncluded: Boolean(node.autoIncluded), inclusionReason: node.inclusionReason || 'Seleccionado directamente por los filtros.',
  }
}

function linksFor(node, nodesByPath, nodesByCollection) {
  const { descriptor, data, id } = node
  const links = []
  const add = (collection, targetId, relation) => {
    if (!targetId || typeof targetId !== 'string') return
    const direct = nodesByPath.get(`${collection}/${targetId}`)
    if (direct) links.push({ node: direct, relation })
    else links.push({ missingPath: `${collection}/${targetId}`, relation })
  }
  if (descriptor.collection === 'shipments') {
    const manifestId = data.manifestId || data.assignedVehicle?.manifestId
    add('manifests', manifestId, 'La guía referencia manifestId/assignedVehicle.manifestId.')
    add('financial_movements', data.financialMovementId, 'La guía referencia financialMovementId.')
    add('cash_shifts', data.cashShiftId, 'La guía referencia el turno por cashShiftId.')
    for (const collection of ['financial_movements', 'shipment_incidents', 'shipment_contacts', 'shipment_notifications', 'driver_custody_records', 'driver_commission_records']) {
      for (const linked of nodesByCollection.get(collection) || []) {
        const d = linked.data
        const shipmentKeys = new Set([id, data.trackingCode].filter(value => typeof value === 'string'))
        const matches = collection === 'financial_movements'
          ? [d.shipmentId, d.trackingCode, d.referenceId].some(value => shipmentKeys.has(value))
          : collection === 'driver_commission_records'
            ? shipmentKeys.has(d.shipmentId)
            : [d.shipmentId, d.trackingCode].some(value => shipmentKeys.has(value))
        if (matches) links.push({ node: linked, relation: `Referencia ${collection} por ${collection === 'driver_commission_records' ? 'shipmentId' : 'shipmentId/trackingCode/referenceId'}.` })
      }
    }
  }
  if (descriptor.collection === 'manifests') {
    const ids = [...new Set([...(Array.isArray(data.shipmentIds) ? data.shipmentIds : []), ...(Array.isArray(data.shipmentSummaries) ? data.shipmentSummaries.map(item => item?.shipmentId) : [])].filter(value => typeof value === 'string'))]
    for (const shipmentId of ids) add('shipments', shipmentId, 'El manifiesto enumera el shipmentId en shipmentIds/shipmentSummaries[].shipmentId.')
  }
  if (descriptor.collection === 'cash_shifts') {
    for (const movement of nodesByCollection.get('financial_movements') || []) if ([movement.data.shiftId, movement.data.cashShiftId].includes(id)) links.push({ node: movement, relation: 'financial_movements.shiftId/cashShiftId apunta a este turno.' })
    for (const lock of nodesByCollection.get('cash_shift_active_locks') || []) if (lock.data.shiftId === id) links.push({ node: lock, relation: 'El candado activo referencia shiftId.' })
  }
  if (descriptor.collection === 'cash_shift_active_locks') add('cash_shifts', data.shiftId, 'El candado activo referencia shiftId.')
  if (descriptor.collection === 'financial_movements') {
    if (data.shipmentId) add('shipments', data.shipmentId, 'El movimiento financiero referencia shipmentId.')
    else if (data.trackingCode) add('shipments', data.trackingCode, 'El movimiento financiero referencia trackingCode.')
    else if (data.referenceId) {
      const shipment = (nodesByCollection.get('shipments') || []).find(item => item.data.trackingCode === data.referenceId)
      if (shipment) links.push({ node: shipment, relation: 'El movimiento financiero referencia referenceId igual al trackingCode.' })
    }
    add('cash_shifts', data.shiftId || data.cashShiftId, 'El movimiento referencia el turno por shiftId/cashShiftId.')
    add('driver_settlements', data.settlementId, 'El movimiento referencia la liquidación por settlementId.')
    add('union_dues', data.dueId, 'El movimiento de aporte referencia dueId.')
    add('union_loans', data.loanId, 'El movimiento de préstamo referencia loanId.')
    add('union_fines', data.fineId, 'El movimiento de multa referencia fineId.')
    add('union_members', data.memberId, 'El movimiento de aporte/desembolso referencia memberId.')
    add('union_workers', data.workerId, 'El movimiento de personal referencia workerId.')
    for (const operation of nodesByCollection.get('passenger_ticket_operations') || []) if (data.ticketOperationId === operation.id || data.referenceId === operation.data.operationNumber) links.push({ node: operation, relation: 'El movimiento de pasaje referencia ticketOperationId/referenceId.' })
  }
  if (descriptor.collection === 'driver_settlements') {
    for (const shipmentId of [...new Set([...(Array.isArray(data.reconciledShipmentIds) ? data.reconciledShipmentIds : []), ...(Array.isArray(data.reconciledShipments) ? data.reconciledShipments.map(item => item?.shipmentId) : [])])]) add('shipments', shipmentId, 'La liquidación enumera guías conciliadas.')
    add('cash_shifts', data.cashShiftId, 'La liquidación referencia cashShiftId.')
    for (const recordId of Array.isArray(data.allocatedRecords) ? data.allocatedRecords.map(item => item?.recordId) : []) add('driver_custody_records', recordId, 'allocatedRecords[].recordId referencia el asiento de custodia.')
    for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.settlementId === id) links.push({ node: movement, relation: 'El movimiento financiero referencia settlementId.' })
  }
  if (descriptor.collection === 'driver_custody_records') {
    add('driver_custody_accounts', data.driverUid, 'El asiento de custodia referencia la cuenta por driverUid/document ID.')
    for (const settlementId of [...new Set([...(Array.isArray(data.settlementIds) ? data.settlementIds : []), ...(Array.isArray(data.settlementsHistory) ? data.settlementsHistory.map(item => item?.settlementId) : []), ...(data.lastSettlementId ? [data.lastSettlementId] : [])])]) add('driver_settlements', settlementId, 'El asiento de custodia referencia la liquidación por settlementIds/lastSettlementId/settlementsHistory.')
  }
  if (descriptor.collection === 'driver_custody_accounts') for (const record of nodesByCollection.get('driver_custody_records') || []) if (record.data.driverUid === id) links.push({ node: record, relation: 'driver_custody_records.driverUid referencia la cuenta.' })
  if (descriptor.collection === 'driver_commission_records' && data.shipmentId) add('shipments', data.shipmentId, 'El devengo referencia shipmentId.')
  if (descriptor.collection === 'passenger_ticket_operations') {
    add('financial_movements', data.paymentMovementId, 'La operación de pasaje referencia paymentMovementId.')
    for (const validation of nodesByCollection.get('passenger_ticket_validations') || []) if (validation.data.operationId === id || validation.data.ticketCode === id) links.push({ node: validation, relation: 'La validación referencia operationId/ticketCode.' })
    for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.ticketOperationId === id || movement.data.referenceId === data.operationNumber) links.push({ node: movement, relation: 'El movimiento financiero referencia ticketOperationId/referenceId.' })
  }
  if (descriptor.collection === 'passenger_ticket_validations') add('passenger_ticket_operations', data.operationId || data.ticketCode, 'La validación referencia operationId/ticketCode.')
  if (descriptor.collection === 'union_members') {
    for (const collection of ['union_dues', 'union_loans', 'union_fines']) for (const linked of nodesByCollection.get(collection) || []) if (linked.data.memberId === id) links.push({ node: linked, relation: `${collection} referencia memberId.` })
    for (const user of nodesByCollection.get('users') || []) if (user.data.unionMemberId === id) links.push({ node: user, relation: 'users.unionMemberId referencia el afiliado.' })
  }
  if (['union_dues', 'union_loans', 'union_fines'].includes(descriptor.collection)) add('union_members', data.memberId, 'El expediente de afiliado referencia memberId.')
  if (descriptor.collection === 'union_dues') for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.dueId === id) links.push({ node: movement, relation: 'El movimiento financiero referencia dueId.' })
  if (descriptor.collection === 'union_loans') for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.loanId === id) links.push({ node: movement, relation: 'El movimiento financiero referencia loanId.' })
  if (descriptor.collection === 'union_fines') for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.fineId === id) links.push({ node: movement, relation: 'El movimiento financiero referencia fineId.' })
  if (descriptor.collection === 'union_worker_payments') {
    add('union_workers', data.workerId, 'El pago de personal referencia workerId.')
    for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.referenceId === data.id || movement.data.referenceId === id) links.push({ node: movement, relation: 'El movimiento financiero referencia el pago de personal por referenceId.' })
  }
  if (descriptor.collection === 'union_workers') for (const payment of nodesByCollection.get('union_worker_payments') || []) if (payment.data.workerId === id) links.push({ node: payment, relation: 'El pago de personal referencia workerId.' })
  if (descriptor.collection === 'union_expenses') for (const movement of nodesByCollection.get('financial_movements') || []) if (movement.data.referenceId === id) links.push({ node: movement, relation: 'El movimiento financiero referencia el egreso por referenceId.' })
  if (descriptor.collection === 'fixed_asset_batches') for (const assetId of Array.isArray(data.assetIds) ? data.assetIds : []) add('fixed_assets', assetId, 'El lote enumera assetIds[].')
  if (descriptor.collection === 'fixed_assets') for (const batch of nodesByCollection.get('fixed_asset_batches') || []) if ((batch.data.assetIds || []).includes(id)) links.push({ node: batch, relation: 'fixed_asset_batches.assetIds[] contiene el activo.' })
  if (descriptor.collection === 'branch_consumables') for (const movement of nodesByCollection.get('consumable_movements') || []) if (movement.data.consumableId === id) links.push({ node: movement, relation: 'El movimiento de almacén referencia consumableId.' })
  if (descriptor.collection === 'consumable_movements') add('branch_consumables', data.consumableId, 'El movimiento de almacén referencia consumableId.')
  // Only relations confirmed in current writers/readers are traversed. Other
  // collections stay visible and protected; no guessed edge can authorize deletion.
  return links
}

async function readModel(db) {
  const catalogItems = CLEANUP_INVENTORY.filter(item => !['audit_logs', 'idempotency_keys'].includes(item.collection))
  const snapshots = await Promise.all(catalogItems.map(async descriptor => [descriptor, await db.collection(descriptor.collection).limit(SCAN_LIMIT).get()]))
  const oversized = snapshots.filter(([, snapshot]) => snapshot.size >= SCAN_LIMIT).map(([descriptor]) => descriptor.collection)
  if (oversized.length) throw new HttpsError('resource-exhausted', `El inventario excede el límite seguro en: ${oversized.join(', ')}. Acote el conjunto antes de simular.`)
  const registry = await db.collection(PROVENANCE).limit(2501).get()
  if (registry.size > 2500) throw new HttpsError('resource-exhausted', 'La procedencia registrada excede el límite seguro de lectura.')
  const provenanceByPath = new Map(registry.docs.map(doc => [doc.data()?.recordPath, doc.data()]))
  const nodesByPath = new Map()
  const nodesByCollection = new Map()
  for (const [descriptor, snapshot] of snapshots) {
    const values = []
    for (const doc of snapshot.docs) {
      const path = doc.ref.path
      const data = doc.data()
      const stored = provenanceByPath.get(path)
      let valid = false
      if (stored?.source === 'test-seed-helper-v1' && stored.recordPath === path && stored.datasetId && stored.contentHash === cleanupDataHash(data)) {
        valid = stored.signature === provenanceSignature(path, stored.contentHash, stored.datasetId)
      }
      const node = { descriptor, id: doc.id, data, path, ref: doc.ref, updateTime: doc.updateTime?.toMillis?.() || null, contentHash: cleanupDataHash(data), origin: valid ? 'verificado' : 'Origen no verificado', provenance: valid ? stored : null }
      nodesByPath.set(path, node)
      values.push(node)
    }
    nodesByCollection.set(descriptor.collection, values)
  }
  return { nodesByPath, nodesByCollection }
}

async function inspectComponents(db, filters) {
  const { nodesByPath, nodesByCollection } = await readModel(db)
  const descriptors = CLEANUP_INVENTORY.filter(item => filters.categories.includes(item.category))
  const candidates = descriptors.flatMap(descriptor => (nodesByCollection.get(descriptor.collection) || [])
    .filter(node => filterMatches(descriptor, node, filters, node.provenance)))
  const selected = candidates
  const candidateStatus = candidates.map(node => ({ node, state: !node.provenance ? 'unknown' : !node.descriptor.deletable ? 'protected' : 'candidate' }))
  const included = new Map()
  const visited = new Set()
  const selectedPaths = new Set(selected.map(node => node.path))
  const autoIncludedPaths = new Set()
  const adjacency = new Map()
  const exclusions = candidateStatus.filter(row => row.state !== 'candidate').map(row => ({ ...previewRecord(row.node), reason: row.state === 'unknown' ? 'Origen no verificado: falta procedencia registrada por el seeder seguro.' : row.node.descriptor.protectedReason }))
  const conflicts = []
  const queue = [...selected]
  while (queue.length) {
    const node = queue.shift()
    if (visited.has(node.path)) continue
    visited.add(node.path)
    const eligible = Boolean(node.provenance && node.descriptor.deletable)
    if (!node.provenance) conflicts.push({ path: node.path, id: node.id, reason: 'La dependencia no tiene procedencia verificable.' })
    else if (!node.descriptor.deletable) conflicts.push({ path: node.path, id: node.id, reason: node.descriptor.protectedReason || 'Colección protegida.' })
    if (eligible) included.set(node.path, node)
    // Operational writes create immutable global audit rows with these exact
    // schema variants. Inspect them by indexed equality instead of scanning the
    // full audit collection; any match remains visible and blocks deletion.
    if (['shipments', 'manifests'].includes(node.descriptor.collection)) {
      const [entityAudits, targetAudits] = await Promise.all([
        db.collection('audit_logs').where('entityId', '==', node.id).limit(201).get(),
        db.collection('audit_logs').where('targetId', '==', node.id).limit(201).get(),
      ])
      const entityType = node.descriptor.collection === 'shipments' ? 'shipment' : 'manifest'
      const auditDocs = new Map([...entityAudits.docs, ...targetAudits.docs]
        .filter(doc => (doc.data().entityType === entityType && doc.data().entityId === node.id)
          || (doc.data().targetCollection === node.descriptor.collection && doc.data().targetId === node.id))
        .map(doc => [doc.ref.path, doc]))
      if (auditDocs.size > 200) conflicts.push({ path: `audit_logs/*/${node.id}`, id: node.id, reason: 'Más de 200 evidencias de auditoría referencian este documento; requiere revisión manual.' })
      for (const audit of [...auditDocs.values()].slice(0, 200)) {
        const auditDescriptor = descriptorForCollection('audit_logs')
        const auditNode = { descriptor: auditDescriptor, id: audit.id, data: audit.data(), path: audit.ref.path, origin: 'Origen no verificado', protectedReason: auditDescriptor.protectedReason }
        exclusions.push({ ...previewRecord(auditNode), reason: 'Auditoría inmutable vinculada por entityType/entityId o targetCollection/targetId.' })
        conflicts.push({ path: audit.ref.path, id: audit.id, reason: 'La guía/manifiesto tiene evidencia en audit_logs; la auditoría es inmutable y bloquea el borrado.' })
      }
    }
    for (const subcollection of node.descriptor.subcollections || []) {
      const snapshot = await node.ref.collection(subcollection).limit(201).get()
      if (!snapshot.empty) {
        if (snapshot.size > 200) conflicts.push({ path: `${node.path}/${subcollection}`, id: subcollection, reason: 'La subcolección supera el límite de 200 documentos inspeccionados; requiere análisis manual.' })
        for (const child of snapshot.docs.slice(0, 200)) {
          const childData = child.data()
          const childDescriptor = { collection: `${node.descriptor.collection}/${subcollection}`, category: node.descriptor.category, label: `${node.descriptor.label} · ${subcollection}`, deletable: false, idField: 'id', branchFields: ['branchId'], dateFields: ['createdAtIso', 'paidAtIso', 'dueDate'], statusField: 'status', amountFields: ['amountCents', 'balanceCents'], protectedReason: 'Subdocumento operativo no clasificable para borrado automático.' }
          const childNode = { descriptor: childDescriptor, id: child.id, data: childData, path: child.ref.path, origin: 'Origen no verificado', protectedReason: childDescriptor.protectedReason }
          exclusions.push({ ...previewRecord(childNode), reason: childDescriptor.protectedReason })
          conflicts.push({ path: child.ref.path, id: child.id, reason: `La subcolección ${subcollection} conserva evidencia operativa; no hay borrado recursivo.` })
          if (subcollection === 'participants' && typeof childData.fineId === 'string') {
            const fine = nodesByPath.get(`union_fines/${childData.fineId}`)
            if (fine) queue.push(fine)
            else conflicts.push({ path: `union_fines/${childData.fineId}`, id: childData.fineId, reason: 'Participante referencia fineId sin expediente de multa existente.' })
          }
        }
      }
    }
    for (const link of linksFor(node, nodesByPath, nodesByCollection)) {
      if (link.missingPath) {
        conflicts.push({ path: link.missingPath, id: link.missingPath.split('/').at(-1), reason: `Referencia huérfana: ${link.relation}` })
        continue
      }
      if (!link.node.provenance || !link.node.descriptor.deletable) {
        conflicts.push({ path: link.node.path, id: link.node.id, reason: `${link.relation} ${link.node.descriptor.protectedReason || 'Origen no verificado; la dependencia no se puede incluir.'}` })
        exclusions.push({ ...previewRecord(link.node), reason: link.node.protectedReason || link.node.descriptor.protectedReason || 'Origen no verificado; dependencia compartida o desconocida.' })
        queue.push(link.node)
        continue
      }
      adjacency.set(node.path, [...(adjacency.get(node.path) || []), link.node.path])
      adjacency.set(link.node.path, [...(adjacency.get(link.node.path) || []), node.path])
      if (!included.has(link.node.path)) {
        if (!selectedPaths.has(link.node.path)) {
          autoIncludedPaths.add(link.node.path)
          link.node.autoIncluded = true
          link.node.inclusionReason = link.relation
        }
        queue.push(link.node)
      }
    }
  }
  const records = [...included.values()].sort((a, b) => a.path.localeCompare(b.path))
  const parent = new Map(records.map(node => [node.path, node.path]))
  const find = path => { const current = parent.get(path); if (current !== path) parent.set(path, find(current)); return parent.get(path) }
  const unite = (left, right) => { const a = find(left); const b = find(right); if (a && b && a !== b) parent.set(b, a) }
  for (const [path, linkedPaths] of adjacency) for (const linkedPath of linkedPaths) unite(path, linkedPath)
  const groups = new Map()
  for (const node of records) { const root = find(node.path); groups.set(root, [...(groups.get(root) || []), node]) }
  for (const group of groups.values()) if (group.length > WRITE_BATCH_SIZE) conflicts.push({ path: group[0].path, id: group[0].id, reason: `El componente conectado supera el máximo seguro de ${WRITE_BATCH_SIZE} documentos por lote.` })
  for (const node of records) node.componentId = cleanupDataHash([...groups.get(find(node.path))].map(item => item.path).sort())
  if (records.length > MAX_PLAN_RECORDS) conflicts.push({ path: null, id: null, reason: `El conjunto supera el máximo de ${MAX_PLAN_RECORDS} registros por plan.` })
  if (filters.ids.length && !candidates.some(node => node.provenance && node.descriptor.deletable)) conflicts.push({ path: null, id: filters.ids.join(', '), reason: 'Los identificadores indicados no coinciden con un registro sintético y elegible.' })
  const summaries = new Map()
  for (const node of records) summaries.set(node.descriptor.collection, (summaries.get(node.descriptor.collection) || 0) + 1)
  const allRelated = [...included.values()]
  const branchIds = [...new Set(allRelated.flatMap(node => (node.descriptor.branchFields || []).map(field => getAtPath(node.data, field)).filter(value => typeof value === 'string')))].sort()
  const allDates = allRelated.flatMap(node => datesFrom(node.descriptor, node.data)).sort()
  const amountCents = allRelated.reduce((sum, node) => sum + amountFrom(node.descriptor, node.data), 0)
  const digestPayload = { filters, records: records.map(node => ({ path: node.path, contentHash: node.contentHash, updateTime: node.updateTime, provenance: node.provenance, componentId: node.componentId })) }
  return {
    filters, records, candidates, exclusions: uniqueByPath(exclusions), conflicts: uniqueConflicts(conflicts),
    digest: cleanupDataHash(digestPayload), summaries: Object.fromEntries(summaries), branchIds,
    from: allDates[0] || null, to: allDates.at(-1) || null, amountCents,
    selectedCount: candidates.length, autoIncludedCount: records.filter(node => autoIncludedPaths.has(node.path)).length,
    ready: records.length > 0 && conflicts.length === 0,
  }
}

function uniqueByPath(items) { return [...new Map(items.map(item => [item.path, item])).values()] }
function uniqueConflicts(items) { return [...new Map(items.map(item => [`${item.path || ''}:${item.reason}`, item])).values()] }
function descriptorForCollection(collection) { return CLEANUP_INVENTORY.find(item => item.collection === collection) }
function publicPlan(plan, snapshots = []) {
  return {
    planId: plan.planId, operatorUid: plan.operatorUid, createdAtIso: plan.createdAtIso, expiresAtIso: plan.expiresAtIso,
    categories: plan.filters.categories, filters: plan.filters, digest: plan.digest, state: plan.state, ready: plan.ready,
    records: snapshots.map(record => previewRecord({ ...record, descriptor: descriptorForCollection(record.collection) })), exclusions: plan.exclusions, conflicts: plan.conflicts,
    summaries: plan.summaries, selectedCount: plan.selectedCount, autoIncludedCount: plan.autoIncludedCount,
    branchIds: plan.branchIds, from: plan.from, to: plan.to, amountCents: plan.amountCents,
    consequences: plan.ready ? ['Se eliminarán únicamente documentos sintéticos verificados de guías/manifiestos.', 'Los historiales, movimientos, turnos y demás colecciones protegidas se conservan.'] : ['Plan bloqueado: resuelva conflictos mediante revisión autorizada; vuelva a simular.'],
    environment: 'emulador',
  }
}

function assertPlanId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{12,80}$/.test(value)) throw new HttpsError('invalid-argument', 'ID de plan no válido.') }
function requireRecent(request) {
  const now = Date.now() / 1000
  const authTime = request.auth?.token?.auth_time
  if (!Number.isFinite(authTime) || now - authTime > 300 || authTime > now + 30) throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
  if (!inEmulators() && !request.auth?.token?.firebase?.sign_in_second_factor) throw new HttpsError('permission-denied', 'Se requiere autenticación multifactor.')
}
function assertCleanupEmulator() { if (!inEmulators()) throw new HttpsError('failed-precondition', 'La limpieza de colecciones operativas permanece deshabilitada fuera de Firebase Emulator Suite.') }
function auditDoc(db, action, entry) { return db.collection('audit_logs').doc().set({ action, ...entry, createdAtIso: new Date().toISOString() }) }
async function readPlanRecords(db, planId) {
  const snapshot = await db.collection(PLANS).doc(planId).collection('records').orderBy('path').get()
  return snapshot.docs.map(doc => doc.data()).sort((a, b) => (a.componentId || '').localeCompare(b.componentId || '') || a.path.localeCompare(b.path))
}
function chunkByComponents(records) {
  const groups = new Map()
  for (const record of records) groups.set(record.componentId || record.path, [...(groups.get(record.componentId || record.path) || []), record])
  const chunks = []; let current = []; let startIndex = 0; let count = 0
  for (const group of [...groups.values()].sort((a, b) => (a[0].componentId || a[0].path).localeCompare(b[0].componentId || b[0].path))) {
    if (group.length > WRITE_BATCH_SIZE) throw new HttpsError('failed-precondition', 'Un componente relacionado excede el tamaño de lote seguro.')
    if (current.length && current.length + group.length > WRITE_BATCH_SIZE) {
      chunks.push({ startIndex, records: current }); startIndex = count; current = []
    }
    current.push(...group); count += group.length
  }
  if (current.length) chunks.push({ startIndex, records: current })
  return chunks
}

export function createSupportCleanupFunctions(db, authorize) {
  const getSupportCleanupInventory = onCall({ cors: true }, async request => {
    await authorize(request)
    return { environment: inEmulators() ? 'emulador' : 'no disponible en producción', categories: CLEANUP_INVENTORY.map(item => ({ collection: item.collection, category: item.category, label: item.label, deletable: item.deletable, protectedReason: item.protectedReason || null })), relations: CLEANUP_RELATIONS }
  })

  const simulateSupportCleanup = onCall({ cors: true }, async request => {
    await authorize(request)
    assertCleanupEmulator()
    const filters = validateFilters(request.data)
    const inspection = await inspectComponents(db, filters)
    const planId = `cln_${crypto.randomUUID()}`
    const createdAtIso = new Date().toISOString()
    const expiresAtIso = new Date(Date.now() + PLAN_TTL_MS).toISOString()
    const state = inspection.ready ? 'simulado' : 'bloqueado'
    const recordSnapshots = inspection.records.map(node => ({ path: node.path, collection: node.descriptor.collection, id: node.id, data: node.data, contentHash: node.contentHash, updateTime: node.updateTime, provenance: node.provenance, componentId: node.componentId, autoIncluded: node.autoIncluded || false, inclusionReason: node.inclusionReason || null })).sort((a, b) => (a.componentId || '').localeCompare(b.componentId || '') || a.path.localeCompare(b.path))
    const plan = { ...inspection, planId, operatorUid: request.auth.uid, createdAtIso, expiresAtIso, state: 'preparando', ready: false }
    const planRef = db.collection(PLANS).doc(planId)
    const { records: _records, candidates: _candidates, ...planDocument } = plan
    await planRef.create(planDocument)
    for (let offset = 0; offset < recordSnapshots.length; offset += WRITE_BATCH_SIZE) {
      const batch = db.batch()
      for (const record of recordSnapshots.slice(offset, offset + WRITE_BATCH_SIZE)) batch.create(planRef.collection('records').doc(pathId(record.path)), record)
      await batch.commit()
    }
    await planRef.update({ state, ready: inspection.ready, updatedAtIso: new Date().toISOString() })
    plan.state = state
    plan.ready = inspection.ready
    await auditDoc(db, 'SUPPORT_CLEANUP_SIMULATED', { uid: request.auth.uid, planId, digest: inspection.digest, state, selectedCount: inspection.selectedCount, recordCount: inspection.records.length, conflictCount: inspection.conflicts.length })
    return publicPlan(plan, recordSnapshots)
  })

  const getSupportCleanupPlan = onCall({ cors: true }, async request => {
    await authorize(request)
    const { planId } = request.data || {}
    assertPlanId(planId)
    const snapshot = await db.collection(PLANS).doc(planId).get()
    if (!snapshot.exists || snapshot.data()?.operatorUid !== request.auth.uid) throw new HttpsError('not-found', 'No existe un plan disponible para esta sesión técnica.')
    return publicPlan(snapshot.data(), await readPlanRecords(db, planId))
  })

  const listSupportCleanupOperations = onCall({ cors: true }, async request => {
    await authorize(request)
    const snapshot = await db.collection(OPERATIONS).where('operatorUid', '==', request.auth.uid).orderBy('createdAtIso', 'desc').limit(25).get()
    return { operations: snapshot.docs.map(doc => { const d = doc.data(); return { operationId: doc.id, planId: d.planId, digest: d.digest, state: d.state, processed: d.processed || 0, total: d.total || 0, error: d.error || null, leaseUntilMs: d.leaseUntilMs || 0, createdAtIso: d.createdAtIso, updatedAtIso: d.updatedAtIso } }) }
  })

  const executeSupportCleanup = onCall({ cors: true }, async request => {
    await authorize(request, true)
    assertCleanupEmulator()
    requireRecent(request)
    const { planId, digest, operationId, confirmation } = request.data || {}
    assertPlanId(planId)
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || !/^[A-Za-z0-9_-]{12,80}$/.test(operationId || '') || confirmation !== `LIMPIAR ${planId}`) throw new HttpsError('invalid-argument', 'Confirme el ID y la huella exacta del plan.')
    const planRef = db.collection(PLANS).doc(planId)
    const operationRef = db.collection(OPERATIONS).doc(operationId)
    let operation = null
    let alreadyInProgress = false
    await db.runTransaction(async tx => {
      const [profile, planSnap, operationSnap] = await Promise.all([tx.get(db.collection('users').doc(request.auth.uid)), tx.get(planRef), tx.get(operationRef)])
      if (profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
      if (!planSnap.exists || planSnap.data()?.operatorUid !== request.auth.uid || planSnap.data()?.digest !== digest) throw new HttpsError('failed-precondition', 'El plan no pertenece a la sesión o la huella no coincide.')
      const plan = planSnap.data()
      if (operationSnap.exists) {
        const prior = operationSnap.data()
        if (prior.operatorUid !== request.auth.uid || prior.planId !== planId || prior.digest !== digest) throw new HttpsError('already-exists', 'El ID de operación está asociado a otro conjunto.')
        operation = prior
        if (!['preparada', 'en_ejecucion', 'fallida_recuperable', 'completada'].includes(prior.state)) throw new HttpsError('failed-precondition', 'La operación ya quedó bloqueada.')
        if (['preparada', 'en_ejecucion'].includes(prior.state) && (Number(prior.leaseUntilMs) || 0) > Date.now()) { alreadyInProgress = true; return }
        if (prior.state !== 'completada') tx.update(operationRef, { state: 'en_ejecucion', leaseUntilMs: Date.now() + 120_000, updatedAtIso: new Date().toISOString() })
        return
      }
      if (plan.state !== 'simulado' || new Date(plan.expiresAtIso).getTime() <= Date.now() || !plan.ready || plan.conflicts?.length) throw new HttpsError('failed-precondition', 'El plan está bloqueado, vencido o ya se utilizó. Vuelva a simular.')
      const now = new Date().toISOString()
      const planRecords = await tx.get(planRef.collection('records'))
      if (planRecords.empty || planRecords.size > MAX_PLAN_RECORDS) throw new HttpsError('failed-precondition', 'El plan no contiene un lote verificable.')
      operation = { operatorUid: request.auth.uid, planId, digest, state: 'preparada', processed: 0, total: planRecords.size, nextIndex: 0, createdAtIso: now, updatedAtIso: now, backupVerified: false, leaseUntilMs: Date.now() + 120_000 }
      tx.create(operationRef, operation)
      tx.update(planRef, { state: 'en_ejecucion', operationId, updatedAtIso: now })
    })
    if (alreadyInProgress) return { operationId, planId, state: 'en_ejecucion', count: operation.processed || 0, total: operation.total, digest }
    if (operation.state === 'completada') return { operationId, planId, state: operation.state, count: operation.processed, digest }
    const planSnapshot = await planRef.get()
    const plan = planSnapshot.data()
    const planRecords = await readPlanRecords(db, planId)
    try {
      if (!operation.backupVerified) {
        for (let offset = 0; offset < planRecords.length; offset += WRITE_BATCH_SIZE) {
          const batch = db.batch()
          for (const record of planRecords.slice(offset, offset + WRITE_BATCH_SIZE)) {
            const backupId = pathId(record.path)
            const backupRecord = { ...record, operationId }
            batch.set(db.collection(BACKUPS).doc(operationId).collection('records').doc(backupId), { ...backupRecord, backupHash: cleanupDataHash(backupRecord) })
          }
          await batch.commit()
        }
        const backupDocs = await db.collection(BACKUPS).doc(operationId).collection('records').get()
        const validBackup = backupDocs.size === planRecords.length && backupDocs.docs.every(doc => doc.data()?.backupHash === cleanupDataHash(Object.fromEntries(Object.entries(doc.data()).filter(([key]) => key !== 'backupHash'))))
        if (!validBackup) throw new HttpsError('data-loss', 'No se pudo verificar integridad del respaldo; no se inició la limpieza.')
        await operationRef.update({ backupVerified: true, state: 'en_ejecucion', leaseUntilMs: Date.now() + 120_000, updatedAtIso: new Date().toISOString() })
      }
      const chunks = chunkByComponents(planRecords)
      if (!operation.processed) {
        const refreshed = await inspectComponents(db, plan.filters)
        if (refreshed.digest !== digest || !refreshed.ready) throw new HttpsError('aborted', 'Los registros o dependencias cambiaron desde la simulación. El plan quedó invalidado; genere otro.')
      }
      for (const batch of chunks) {
        const offset = batch.startIndex
        const chunk = batch.records
        if (offset < (operation.nextIndex || 0)) continue
        const remaining = planRecords.slice(offset)
        const remainingFilters = {
          categories: [...new Set(remaining.map(record => descriptorForCollection(record.collection).category))].sort(),
          ids: remaining.map(record => record.id), branchId: '', from: '', to: '', status: '', origin: 'verified', dependencyType: 'all',
        }
        const current = await inspectComponents(db, remainingFilters)
        const expected = remaining.map(record => `${record.path}:${record.contentHash}:${record.updateTime}`).sort()
        const actual = current.records.map(record => `${record.path}:${record.contentHash}:${record.updateTime}`).sort()
        if (!current.ready || expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) throw new HttpsError('aborted', 'Cambió el conjunto o apareció una dependencia antes del siguiente lote. Se detuvo la limpieza.')
        await db.runTransaction(async tx => {
          const [profile, currentOperation, currentPlan] = await Promise.all([tx.get(db.collection('users').doc(request.auth.uid)), tx.get(operationRef), tx.get(planRef)])
          if (profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
          if (!currentOperation.exists || currentOperation.data()?.operatorUid !== request.auth.uid || currentOperation.data()?.digest !== digest) throw new HttpsError('permission-denied', 'La operación cambió o no pertenece a esta identidad.')
          if (!currentPlan.exists || currentPlan.data()?.operationId !== operationId || currentOperation.data()?.nextIndex !== offset) throw new HttpsError('aborted', 'Otra ejecución ya avanzó este plan.')
          const docs = await Promise.all(chunk.map(record => tx.get(db.doc(record.path))))
          for (let index = 0; index < chunk.length; index++) {
            const record = chunk[index]
            const doc = docs[index]
            if (!doc.exists || doc.updateTime?.toMillis?.() !== record.updateTime || cleanupDataHash(doc.data()) !== record.contentHash) throw new HttpsError('aborted', `El documento ${record.path} cambió después de simular; detuve el lote.`)
            const stored = (await tx.get(db.collection(PROVENANCE).doc(pathId(record.path)))).data()
            if (stored?.recordPath !== record.path || stored.contentHash !== record.contentHash || stored.signature !== provenanceSignature(record.path, record.contentHash, stored.datasetId)) throw new HttpsError('failed-precondition', `Se perdió la procedencia verificada de ${record.path}.`)
          }
          for (const record of chunk) tx.delete(db.doc(record.path))
          const nextIndex = offset + chunk.length
          const state = nextIndex === planRecords.length ? 'completada' : 'en_ejecucion'
          tx.update(operationRef, { processed: nextIndex, nextIndex, state, leaseUntilMs: state === 'completada' ? 0 : Date.now() + 120_000, updatedAtIso: new Date().toISOString() })
        })
      }
      await Promise.all([planRef.update({ state: 'completado', updatedAtIso: new Date().toISOString() }), operationRef.update({ leaseUntilMs: 0, updatedAtIso: new Date().toISOString() })])
      await auditDoc(db, 'SUPPORT_OPERATIONAL_CLEANUP_COMPLETED', { uid: request.auth.uid, planId, operationId, digest, count: planRecords.length, backupVerified: true })
      return { operationId, planId, state: 'completada', count: planRecords.length, digest }
    } catch (error) {
      const latest = (await operationRef.get()).data()
      const status = latest?.processed ? 'fallida_recuperable' : error?.code === 'aborted' ? 'bloqueada' : 'fallida_recuperable'
      await operationRef.set({ state: status, leaseUntilMs: 0, error: String(error?.message || error).slice(0, 500), updatedAtIso: new Date().toISOString() }, { merge: true })
      if (status === 'bloqueada') await planRef.update({ state: 'invalidado', invalidReason: String(error?.message || error).slice(0, 500), updatedAtIso: new Date().toISOString() })
      await auditDoc(db, 'SUPPORT_OPERATIONAL_CLEANUP_INTERRUPTED', { uid: request.auth.uid, planId, operationId, digest, processed: latest?.processed || 0, error: String(error?.message || error).slice(0, 500) })
      throw error
    }
  })

  const restoreSupportCleanup = onCall({ cors: true }, async request => {
    await authorize(request, true)
    assertCleanupEmulator()
    requireRecent(request)
    const { operationId, confirmation } = request.data || {}
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(operationId || '') || confirmation !== `RESTAURAR ${operationId}`) throw new HttpsError('invalid-argument', 'Confirme el ID completo de la operación para restaurar.')
    const operationRef = db.collection(OPERATIONS).doc(operationId)
    const restoreRef = db.collection(RESTORES).doc(operationId)
    const [operationSnap, backupSnap] = await Promise.all([operationRef.get(), db.collection(BACKUPS).doc(operationId).collection('records').get()])
    if (!operationSnap.exists || operationSnap.data()?.operatorUid !== request.auth.uid || !['completada', 'fallida_recuperable'].includes(operationSnap.data()?.state)) throw new HttpsError('failed-precondition', 'La operación no está disponible para restauración técnica.')
    const operation = operationSnap.data()
    if (backupSnap.empty || backupSnap.size !== operation.total) throw new HttpsError('data-loss', 'El respaldo está incompleto; no se restauró ningún documento.')
    const records = backupSnap.docs.map(doc => doc.data())
    for (const record of records) {
      if (!CLEANUP_DELETABLE_COLLECTIONS.has(record.collection) || record.path !== `${record.collection}/${record.id}` || record.contentHash !== cleanupDataHash(record.data) || record.provenance?.contentHash !== record.contentHash || record.provenance?.signature !== provenanceSignature(record.path, record.contentHash, record.provenance.datasetId)) throw new HttpsError('data-loss', `El respaldo de ${record.path} no supera la verificación.`)
    }
    let prior = await restoreRef.get()
    if (prior.exists && (prior.data()?.operatorUid !== request.auth.uid || prior.data()?.digest !== operation.digest)) throw new HttpsError('permission-denied', 'La recuperación pertenece a otro conjunto.')
    if (prior.exists && prior.data()?.state === 'completada') return prior.data().result
    if (prior.exists && !['en_ejecucion', 'fallida_recuperable'].includes(prior.data()?.state)) throw new HttpsError('failed-precondition', 'La restauración quedó en revisión; requiere conciliación técnica antes de reintentar.')
    const collisions = await Promise.all(records.map(record => db.doc(record.path).get()))
    let priorIndex = prior.exists ? Number(prior.data()?.nextIndex) || 0 : 0
    for (let index = 0; index < priorIndex; index++) if (!collisions[index].exists || cleanupDataHash(collisions[index].data()) !== records[index].contentHash) throw new HttpsError('failed-precondition', `El documento restaurado ${records[index].path} cambió; requiere revisión.`)
    if (collisions.some((doc, index) => index >= priorIndex && doc.exists && cleanupDataHash(doc.data()) !== records[index].contentHash)) {
      await auditDoc(db, 'SUPPORT_OPERATIONAL_CLEANUP_RESTORE_BLOCKED', { uid: request.auth.uid, operationId, digest: operation.digest, reason: 'Colisión de documento; no se sobrescribió.' })
      throw new HttpsError('already-exists', 'Hay documentos nuevos o modificados; no se sobrescribió ningún registro.')
    }
    let restoreAlreadyRunning = false
    let restoreAlreadyCompleted = null
    await db.runTransaction(async tx => {
      const [stateSnap, currentOperation, profile] = await Promise.all([
        tx.get(restoreRef), tx.get(operationRef), tx.get(db.collection('users').doc(request.auth.uid)),
      ])
      if (profile.data()?.role !== 'soporte_pachax' || profile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
      if (!currentOperation.exists || currentOperation.data()?.operatorUid !== request.auth.uid || currentOperation.data()?.digest !== operation.digest) throw new HttpsError('permission-denied', 'La operación cambió o no pertenece a esta identidad.')
      if (stateSnap.exists) {
        const state = stateSnap.data()
        if (state.operatorUid !== request.auth.uid || state.digest !== operation.digest) throw new HttpsError('permission-denied', 'La recuperación pertenece a otro conjunto.')
        if (state.state === 'completada') { restoreAlreadyCompleted = state.result; return }
        if (!['en_ejecucion', 'fallida_recuperable'].includes(state.state)) throw new HttpsError('failed-precondition', 'La restauración quedó en revisión; requiere conciliación técnica antes de reintentar.')
        if (state.state === 'en_ejecucion' && (Number(state.leaseUntilMs) || 0) > Date.now()) { restoreAlreadyRunning = true; return }
        priorIndex = Number(state.nextIndex) || 0
        tx.update(restoreRef, { state: 'en_ejecucion', leaseUntilMs: Date.now() + 120_000, updatedAtIso: new Date().toISOString() })
      } else {
        priorIndex = 0
        tx.create(restoreRef, { operatorUid: request.auth.uid, digest: operation.digest, state: 'en_ejecucion', expected: records.length, processed: 0, nextIndex: 0, leaseUntilMs: Date.now() + 120_000, createdAtIso: new Date().toISOString() })
      }
    })
    if (restoreAlreadyCompleted) return restoreAlreadyCompleted
    if (restoreAlreadyRunning) return { operationId, state: 'en_ejecucion', count: priorIndex, total: records.length, digest: operation.digest }
    await operationRef.set({ restoreState: 'en_ejecucion', restoreProcessed: priorIndex, updatedAtIso: new Date().toISOString() }, { merge: true })
    try {
      for (let offset = priorIndex; offset < records.length; offset += WRITE_BATCH_SIZE) {
        const chunk = records.slice(offset, offset + WRITE_BATCH_SIZE)
        await db.runTransaction(async tx => {
          const [stateSnap, currentOperation] = await Promise.all([tx.get(restoreRef), tx.get(operationRef)])
          if (!stateSnap.exists || stateSnap.data()?.operatorUid !== request.auth.uid || stateSnap.data()?.nextIndex !== offset || !currentOperation.exists || currentOperation.data()?.operatorUid !== request.auth.uid) throw new HttpsError('aborted', 'La restauración fue modificada por otra sesión.')
          const docs = await Promise.all(chunk.map(record => tx.get(db.doc(record.path))))
          for (let index = 0; index < chunk.length; index++) if (docs[index].exists && cleanupDataHash(docs[index].data()) !== chunk[index].contentHash) throw new HttpsError('already-exists', `Apareció un documento diferente en ${chunk[index].path}; no se sobrescribió.`)
          for (let index = 0; index < chunk.length; index++) if (!docs[index].exists) tx.create(db.doc(chunk[index].path), chunk[index].data)
          const nextIndex = offset + chunk.length
          tx.update(restoreRef, { processed: nextIndex, nextIndex, leaseUntilMs: nextIndex === records.length ? 0 : Date.now() + 120_000, updatedAtIso: new Date().toISOString() })
          tx.update(operationRef, { restoreState: nextIndex === records.length ? 'completada' : 'en_ejecucion', restoreProcessed: nextIndex, updatedAtIso: new Date().toISOString() })
        })
      }
      const result = { operationId, state: 'restaurada', count: records.length, digest: operation.digest }
      await restoreRef.update({ state: 'completada', result, leaseUntilMs: 0, updatedAtIso: new Date().toISOString() })
      await auditDoc(db, 'SUPPORT_OPERATIONAL_CLEANUP_RESTORED', { uid: request.auth.uid, operationId, digest: operation.digest, count: records.length })
      return result
    } catch (error) {
      const state = error?.code === 'already-exists' ? 'requiere_revision' : 'fallida_recuperable'
      await restoreRef.set({ state, leaseUntilMs: 0, error: String(error?.message || error).slice(0, 500), updatedAtIso: new Date().toISOString() }, { merge: true })
      await operationRef.set({ restoreState: state, updatedAtIso: new Date().toISOString() }, { merge: true })
      await auditDoc(db, 'SUPPORT_OPERATIONAL_CLEANUP_RESTORE_INTERRUPTED', { uid: request.auth.uid, operationId, digest: operation.digest, processed: (await restoreRef.get()).data()?.processed || 0, error: String(error?.message || error).slice(0, 500) })
      throw error
    }
  })

  return { getSupportCleanupInventory, simulateSupportCleanup, getSupportCleanupPlan, listSupportCleanupOperations, executeSupportCleanup, restoreSupportCleanup }
}
