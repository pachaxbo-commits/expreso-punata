import React, { useEffect, useState } from 'react'
import { observedHttpsCallable as httpsCallable } from '../../firebase/observedCallable.ts'
import { functions } from '../../firebase/config'
import { CommercialSettings } from './CommercialSettings'
import { InstitutionalSettings } from './InstitutionalSettings'
import { B4Settings } from './B4Settings'
import { CleanupCenter } from './CleanupCenter'
import { useAuth } from '../auth/AuthContext'

type Overview = { services: { functions: string; firestore: string }; commissionsConfigured: boolean; cleanupEnvironment: string }
type Diagnostic = {
  id: string; module: string; operation: string; code: string; category?: string; messageSafe?: string
  severity?: string; branchId: string | null; correlationId: string; status: string; operationState?: string
  frontendVersion?: string | null; backendRevision?: string | null; supportObservation?: string; createdAtIso: string
}
type Filters = { module?: string; from?: string; to?: string; severity?: string; correlationId?: string }
const overviewCall = httpsCallable<void, Overview>(functions, 'getSupportOverview')
const diagnosticsCall = httpsCallable<Filters, { entries: Diagnostic[]; summary: { total: number; open: number; investigating: number; resolved: number } }>(functions, 'listSupportDiagnostics')
const recordDiagnosticCall = httpsCallable<Omit<Diagnostic, 'id' | 'createdAtIso' | 'branchId'>, { success: boolean }>(functions, 'recordSupportDiagnostic')
const updateDiagnosticCall = httpsCallable<{ id: string; status: string; observation?: string }, { success: boolean }>(functions, 'updateSupportDiagnostic')

const emptyFilters: Filters = { module: '', from: '', to: '', severity: '', correlationId: '' }
const emptyDiagnostic = { module: '', operation: '', code: '', correlationId: '', status: 'pendiente' }

