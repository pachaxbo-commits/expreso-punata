import { useEffect, useState } from 'react'
import { observedHttpsCallable as httpsCallable } from '../../firebase/observedCallable.ts'
import { functions } from '../../firebase/config'

const groups = {
  Institución: { legalNotice: 'Aviso en comprobantes' },
  Pasajes: { passengerNotice: 'Aviso en pasajes' },
  Aportes: { contributionsNotice: 'Aviso en recibos de aporte' },
  Reportes: { reportDatePreset: 'Período inicial de reportes' },
  Personal: { personnelNotice: 'Aviso en recibos de personal' },
  Inventario: { inventoryNotice: 'Aviso en etiquetas patrimoniales' },
}
type Group = keyof typeof groups
type Config = {
  values: Record<string, string>
  versions: Record<string, number>
  history: { id: string; field: string; previous: string; value: string; uid: string; createdAtIso: string }[]
}
const readConfig = httpsCallable<void, Config>(functions, 'getSupportConfiguration')
const writeConfig = httpsCallable(functions, 'updateSupportConfiguration')
const dateLabels: Record<string, string> = { today: 'Hoy', this_week: 'Esta semana', this_month: 'Este mes', last_month: 'Mes anterior' }
const inputClass = 'mt-1 block w-full rounded border border-slate-300 p-2'

