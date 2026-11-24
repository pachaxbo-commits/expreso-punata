import { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'

type Kind = 'contributions' | 'catalogs' | 'reports' | 'notifications'
type Option = { id: string; label: string; active: boolean }
type Policy = { concept: string; amountCents: number; periodicity: 'monthly'; effectiveFrom: string; branchIds: string[]; category: string; enabled: boolean }
type Item = { kind: Kind; version: number; value?: any; draft?: Policy | null; effective?: Policy | null; releases?: (Policy & { version: number })[]; history: { version: number; action: string; value: any; reason: string; uid: string; timestampIso: string }[]; canEdit: boolean }
const read = httpsCallable<void, { items: Item[] }>(functions, 'getB4Settings')
const write = httpsCallable(functions, 'updateB4Settings')
const labels: Record<Kind, string> = { contributions: 'Aportes', catalogs: 'Catálogos', reports: 'Reportes', notifications: 'Avisos' }
const reportLabels: Record<string, string> = { members: 'Afiliados', loans: 'Préstamos', fines: 'Multas', sports: 'Deportes', physical_inventory: 'Patrimonio', commissions: 'Comisiones', consumables: 'Almacén', incidents: 'Incidencias' }
const control = 'mt-1 block w-full rounded border border-slate-300 p-2'

function defaultPolicy(): Policy {
  return { concept: 'Cuota ordinaria', amountCents: 0, periodicity: 'monthly', effectiveFrom: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date()), branchIds: ['punata', 'cochabamba'], category: 'all', enabled: true }
}

