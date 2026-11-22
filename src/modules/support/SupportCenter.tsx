import React, { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'
import { useAuth } from '../auth/AuthContext'

type Overview = { services: { functions: string; firestore: string }; commissionsConfigured: boolean; cleanupEnvironment: string }
type Plan = { records: { id: string; category: string; dependsOn: string[]; branchId: string | null }[]; digest: string; branches: string[]; from: string | null; to: string | null; amountCents: number; retained: number }
const categories = ['encomiendas', 'manifiestos', 'custodia', 'recepciones', 'entregas', 'pasajes', 'cobros', 'caja', 'comisiones', 'aportes', 'multas', 'prestamos', 'almacen', 'inventario']
const overviewCall = httpsCallable<void, Overview>(functions, 'getSupportOverview')
const simulateCall = httpsCallable<{ categories: string[] }, Plan>(functions, 'simulateSupportCleanup')
const executeCall = httpsCallable<{ categories: string[]; digest: string; confirmation: string; operationId: string }, { count: number; operationId: string }>(functions, 'executeSupportCleanup')

export const SupportCenter: React.FC = () => {
  const { signOut } = useAuth()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [operationId, setOperationId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { overviewCall().then(r => setOverview(r.data)).catch(() => setMessage('No se pudo consultar el estado. Verifique la autorización y autenticación multifactor.')) }, [])
  const simulate = async () => {
    setBusy(true); setMessage(''); setPlan(null)
    try { const result = await simulateCall({ categories: selected }); setPlan(result.data); setOperationId(crypto.randomUUID()); setConfirmation('') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo simular la limpieza.') }
    finally { setBusy(false) }
  }
  const execute = async () => {
    if (!plan) return
    setBusy(true); setMessage('')
    try { const r = await executeCall({ categories: selected, digest: plan.digest, confirmation, operationId }); setMessage(`Limpieza de emulador completada: ${r.data.count} registros. Operación ${r.data.operationId}.`); setPlan(null) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar la limpieza.') }
    finally { setBusy(false) }
  }
  return <main className="min-h-screen bg-slate-100 text-slate-900">
    <header className="bg-slate-950 text-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-300">PACHAX · Expreso Punata</p><h1 className="mt-1 text-2xl font-bold">Centro de Soporte PACHAX</h1></div><button className="rounded border border-slate-500 px-4 py-2 text-sm" onClick={() => void signOut()}>Cerrar sesión</button></div></header>
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {message && <p role="status" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{message}</p>}
      <section className="grid gap-4 md:grid-cols-3" aria-label="Resumen"><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Servicios</h2><p className="mt-2 text-sm">Functions: {overview?.services.functions ?? 'sin comprobar'}</p><p className="text-sm">Firestore: {overview?.services.firestore ?? 'sin comprobar'}</p></div><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Comisiones</h2><p className="mt-2 text-sm">{overview ? overview.commissionsConfigured ? 'Configuración oficial registrada' : 'Pendientes de configuración oficial' : 'Sin comprobar'}</p></div><div className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">Entorno de limpieza</h2><p className="mt-2 text-sm">{overview?.cleanupEnvironment ?? 'sin comprobar'}</p></div></section>
      <section className="rounded-xl bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">Limpieza de datos de prueba</h2><p className="mt-2 text-sm text-slate-600">Disponible únicamente para registros sintéticos del emulador. No elimina usuarios ni datos operativos.</p><fieldset disabled={busy || overview?.cleanupEnvironment !== 'emulador'} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><legend className="sr-only">Categorías</legend>{categories.map(category => <label key={category} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={selected.includes(category)} onChange={e => { setSelected(e.target.checked ? [...selected, category] : selected.filter(x => x !== category)); setPlan(null) }} />{category}</label>)}</fieldset><button disabled={busy || !selected.length || overview?.cleanupEnvironment !== 'emulador'} onClick={() => void simulate()} className="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">SIMULAR LIMPIEZA</button>
        {plan && <div className="mt-5 space-y-3 rounded-lg border border-slate-200 p-4"><h3 className="font-semibold">Vista previa</h3><p className="text-sm">{plan.records.length} registros · {plan.retained} conservados · agencias: {plan.branches.join(', ') || 'ninguna'} · fechas: {plan.from ?? 'sin fecha'} a {plan.to ?? 'sin fecha'} · importe: Bs {(plan.amountCents / 100).toFixed(2)}</p><ul className="max-h-48 overflow-auto text-sm">{plan.records.map(r => <li key={r.id}>{r.category}: {r.id} {r.dependsOn.length ? `(depende de ${r.dependsOn.join(', ')})` : ''}</li>)}</ul><label className="block text-sm">Escriba LIMPIAR para confirmar <input className="ml-2 rounded border p-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><button disabled={busy || !plan.records.length || confirmation !== 'LIMPIAR'} onClick={() => void execute()} className="rounded bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Ejecutar en emulador</button></div>}
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Configuración', 'Edición y restauración: pendiente de implementación segura.'], ['Usuarios', 'Gestión técnica y bajas: pendiente de implementación segura.'], ['Diagnósticos', 'El incidente internal 0 sigue sin causa confirmada.'], ['Historial de cambios', 'Las operaciones de limpieza se registran en auditoría.'], ['Impresoras y plantillas', 'Herramientas existentes y ampliación previstas para Fase 3.'], ['Mantenimiento', 'No hay herramientas de producción habilitadas.']].map(([title, description]) => <div key={title} className="rounded-xl bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p></div>)}</section>
    </div>
  </main>
}
