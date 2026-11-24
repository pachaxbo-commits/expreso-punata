import React, { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'

type InventoryItem = { collection: string; category: string; label: string; deletable: boolean; protectedReason: string | null }
type CleanupRecord = { path: string; collection: string; category: string; label: string; id: string; recognizedId: string; origin: string; branchId: string | null; date: string | null; status: string | null; amountCents: number; protected: boolean; reason: string | null; autoIncluded: boolean; inclusionReason: string }
type Plan = {
  planId: string; operatorUid: string; createdAtIso: string; expiresAtIso: string; categories: string[]; filters: Record<string, unknown>;
  digest: string; state: string; ready: boolean; records: CleanupRecord[]; exclusions: CleanupRecord[];
  conflicts: { path: string | null; id: string | null; reason: string }[]; summaries: Record<string, number>;
  selectedCount: number; autoIncludedCount: number; branchIds: string[]; from: string | null; to: string | null;
  amountCents: number; consequences: string[]; environment: string
}
type Operation = { operationId: string; planId: string; state: string; processed: number; total: number; error: string | null; createdAtIso: string; updatedAtIso: string; leaseUntilMs?: number }
type Inventory = { environment: string; categories: InventoryItem[] }

const inventoryCall = httpsCallable<void, Inventory>(functions, 'getSupportCleanupInventory')
const simulateCall = httpsCallable<Record<string, unknown>, Plan>(functions, 'simulateSupportCleanup')
const getPlanCall = httpsCallable<{ planId: string }, Plan>(functions, 'getSupportCleanupPlan')
const operationsCall = httpsCallable<void, { operations: Operation[] }>(functions, 'listSupportCleanupOperations')
const executeCall = httpsCallable<{ planId: string; digest: string; operationId: string; confirmation: string }, { operationId: string; planId: string; state: string; count: number; digest: string }>(functions, 'executeSupportCleanup')
const restoreCall = httpsCallable<{ operationId: string; confirmation: string }, { operationId: string; state: string; count: number }>(functions, 'restoreSupportCleanup')
const money = (cents: number) => `Bs ${(cents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const CleanupCenter: React.FC<{ environment?: string }> = ({ environment }) => {
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['encomiendas'])
  const [branchId, setBranchId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [idsText, setIdsText] = useState('')
  const [origin, setOrigin] = useState('all')
  const [dependencyType, setDependencyType] = useState('all')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [lookupId, setLookupId] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [operations, setOperations] = useState<Operation[]>([])
  const [restoreId, setRestoreId] = useState('')
  const [retryOperationId, setRetryOperationId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const categories = useMemo(() => [...new Map((inventory?.categories || []).map(item => [item.category, item])).values()], [inventory])
  const groups = useMemo(() => {
    const map = new Map<string, InventoryItem[]>()
    for (const item of inventory?.categories || []) map.set(item.category, [...(map.get(item.category) || []), item])
    return map
  }, [inventory])
  const refreshOperations = async () => setOperations((await operationsCall()).data.operations)

  useEffect(() => {
    void inventoryCall().then(result => setInventory(result.data)).catch(error => setMessage(error instanceof Error ? error.message : 'No se pudo cargar el inventario.'))
    void refreshOperations().catch(() => {})
  }, [])

  const simulate = async () => {
    setBusy(true); setMessage(''); setPlan(null); setConfirmation('')
    try {
      const ids = idsText.split(/[,\n\r\t ]+/).map(value => value.trim()).filter(Boolean)
      const result = await simulateCall({ categories: selectedCategories, branchId, from, to, status, ids, origin, dependencyType })
      setPlan(result.data); setLookupId(result.data.planId)
      setMessage(result.data.state === 'simulado' ? 'Simulación guardada. Revise el conjunto completo antes de ejecutar.' : 'Simulación guardada como bloqueada. Ningún documento se puede eliminar mientras existan conflictos.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo simular la limpieza.') }
    finally { setBusy(false) }
  }
  const loadPlan = async () => {
    setBusy(true); setMessage('')
    try { const result = await getPlanCall({ planId: lookupId.trim() }); setPlan(result.data); setConfirmation(''); setMessage('Plan persistente cargado desde el backend.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo recuperar el plan.') }
    finally { setBusy(false) }
  }
  const execute = async () => {
    if (!plan) return
    setBusy(true); setMessage('')
    try {
      const operationId = retryOperationId || `clean-${crypto.randomUUID()}`
      const result = await executeCall({ planId: plan.planId, digest: plan.digest, operationId, confirmation })
      setRestoreId(result.data.operationId); setRestoreConfirmation('')
      setRetryOperationId('')
      setMessage(`Operación ${result.data.state}: ${result.data.count} documentos. Respaldo verificado. ID ${result.data.operationId}.`)
      await refreshOperations()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo ejecutar el plan.') }
    finally { setBusy(false) }
  }
  const restore = async () => {
    setBusy(true); setMessage('')
    try {
      const result = await restoreCall({ operationId: restoreId.trim(), confirmation: restoreConfirmation })
      setMessage(`Recuperación ${result.data.state}: ${result.data.count} documentos. Operación ${result.data.operationId}.`)
      await refreshOperations()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo restaurar el respaldo.') }
    finally { setBusy(false) }
  }
  const prepareRetry = async (item: Operation) => {
    setBusy(true); setMessage('')
    try {
      const result = await getPlanCall({ planId: item.planId })
      setPlan(result.data); setLookupId(item.planId); setConfirmation(''); setRetryOperationId(item.operationId)
      setMessage(`Plan cargado para reanudar la operación ${item.operationId}. Confirme nuevamente el mismo conjunto.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo cargar el plan para reanudar.') }
    finally { setBusy(false) }
  }

  return <section className="rounded-xl bg-white p-5 shadow-sm sm:p-6" aria-labelledby="cleanup-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Mantenimiento seguro · solo emuladores</p><h2 id="cleanup-heading" className="mt-1 text-xl font-bold">Limpieza de datos de prueba</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Analiza relaciones en las colecciones operativas. Los datos sin procedencia verificada y los libros financieros quedan excluidos o bloquean el plan. No se eliminan usuarios.</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${environment === 'emulador' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>Entorno: {environment || inventory?.environment || 'comprobando'}</span>
    </div>
    {message && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{message}</p>}

    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <div className="space-y-4">
        <fieldset disabled={busy || (environment || inventory?.environment) !== 'emulador'} className="rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">1 · Selección del conjunto</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="text-sm"><span className="font-medium">Categorías</span>
              <div className="mt-2 grid max-h-44 gap-2 overflow-auto rounded border p-2 sm:grid-cols-2">
                {categories.map(category => <label key={category.category} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selectedCategories.includes(category.category)} onChange={event => { setSelectedCategories(event.target.checked ? [...selectedCategories, category.category] : selectedCategories.filter(value => value !== category.category)); setPlan(null) }} /><span><strong>{category.category}</strong><br />{groups.get(category.category)?.map(item => item.collection).join(', ')}</span></label>)}
              </div>
            </div>
            <label className="text-sm">Agencia<select className="mt-1 w-full rounded border p-2" value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">Todas</option><option value="punata">Punata</option><option value="cochabamba">Cochabamba</option></select></label>
            <label className="text-sm">Desde<input type="date" className="mt-1 w-full rounded border p-2" value={from} onChange={event => setFrom(event.target.value)} /></label>
            <label className="text-sm">Hasta<input type="date" className="mt-1 w-full rounded border p-2" value={to} onChange={event => setTo(event.target.value)} /></label>
            <label className="text-sm">Estado<input maxLength={60} className="mt-1 w-full rounded border p-2" placeholder="Cualquier estado" value={status} onChange={event => setStatus(event.target.value)} /></label>
            <label className="text-sm">Tipo de dependencia<select className="mt-1 w-full rounded border p-2" value={dependencyType} onChange={event => setDependencyType(event.target.value)}><option value="all">Todas</option><option value="manifiesto">Manifiesto</option><option value="sin_dependencias">Sin dependencias</option><option value="financiera">Financiera (solo revisión)</option><option value="operativa">Operativa</option></select></label>
            <label className="text-sm">Procedencia<select className="mt-1 w-full rounded border p-2" value={origin} onChange={event => setOrigin(event.target.value)}><option value="all">Verificados y desconocidos</option><option value="verified">Solo verificados</option><option value="unknown">Origen no verificado</option></select></label>
            <label className="text-sm sm:col-span-2">IDs concretos <span className="font-normal text-slate-500">(separados por coma o espacio)</span><textarea className="mt-1 w-full rounded border p-2 font-mono text-xs" rows={2} placeholder="Código de guía, ID de manifiesto…" value={idsText} onChange={event => setIdsText(event.target.value)} /></label>
          </div>
          <button type="button" disabled={busy || !selectedCategories.length || (environment || inventory?.environment) !== 'emulador'} onClick={() => void simulate()} className="mt-4 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">SIMULAR LIMPIEZA</button>
          {(environment || inventory?.environment) !== 'emulador' && <p className="mt-2 text-xs text-rose-800">Las acciones destructivas están deshabilitadas fuera del Firebase Emulator Suite.</p>}
        </fieldset>

        <fieldset className="rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">Consultar un plan de esta sesión</legend>
          <div className="flex flex-col gap-2 sm:flex-row"><input className="min-w-0 flex-1 rounded border p-2 font-mono text-xs" aria-label="ID de plan guardado" placeholder="ID del plan" value={lookupId} onChange={event => setLookupId(event.target.value)} /><button type="button" disabled={busy || !lookupId.trim()} onClick={() => void loadPlan()} className="rounded border px-3 py-2 text-sm font-semibold disabled:opacity-40">Cargar plan</button></div>
        </fieldset>
      </div>

      <aside className="space-y-4">
        <section className="rounded-lg border bg-slate-50 p-4" aria-label="Colecciones en inventario"><h3 className="font-semibold">Inventario identificado</h3><p className="mt-1 text-xs text-slate-600">Solo guías y manifiestos sintéticos pueden ser candidatos. Las demás entidades se muestran como protegidas.</p><ul className="mt-3 max-h-52 space-y-2 overflow-auto text-xs">{(inventory?.categories || []).map(item => <li key={item.collection} className="flex items-start justify-between gap-3 border-t pt-2"><span><strong>{item.collection}</strong><br />{item.label}{item.protectedReason && <span className="block text-slate-500">{item.protectedReason}</span>}</span><span className={item.deletable ? 'text-emerald-800' : 'text-slate-500'}>{item.deletable ? 'candidato' : 'protegida'}</span></li>)}</ul></section>
        <section className="rounded-lg border p-4" aria-label="Operaciones recientes"><div className="flex items-center justify-between"><h3 className="font-semibold">Operaciones recientes</h3><button type="button" disabled={busy} onClick={() => void refreshOperations().catch(() => setMessage('No se pudieron actualizar las operaciones.'))} className="text-xs underline">Actualizar</button></div><ul className="mt-2 space-y-2 text-xs">{operations.length ? operations.map(item => <li key={item.operationId} className="break-all border-t pt-2"><strong>{item.state}</strong> · {item.processed}/{item.total}<br />Operación: {item.operationId}<br />Plan: {item.planId}{item.error && <span className="block text-rose-800">{item.error}</span>}{item.state === 'fallida_recuperable' && <button type="button" disabled={busy} onClick={() => void prepareRetry(item)} className="mt-1 rounded border px-2 py-1 font-semibold">Reanudar con el mismo ID</button>}</li>) : <li className="text-slate-500">No hay operaciones en esta sesión.</li>}</ul></section>
      </aside>
    </div>

    {plan && <div className="mt-5 rounded-xl border-2 border-slate-200 p-4 sm:p-5" aria-label="Vista previa completa del plan">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-lg font-bold">2 · Vista previa del conjunto</h3><p className="mt-1 break-all font-mono text-xs">Plan {plan.planId} · SHA-256 {plan.digest}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${plan.ready ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>{plan.state}</span></div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><div><dt className="text-xs text-slate-500">Registros filtrados</dt><dd className="font-semibold">{plan.selectedCount}</dd></div><div><dt className="text-xs text-slate-500">Candidatos de eliminación</dt><dd className="font-semibold">{plan.records.length}</dd></div><div><dt className="text-xs text-slate-500">Incluidos por dependencia</dt><dd className="font-semibold">{plan.autoIncludedCount}</dd></div><div><dt className="text-xs text-slate-500">Importe asociado</dt><dd className="font-semibold">{money(plan.amountCents)}</dd></div><div><dt className="text-xs text-slate-500">Agencias</dt><dd className="font-semibold">{plan.branchIds.join(', ') || 'sin dato'}</dd></div><div><dt className="text-xs text-slate-500">Fechas</dt><dd className="font-semibold">{plan.from || '—'} → {plan.to || '—'}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">Vigencia</dt><dd className="font-semibold">Hasta {new Date(plan.expiresAtIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</dd></div></dl>
      <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">{Object.entries(plan.summaries).map(([collection, count]) => <li key={collection} className="rounded bg-slate-100 px-2 py-1">{collection}: {count} documento(s)</li>)}</ul>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section><h4 className="font-semibold">Conjunto candidato {plan.ready ? '· listo para validar' : '· retenido por conflictos'}</h4><ul className="mt-2 max-h-72 space-y-2 overflow-auto">{plan.records.map(record => <li key={record.path} className="break-words rounded border p-3 text-xs"><div className="flex flex-wrap justify-between gap-1"><strong>{record.label} · {record.recognizedId}</strong><span>{record.origin}</span></div><code>{record.path}</code><p className="mt-1">Agencia: {record.branchId || 'sin dato'} · Fecha: {record.date || 'sin dato'} · Estado: {record.status || 'sin estado'} · Importe: {money(record.amountCents)}</p><p className="mt-1 text-slate-600">{record.autoIncluded ? 'Incluido automáticamente' : 'Seleccionado'} · {record.inclusionReason}</p>{record.reason && <p className="mt-1 text-amber-800">{record.reason}</p>}</li>)}{!plan.records.length && <li className="rounded bg-slate-50 p-3 text-sm text-slate-500">No hay registros sintéticos autorizados en el filtro.</li>}</ul></section>
        <section><h4 className="font-semibold">Excluidos, protegidos y conflictos</h4><ul className="mt-2 max-h-72 space-y-2 overflow-auto">{plan.exclusions.map(record => <li key={record.path} className="break-words rounded border border-amber-200 bg-amber-50 p-3 text-xs"><strong>{record.label} · {record.recognizedId}</strong><br /><code>{record.path}</code><p className="mt-1">{record.origin} · {record.branchId || 'sin agencia'} · {money(record.amountCents)}</p><p className="mt-1">{record.reason || record.label}</p></li>)}{plan.conflicts.map((conflict, index) => <li key={`${conflict.path}-${index}`} className="break-words rounded border border-rose-200 bg-rose-50 p-3 text-xs"><strong>Bloqueo: {conflict.id || 'conjunto'}</strong>{conflict.path && <><br /><code>{conflict.path}</code></>}<p className="mt-1">{conflict.reason}</p></li>)}{!plan.exclusions.length && !plan.conflicts.length && <li className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">Sin dependencias incompatibles detectadas.</li>}</ul></section>
      </div>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-700">{plan.consequences.map(item => <li key={item}>{item}</li>)}</ul>
      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-semibold text-rose-950">3 · Respaldo verificado y ejecución por lotes</p><p className="mt-1 text-xs text-rose-900">El servidor volverá a comprobar versión, contenido, procedencia y relaciones; guardará y verificará el respaldo antes de borrar. Solo se usa este plan y el lote se limita a 450 documentos.</p>{retryOperationId && <p className="mt-2 text-xs font-semibold">Reanudación idempotente: se reutilizará {retryOperationId}.</p>}<label className="mt-3 block text-sm">Escriba <code>LIMPIAR {plan.planId}</code> para confirmar<input aria-label="Confirmación exacta del plan" className="mt-1 w-full rounded border p-2 font-mono text-xs" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><button type="button" disabled={busy || !plan.ready || (plan.state !== 'simulado' && !retryOperationId) || confirmation !== `LIMPIAR ${plan.planId}` || (environment || inventory?.environment) !== 'emulador'} onClick={() => void execute()} className="mt-3 rounded bg-rose-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{retryOperationId ? 'Reanudar operación con respaldo existente' : 'Respaldar y ejecutar limpieza sintética'}</button></div>
    </div>}

    <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold">4 · Recuperación técnica del respaldo</h3><p className="mt-1 text-xs text-slate-700">La recuperación se limita a documentos respaldados que sigan ausentes. Si encuentra documentos nuevos, se detiene sin sobrescribirlos. No constituye una reversión financiera.</p><label className="mt-3 block text-sm">ID de operación del respaldo<input className="mt-1 w-full rounded border p-2 font-mono text-xs" value={restoreId} onChange={event => setRestoreId(event.target.value)} /></label><label className="mt-3 block text-sm">Escriba <code>RESTAURAR {restoreId || 'ID'}</code><input aria-label="Confirmación exacta de recuperación" className="mt-1 w-full rounded border p-2 font-mono text-xs" value={restoreConfirmation} onChange={event => setRestoreConfirmation(event.target.value)} /></label><button type="button" disabled={busy || !restoreId || restoreConfirmation !== `RESTAURAR ${restoreId}`} onClick={() => void restore()} className="mt-3 rounded border border-blue-700 px-4 py-2 text-sm font-semibold disabled:opacity-40">Verificar y restaurar respaldo</button></div>
  </section>
}
