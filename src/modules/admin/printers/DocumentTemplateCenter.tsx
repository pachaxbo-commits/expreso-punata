import React, { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Save, Printer, ArrowLeft, ArrowUp, ArrowDown } from 'lucide-react'
import type { DocumentPrintType, UnifiedDocumentPayload } from '../../../types/printing.ts'
import { DOCUMENT_PRINT_CATALOG } from '../../../services/printing/printCatalog.ts'
import { createDefaultDocumentTemplate, getRequiredTemplateFields, getTemplateFields, normalizeDocumentTemplate, type DocumentPrintTemplate, type TemplateFieldId } from '../../../services/printing/documentTemplates.ts'
import { loadDocumentPrintTemplate, saveDocumentPrintTemplate } from '../../../services/printing/documentTemplateService.ts'
import type { TicketTemplateHistoryEntry } from '../../../services/printing/ticketTemplateService.ts'
import { printEngine } from '../../../services/printing/printEngineService.ts'
import { getDefaultPrinter } from '../../../services/printing/printerProfiles.ts'

const inputClass = 'rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-800'

function syntheticDocument(type: DocumentPrintType, branchId: string): UnifiedDocumentPayload {
  const common: UnifiedDocumentPayload = {
    documentType: type, title: DOCUMENT_PRINT_CATALOG.find(item => item.type === type)?.label.toUpperCase() || 'COMPROBANTE DE PRUEBA',
    subtitle: type === 'shipment_guide' ? 'Punata → Cochabamba' : 'DATOS SINTÉTICOS', branchId, branchName: branchId === 'punata' ? 'Agencia Punata' : 'Agencia Cochabamba',
    companyName: 'EXPRESO PUNATA', branchAddress: 'Dirección de prueba', branchPhone: '000-00000', documentNumber: `TEST-${type.toUpperCase()}-0001`,
    trackingCode: ['shipment_guide', 'package_label', 'delivery_proof'].includes(type) ? 'EP-TEST-000001' : undefined,
    qrContent: `EXPRESO-PUNATA:TEST-${type}`, timestampIso: '2026-10-20T15:30:00.000Z', operatorName: 'Operador sintético',
    sender: { name: 'Remitente de prueba', phone: '70000000' }, recipient: { name: 'Destinatario de prueba', phone: '71111111' },
    items: [{ description: 'Paquete de prueba', quantity: 2, weightKg: 1.25, totalBob: 25 }],
    financials: { subtotalBob: 25, totalBob: 25, amountCents: 2500, paymentTiming: 'origin_paid', paymentStatus: 'paid' },
    dispatch: { originBranchName: 'Punata', destinationBranchName: 'Cochabamba', vehiclePlate: 'TEST-000', driverName: 'Conductor sintético', totalPackages: 2, totalWeightKg: 2.5, totalCodToCollectBob: 0 },
    signatures: { operatorSignatureName: 'Operador sintético', clientSignatureName: 'Cliente sintético' }, footerNotes: ['EJEMPLO SINTÉTICO — NO VÁLIDO COMO COMPROBANTE'],
    metadata: { packageCount: 2, destination: 'Cochabamba', description: 'Paquete de prueba', amountBob: 25, passengerName: 'Pasajera sintética', travelDate: '2026-11-24', vehicle: 'TEST-000 · Móvil 000', quantity: '2', fare: 'Bs 25,00 c/u · Total Bs 50,00', paymentVerification: 'QR VERIFICADO', settlement: 'PENDIENTE DE ENTREGA AL CONDUCTOR' },
  }
  return common
}

