import { useEffect, useState } from 'react'
import { observedHttpsCallable as httpsCallable } from '../../firebase/observedCallable.ts'
import { functions } from '../../firebase/config'

const names = {
  commission: 'Comisiones de conductores',
  loan: 'Límites de préstamos',
  sports: 'Multas deportivas',
  'punata-cochabamba': 'Tarifas de Punata a Cochabamba',
  'cochabamba-punata': 'Tarifas de Cochabamba a Punata',
}
type Key = keyof typeof names
type Rule = {
  effectiveFrom: string
  enabled: boolean
  type?: string
  value?: number
  base?: string
  maxInstallments?: number
  maxPrincipalCents?: number
  lateFineCents?: number
  absentFineCents?: number
  baseFeeCents?: number
  freeWeightKg?: number
  extraKgRateCents?: number
  homeDeliveryFeeCents?: number
}
type Entry = { version: number; rule: Rule; timestampIso: string; performedByUid: string; reason: string; action: string }
type Item = { key: Key; legacy: Rule | null; version: number; effective: Rule | null; draft: Rule | null; releases: (Rule & { version: number })[]; history: Entry[] }
type Settings = { canEdit: boolean; automaticPricingEnabled: boolean; items: Item[] }
const read = httpsCallable<void, Settings>(functions, 'getCommercialSettings')
const write = httpsCallable(functions, 'updateCommercialSettings')
const control = 'mt-1 block w-full rounded border border-slate-300 p-2'

function summary(rule: Rule | null) {
  if (!rule) return 'Sin publicación en el editor'
  if (!rule.enabled) return `Deshabilitada desde ${rule.effectiveFrom}`
  const value = rule.maxInstallments !== undefined ? `Hasta ${rule.maxInstallments} cuotas y Bs ${(rule.maxPrincipalCents || 0) / 100}`
    : rule.lateFineCents !== undefined ? `Bs ${rule.lateFineCents / 100} por tardanza y Bs ${(rule.absentFineCents || 0) / 100} por ausencia`
    : rule.type === 'percentage' ? `${rule.value}% del flete tarifario`
    : rule.type === 'fixed_per_shipment' ? `Bs ${rule.value} por encomienda`
    : `Bs ${(rule.baseFeeCents || 0) / 100} de base · ${rule.freeWeightKg} kg incluidos · Bs ${(rule.extraKgRateCents || 0) / 100}/kg adicional · Bs ${(rule.homeDeliveryFeeCents || 0) / 100} por entrega a domicilio`
  return `${value} desde ${rule.effectiveFrom}`
}

function blankRule(): Rule {
  return { effectiveFrom: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date()), enabled: true, type: 'fixed_per_shipment' }
}

