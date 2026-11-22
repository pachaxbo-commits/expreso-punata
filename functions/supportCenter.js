import crypto from 'node:crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

// This first cleanup implementation is deliberately confined to a synthetic
// collection and the Firebase emulators. It cannot delete operational data.
const COLLECTION = 'support_cleanup_fixtures'
const MARKER = 'pachax-emulator-fixture-v1'
const CATEGORIES = new Set(['encomiendas', 'manifiestos', 'custodia', 'recepciones', 'entregas', 'pasajes', 'cobros', 'caja', 'comisiones', 'aportes', 'multas', 'prestamos', 'almacen', 'inventario'])
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

function selectedCategories(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > CATEGORIES.size || input.some(x => typeof x !== 'string' || !CATEGORIES.has(x))) {
    throw new HttpsError('invalid-argument', 'Seleccione categorías válidas.')
  }
  return [...new Set(input)].sort()
}

function makePlan(snapshot, categories) {
  if (snapshot.size > 100) throw new HttpsError('resource-exhausted', 'El lote supera 100 registros.')
  const docs = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]))
  const selected = new Set([...docs].filter(([, d]) => categories.includes(d.category) && d.testMarker === MARKER).map(([id]) => id))
  const pending = [...selected]
  while (pending.length) {
    const id = pending.pop()
    const item = docs.get(id)
    if (!item || item.testMarker !== MARKER || !CATEGORIES.has(item.category) || !Array.isArray(item.dependsOn) || item.dependsOn.some(x => typeof x !== 'string')) {
      throw new HttpsError('failed-precondition', 'Existe una dependencia sin identificación sintética verificable.')
    }
    // Include both parents and children, to avoid leaving dangling references.
    const related = [...item.dependsOn, ...[...docs].filter(([, d]) => Array.isArray(d.dependsOn) && d.dependsOn.includes(id)).map(([key]) => key)]
    for (const relatedId of related) {
      const linked = docs.get(relatedId)
      if (!linked || linked.testMarker !== MARKER) throw new HttpsError('failed-precondition', 'La selección está vinculada a un registro no verificable.')
      if (!selected.has(relatedId)) { selected.add(relatedId); pending.push(relatedId) }
    }
  }
  const records = [...selected].sort().map(id => ({ id, data: docs.get(id) }))
  const digest = crypto.createHash('sha256').update(JSON.stringify({ categories, records })).digest('hex')
  const branches = [...new Set(records.map(r => r.data.branchId).filter(x => typeof x === 'string'))].sort()
  const dates = records.map(r => r.data.date).filter(x => typeof x === 'string').sort()
  const amountCents = records.reduce((sum, r) => sum + (Number.isSafeInteger(r.data.amountCents) ? r.data.amountCents : 0), 0)
  return { categories, records, digest, branches, from: dates[0] || null, to: dates.at(-1) || null, amountCents, retained: snapshot.size - records.length }
}

function publicPlan(plan) {
  return { categories: plan.categories, records: plan.records.map(r => ({ id: r.id, category: r.data.category, dependsOn: r.data.dependsOn, branchId: r.data.branchId || null })), digest: plan.digest, branches: plan.branches, from: plan.from, to: plan.to, amountCents: plan.amountCents, retained: plan.retained, environment: 'emulador' }
}

export function createSupportFunctions(db) {
  const getSupportOverview = onCall({ cors: true }, async request => {
    await authorize(db, request)
    const config = await db.collection('system_config').doc('expreso_punata').get()
    const c = config.data()?.commissions || {}
    const value = Number(c.defaultValue)
    const validRule = ['percentage', 'fixed_per_shipment'].includes(c.defaultType) && Number.isFinite(value) && value > 0 && (c.defaultType !== 'percentage' || value <= 100)
    return { services: { functions: 'disponible', firestore: 'disponible' }, commissionsConfigured: config.data()?.status === 'configured' && config.data()?.isOfficial === true && validRule, cleanupEnvironment: inEmulators() ? 'emulador' : 'no disponible en producción' }
  })
  const simulateSupportCleanup = onCall({ cors: true }, async request => {
    await authorize(db, request)
    if (!inEmulators()) throw new HttpsError('failed-precondition', 'La limpieza todavía está limitada a emuladores.')
    const categories = selectedCategories(request.data?.categories)
    return publicPlan(makePlan(await db.collection(COLLECTION).limit(101).get(), categories))
  })
  const executeSupportCleanup = onCall({ cors: true }, async request => {
    await authorize(db, request, true)
    if (!inEmulators()) throw new HttpsError('failed-precondition', 'La limpieza todavía está limitada a emuladores.')
    const categories = selectedCategories(request.data?.categories)
    const { digest, operationId, confirmation } = request.data || {}
    if (!/^[a-f0-9]{64}$/.test(digest || '') || !/^[a-zA-Z0-9_-]{12,80}$/.test(operationId || '') || confirmation !== 'LIMPIAR') throw new HttpsError('invalid-argument', 'Confirme la simulación y la operación.')
    const operationRef = db.collection('support_cleanup_operations').doc(operationId)
    return db.runTransaction(async tx => {
      const currentProfile = await tx.get(db.collection('users').doc(request.auth.uid))
      if (currentProfile.data()?.role !== 'soporte_pachax' || currentProfile.data()?.isActive !== true) throw new HttpsError('permission-denied', 'La autorización de soporte ya no está activa.')
      const prior = await tx.get(operationRef)
      if (prior.exists) {
        const saved = prior.data()
        if (saved.uid !== request.auth.uid || saved.digest !== digest) throw new HttpsError('already-exists', 'Identificador de operación ya utilizado.')
        return saved.result
      }
      const snap = await tx.get(db.collection(COLLECTION).limit(101))
      const plan = makePlan(snap, categories)
      if (plan.digest !== digest) throw new HttpsError('aborted', 'Los datos cambiaron; vuelva a simular.')
      if (!plan.records.length) throw new HttpsError('failed-precondition', 'No hay registros seleccionados.')
      const result = { operationId, count: plan.records.length, digest }
      tx.create(db.collection('support_cleanup_backups').doc(operationId), { records: plan.records, uid: request.auth.uid, createdAt: new Date().toISOString() })
      tx.create(db.collection('audit_logs').doc(), { action: 'SUPPORT_FIXTURE_CLEANUP', uid: request.auth.uid, operationId, digest, count: plan.records.length, createdAt: new Date().toISOString() })
      tx.create(operationRef, { uid: request.auth.uid, digest, result })
      for (const record of plan.records) tx.delete(db.collection(COLLECTION).doc(record.id))
      return result
    })
  })
  return { getSupportOverview, simulateSupportCleanup, executeSupportCleanup }
}
