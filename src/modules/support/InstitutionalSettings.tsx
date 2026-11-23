import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'

const groups = {
  Institución: { tradeName: 'Nombre comercial', logoUrl: 'URL del logotipo', legalNotice: 'Aviso en comprobantes' },
  Punata: { punataName: 'Nombre de agencia', punataAddress: 'Dirección', punataPhone: 'Teléfono Punata' },
  Pasajes: { passengerNotice: 'Aviso en pasajes' },
  Aportes: { contributionsNotice: 'Aviso en recibos de aporte' },
  Personal: { personnelNotice: 'Aviso en recibos de personal' },
  Inventario: { inventoryNotice: 'Aviso en etiquetas patrimoniales' },
  Cochabamba: { cochabambaName: 'Nombre de agencia', cochabambaAddress: 'Dirección', cochabambaPhone: 'Teléfono Cochabamba' },
}
type Group = keyof typeof groups
type Config = {
  values: Record<string, string>
  versions: Record<string, number>
  history: { id: string; field: string; previous: string; value: string; uid: string; createdAtIso: string }[]
}
const readConfig = httpsCallable<void, Config>(functions, 'getSupportConfiguration')
const writeConfig = httpsCallable(functions, 'updateSupportConfiguration')
const inputClass = 'mt-1 block w-full rounded border border-slate-300 p-2'

export function InstitutionalSettings() {
  const [config, setConfig] = useState<Config>()
  const [group, setGroup] = useState<Group>('Institución')
  const [field, setField] = useState('tradeName')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const labels: Record<string, string> = groups[group]

  async function refresh() {
    setConfig((await readConfig()).data)
  }
  useEffect(() => { void refresh().catch(error => setMessage(error.message)) }, [])

  async function save(restoreHistoryId?: string) {
    if (!config || !window.confirm(`¿Confirma ${restoreHistoryId ? 'restaurar' : 'cambiar'} ${labels[field]} en los próximos comprobantes?`)) return
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
      <h2 className="text-lg font-bold">Configuración institucional</h2>
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
          <p>Valor actual: <strong>{config.values[field] || 'Sin establecer'}</strong></p>
          <label className="block">Nuevo valor<input className={inputClass} type={field === 'logoUrl' ? 'url' : 'text'} value={value} onChange={event => setValue(event.target.value)} /></label>
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
              <p>{item.previous || 'Sin establecer'} → {item.value || 'Sin establecer'}</p>
              <button type="button" disabled={busy || reason.trim().length < 10} className="underline disabled:opacity-40" onClick={() => void save(item.id)}>Restaurar valor anterior</button>
            </li>
          ))}
        </ul>
      </>}
    </section>
  )
}