export const DocumentTemplateCenter: React.FC<{ currentBranchId?: string }> = ({ currentBranchId = 'punata' }) => {
  const [selectedType, setSelectedType] = useState<DocumentPrintType | null>(null)
  const [template, setTemplate] = useState<DocumentPrintTemplate | null>(null)
  const [savedVersion, setSavedVersion] = useState(0)
  const [history, setHistory] = useState<TicketTemplateHistoryEntry[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [copyIndex, setCopyIndex] = useState<0 | 1>(0)
  const [restoreVersion, setRestoreVersion] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [message, setMessage] = useState('Selecciona un comprobante para ver su plantilla predeterminada.')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [advanced, setAdvanced] = useState(false)

  const sample = useMemo(() => selectedType ? syntheticDocument(selectedType, currentBranchId) : null, [selectedType, currentBranchId])
  const printer = useMemo(() => getDefaultPrinter(currentBranchId), [currentBranchId])
  const activeCopy = template?.copies[copyIndex]
  const required = selectedType ? getRequiredTemplateFields(selectedType) : []

  useEffect(() => {
    if (!selectedType) return
    let active = true
    setLoading(true)
    loadDocumentPrintTemplate(selectedType).then(result => {
      if (!active) return
      setTemplate(result.template || createDefaultDocumentTemplate(selectedType))
      setSavedVersion(result.version); setHistory(result.history); setCanEdit(result.canEdit)
      setMessage(result.canEdit ? (result.template ? `Plantilla sincronizada · versión ${result.version}.` : 'Mostrando el diseño predeterminado. Guarda una versión para personalizarlo.') : 'Vista de solo lectura para este perfil.')
    }).catch(() => {
      if (!active) return
      setTemplate(createDefaultDocumentTemplate(selectedType)); setCanEdit(false)
      setMessage('Functions de Fase 3 no responde. Puedes revisar la previsualización predeterminada; guardar y activar impresión requiere el backend.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedType])

  useEffect(() => {
    if (!selectedType || !template || !sample) return
    let active = true
    const timer = setTimeout(() => printEngine.generatePreviewHtml(sample, template.paperFormat, undefined, template, { includeLogo: printer.capabilities.supportsLogo, includeQr: printer.capabilities.supportsQrCode, copyIndex: selectedType === 'shipment_guide' ? copyIndex : undefined }).then(html => { if (active) setPreviewHtml(html) }), 80)
    return () => { active = false; clearTimeout(timer) }
  }, [selectedType, template, sample, printer, copyIndex])

  const update = (change: (current: DocumentPrintTemplate) => DocumentPrintTemplate) => setTemplate(current => current ? change(current) : current)
  const updateCopy = (change: (copy: DocumentPrintTemplate['copies'][number]) => DocumentPrintTemplate['copies'][number]) => update(current => {
    const copies = [...current.copies] as DocumentPrintTemplate['copies']; copies[copyIndex] = change(copies[copyIndex]); return { ...current, copies }
  })
  const toggleField = (field: TemplateFieldId) => updateCopy(copy => ({ ...copy, visibleFields: copy.visibleFields.includes(field) ? copy.visibleFields.filter(id => id !== field) : [...copy.visibleFields, field], order: copy.order.includes(field) ? copy.order : [...copy.order, field] }))
  const moveField = (field: TemplateFieldId, direction: -1 | 1) => updateCopy(copy => {
    const order = [...copy.order], index = order.indexOf(field), next = index + direction
    if (index < 0 || next < 0 || next >= order.length) return copy
    ;[order[index], order[next]] = [order[next], order[index]]
    return { ...copy, order }
  })
  const save = async (action: 'save' | 'restore' = 'save') => {
    if (!selectedType || !template) return
    setSaving(true)
    try {
      const result = await saveDocumentPrintTemplate({ documentType: selectedType, template: normalizeDocumentTemplate(selectedType, template), expectedVersion: savedVersion, action, restoreVersion: action === 'restore' ? Number(restoreVersion) : undefined })
      setTemplate(result.template); setSavedVersion(result.version)
      const refreshed = await loadDocumentPrintTemplate(selectedType); setHistory(refreshed.history)
      setMessage(action === 'restore' ? `Versión restaurada como v${result.version}; quedó auditada.` : `Versión ${result.version} guardada y auditada.`); setRestoreVersion('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la plantilla.') }
    finally { setSaving(false) }
  }
  const printSynthetic = async () => {
    if (!sample) return
    setPrinting(true)
    try { const result = await printEngine.printDocument(sample); setMessage(`Prueba sintética: ${result.message} Estado ${result.status}. Esto no registra guías, cobros ni cambios operativos.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo abrir la impresión sintética.') }
    finally { setPrinting(false) }
  }

  if (selectedType && template && activeCopy) return <section className="space-y-4" aria-label="Editor de plantilla universal" data-testid="document-template-editor">
    <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => { setSelectedType(null); setTemplate(null); setPreviewHtml('') }} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"><ArrowLeft className="h-4 w-4" />Centro de plantillas</button><h2 className="text-lg font-black">{DOCUMENT_PRINT_CATALOG.find(item => item.type === selectedType)?.label}</h2><button data-testid="print-synthetic-template" type="button" disabled={printing} onClick={printSynthetic} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40"><Printer className="h-4 w-4" />{printing ? 'Abriendo…' : 'Imprimir prueba sintética'}</button></div>
    <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-950">{message}</p>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
      <div className="space-y-3 rounded-xl border bg-white p-4">
        <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-bold">Ancho<select className={`${inputClass} mt-1 w-full`} value={template.paperFormat} onChange={event => update(current => ({ ...current, paperFormat: event.target.value as DocumentPrintTemplate['paperFormat'] }))}><option value="58mm">58 mm</option><option value="80mm">80 mm</option></select></label><label className="text-xs font-bold">Tamaño de texto<select className={`${inputClass} mt-1 w-full`} value={template.fontSize} onChange={event => update(current => ({ ...current, fontSize: event.target.value as DocumentPrintTemplate['fontSize'] }))}><option value="compact">Compacto</option><option value="normal">Normal</option><option value="large">Grande</option></select></label>{(advanced || selectedType !== 'shipment_guide') && <><label className="text-xs font-bold">Margen (mm)<input type="number" min="0" max="6" className={`${inputClass} mt-1 w-full`} value={template.marginsMm} onChange={event => update(current => ({ ...current, marginsMm: Number(event.target.value) }))} /></label><label className="text-xs font-bold">Separador<select className={`${inputClass} mt-1 w-full`} value={template.separator} onChange={event => update(current => ({ ...current, separator: event.target.value as DocumentPrintTemplate['separator'] }))}><option value="dashed">Discreto</option><option value="solid">Sólido</option><option value="none">Sin separador</option></select></label></>}</div>
        <label className="flex items-center gap-2 rounded-lg border p-3 text-xs font-bold"><input type="checkbox" checked={template.secondCopyEnabled} onChange={event => update(current => ({ ...current, secondCopyEnabled: event.target.checked }))} />{selectedType === 'shipment_guide' ? 'Imprimir también copia de agencia' : 'Imprimir segunda copia dentro del mismo trabajo'}</label>
        <div className="grid grid-cols-2 gap-2">{template.copies.map((_, index) => <button key={index} type="button" aria-pressed={copyIndex === index} onClick={() => setCopyIndex(index as 0 | 1)} className={`rounded-lg border p-2 text-xs font-bold ${copyIndex === index ? 'border-emerald-800 bg-emerald-50 text-emerald-900' : ''}`}>{selectedType === 'shipment_guide' ? (index === 0 ? 'GUÍA ORIGINAL' : 'COPIA CLIENTE') : (index === 0 ? 'COPIA 1' : 'COPIA 2')}{index === 1 && <span className="block text-[10px] font-normal">Compacta: campos reducidos para ahorrar papel</span>}</button>)}</div>
        <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 p-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={activeCopy.showBranchContact} onChange={event => updateCopy(copy => ({ ...copy, showBranchContact: event.target.checked }))} />Dirección y teléfono institucional</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={activeCopy.showLogo} onChange={event => updateCopy(copy => ({ ...copy, showLogo: event.target.checked }))} />Logo oficial (si el perfil lo admite)</label></div>
        {selectedType === 'shipment_guide' && <button type="button" className="text-xs underline" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Opciones avanzadas</button>}
        {selectedType !== 'shipment_guide' && <>        <div className="flex flex-wrap items-center gap-2"><label className="text-xs font-bold">Separación entre copias<select className={`${inputClass} ml-2`} value={template.cutBetweenCopies} onChange={event => update(current => ({ ...current, cutBetweenCopies: event.target.value as DocumentPrintTemplate['cutBetweenCopies'] }))}><option value="page_break">Salto de página del driver</option><option value="continuous">Continuo, sin salto</option></select></label><label className="text-xs font-bold">Corte final<select className={`${inputClass} ml-2`} value={template.cutAtEnd} onChange={event => update(current => ({ ...current, cutAtEnd: event.target.value as DocumentPrintTemplate['cutAtEnd'] }))}><option value="driver">Preferencia de corte de la impresora</option><option value="none">No enviar comando (ESC/POS)</option></select></label><label className="text-xs font-bold">Tipo de corte<select className={`${inputClass} ml-2`} value={template.cutPreference} onChange={event => update(current => ({ ...current, cutPreference: event.target.value as DocumentPrintTemplate['cutPreference'] }))}><option value="partial">Parcial</option><option value="full">Completo</option></select></label></div>
        <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-900">En Windows + Chrome, el salto separa páginas; el controlador de Rongta decide si corta por página y al final. El navegador no envía un comando directo de cuchilla. RawBT sí envía ESC/POS parcial o completo según esta preferencia. La apertura del diálogo y `afterprint` no confirman el resultado físico.</p>
        </>}
        {selectedType === 'shipment_guide' && <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-900">La copia cliente es compacta por defecto. Incluye guía, fecha, ruta, remitente, destinatario, bultos, importe pagado, saldo pendiente y método de pago. Puedes añadir más campos desde esta lista.</p>}
        <div className="space-y-2"><h3 className="text-sm font-black">Campos disponibles en este documento</h3>{[...getTemplateFields(selectedType)].sort((a, b) => activeCopy.order.indexOf(a.id) - activeCopy.order.indexOf(b.id)).map(field => {
          const isRequired = required.includes(field.id), style = activeCopy.fieldStyles[field.id] || { bold: false, alignment: field.id === 'financials' ? 'right' as const : 'center' as const }
          const index = activeCopy.order.indexOf(field.id)
          return <div key={field.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={activeCopy.visibleFields.includes(field.id) || isRequired} disabled={isRequired} onChange={() => toggleField(field.id)} />{field.label}{isRequired && <span className="text-[10px] text-amber-700">Obligatorio</span>}</label>{(advanced || selectedType !== 'shipment_guide') && <><div className="flex gap-1"><button type="button" aria-label={`Subir ${field.label}`} disabled={index <= 0} onClick={() => moveField(field.id, -1)} className="rounded border p-1 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button><button type="button" aria-label={`Bajar ${field.label}`} disabled={index < 0 || index >= activeCopy.order.length - 1} onClick={() => moveField(field.id, 1)} className="rounded border p-1 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button></div><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" aria-label={`Negrita ${field.label}`} checked={style.bold} disabled={!activeCopy.visibleFields.includes(field.id)} onChange={event => updateCopy(copy => ({ ...copy, fieldStyles: { ...copy.fieldStyles, [field.id]: { ...style, bold: event.target.checked } } }))} />Negrita</label><select aria-label={`Alineación ${field.label}`} className="rounded border px-1 py-1 text-[10px]" value={style.alignment} disabled={!activeCopy.visibleFields.includes(field.id)} onChange={event => updateCopy(copy => ({ ...copy, fieldStyles: { ...copy.fieldStyles, [field.id]: { ...style, alignment: event.target.value as 'left' | 'center' | 'right' } } }))}><option value="left">Izq.</option><option value="center">Centro</option><option value="right">Der.</option></select></>}</div>
        })}</div>
        <div className="flex flex-wrap gap-2 border-t pt-3"><button data-testid="save-ticket-template" type="button" disabled={!canEdit || loading || saving} onClick={() => save()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Save className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar versión'}</button><select aria-label="Versión para restaurar" className={inputClass} value={restoreVersion} onChange={event => setRestoreVersion(event.target.value)}><option value="">Restaurar versión…</option>{history.map(item => <option key={item.version} value={item.version}>v{item.version} · {new Date(item.timestampIso).toLocaleDateString('es-BO')}</option>)}</select><button type="button" disabled={!canEdit || !restoreVersion || saving} onClick={() => save('restore')} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40"><RotateCcw className="h-4 w-4" />Restaurar</button></div>
        <p className="text-[11px] text-slate-500">La empresa, logo, dirección, teléfono, NIT, avisos e importes oficiales proceden de los datos/configuración de la operación. Aquí solo se cambia presentación y visibilidad dentro de los campos permitidos.</p>
      </div>
      <div className="space-y-2 rounded-xl border bg-slate-100 p-3"><div><h3 className="font-black">{selectedType === 'shipment_guide' ? (copyIndex === 0 ? 'Vista previa · Cliente' : 'Vista previa · Agencia') : 'Vista previa real'}</h3><p className="text-xs text-slate-600">Sintética · {template.paperFormat} · mismo renderizador usado por impresión.</p></div>{previewHtml ? <iframe title="Vista previa del comprobante" data-testid="ticket-template-preview" sandbox="allow-same-origin" srcDoc={previewHtml} className="h-[720px] w-full rounded border bg-white" /> : <div className="p-4 text-sm">Preparando previsualización…</div>}</div>
    </div>
  </section>

  const sections = [...new Set(DOCUMENT_PRINT_CATALOG.map(item => item.section))]
  return <section className="space-y-4" aria-label="Centro de plantillas" data-testid="document-template-center"><div><h2 className="text-lg font-black">CENTRO DE PLANTILLAS</h2><p className="text-xs text-slate-600">Documentos que el sistema ya puede imprimir. Selecciona uno para revisar y configurar su plantilla.</p></div><p role="status" className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{message}</p>{sections.map(group => <div key={group} className="space-y-2"><h3 className="text-sm font-black text-slate-800">{group}</h3><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{DOCUMENT_PRINT_CATALOG.filter(item => item.section === group).map(item => <button key={item.type} data-testid={`template-card-${item.type}`} type="button" onClick={() => { setSelectedType(item.type); setCopyIndex(0); setAdvanced(false); setTemplate(null); setPreviewHtml('') }} className="rounded-xl border bg-white p-4 text-left hover:border-emerald-700 hover:bg-emerald-50"><strong className="block text-sm">{item.label}</strong><span className="mt-1 block text-xs text-slate-500">{item.description}</span><span className="mt-2 block text-[10px] font-bold text-emerald-800">Plantilla editable · fallback original disponible</span></button>)}</div></div>)}<aside className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><strong className="text-slate-800">Salidas con formato propio.</strong> Los reportes imprimibles A4 y consultas de listados conservan su impresión convencional; no se convierten en tickets térmicos. Etiquetas de bulto de encomienda y actas de discrepancia no tienen actualmente un punto de impresión operativa identificado, por eso no aparecen como plantillas.</aside></section>
}
