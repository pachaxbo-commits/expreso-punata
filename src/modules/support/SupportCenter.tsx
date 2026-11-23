import React, { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'
import { CommercialSettings } from './CommercialSettings'
import { InstitutionalSettings } from './InstitutionalSettings'
import { useAuth } from '../auth/AuthContext'

type Overview = { services: { functions: string; firestore: string }; commissionsConfigured: boolean; cleanupEnvironment: string }
type Plan = { records: { id: string; category: string; dependsOn: string[]; branchId: string | null }[]; digest: string; branches: string[]; from: string | null; to: string | null; amountCents: number; retained: number }
type Diagnostic = { id: string; module: string; operation: string; code: string; branchId: string | null; correlationId: string; status: string; createdAtIso: string }
const categories = ['encomiendas', 'manifiestos', 'custodia', 'recepciones', 'entregas', 'pasajes', 'cobros', 'caja', 'comisiones', 'aportes', 'multas', 'prestamos', 'almacen', 'inventario']
const overviewCall = httpsCallable<void, Overview>(functions, 'getSupportOverview')
const simulateCall = httpsCallable<{ categories: string[] }, Plan>(functions, 'simulateSupportCleanup')
const executeCall = httpsCallable<{ categories: string[]; digest: string; confirmation: string; operationId: string }, { count: number; operationId: string }>(functions, 'executeSupportCleanup')
const restoreCall = httpsCallable<{ operationId: string; confirmation: string }, { count: number; operationId: string }>(functions, 'restoreSupportCleanup')
const diagnosticsCall = httpsCallable<void, { entries: Diagnostic[] }>(functions, 'listSupportDiagnostics')
const recordDiagnosticCall = httpsCallable<Omit<Diagnostic, 'id' | 'createdAtIso' | 'branchId'> & { branchId: string }, { success: boolean }>(functions, 'recordSupportDiagnostic')

export const SupportCenter: React.FC = () => {
  const { signOut } = useAuth()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [operationId, setOperationId] = useState('')
  const [restoreId, setRestoreId] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [diagnostic, setDiagnostic] = useState({ module: '', operation: '', code: '', correlationId: '', branchId: '', status: 'pendiente' })
  const refreshDiagnostics = async () => { const response = await diagnosticsCall(); setDiagnostics(response.data.entries) }
  useEffect(() => { overviewCall().then(r => setOverview(r.data)).catch(() => setMessage('No se pudo consultar el estado. Verifique la autorización y autenticación multifactor.')); void refreshDiagnostics().catch(() => {}) }, [])
  const saveDiagnostic = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await recordDiagnosticCall(diagnostic); await refreshDiagnostics(); setDiagnostic({ module: '', operation: '', code: '', correlationId: '', branchId: '', status: 'pendiente' }); setMessage('Diagnóstico registrado.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo registrar el diagnóstico.') }
    finally { setBusy(false) }
  }
  const simulate = async () => {
    setBusy(true); setMessage(''); setPlan(null)
    try { const result = await simulateCall({ categories: selected }); setPlan(result.data); setOperationId(crypto.randomUUID()); setConfirmation('') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo simular la limpieza.') }
    finally { setBusy(false) }
  }
  const execute = async () => {
    if (!plan) return
    setBusy(true); setMessage('')
    try { const r = await executeCall({ categories: selected, digest: plan.digest, confirmation, operationId }); setRestoreId(r.data.operationId); setMessage(`Limpieza de emulador completada: ${r.data.count} registros. Operación ${r.data.operationId}.`); setPlan(null) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar la limpieza.') }
    finally { setBusy(false) }
  }
  const restore = async () => {
    setBusy(true); setMessage('')
    try { const r = await restoreCall({ operationId: restoreId, confirmation: restoreConfirmation }); setMessage(`Restauración completada: ${r.data.count} registros.`); setRestoreConfirmation('') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo restaurar el respaldo.') }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-slate-100 text-slate-900">
    <header className="bg-slate-950 text-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">PACHAX · Expreso Punata</p><h1 className="mt-1 text-2xl font-bold">Centro de Soporte PACHAX</h1></div><button className="rounded border border-slate-500 px-4 py-2 text-sm" onClick={() => void signOut()}>Cerrar sesión</button></div></header>
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {message && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{message}</p>}
      <section className="grid gap-4 md:grid-cols-3" aria-label="Resumen"><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Servicios</h2><p className="mt-2 text-sm">Functions: {overview?.services.functions ?? 'sin comprobar'}</p><p className="text-sm">Firestore: {overview?.services.firestore ?? 'sin comprobar'}</p></div><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Comisiones</h2><p className="mt-2 text-sm">{overview ? overview.commissionsConfigured ? 'Configuración oficial registrada' : 'Pendientes de configuración oficial' : 'Sin comprobar'}</p></div><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Entorno de limpieza</h2><p className="mt-2 text-sm">{overview?.cleanupEnvironment ?? 'sin comprobar'}</p></div></section>
      <InstitutionalSettings /><CommercialSettings />
      <section className="rounded-xl bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">Diagnósticos</h2><p className="mt-2 text-sm text-slate-600">Registro manual de identificadores técnicos; no incluya contraseñas ni datos personales. El incidente internal 0 sigue sin causa confirmada.</p><form onSubmit={event => void saveDiagnostic(event)} className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{([['module', 'Módulo'], ['operation', 'Operación'], ['code', 'Código'], ['correlationId', 'ID de correlación']] as const).map(([key, label]) => <label key={key}>{label}<input required maxLength={64} pattern="[A-Za-z0-9_.-]+" className="mt-1 block w-full rounded border p-2" value={diagnostic[key]} onChange={event => setDiagnostic({ ...diagnostic, [key]: event.target.value })} /></label>)}<label>Agencia<select className="mt-1 block w-full rounded border p-2" value={diagnostic.branchId} onChange={event => setDiagnostic({ ...diagnostic, branchId: event.target.value })}><option value="">Sin agencia</option><option value="punata">Punata</option><option value="cochabamba">Cochabamba</option></select></label><label>Estado<select className="mt-1 block w-full rounded border p-2" value={diagnostic.status} onChange={event => setDiagnostic({ ...diagnostic, status: event.target.value })}><option value="pendiente">Pendiente</option><option value="investigando">Investigando</option><option value="resuelto">Resuelto</option></select></label><button disabled={busy} className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-40">Registrar diagnóstico</button></form><ul className="mt-4 space-y-2 text-sm">{diagnostics.map(item => <li key={item.id} className="border-t pt-2">{item.createdAtIso} · {item.module}/{item.operation} · {item.code} · {item.branchId || 'sin agencia'} · {item.status} · {item.correlationId}</li>)}</ul></section>
      <section className="rounded-xl bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">Limpieza de datos de prueba</h2><p className="mt-2 text-sm text-slate-600">Disponible únicamente para registros sintéticos del emulador. No elimina usuarios ni datos operativos.</p><fieldset disabled={busy || overview?.cleanupEnvironment !== 'emulador'} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><legend className="sr-only">Categorías</legend>{categories.map(category => <label key={category} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={selected.includes(category)} onChange={e => { setSelected(e.target.checked ? [...selected, category] : selected.filter(x => x !== category)); setPlan(null) }} />{category}</label>)}</fieldset><button disabled={busy || !selected.length || overview?.cleanupEnvironment !== 'emulador'} onClick={() => void simulate()} className="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">SIMULAR LIMPIEZA</button>
        {plan && <div className="mt-5 space-y-3 rounded-lg border border-slate-200 p-4"><h3 className="font-semibold">Vista previa</h3><p className="text-sm">{plan.records.length} registros · {plan.retained} conservados · agencias: {plan.branches.join(', ') || 'ninguna'} · fechas: {plan.from ?? 'sin fecha'} a {plan.to ?? 'sin fecha'} · importe: Bs {(plan.amountCents / 100).toFixed(2)}</p><ul className="max-h-48 overflow-auto text-sm">{plan.records.map(r => <li key={r.id}>{r.category}: {r.id} {r.dependsOn.length ? `(depende de ${r.dependsOn.join(', ')})` : ''}</li>)}</ul><label className="block text-sm">Escriba LIMPIAR para confirmar <input className="ml-2 rounded border p-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><button disabled={busy || !plan.records.length || confirmation !== 'LIMPIAR'} onClick={() => void execute()} className="rounded bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Ejecutar en emulador</button></div>}
        <div className="mt-5 space-y-2 border-t pt-4 text-sm"><h3 className="font-semibold">Restaurar respaldo del emulador</h3><label className="block">ID de operación <input className="ml-2 rounded border p-2" value={restoreId} onChange={e => setRestoreId(e.target.value)} /></label><label className="block">Escriba RESTAURAR <input className="ml-2 rounded border p-2" value={restoreConfirmation} onChange={e => setRestoreConfirmation(e.target.value)} /></label><button disabled={busy || overview?.cleanupEnvironment !== 'emulador' || !restoreId || restoreConfirmation !== 'RESTAURAR'} onClick={() => void restore()} className="rounded border px-4 py-2 disabled:opacity-40">Restaurar respaldo</button></div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Usuarios', 'Gestión técnica y bajas: pendiente de implementación segura.'], ['Historial de cambios', 'Los cambios institucionales y limpiezas se registran en auditoría.'], ['Impresoras y plantillas', 'Herramientas existentes y ampliación previstas para Fase 3.'], ['Mantenimiento', 'No hay herramientas de producción habilitadas.']].map(([title, description]) => <div key={title} className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p></div>)}</section>
    </div>
  </main>
}
