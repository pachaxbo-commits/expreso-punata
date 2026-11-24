import React, { useEffect, useMemo, useState } from 'react'
import { CircleHelp, Printer, Save } from 'lucide-react'
import type { PaperFormat, PrintResult, UnifiedDocumentPayload } from '../../../types/printing.ts'
import { printViaBrowserDialog } from '../../../adapters/printing/browserDialogPrinterAdapter.ts'
import { INITIAL_BRANCHES } from '../../../domain/expresoPunataConfig.ts'

type TestRecord = { id: string; label: string; paperFormat: PaperFormat; result: string; observedAtIso: string }
type DiagnosticLog = {
  records: TestRecord[]
  marginsAndGlyphs: 'pendiente' | 'correcto' | 'parcial' | 'incorrecto'
  endCut: 'pendiente' | 'no_corto' | 'corte_completo' | 'corte_parcial'
  betweenJobs: 'pendiente' | 'no_corto' | 'corte_completo' | 'corte_parcial'
  printerModel: string
  driverVersion: string
  notes: string
  updatedAtIso?: string
}

const STORAGE_KEY = 'pachax:printer-diagnostics:rongta-windows'
const freshLog = (): DiagnosticLog => ({ records: [], marginsAndGlyphs: 'pendiente', endCut: 'pendiente', betweenJobs: 'pendiente', printerModel: '', driverVersion: '', notes: '' })

function testDocument(branchId: string, label: string, withQr = true): UnifiedDocumentPayload {
  const branch = INITIAL_BRANCHES.find(item => item.id === branchId) || INITIAL_BRANCHES[0]
  const now = new Date().toISOString()
  const documentNumber = `TEST-RONGTA-${label.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`
  return {
    documentType: 'test_page',
    title: 'PRUEBA DE IMPRESIÓN · DATOS SINTÉTICOS',
    subtitle: label,
    branchId,
    branchName: branch.name,
    branchAddress: branch.address,
    branchPhone: branch.phone,
    documentNumber,
    trackingCode: documentNumber,
    qrContent: withQr ? `EXPRESO-PUNATA:${documentNumber}` : undefined,
    timestampIso: now,
    operatorName: 'Operador de prueba',
    sender: { name: 'REMÍTENTE FICTICIO Ñandú', phone: '70000001' },
    recipient: { name: 'DESTINATARIO FICTICIO', phone: '70000002' },
    items: [{ description: 'Caja sintética · ÁÉÍÓÚ ñ Ñ — 1234567890', quantity: 2, packaging: 'Caja', weightKg: 4.5, totalBob: 12.5 }],
    financials: { subtotalBob: 12.5, totalBob: 12.5, amountCents: 1250, paymentTiming: 'origin_paid', paymentStatus: 'paid', paymentMethod: 'cash' },
    footerNotes: ['NO REGISTRAR NI COBRAR · SOLO CALIBRACIÓN', 'Márgenes | acentos ñ Ñ | símbolos Bs · / —'],
  }
}