export function InstitutionalSettings() {
  const [config, setConfig] = useState<Config>()
  const [group, setGroup] = useState<Group>('Institución')
  const [field, setField] = useState('legalNotice')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const labels: Record<string, string> = groups[group]

  const displayValue = (entry: string) => field === 'reportDatePreset' && dateLabels[entry] ? dateLabels[entry] : entry || 'Sin establecer'

  async function refresh() {
    setConfig((await readConfig()).data)
  }
  useEffect(() => { void refresh().catch(error => setMessage(error.message)) }, [])

  async function save(restoreHistoryId?: string) {
    const impact = field === 'reportDatePreset' ? 'al abrir reportes' : 'en los próximos comprobantes'
    if (!config || !window.confirm(`¿Confirma ${restoreHistoryId ? 'restaurar' : 'cambiar'} ${labels[field]} ${impact}?`)) return
    setBusy(true)
    setMessage('')
    try {
      await writeConfig({ field, value, reason, expectedValue: config.values[field], expectedVersion: config.versions[field] || 0, ...(restoreHistoryId ? { restoreHistoryId } : {}), confirmation: true })
      await refresh()
      setValue('')
      setReason('')
      setMessage('Configuración actualizada y registrada en auditoría.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl bg-white p-6 text-sm shadow-sm">
      <h2 className="text-lg font-bold">Opciones institucionales avanzadas</h2>
      <p className="text-slate-600">Los cambios se reflejan al emitir comprobantes. Las agencias conservan sus identificadores.</p>
      {message && <p role="status" className="rounded bg-slate-100 p-3">{message}</p>}
      {config && <>
        <div className="flex flex-wrap gap-2" aria-label="Grupos institucionales">
          {(Object.keys(groups) as Group[]).map(key => (
            <button key={key} type="button" aria-pressed={group === key} className="rounded border px-3 py-2 aria-pressed:bg-slate-900 aria-pressed:text-white" onClick={() => {
              setGroup(key)
              setField(Object.keys(groups[key])[0])
              setValue('')
            }}>{key}</button>
          ))}
        </div>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save() }}>
          <label className="block">Campo<select aria-label="Campo" className={inputClass} value={field} onChange={event => { setField(event.target.value); setValue('') }}>
            {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <p>Valor actual: <strong>{displayValue(config.values[field])}</strong></p>
          <label className="block">Nuevo valor
            {field === 'reportDatePreset' ? <select className={inputClass} value={value} onChange={event => setValue(event.target.value)}>
              <option value="">Configuración predeterminada</option>
              {Object.entries(dateLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select> : <input className={inputClass} type={field === 'logoUrl' ? 'url' : 'text'} value={value} onChange={event => setValue(event.target.value)} />}
          </label>
          <label className="block">Motivo<input className={inputClass} required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || reason.trim().length < 10} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40">Guardar cambio</button>
            <button type="button" className="rounded border px-4 py-2" onClick={() => { setValue(''); setReason(''); setMessage('') }}>Cancelar</button>
            <button type="button" className="rounded border px-4 py-2" onClick={() => void refresh().catch(error => setMessage(error.message))}>Recargar</button>
          </div>
        </form>
        <h3 className="font-semibold">Historial reciente</h3>
        <ul className="divide-y">
          {config.history.filter(item => item.field === field).map(item => (
            <li key={item.id} className="space-y-1 py-2">
              <p>{new Date(item.createdAtIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} · {item.uid}</p>
              <p>{displayValue(item.previous)} → {displayValue(item.value)}</p>
              <button type="button" disabled={busy || reason.trim().length < 10} className="underline disabled:opacity-40" onClick={() => void save(item.id)}>Restaurar valor anterior</button>
            </li>
          ))}
        </ul>
      </>}
    </section>
  )
}

const everydayGroups: { title: string; fields: Record<string, string> }[] = [
  { title: 'Datos de la empresa', fields: { tradeName: 'Nombre comercial', legalName: 'Razón social', logoUrl: 'Logo (URL HTTPS)' } },
  { title: 'Agencia Punata', fields: { punataName: 'Nombre de la agencia', punataAddress: 'Dirección oficial de Punata', punataPhone: 'Teléfono de Punata' } },
  { title: 'Agencia Cochabamba', fields: { cochabambaName: 'Nombre de la agencia', cochabambaAddress: 'Dirección oficial de Cochabamba', cochabambaPhone: 'Teléfono de Cochabamba' } },
]

export function CompanyAndAgenciesSettings() {
  const [config, setConfig] = useState<Config>()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Cargando datos…')

  useEffect(() => {
    let active = true
    readConfig().then(({ data }) => {
      if (!active) return
      setConfig(data)
      setDraft(data.values)
      setMessage('')
    }).catch(error => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [])

  async function save(fields: string[]) {
    if (!config || busy) return
    const changes = fields.filter(field => draft[field]?.trim() !== config.values[field])
      .map(field => ({ field, value: draft[field] ?? '', expectedValue: config.values[field] ?? '', expectedVersion: config.versions[field] || 0 }))
    if (!changes.length) return
    setBusy(true)
    setMessage('')
    try {
      await writeConfig({ changes })
      const { data } = await readConfig()
      const savedValues = Object.fromEntries(fields.map(field => [field, data.values[field] ?? '']))
      const savedVersions = Object.fromEntries(fields.map(field => [field, data.versions[field] || 0]))
      setConfig({ values: { ...config.values, ...savedValues }, versions: { ...config.versions, ...savedVersions }, history: data.history })
      setDraft(previous => ({ ...previous, ...savedValues }))
      setMessage('Datos guardados. Las próximas guías usarán las direcciones actualizadas.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron guardar los datos.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="space-y-4 text-sm">
    <p role="status">{message}</p>
    {config && everydayGroups.map(({ title, fields }) => <form key={title} className="space-y-3 rounded-xl border bg-white p-5" onSubmit={event => { event.preventDefault(); void save(Object.keys(fields)) }}>
      <h2 className="text-base font-bold">{title}</h2>
      {Object.entries(fields).map(([field, label]) => <label key={field} className="block">
        {label}
        <input className={inputClass} type={field === 'logoUrl' ? 'url' : field.endsWith('Phone') ? 'tel' : 'text'} disabled={busy}
          value={draft[field] ?? ''} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} />
        {field.endsWith('Address') && !config.values[field] && <span className="mt-1 block text-amber-800">Dirección pendiente. Aparecerá en las guías al guardarla.</span>}
      </label>)}
      <button type="submit" disabled={busy || Object.keys(fields).every(field => (draft[field] || '').trim() === (config.values[field] || ''))}
        className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Guardar {title.toLowerCase()}</button>
    </form>)}
    {config && <details className="rounded-xl border bg-white p-4">
      <summary className="cursor-pointer font-bold">Historial reciente</summary>
      <ul className="mt-3 space-y-2">{config.history.filter(item => everydayGroups.some(group => Object.hasOwn(group.fields, item.field))).map(item =>
        <li key={item.id}>{everydayGroups.map(group => group.fields[item.field]).find(Boolean)} · {new Date(item.createdAtIso).toLocaleString('es-BO')} · {item.previous || 'Sin establecer'} → {item.value || 'Sin establecer'}</li>
      )}</ul>
    </details>}
  </section>
}