export function CommercialSettings() {
  const [settings, setSettings] = useState<Settings>()
  const [key, setKey] = useState<Key>('commission')
  const [rule, setRule] = useState<Rule>(blankRule)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const item = settings?.items.find(entry => entry.key === key)

  async function refresh(selected: Key) {
    const { data } = await read()
    setSettings(data)
    const current = data.items.find(entry => entry.key === selected)
    setRule(current?.draft || current?.effective || blankRule())
  }

  useEffect(() => { void refresh('commission').catch(error => setMessage(error.message)) }, [])

  async function save(action: 'draft' | 'publish' | 'restore', restoreVersion?: number) {
    if (!item || !settings?.canEdit || reason.trim().length < 10) return
    const impact = action === 'publish' ? 'La regla modificará el cálculo de nuevas operaciones según su vigencia.' : 'Se guardará un borrador sin cambiar la regla vigente.'
    if (!window.confirm(impact + ' ¿Confirma la operación?')) return
    setSaving(true)
    setMessage('')
    try {
      await write({ key, action, expectedVersion: item.version, reason, rule, ...(restoreVersion ? { restoreVersion } : {}), confirmation: true })
      await refresh(key)
      setReason('')
      setMessage(action === 'publish' ? 'Regla autorizada y publicada.' : 'Borrador guardado con historial.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la regla.')
    } finally {
      setSaving(false)
    }
  }

  const commission = key === 'commission'
  const tariff = key === 'punata-cochabamba' || key === 'cochabamba-punata'
  const numericFields = key === 'loan' ? [
    ['maxInstallments', 'Máximo de cuotas', 1, 1],
    ['maxPrincipalCents', 'Capital máximo (centavos)', 1, 1],
  ] as const : key === 'sports' ? [
    ['lateFineCents', 'Multa de tardanza (centavos)', 0, 1],
    ['absentFineCents', 'Multa de inasistencia (centavos)', 0, 1],
  ] as const : [
    ['baseFeeCents', 'Tarifa base (centavos)', 1, 1],
    ['freeWeightKg', 'Peso incluido (kg)', 0, 0.01],
    ['extraKgRateCents', 'Kg adicional (centavos)', 0, 1],
    ['homeDeliveryFeeCents', 'Entrega a domicilio (centavos)', 0, 1],
  ] as const
  return (
    <section className="space-y-4 rounded-xl bg-white p-6 text-sm shadow-sm">
      <h2 className="text-lg font-bold">Configuración comercial</h2>
      {message && <p role="status" className="rounded bg-slate-100 p-3">{message}</p>}
      {settings && item && <>
        <label className="block">Módulo o ruta<select className={control} value={key} onChange={event => {
          const selected = event.target.value as Key
          setKey(selected)
          setRule(settings.items.find(entry => entry.key === selected)?.draft || blankRule())
          setReason('')
        }}>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <dl className="grid gap-2 rounded bg-slate-100 p-3">
          <div><dt className="font-semibold">Regla vigente del editor</dt><dd>{item.effective ? summary(item.effective) : commission && (!item.legacy?.value || item.legacy.value <= 0) ? 'Pendiente de configuración oficial' : item.legacy ? summary({ ...item.legacy, enabled: true, effectiveFrom: 'configuración anterior' }) : 'Sin regla oficial'}</dd></div>
          <div><dt className="font-semibold">Borrador</dt><dd>{summary(item.draft)}</dd></div>
        </dl>
        {commission && <p className="text-slate-600">El porcentaje aplica al flete tarifario registrado. El precio manual no tiene esa base. La comisión fija admite ambos modos.</p>}
        {tariff && <p className="text-slate-600">{settings.automaticPricingEnabled ? 'Cálculo automático habilitado.' : 'Cálculo automático deshabilitado. Ventanilla conserva el precio manual.'}</p>}
        {!settings.canEdit && <p>La administración del cliente autoriza y publica las reglas comerciales.</p>}
        {settings.canEdit && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save('draft') }}>
          <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
            <label>Inicio de vigencia<input className={control} required type="date" value={rule.effectiveFrom} onChange={event => setRule({ ...rule, effectiveFrom: event.target.value })} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={event => setRule({ ...rule, enabled: event.target.checked })} /> Habilitar regla</label>
            {rule.enabled && (commission ? <>
              <label>Modalidad<select className={control} value={rule.type} onChange={event => setRule({ ...rule, type: event.target.value, base: undefined })}><option value="fixed_per_shipment">Fija por encomienda</option><option value="percentage">Porcentaje</option></select></label>
              <label>Valor<input className={control} type="number" required min="0.01" max={rule.type === 'percentage' ? 100 : 100000} step="0.01" value={rule.value ?? ''} onChange={event => setRule({ ...rule, value: event.target.valueAsNumber || undefined })} /></label>
              {rule.type === 'percentage' && <label>Base de cálculo<select className={control} required value={rule.base || ''} onChange={event => setRule({ ...rule, base: event.target.value })}><option value="">Seleccione la base</option><option value="shippingFeeCents">Flete tarifario registrado</option></select></label>}
            </> : numericFields.map(([field, label, min, step]) => <label key={field}>{label}<input className={control} required type="number" min={min} step={step} value={rule[field] ?? ''} onChange={event => setRule({ ...rule, [field]: event.target.value === '' ? undefined : event.target.valueAsNumber })} /></label>))}
          </fieldset>
          <label className="block">Motivo comercial<input className={control} required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <button disabled={saving} className="rounded border px-4 py-2">Guardar borrador</button>
            <button type="submit" disabled={saving} className="rounded bg-emerald-700 px-4 py-2 text-white" onClick={event => {
              if (!event.currentTarget.form?.reportValidity()) return
              event.preventDefault()
              void save('publish')
            }}>Autorizar y publicar</button>
            <button type="button" disabled={saving} className="rounded border px-4 py-2" onClick={() => { setRule(item.draft || blankRule()); setReason('') }}>Cancelar</button>
            <button type="button" disabled={saving} className="rounded border px-4 py-2" onClick={() => void refresh(key).catch(error => setMessage(error.message))}>Recargar</button>
          </div>
        </form>}
        <h3 className="font-semibold">Historial y vigencias</h3>
        {item.releases.length > 0 && <ul>{item.releases.map(entry => <li key={entry.version}>{summary(entry)} · versión {entry.version}</li>)}</ul>}
        <ul className="divide-y">
          {item.history.map(entry => <li key={entry.version} className="space-y-1 py-2">
            <p>Versión {entry.version} · {entry.performedByUid} · {new Date(entry.timestampIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</p>
            <p>{summary(entry.rule)} · {entry.reason}</p>
            {settings.canEdit && <button type="button" disabled={saving || reason.trim().length < 10} className="underline disabled:opacity-40" onClick={() => void save('restore', entry.version)}>Restaurar como borrador</button>}
          </li>)}
        </ul>
      </>}
    </section>
  )
}
