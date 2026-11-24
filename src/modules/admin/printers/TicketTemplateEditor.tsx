import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, RotateCcw, Save } from 'lucide-react'
import { printEngine } from '../../../services/printing/printEngineService.ts'
import { createSyntheticShipmentTicket } from '../../../services/printing/syntheticShipmentTicket.ts'
import {
  DEFAULT_SHIPMENT_TICKET_TEMPLATE,
  REQUIRED_SHIPMENT_TICKET_FIELDS,
  SHIPMENT_TICKET_FIELDS,
  duplicateTicketCopy,
  normalizeShipmentTicketTemplate,
  type ShipmentTicketCopy,
  type ShipmentTicketFieldId,
  type TicketCopyKey,
  type TicketFieldStyle,
  type ShipmentTicketTemplate,
} from '../../../services/printing/ticketTemplates.ts'
import { loadShipmentTicketTemplate, saveShipmentTicketTemplate, type TicketTemplateHistoryEntry } from '../../../services/printing/ticketTemplateService.ts'

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100'
export const TicketTemplateEditor: React.FC<{ currentBranchId?: string }> = ({ currentBranchId = 'punata' }) => {
  const [template, setTemplate] = useState<ShipmentTicketTemplate>(DEFAULT_SHIPMENT_TICKET_TEMPLATE)
  const [savedVersion, setSavedVersion] = useState(0)
  const [history, setHistory] = useState<TicketTemplateHistoryEntry[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [selectedCopy, setSelectedCopy] = useState<TicketCopyKey>('customer')
  const [restoreVersion, setRestoreVersion] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('Cargando la plantilla versionada…')

  const copy = template[selectedCopy]
  const paperFormat = template.paperFormat
  const sample = useMemo(() => createSyntheticShipmentTicket(currentBranchId), [currentBranchId])

  useEffect(() => {
    let active = true
    loadShipmentTicketTemplate().then(result => {
      if (!active) return
      setTemplate(result.template || DEFAULT_SHIPMENT_TICKET_TEMPLATE)
      setSavedVersion(result.version)
      setHistory(result.history)
      setCanEdit(result.canEdit)
      setMessage(result.canEdit ? 'Plantilla sincronizada. Los valores institucionales se leen de la configuración oficial.' : 'Vista de solo lectura para este perfil.')
    }).catch(() => {
      if (!active) return
      setCanEdit(false)
      setMessage('No se pudo cargar la plantilla remota. La vista sintética está disponible; guardar requiere que Functions de Fase 3 esté publicado.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      printEngine.generatePreviewHtml(sample, paperFormat, template).then(html => { if (active) setPreviewHtml(html) })
    }, 120)
    return () => { active = false; clearTimeout(timer) }
  }, [sample, paperFormat, template])

  const updateCopy = (update: (current: ShipmentTicketCopy) => ShipmentTicketCopy) => {
    setTemplate(current => ({ ...current, [selectedCopy]: update(current[selectedCopy]) }))
  }

  const toggleField = (id: ShipmentTicketFieldId) => updateCopy(current => {
    if (REQUIRED_SHIPMENT_TICKET_FIELDS.includes(id)) return current
    const visibleFields = current.visibleFields.includes(id) ? current.visibleFields.filter(field => field !== id) : [...current.visibleFields, id]
    const order = current.order.includes(id) ? current.order : [...current.order, id]
    return { ...current, visibleFields, order }
  })

  const moveField = (id: ShipmentTicketFieldId, direction: -1 | 1) => updateCopy(current => {
    const order = [...current.order]
    const index = order.indexOf(id)
    const next = index + direction
    if (index < 0 || next < 0 || next >= order.length) return current
    ;[order[index], order[next]] = [order[next], order[index]]
    return { ...current, order }
  })

  const updateStyle = (id: ShipmentTicketFieldId, change: Partial<TicketFieldStyle>) => updateCopy(current => ({
    ...current,
    fieldStyles: { ...current.fieldStyles, [id]: { bold: false, alignment: 'left', ...current.fieldStyles[id], ...change } },
  }))

  const duplicateSelected = () => {
    const destination = selectedCopy === 'customer' ? 'agency' : 'customer'
    setTemplate(current => ({ ...current, [destination]: duplicateTicketCopy(current[selectedCopy]) }))
    setSelectedCopy(destination)
    setMessage(`Se duplicó la plantilla ${selectedCopy === 'customer' ? 'del cliente' : 'de la agencia'} como borrador. Guarda para crear una versión.`)
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await saveShipmentTicketTemplate({ template: normalizeShipmentTicketTemplate(template), expectedVersion: savedVersion })
      setTemplate(result.template)
      setSavedVersion(result.version)
      const refreshed = await loadShipmentTicketTemplate()
      setHistory(refreshed.history)
      setMessage(`Plantilla guardada en versión ${result.version}. La auditoría quedó registrada.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la plantilla. Recarga y verifica permisos.')
    } finally { setSaving(false) }
  }

  const restore = async () => {
    if (!restoreVersion) return
    setSaving(true)
    try {
      const result = await saveShipmentTicketTemplate({ action: 'restore', expectedVersion: savedVersion, restoreVersion: Number(restoreVersion) })
      setTemplate(result.template)
      setSavedVersion(result.version)
      const refreshed = await loadShipmentTicketTemplate()
      setHistory(refreshed.history)
      setMessage(`Versión ${restoreVersion} restaurada como nueva versión ${result.version}.`)
      setRestoreVersion('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo restaurar la versión seleccionada.')
    } finally { setSaving(false) }
  }

  const isVisible = (id: ShipmentTicketFieldId) => copy.visibleFields.includes(id)
  const orderedFields = copy.order.filter(id => isVisible(id))

  return <section className="space-y-4" data-testid="ticket-template-editor">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Editor de guía de encomienda</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Ajusta campos y presentación. La vista previa usa el mismo HTML que el diálogo de impresión. Los valores del envío y los importes vienen de la operación; no se editan aquí.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Versión guardada: {savedVersion}</span>
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" role="status">{loading ? 'Cargando…' : message}</p>
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">NIT: no hay un NIT configurado en la configuración institucional existente; no se imprimirá. El ticket conserva el aviso “NO CONSTITUYE FACTURA FISCAL”.</div>
    </header>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(340px,1.1fr)]">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-bold text-slate-700">Copia que editas
            <select className={`${inputClass} mt-1`} value={selectedCopy} onChange={event => setSelectedCopy(event.target.value as TicketCopyKey)}>
              <option value="customer">Cliente</option><option value="agency">Agencia</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">Papel de vista previa
            <select className={`${inputClass} mt-1`} value={paperFormat} onChange={event => setTemplate(current => ({ ...current, paperFormat: event.target.value as '58mm' | '80mm' }))}>
              <option value="80mm">Térmico 80 mm</option><option value="58mm">Térmico 58 mm</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-bold text-slate-700">Margen (mm)<input aria-label="Margen (mm)" className={`${inputClass} mt-1`} type="number" min="0" max="6" step="0.5" value={template.marginsMm} onChange={event => setTemplate(current => ({ ...current, marginsMm: Math.max(0, Math.min(6, Number(event.target.value) || 0)) }))} /></label>
          <label className="text-xs font-bold text-slate-700">Tamaño de letra<select className={`${inputClass} mt-1`} value={template.fontSize} onChange={event => setTemplate(current => ({ ...current, fontSize: event.target.value as ShipmentTicketTemplate['fontSize'] }))}><option value="compact">Compacta</option><option value="normal">Normal</option><option value="large">Grande</option></select></label>
          <label className="text-xs font-bold text-slate-700">Separador<select className={`${inputClass} mt-1`} value={template.separator} onChange={event => setTemplate(current => ({ ...current, separator: event.target.value as ShipmentTicketTemplate['separator'] }))}><option value="dashed">Discontinuo</option><option value="solid">Continuo</option><option value="none">Sin línea</option></select></label>
          <label className="text-xs font-bold text-slate-700">Espaciado<select className={`${inputClass} mt-1`} value={template.spacing} onChange={event => setTemplate(current => ({ ...current, spacing: event.target.value as ShipmentTicketTemplate['spacing'] }))}><option value="compact">Compacto</option><option value="normal">Normal</option><option value="wide">Amplio</option></select></label>
        </div>
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-800">
          <input data-testid="second-copy-toggle" type="checkbox" checked={template.secondCopyEnabled} onChange={event => setTemplate(current => ({ ...current, secondCopyEnabled: event.target.checked }))} className="mt-0.5" />
          <span>Agregar segundo ticket (copia de agencia)<small className="mt-1 block text-xs font-normal text-slate-500">Ambas copias usan la misma guía. Se imprimen como páginas del mismo trabajo del navegador; el driver decide si corta entre páginas.</small></span>
        </label>
        {template.secondCopyEnabled && <label className="text-xs font-bold text-slate-700">Separación visual entre copias<select className={`${inputClass} mt-1`} value={template.betweenCopies} onChange={event => setTemplate(current => ({ ...current, betweenCopies: event.target.value as ShipmentTicketTemplate['betweenCopies'] }))}><option value="page_break">Salto de página</option><option value="continuous">Continuo</option></select></label>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">Texto adicional de encabezado<input className={`${inputClass} mt-1`} maxLength={120} value={copy.headerText} onChange={event => updateCopy(current => ({ ...current, headerText: event.target.value.slice(0, 120) }))} placeholder="Opcional" /></label>
          <label className="text-xs font-bold text-slate-700">Texto adicional de pie<input className={`${inputClass} mt-1`} maxLength={180} value={copy.footerText} onChange={event => updateCopy(current => ({ ...current, footerText: event.target.value.slice(0, 180) }))} placeholder="Opcional" /></label>
        </div>
        <div className="space-y-2">
          <div><h3 className="text-sm font-black text-slate-900">Campos de operación</h3><p className="text-xs text-slate-500">La identificación de guía, fecha, destino, institución y aviso legal permanecen visibles.</p></div>
          {SHIPMENT_TICKET_FIELDS.map(field => {
            const required = REQUIRED_SHIPMENT_TICKET_FIELDS.includes(field.id)
            const index = orderedFields.indexOf(field.id)
            const style = copy.fieldStyles[field.id] || { bold: false, alignment: 'left' as const }
            return <div key={field.id} className="grid grid-cols-[minmax(130px,1fr)_auto_auto] items-center gap-2 rounded-lg border border-slate-100 p-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-800"><input type="checkbox" checked={isVisible(field.id)} disabled={required} onChange={() => toggleField(field.id)} />{field.label}{required && <span className="text-[10px] text-amber-700">Obligatorio</span>}</label>
              <div className="flex gap-1"><button aria-label={`Subir ${field.label}`} type="button" disabled={index <= 0} onClick={() => moveField(field.id, -1)} className="rounded border px-2 py-1 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button><button aria-label={`Bajar ${field.label}`} type="button" disabled={index < 0 || index >= orderedFields.length - 1} onClick={() => moveField(field.id, 1)} className="rounded border px-2 py-1 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button></div>
              <div className="flex items-center gap-1"><label className="text-[10px] text-slate-500"><input type="checkbox" checked={style.bold} disabled={!isVisible(field.id)} onChange={event => updateStyle(field.id, { bold: event.target.checked })} /> Negrita</label><select aria-label={`Alineación ${field.label}`} disabled={!isVisible(field.id)} className="rounded border px-1 py-1 text-[10px]" value={style.alignment} onChange={event => updateStyle(field.id, { alignment: event.target.value as TicketFieldStyle['alignment'] })}><option value="left">Izq.</option><option value="center">Centro</option><option value="right">Der.</option></select></div>
            </div>
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button data-testid="save-ticket-template" type="button" disabled={!canEdit || loading || saving} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Save className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar versión'}</button>
          <button type="button" disabled={!canEdit || saving} onClick={duplicateSelected} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"><Copy className="h-4 w-4" />Duplicar a {selectedCopy === 'customer' ? 'agencia' : 'cliente'}</button>
          <select aria-label="Versión para restaurar" className="max-w-36 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs" value={restoreVersion} onChange={event => setRestoreVersion(event.target.value)}><option value="">Versión…</option>{history.map(entry => <option key={entry.version} value={entry.version}>v{entry.version} · {new Date(entry.timestampIso).toLocaleDateString('es-BO')}</option>)}</select>
          <button type="button" disabled={!canEdit || !restoreVersion || saving} onClick={restore} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"><RotateCcw className="h-4 w-4" />Restaurar</button>
        </div>
        <p className="text-[11px] text-slate-500">NIT y datos institucionales no se editan aquí. Los guardados requieren perfil administrativo autorizado o Soporte con MFA, autenticación reciente, control de versión y auditoría.</p>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-100 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-black text-slate-900">Vista previa en tiempo real</h3><p className="text-xs text-slate-600">Muestra datos sintéticos. Papel actual: {paperFormat}.</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600">Mismo renderizador HTML</span></div>
        <div className="mx-auto min-h-[650px] overflow-auto rounded-xl border border-slate-300 bg-white p-3" style={{ width: paperFormat === '58mm' ? 'min(100%, 260px)' : 'min(100%, 360px)' }}>
          {previewHtml ? <iframe title="Vista previa del ticket sintético" data-testid="ticket-template-preview" sandbox="allow-same-origin" srcDoc={previewHtml} className="min-h-[620px] w-full border-0" /> : <div className="p-4 text-sm text-slate-500">Preparando vista previa…</div>}
        </div>
      </div>
    </div>
  </section>
}