export function B4Settings() {
  const [items, setItems] = useState<Item[]>([])
  const [kind, setKind] = useState<Kind>('contributions')
  const [draft, setDraft] = useState<any>(defaultPolicy())
  const [catalog, setCatalog] = useState('fixedAssetCategories')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const item = items.find(entry => entry.kind === kind)
  const catalogOptions: Option[] = item?.value?.[catalog] || []
  const columns = item?.value?.optionalColumns || {}
  const refresh = async (selected = kind) => {
    const response = await read()
    setItems(response.data.items)
    const current = response.data.items.find(entry => entry.kind === selected)
    setDraft(selected === 'contributions' ? current?.draft || current?.effective || defaultPolicy() : current?.value || {})
  }
  useEffect(() => { void refresh().catch(error => setMessage(error.message)) }, [])
  const editKind = (selected: Kind) => {
    setKind(selected)
    const current = items.find(entry => entry.kind === selected)
    setDraft(selected === 'contributions' ? current?.draft || current?.effective || defaultPolicy() : structuredClone(current?.value || {}))
    setReason('')
  }
  const save = async (action: 'save' | 'publish' | 'restore', restoreVersion?: number) => {
    if (!item || reason.trim().length < 10) return
    if (!window.confirm(action === 'publish' ? 'La política afectará cuotas nuevas dentro de su vigencia. ¿Publicar?' : action === 'restore' ? 'Se guardará la versión como restauración auditada. ¿Continuar?' : '¿Guardar esta configuración y registrarla en el historial?')) return
    setBusy(true); setMessage('')
    try {
      await write({ kind, action, value: draft, expectedVersion: item.version, reason, ...(restoreVersion ? { restoreVersion } : {}), confirmation: true })
      await refresh(kind); setReason('')
      setMessage(action === 'publish' ? 'Política aprobada y publicada para operaciones nuevas.' : 'Configuración guardada con versión e historial.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.') }
    finally { setBusy(false) }
  }
  const updateOption = (id: string, change: Partial<Option>) => setDraft((value: any) => ({ ...value, [catalog]: value[catalog].map((entry: Option) => entry.id === id ? { ...entry, ...change } : entry) }))
  const toggleColumn = (report: string, column: string) => setDraft((value: any) => ({ ...value, optionalColumns: { ...value.optionalColumns, [report]: (value.optionalColumns[report] || []).includes(column) ? value.optionalColumns[report].filter((item: string) => item !== column) : [...(value.optionalColumns[report] || []), column] } }))
  const readOnlyPolicy = item?.effective
  const effectiveSummary = useMemo(() => readOnlyPolicy ? `${readOnlyPolicy.concept} · Bs ${(readOnlyPolicy.amountCents / 100).toFixed(2)} · desde ${readOnlyPolicy.effectiveFrom}` : 'Sin política publicada; se usa el importe individual del afiliado.', [readOnlyPolicy])

  return <section className="space-y-4 rounded-xl bg-white p-6 text-sm shadow-sm">
    <h2 className="text-lg font-bold">Configuraciones operativas B4</h2>
    <p className="text-slate-600">Las restauraciones generan una nueva versión. Las cuotas ya emitidas, bienes, personal e inventarios históricos no se reescriben.</p>
    {message && <p role="status" className="rounded bg-slate-100 p-3">{message}</p>}
    {item && <>
      <label>Área<select className={control} value={kind} onChange={event => editKind(event.target.value as Kind)}>{(Object.keys(labels) as Kind[]).filter(key => items.some(entry => entry.kind === key && entry.canEdit) || key === 'contributions').map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
      {kind === 'contributions' && <div className="space-y-3">
        <p>Política vigente: <strong>{effectiveSummary}</strong></p>
        {!item.canEdit ? <p>Solo afiliado administrador puede preparar o aprobar políticas de aportes.</p> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Concepto<input className={control} maxLength={80} value={draft.concept || ''} onChange={e => setDraft({ ...draft, concept: e.target.value })} /></label>
            <label>Importe (Bs)<input className={control} type="number" min="0.01" step="0.01" value={draft.amountCents ? draft.amountCents / 100 : ''} onChange={e => setDraft({ ...draft, amountCents: Math.round(Number(e.target.value) * 100) })} /></label>
            <label>Periodicidad<select className={control} value={draft.periodicity || 'monthly'} onChange={e => setDraft({ ...draft, periodicity: e.target.value })}><option value="monthly">Mensual (admitida por emisión vigente)</option></select></label>
            <label>Vigencia desde<input className={control} type="date" value={draft.effectiveFrom || ''} onChange={e => setDraft({ ...draft, effectiveFrom: e.target.value })} /></label>
            <label>Categoría de afiliado<select className={control} value={draft.category || 'all'} onChange={e => setDraft({ ...draft, category: e.target.value })}><option value="all">Todas las categorías</option><option value="propietario_transporte">Propietario de transporte</option><option value="conductor">Conductor</option><option value="socio_general">Socio general</option></select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled !== false} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> Activa</label>
          </div>
          <fieldset className="flex flex-wrap gap-4"><legend className="font-semibold">Agencias aplicables</legend>{[['punata', 'Punata'], ['cochabamba', 'Cochabamba']].map(([id, name]) => <label key={id} className="flex items-center gap-2"><input type="checkbox" checked={(draft.branchIds || []).includes(id)} onChange={e => setDraft({ ...draft, branchIds: e.target.checked ? [...draft.branchIds, id] : draft.branchIds.filter((branch: string) => branch !== id) })} />{name}</label>)}</fieldset>
        </>}
      </div>}
      {kind === 'catalogs' && <div className="space-y-3">
        <p>Se editan nombres y disponibilidad de opciones existentes. Las claves requeridas por validaciones se conservan y una opción inactiva sigue visible en registros históricos.</p>
        <label>Catálogo<select className={control} value={catalog} onChange={e => setCatalog(e.target.value)}>{Object.entries({ fixedAssetCategories: 'Categorías de bienes', consumableCategories: 'Categorías de insumos', workerRoles: 'Cargos de personal', consumableUnits: 'Unidades sugeridas' }).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div className="divide-y">{catalogOptions.map(option => <div key={option.id} className="grid gap-2 py-2 sm:grid-cols-[1fr_auto]"><label>{option.id}<input className={control} value={option.label} onChange={e => updateOption(option.id, { label: e.target.value })} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={option.active} onChange={e => updateOption(option.id, { active: e.target.checked })} />Disponible para nuevas altas</label></div>)}</div>
      </div>}
      {kind === 'reports' && <div className="space-y-3">
        <label>Orden de columnas<select className={control} value={draft.order || 'source'} onChange={e => setDraft({ ...draft, order: e.target.value })}><option value="source">Orden del generador</option><option value="alphabetical">Alfabético</option></select></label>
        <p>Los importes, totales, identificadores de registro y columnas legales no se pueden ocultar desde estas preferencias.</p>
        {Object.entries(reportLabels).map(([report, label]) => <fieldset key={report} className="rounded border p-3"><legend className="font-semibold">{label}</legend><div className="flex flex-wrap gap-3">{(columns[report] || []).map((column: string) => <label key={column} className="flex items-center gap-2"><input type="checkbox" checked={(draft.optionalColumns?.[report] || []).includes(column)} onChange={() => toggleColumn(report, column)} />{column}</label>)}</div></fieldset>)}
      </div>}
      {kind === 'notifications' && <div className="space-y-3"><p>Estas opciones controlan avisos de guía registrada que el backend ya genera y la lista de avisos no leídos. Los avisos de seguridad, caja y auditoría no se pueden desactivar.</p>{[['shipmentRegisteredVisible', 'Mostrar avisos de encomienda registrada'], ['unreadShipmentAlertsVisible', 'Mostrar la sección de avisos no leídos']].map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={draft[key] !== false} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} />{label}</label>)}</div>}
      <label className="block">Motivo del cambio<input className={control} minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {item.canEdit && <div className="flex flex-wrap gap-2"><button disabled={busy || reason.trim().length < 10} onClick={() => void save('save')} className="rounded border px-4 py-2 disabled:opacity-40">Guardar configuración</button>{kind === 'contributions' && <button disabled={busy || reason.trim().length < 10} onClick={() => void save('publish')} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40">Aprobar y publicar</button>}<button disabled={busy} onClick={() => void refresh()} className="rounded border px-4 py-2">Recargar</button></div>}
      <h3 className="font-semibold">Versiones e historial</h3><ul className="divide-y">{item.history.map(entry => <li key={entry.version} className="py-2"><p>Versión {entry.version} · {entry.action} · {entry.uid} · {new Date(entry.timestampIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</p><p>{entry.reason}</p>{item.canEdit && <button disabled={busy || reason.trim().length < 10} className="mt-1 underline disabled:opacity-40" onClick={() => void save('restore', entry.version)}>Restaurar versión</button>}</li>)}</ul>
    </>}
  </section>
}
