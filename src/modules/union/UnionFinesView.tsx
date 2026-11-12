import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, PlusCircle, Printer, RefreshCw } from 'lucide-react'
import type { UnionMember } from '../../types/index.ts'
import { formatCurrencyBob, parseBobToCents } from '../../domain/parcelEngine.ts'
import { collectUnionFinePaymentThroughBackend, createUnionFineThroughBackend, listUnionFinesThroughBackend, type UnionFine, type UnionFineCategory } from '../../services/unionService.ts'
import type { CashShift } from '../../types/index.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'

const categories: Array<{ value: UnionFineCategory; label: string }> = [
  { value: 'transporte', label: 'Transporte' }, { value: 'conflictos', label: 'Conflictos' },
  { value: 'deportes', label: 'Deportes' }, { value: 'otros', label: 'Otros' },
]

export const UnionFinesView: React.FC<{ members: UnionMember[]; canCreate: boolean; canCollect: boolean; activeShift?: CashShift | null; branchId: string }> = ({ members, canCreate, canCollect, activeShift, branchId }) => {
  const [fines, setFines] = useState<UnionFine[]>([])
  const [memberFilter, setMemberFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | UnionFine['status']>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [payingFineId, setPayingFineId] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [completedPayment, setCompletedPayment] = useState<{ result: any; fine: UnionFine } | null>(null)
  const operationRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const [form, setForm] = useState({ memberId: '', category: 'transporte' as UnionFineCategory, reason: '', description: '', date: new Date().toLocaleDateString('en-CA'), amount: '', notes: '' })
  const reload = async () => {
    setLoading(true); setError('')
    try { setFines(await listUnionFinesThroughBackend({ ...(memberFilter ? { memberId: memberFilter } : {}), ...(categoryFilter ? { category: categoryFilter as UnionFineCategory } : {}), ...(statusFilter !== 'all' ? { status: statusFilter } : {}) })) }
    catch (e: any) { setError(e?.message || 'No se pudieron consultar las multas.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [memberFilter, categoryFilter, statusFilter])
  const filtered = fines
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const amountCents = parseBobToCents(form.amount)
      if (!amountCents) throw new Error('Introduce un importe válido mayor que cero.')
      const fine = await createUnionFineThroughBackend({ memberId: form.memberId, category: form.category, reason: form.reason, description: form.description, date: form.date, amountCents, notes: form.notes })
      setNotice(`Multa ${fine.fineNumber} registrada como pendiente.`)
      setForm((current) => ({ ...current, reason: '', description: '', amount: '', notes: '' }))
      await reload()
    } catch (e: any) { setError(e?.message || 'No se pudo registrar la multa.') }
    finally { setSaving(false) }
  }
  const submitPayment = async (event: React.FormEvent, fine: UnionFine) => {
    event.preventDefault()
    if (!activeShift || !canCollect || saving) return
    const amountCents = parseBobToCents(paymentAmount)
    if (!amountCents) { setError('Introduce un importe positivo válido.'); return }
    if (amountCents > fine.balanceCents) { setError('El importe supera el saldo pendiente de esta multa.'); return }
    const fingerprint = `${fine.id}:${amountCents}:${paymentMethod}:${activeShift.id}:${paymentNotes}`
    if (!operationRef.current || operationRef.current.fingerprint !== fingerprint) operationRef.current = { fingerprint, key: `fine-${crypto.randomUUID()}` }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await collectUnionFinePaymentThroughBackend({ fineId: fine.id, amountCents, paymentMethod, shiftId: activeShift.id, branchId, notes: paymentNotes, idempotencyKey: operationRef.current.key })
      setCompletedPayment({ result, fine })
      setFines((current) => current.map((item) => item.id === fine.id ? { ...item, paidCents: result.paidCents, balanceCents: result.balanceCents, status: result.status, payments: [...(item.payments || []), result.payment] } : item))
      setNotice(`Pago ${result.payment.receiptNumber} confirmado. Saldo: ${formatCurrencyBob(result.balanceCents, true)}.`)
      setPaymentAmount(''); setPaymentNotes(''); setPayingFineId(null); operationRef.current = null
    } catch (e: any) { setError(e?.message || 'No se pudo confirmar el pago. Puede reintentar la misma operación.') }
    finally { setSaving(false) }
  }
  return <div className="space-y-4">
    {canCreate && <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-bold text-slate-700">Afiliado<select required value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2"><option value="">Seleccionar afiliado</option>{members.map((m) => <option key={m.id} value={m.id}>{m.memberNumber} · {m.fullName}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-700">Categoría<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as UnionFineCategory })} className="mt-1 w-full rounded-lg border border-slate-200 p-2">{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-700">Motivo<input required maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="text-xs font-bold text-slate-700">Fecha<input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="text-xs font-bold text-slate-700">Importe (Bs)<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="text-xs font-bold text-slate-700 md:col-span-2">Descripción<textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="text-xs font-bold text-slate-700">Observaciones<input maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <button disabled={saving} className="self-end rounded-lg bg-[#064e3b] px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50"><PlusCircle className="mr-1 inline h-4 w-4" />{saving ? 'Guardando…' : 'Registrar multa'}</button>
    </form>}
    <div className="flex flex-wrap gap-3 rounded-xl border bg-white p-3">
      <label className="text-xs font-bold">Filtrar afiliado<select value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} className="ml-2 rounded border p-2"><option value="">Todos</option>{members.map((m) => <option key={m.id} value={m.id}>{m.memberNumber} · {m.fullName}</option>)}</select></label>
      <label className="text-xs font-bold">Categoría<select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="ml-2 rounded border p-2"><option value="">Todas</option>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      <label className="text-xs font-bold">Estado<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | UnionFine['status'])} className="ml-2 rounded border p-2"><option value="all">Todos</option><option value="pending">Pendiente</option><option value="partial">Parcialmente pagada</option><option value="paid">Pagada</option><option value="voided">Anulada por corrección</option></select></label>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-800">{error}</p>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
    {completedPayment && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs"><div><strong className="block text-emerald-900">Comprobante generado: {completedPayment.result.payment.receiptNumber}</strong><span>Pago: {formatCurrencyBob(completedPayment.result.amountCents, true)} · Saldo restante: {formatCurrencyBob(completedPayment.result.balanceCents, true)}</span></div><button type="button" onClick={async () => { const doc = printEngine.buildFromUnionFinePayment(completedPayment.result, completedPayment.fine, branchId, completedPayment.result.payment.collectedByName || 'Operador'); await printEngine.printDocument(doc) }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-3 py-2 font-bold text-white"><Printer className="h-4 w-4" />Imprimir comprobante</button><button type="button" onClick={() => setCompletedPayment(null)} className="rounded-lg border border-emerald-300 px-3 py-2 font-bold text-emerald-900">Cerrar</button></div>}
    {loading ? <div className="p-8 text-center text-sm text-slate-500"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />Cargando multas…</div> : filtered.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500"><AlertTriangle className="mx-auto mb-2 h-5 w-5" />No hay multas con los filtros seleccionados.</div> : <div className="space-y-2">{filtered.map((fine) => <article key={fine.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><div><strong className="text-sm">{fine.memberNumber} · {fine.memberName}</strong><p className="text-xs text-slate-600">{fine.fineNumber} · {categories.find((c) => c.value === fine.category)?.label} · {fine.date}</p>{fine.source === 'sports_attendance' && <p className="text-xs font-bold text-blue-700">Origen deportivo · {fine.description?.split('·').at(-1)?.trim()}</p>}<p className="mt-1 text-xs">{fine.reason}{fine.description ? ` — ${fine.description}` : ''}</p>{fine.notes && <p className="mt-1 text-xs text-slate-500">Observaciones: {fine.notes}</p>}{fine.financialReviewRequired && <p className="mt-1 text-xs font-bold text-red-700">Situación financiera pendiente de revisión autorizada.</p>}</div><div className="text-right text-xs"><span className="block">Importe {formatCurrencyBob(fine.amountCents, true)}</span><span className="block text-emerald-700">Pagado {formatCurrencyBob(fine.paidCents || 0, true)}</span><strong className={fine.balanceCents > 0 ? 'text-amber-700' : 'text-emerald-700'}>Saldo {formatCurrencyBob(fine.balanceCents, true)}</strong><span className="block">{fine.status === 'paid' ? 'Pagada' : fine.status === 'partial' ? 'Parcialmente pagada' : fine.status === 'voided' ? 'Anulada por corrección' : 'Pendiente'}</span></div></div>
      <details className="mt-3 border-t pt-2"><summary className="cursor-pointer text-xs font-bold text-emerald-800">Historial de pagos ({fine.payments?.length || 0})</summary>{!fine.payments?.length ? <p className="mt-2 text-xs text-slate-500">Sin pagos registrados.</p> : <div className="mt-2 space-y-1">{fine.payments.map((payment) => <div key={payment.id} className="flex flex-wrap justify-between gap-2 rounded bg-slate-50 p-2 text-xs"><span>{payment.receiptNumber} · {new Date(payment.paidAtIso).toLocaleString('es-BO')} · {payment.collectedByName} · {payment.paymentMethod}</span><strong>{formatCurrencyBob(payment.amountCents, true)}</strong></div>)}</div>}</details>
      {canCollect && fine.balanceCents > 0 && fine.status !== 'voided' && !fine.financialReviewRequired && <div className="mt-3 border-t pt-3">{!activeShift ? <p className="text-xs font-semibold text-amber-700">No hay un turno de Caja abierto disponible para este usuario. El pago requiere el turno autorizado.</p> : payingFineId !== fine.id ? <button type="button" onClick={() => { setError(''); setPaymentAmount(''); setPayingFineId(fine.id) }} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-extrabold text-emerald-950">Registrar pago</button> : <form onSubmit={(event) => void submitPayment(event, fine)} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-bold">Saldo disponible<strong className="mt-1 block text-amber-700">{formatCurrencyBob(fine.balanceCents, true)}</strong></label><label className="text-xs font-bold">Importe del pago (Bs)<input required type="number" min="0.01" max={(fine.balanceCents / 100).toFixed(2)} step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="text-xs font-bold">Medio<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'qr' | 'transfer')} className="mt-1 w-full rounded border p-2"><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label><label className="text-xs font-bold">Observaciones<input maxLength={2000} value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4"><button disabled={saving} className="rounded-lg bg-[#064e3b] px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Procesando…' : 'Confirmar pago'}</button><button type="button" disabled={saving} onClick={() => setPayingFineId(null)} className="rounded-lg border px-4 py-2 text-xs font-bold">Cancelar</button></div></form>}</div>}
    </article>)}</div>}
  </div>
}