export const RongtaPrintTestPage: React.FC<{ currentBranchId?: string }> = ({ currentBranchId = 'punata' }) => {
  const [log, setLog] = useState<DiagnosticLog>(freshLog)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Los botones abren el diálogo de Windows. El hardware requiere observación manual.')
  const branch = useMemo(() => INITIAL_BRANCHES.find(item => item.id === currentBranchId) || INITIAL_BRANCHES[0], [currentBranchId])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) setLog({ ...freshLog(), ...JSON.parse(stored) })
    } catch { setLog(freshLog()) }
  }, [])

  const persist = (next: DiagnosticLog) => {
    const saved = { ...next, updatedAtIso: new Date().toISOString() }
    setLog(saved)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)) } catch {}
  }

  const run = async (id: string, label: string, paperFormat: Extract<PaperFormat, '58mm' | '80mm'>, withQr = true) => {
    if (busy) return
    setBusy(true)
    setStatus(`Abriendo el diálogo de Windows para ${label}. Confirma manualmente en el driver.`)
    try {
      const result: PrintResult = await printViaBrowserDialog(testDocument(currentBranchId, label, withQr), paperFormat, { includeQr: withQr, includeLogo: false, marginsMm: 2 })
      const record: TestRecord = { id, label, paperFormat, result: result.status === 'dialog_opened' ? 'Diálogo abierto; impresión física sin confirmar' : result.errorMessage || result.message, observedAtIso: new Date().toISOString() }
      persist({ ...log, records: [record, ...log.records.filter(item => item.id !== id)].slice(0, 20) })
      setStatus(result.status === 'dialog_opened' ? 'Diálogo abierto; esta respuesta no confirma que la Rongta imprimió o cortó.' : `No se abrió el diálogo: ${result.errorMessage || result.message}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo abrir la impresión.')
    } finally { setBusy(false) }
  }

  const update = <K extends keyof DiagnosticLog>(key: K, value: DiagnosticLog[K]) => persist({ ...log, [key]: value })
  const options = (items: Array<[string, string]>) => items.map(([value, label]) => <option key={value} value={value}>{label}</option>)

  return <section className="space-y-4" data-testid="rongta-print-test">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-800"><Printer className="h-5 w-5" /></div><div><h2 className="text-lg font-black text-slate-900">Diagnóstico Rongta USB · Windows</h2><p className="text-sm text-slate-600">Agencia {branch.name}. La aplicación sólo abre el diálogo del driver; el corte físico se registra después de observarlo.</p></div></div>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status">{status}</p>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" /><span>Usa datos totalmente sintéticos. No incluye ESC/POS ni selección silenciosa de impresora. No interpretes “Diálogo abierto” ni `afterprint` como confirmación del mecanismo o cortador.</span></div>
    </header>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-black text-slate-900">Pruebas de ancho y QR</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <button data-testid="print-80" type="button" disabled={busy} onClick={() => run('80', 'Papel 80 mm', '80mm')} className="rounded-lg bg-emerald-800 px-3 py-3 text-sm font-bold text-white disabled:opacity-40">Imprimir ticket 80 mm</button>
          <button data-testid="print-58" type="button" disabled={busy} onClick={() => run('58', 'Papel 58 mm', '58mm')} className="rounded-lg bg-emerald-800 px-3 py-3 text-sm font-bold text-white disabled:opacity-40">Imprimir ticket 58 mm</button>
          <button data-testid="print-qr" type="button" disabled={busy} onClick={() => run('qr', 'Ticket con QR', '80mm', true)} className="rounded-lg border border-emerald-800 px-3 py-3 text-sm font-bold text-emerald-900 disabled:opacity-40">Imprimir ticket con QR</button>
          <button data-testid="print-no-qr" type="button" disabled={busy} onClick={() => run('no-qr', 'Ticket sin QR', '80mm', false)} className="rounded-lg border border-slate-300 px-3 py-3 text-sm font-bold text-slate-700 disabled:opacity-40">Imprimir sin QR (comparación)</button>
        </div>
        <div className="rounded-lg border border-slate-100 p-3 text-xs text-slate-600"><strong>Caracteres sintéticos:</strong> Ñandú · ÁÉÍÓÚ · Bs · número de guía largo · texto de bultos. Compara el papel con el ancho, los márgenes y la legibilidad.</div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-black text-slate-900">Dos trabajos independientes</h3>
        <p className="text-xs text-slate-600">Haz clic en A, cierra/termina manualmente ese diálogo y luego pulsa B. No se lanza un segundo trabajo automáticamente para evitar bloqueo o duplicado.</p>
        <div className="grid grid-cols-2 gap-2"><button data-testid="print-job-a" disabled={busy} onClick={() => run('job-a', 'Trabajo independiente A', '80mm')} className="rounded-lg bg-slate-800 px-3 py-3 text-sm font-bold text-white disabled:opacity-40">Imprimir trabajo A</button><button data-testid="print-job-b" disabled={busy} onClick={() => run('job-b', 'Trabajo independiente B', '80mm')} className="rounded-lg bg-slate-800 px-3 py-3 text-sm font-bold text-white disabled:opacity-40">Imprimir trabajo B</button></div>
        <label className="block text-xs font-bold text-slate-700">¿El driver cortó entre A y B?<select data-testid="cut-between-jobs" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={log.betweenJobs} onChange={event => update('betweenJobs', event.target.value as DiagnosticLog['betweenJobs'])}>{options([['pendiente','Pendiente de probar'],['no_corto','No cortó'],['corte_completo','Corte completo'],['corte_parcial','Corte parcial']])}</select></label>
      </section>
    </div>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
      <label className="text-xs font-bold text-slate-700">Márgenes y caracteres<select data-testid="glyph-observation" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={log.marginsAndGlyphs} onChange={event => update('marginsAndGlyphs', event.target.value as DiagnosticLog['marginsAndGlyphs'])}>{options([['pendiente','Pendiente'],['correcto','Correctos'],['parcial','Algunos cortes/desalineación'],['incorrecto','Incorrectos']])}</select></label>
      <label className="text-xs font-bold text-slate-700">Corte al final del trabajo<select data-testid="cut-end-observation" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={log.endCut} onChange={event => update('endCut', event.target.value as DiagnosticLog['endCut'])}>{options([['pendiente','Pendiente'],['no_corto','No cortó'],['corte_completo','Corte completo'],['corte_parcial','Corte parcial']])}</select></label>
      <label className="text-xs font-bold text-slate-700">Modelo de impresora<input aria-label="Modelo de impresora" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" maxLength={100} value={log.printerModel} onChange={event => update('printerModel', event.target.value.slice(0, 100))} placeholder="Rongta RP…" /></label>
      <label className="text-xs font-bold text-slate-700">Versión/nombre del driver<input aria-label="Versión/nombre del driver" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" maxLength={120} value={log.driverVersion} onChange={event => update('driverVersion', event.target.value.slice(0, 120))} placeholder="Nombre y versión en Windows" /></label>
      <label className="text-xs font-bold text-slate-700">Notas de estación<textarea className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" maxLength={500} rows={2} value={log.notes} onChange={event => update('notes', event.target.value.slice(0, 500))} placeholder="Tamaño elegido, resultado observado…" /></label>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-black text-slate-900">Registro local de pruebas</h3><p className="text-xs text-slate-500">Se guarda sólo en este navegador; cada fila confirma apertura del diálogo, no impresión física.</p></div><button type="button" onClick={() => persist(freshLog())} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Limpiar registro</button></div>
      <div className="mt-3 space-y-2">{log.records.length ? log.records.map(record => <div key={record.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-xs"><span className="font-bold text-slate-800">{record.label} · {record.paperFormat}</span><span className="text-slate-600">{record.result}</span><time className="text-slate-500">{new Date(record.observedAtIso).toLocaleString('es-BO')}</time></div>) : <p className="text-sm text-slate-500">Aún no se abrió ninguna prueba.</p>}</div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><Save className="h-3.5 w-3.5" />Observaciones, corte y notas quedan en localStorage, no se envían a Functions.</div>
    </section>
  </section>
}
