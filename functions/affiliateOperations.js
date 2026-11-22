import { FieldPath, Filter } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

// Solo campos operativos. Las descripciones libres, referencias bancarias, identidades
// privadas y objetos anidados quedan fuera, incluso si existen en registros antiguos.
const views = {
  encomiendas: ['shipments', 'originBranchId', 'createdAtIso', { trackingCode: 'Guía', destinationBranchId: 'Destino', status: 'Estado', packageCount: 'Bultos', agreedAmountCents: 'Importe', paymentStatus: 'Pago' }],
  pasajes: ['passenger_ticket_operations', 'branchId', 'travelDate', { operationNumber: 'Operación', destinationBranchId: 'Destino', quantity: 'Cantidad', usedCount: 'Usados', totalAmountCents: 'Importe', paymentStatus: 'Pago', settlementStatus: 'Entrega' }],
  almacen: ['shelves', null, 'createdAtIso', { name: 'Estante', code: 'Código', active: 'Activo', moduleCount: 'Módulos' }],
  caja: ['cash_shifts', 'branchId', 'openedAt', { shiftNumber: 'Turno', status: 'Estado', initialCashCents: 'Fondo inicial', expectedCashCents: 'Efectivo esperado', actualCashCents: 'Efectivo contado', differenceCents: 'Diferencia' }],
  comisiones: ['driver_commission_records', 'originBranchId', 'createdAtIso', { trackingCode: 'Guía', commissionAmountCents: 'Devengado', paidAmountCents: 'Liquidado', status: 'Estado' }],
  afiliados: ['union_members', 'branchId', 'joinedAt', { memberNumber: 'Número de afiliado', category: 'Categoría', status: 'Estado' }],
  aportes: ['union_dues', 'branchId', 'period', { period: 'Período', amountCents: 'Cuota', paidAmountCents: 'Pagado', balanceCents: 'Saldo', status: 'Estado' }],
  prestamos: ['union_loans', 'branchId', 'grantDate', { loanNumber: 'Préstamo', principalCents: 'Principal', balanceCents: 'Saldo', installmentCount: 'Cuotas', disbursementStatus: 'Desembolso', status: 'Estado' }],
  multas: ['union_fines', 'branchId', 'date', { category: 'Categoría', amountCents: 'Importe', balanceCents: 'Saldo', status: 'Estado' }],
  deportes: ['union_sports_events', 'branchId', 'date', { activityName: 'Jornada', participantCount: 'Participantes', status: 'Estado' }],
  inventario: ['fixed_assets', 'branchId', 'createdAtIso', { assetCode: 'Código', name: 'Bien', category: 'Categoría', acquisitionCostCents: 'Valor', status: 'Estado' }],
  personal: ['union_workers', 'branchId', 'createdAtIso', { workerCode: 'Código', role: 'Cargo', salaryType: 'Modalidad', status: 'Estado' }],
  gastos: ['union_expenses', 'branchId', 'paidAtIso', { voucherNumber: 'Comprobante', category: 'Categoría', amountCents: 'Importe', paymentMethod: 'Medio', status: 'Estado' }],
  reportes: ['financial_movements', 'branchId', 'timestamp', { type: 'Movimiento', category: 'Categoría', amountCents: 'Importe', paymentMethod: 'Medio', status: 'Estado' }],
  historial: ['shipment_incidents', 'branchId', 'createdAtIso', { trackingCode: 'Guía', incidentType: 'Incidencia', status: 'Estado' }],
}

const pageSize = 40

function dateOf(value) {
  if (typeof value?.toDate === 'function') value = value.toDate().toISOString()
  if (typeof value !== 'string') return ''
  return /^\d{4}-\d{2}(-\d{2})?/.exec(value)?.[0] || ''
}

export async function readAffiliateOperations(db, caller, data = {}) {
  const { module, branchId, search = '', from = '', to = '', cursor = '' } = data
  if (caller.role !== 'afiliado' || caller.isActive !== true ||
      !['punata', 'cochabamba'].includes(branchId) ||
      !(caller.primaryBranchId === branchId || (Array.isArray(caller.allowedBranchIds) && caller.allowedBranchIds.includes(branchId)))) {
    throw new HttpsError('permission-denied', 'La agencia solicitada no está autorizada.')
  }
  if (!Object.hasOwn(views, module) || typeof search !== 'string' || search.length > 80 ||
      typeof cursor !== 'string' || cursor.length > 512 || cursor.includes('/') ||
      [from, to].some(value => typeof value !== 'string' || (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) ||
      (from && to && from > to)) {
    throw new HttpsError('invalid-argument', 'Revise el módulo, la búsqueda y las fechas.')
  }

  const [collection, branchField, dateField, fields] = views[module]
  const columns = Object.entries(fields).map(([key, label]) => ({ key, label, money: key.endsWith('Cents') }))
  const shelfView = collection === 'shelves'
  const shipmentView = collection === 'shipments'
  const loanView = collection === 'union_loans'
  const source = shelfView ? db.collection('branches').doc(branchId).collection('shelves') : db.collection(collection)
  const scoped = shelfView || loanView ? source : shipmentView
    ? source.where(Filter.or(Filter.where('originBranchId', '==', branchId), Filter.where('destinationBranchId', '==', branchId)))
    : source.where(branchField, '==', branchId)
  let query = scoped.orderBy(FieldPath.documentId())
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.select(...new Set([dateField, 'createdAt', 'createdAtIso', ...Object.keys(fields), ...(loanView ? ['memberId'] : [])])).limit(201).get()
  const memberBranches = new Map()
  if (loanView) {
    const memberIds = new Set(snapshot.docs.map(doc => doc.get('memberId')).filter(id => typeof id === 'string' && id && !id.includes('/')))
    if (memberIds.size) {
      const members = await db.getAll(...Array.from(memberIds, id => db.collection('union_members').doc(id)), { fieldMask: ['branchId'] })
      for (const member of members) memberBranches.set(member.id, member.get('branchId'))
    }
  }
  const needle = search.trim().toLocaleLowerCase('es')
  const rows = []
  let lastVisited = ''
  let processed = 0
  for (const record of snapshot.docs.slice(0, 200)) {
    lastVisited = record.id
    processed++
    const item = record.data()
    if (loanView && memberBranches.get(item.memberId) !== branchId) continue
    const date = dateOf(item[dateField] ?? item.createdAtIso ?? item.createdAt)
    if ((from || to) && (!date || (from && (date.length === 7 ? date < from.slice(0, 7) : date < from)) || (to && (date.length === 7 ? date > to.slice(0, 7) : date > to)))) continue
    const values = Object.fromEntries(Object.keys(fields).flatMap(key => {
      const value = item[key]
      if (typeof value === 'boolean') return [[key, value]]
      if (typeof value === 'number' && Number.isFinite(value)) return [[key, value]]
      if (typeof value === 'string' && !key.endsWith('Cents')) return [[key, value.slice(0, 160)]]
      return []
    }))
    if (needle && ![date, ...Object.values(values)].some(value => String(value).toLocaleLowerCase('es').includes(needle))) continue
    rows.push({ date, values })
    if (rows.length === pageSize) break
  }
  return { columns, rows, nextCursor: snapshot.size > processed ? lastVisited : null }
}