export const SupportCenter: React.FC = () => {
  const { signOut } = useAuth()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [summary, setSummary] = useState({ total: 0, open: 0, investigating: 0, resolved: 0 })
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [selected, setSelected] = useState<Diagnostic | null>(null)
  const [observation, setObservation] = useState('')
  const [diagnostic, setDiagnostic] = useState(emptyDiagnostic)
  const refreshDiagnostics = async (filter = filters) => {
    const response = await diagnosticsCall(filter)
    setDiagnostics(response.data.entries)
    setSummary(response.data.summary)
    setSelected(current => current ? response.data.entries.find(entry => entry.id === current.id) || null : null)
  }
  useEffect(() => {
    overviewCall().then(r => setOverview(r.data)).catch(() => setMessage('No se pudo consultar el estado. Verifique la autorización y autenticación multifactor.'))
    void refreshDiagnostics(emptyFilters).catch(() => {})
  }, [])
  const saveDiagnostic = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await recordDiagnosticCall(diagnostic); await refreshDiagnostics(); setDiagnostic(emptyDiagnostic); setMessage('Observación técnica registrada.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo registrar la observación.') }
    finally { setBusy(false) }
  }
  const saveReview = async () => {
    if (!selected) return
    setBusy(true); setMessage('')
    try { await updateDiagnosticCall({ id: selected.id, status: selected.status, observation }); setObservation(''); await refreshDiagnostics(); setMessage('Revisión guardada y auditada.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la revisión.') }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-slate-100 text-slate-900">
    <header className="bg-slate-950 text-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">PACHAX · Expreso Punata</p><h1 className="mt-1 text-2xl font-bold">Centro de Soporte PACHAX</h1></div><button className="rounded border border-slate-500 px-4 py-2 text-sm" onClick={() => void signOut()}>Cerrar sesión</button></div></header>
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {message && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{message}</p>}
      <section className="grid gap-4 md:grid-cols-3" aria-label="Resumen"><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Servicios</h2><p className="mt-2 text-sm">Functions: {overview?.services.functions ?? 'sin comprobar'}</p><p className="text-sm">Firestore: {overview?.services.firestore ?? 'sin comprobar'}</p></div><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Comisiones</h2><p className="mt-2 text-sm">{overview ? overview.commissionsConfigured ? 'Configuración oficial registrada' : 'Pendientes de configuración oficial' : 'Sin comprobar'}</p></div><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Entorno de limpieza</h2><p className="mt-2 text-sm">{overview?.cleanupEnvironment ?? 'sin comprobar'}</p></div></section>
      <InstitutionalSettings /><CommercialSettings /><B4Settings />
      <section className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div><h2 className="text-lg font-bold">Diagnósticos</h2><p className="mt-2 text-sm text-slate-600">Errores automáticos de operaciones observables. Se guardan códigos y mensajes seguros, sin trazas ni datos de solicitudes. El incidente histórico “internal 0” sigue sin causa confirmada.</p></div>
        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <label>Módulo<select aria-label="Filtrar módulo" className="mt-1 block w-full rounded border p-2" value={filters.module || ''} onChange={e => setFilters({ ...filters, module: e.target.value })}><option value="">Todos</option>{['auth', 'cash', 'shipments', 'tickets', 'configuration', 'users', 'support', 'printing', 'reports', 'other'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Desde<input aria-label="Filtrar desde" type="date" className="mt-1 block w-full rounded border p-2" value={filters.from || ''} onChange={e => setFilters({ ...filters, from: e.target.value ? `${e.target.value}T00:00:00.000Z` : '' })} /></label>
          <label>Hasta<input aria-label="Filtrar hasta" type="date" className="mt-1 block w-full rounded border p-2" value={filters.to?.slice(0, 10) || ''} onChange={e => setFilters({ ...filters, to: e.target.value ? `${e.target.value}T23:59:59.999Z` : '' })} /></label>
          <label>Gravedad<select aria-label="Filtrar gravedad" className="mt-1 block w-full rounded border p-2" value={filters.severity || ''} onChange={e => setFilters({ ...filters, severity: e.target.value })}><option value="">Todas</option>{['info', 'warning', 'error', 'critical'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>ID de correlación<input aria-label="Buscar correlación" maxLength={64} className="mt-1 block w-full rounded border p-2" value={filters.correlationId || ''} onChange={e => setFilters({ ...filters, correlationId: e.target.value })} /></label>
          <div className="flex items-end gap-2"><button className="rounded bg-slate-800 px-4 py-2 text-white" onClick={() => void refreshDiagnostics(filters)}>Filtrar</button><button className="rounded border px-4 py-2" onClick={() => { setFilters(emptyFilters); void refreshDiagnostics(emptyFilters) }}>Limpiar</button></div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4" aria-label="Resumen de incidencias">{[['Encontradas', summary.total], ['Pendientes', summary.open], ['Investigando', summary.investigating], ['Resueltas', summary.resolved]].map(([label, count]) => <div key={label} className="rounded bg-slate-50 p-3"><span>{label}</span><strong className="ml-2">{count}</strong></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><ul className="max-h-96 space-y-2 overflow-auto text-sm">{diagnostics.map(item => <li key={item.id}><button onClick={() => { setSelected(item); setObservation('') }} className={`w-full rounded border p-3 text-left ${selected?.id === item.id ? 'border-emerald-700 bg-emerald-50' : 'bg-white'}`}><span className="font-semibold">{item.createdAtIso}</span> · {item.module}/{item.operation}<br /><span>{item.code} · {item.severity || 'info'} · {item.status} · ID {item.correlationId}</span></button></li>)}</ul>
          <div className="rounded-lg border p-4 text-sm">{selected ? <><h3 className="font-bold">Detalle seguro · {selected.correlationId}</h3><p className="mt-2">{selected.messageSafe || 'Observación técnica manual.'}</p><p>Categoría: {selected.category || 'manual'} · Estado operación: {selected.operationState || 'observación'}</p><p>Agencia autorizada: {selected.branchId || 'no determinada'}</p><p>Frontend: {selected.frontendVersion || 'no disponible'} · Backend: {selected.backendRevision || 'no disponible'}</p><p>Fecha: {selected.createdAtIso}</p>{selected.supportObservation && <p className="mt-2">Observación actual: {selected.supportObservation}</p>}<label className="mt-3 block">Estado de revisión<select className="mt-1 block w-full rounded border p-2" value={selected.status} onChange={e => setSelected({ ...selected, status: e.target.value })}><option value="pendiente">Pendiente</option><option value="investigando">Investigando</option><option value="resuelto">Resuelto</option></select></label><label className="mt-3 block">Observación (sin datos personales ni secretos)<textarea maxLength={500} className="mt-1 block w-full rounded border p-2" value={observation} onChange={e => setObservation(e.target.value)} /></label><button disabled={busy} className="mt-3 rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40" onClick={() => void saveReview()}>Guardar revisión</button></> : <p>Seleccione una incidencia para ver su detalle.</p>}</div></div>
        <details><summary className="cursor-pointer text-sm font-semibold">Registrar observación manual</summary><form onSubmit={event => void saveDiagnostic(event)} className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{([['module', 'Módulo'], ['operation', 'Operación'], ['code', 'Código'], ['correlationId', 'ID de correlación']] as const).map(([key, label]) => <label key={key}>{label}<input required maxLength={64} pattern="[A-Za-z0-9_.-]+" className="mt-1 block w-full rounded border p-2" value={diagnostic[key]} onChange={event => setDiagnostic({ ...diagnostic, [key]: event.target.value })} /></label>)}<label>Estado<select className="mt-1 block w-full rounded border p-2" value={diagnostic.status} onChange={event => setDiagnostic({ ...diagnostic, status: event.target.value })}><option value="pendiente">Pendiente</option><option value="investigando">Investigando</option><option value="resuelto">Resuelto</option></select></label><button disabled={busy} className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40">Registrar</button></form></details>
      </section>
      <CleanupCenter environment={overview?.cleanupEnvironment} />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Usuarios', 'Gestión técnica y bajas: pendiente de implementación segura.'], ['Historial de cambios', 'Los cambios institucionales y limpiezas se registran en auditoría.'], ['Impresoras y plantillas', 'Herramientas existentes y ampliación previstas para Fase 3.'], ['Mantenimiento', 'No hay herramientas de producción habilitadas.']].map(([title, description]) => <div key={title} className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p></div>)}</section>
    </div>
  </main>
}
