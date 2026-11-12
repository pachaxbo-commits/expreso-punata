import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDollarSign, FileText, Plus, Printer, RefreshCw, Search } from 'lucide-react'
import type { Branch, CashShift, UnionMember, UserProfile } from '../../types/index.ts'
import { formatCurrencyBob, parseBobToCents } from '../../domain/parcelEngine.ts'
import {
  collectUnionLoanPaymentThroughBackend,
  createUnionLoanThroughBackend,
  disburseUnionLoanThroughBackend,
  listUnionLoansThroughBackend,
  type UnionLoan,
} from '../../services/unionService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'

interface UnionLoansViewProps {
  members: UnionMember[]
  currentUser: UserProfile
  currentBranch: Branch
  activeShift: CashShift | null
  onOpenStatement?: (member: UnionMember) => void
}

const statusLabels: Record<UnionLoan['status'], string> = { active: 'Vigente', overdue: 'Vencido', paid: 'Pagado' }

export const UnionLoansView: React.FC<UnionLoansViewProps> = ({ members, currentUser, currentBranch, activeShift, onOpenStatement }) => {
  const [loans, setLoans] = useState<UnionLoan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | UnionLoan['status']>('all')
  const [creating, setCreating] = useState(false)
  const [savingLoan, setSavingLoan] = useState(false)
  const [payingLoanId, setPayingLoanId] = useState<string | null>(null)
  const [savingPayment, setSavingPayment] = useState(false)
  const [disbursingLoanId, setDisbursingLoanId] = useState<string | null>(null)
  const [disbursementMethod, setDisbursementMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')
  const [savingDisbursement, setSavingDisbursement] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [principalBob, setPrincipalBob] = useState('')
  const [installmentCount, setInstallmentCount] = useState('1')
  const [grantDate, setGrantDate] = useState(new Date().toISOString().slice(0, 10))
  const [firstDueDate, setFirstDueDate] = useState('')
  const [loanNotes, setLoanNotes] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [completedPayment, setCompletedPayment] = useState<{ result: any; loan: UnionLoan } | null>(null)

  const isManagement = currentUser.role === 'directiva_admin' || currentUser.role === 'tesoreria'
  const canCreateLoan = isManagement || currentUser.role === 'secretaria'
  const canCollect = ['directiva_admin', 'tesoreria', 'secretaria', 'encargado_agencia'].includes(currentUser.role)
  const canDisburse = currentUser.role === 'tesoreria' || currentUser.role === 'secretaria'

  const loadLoans = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setLoans(await listUnionLoansThroughBackend())
    } catch (err: any) {
      setError(err?.message || 'No se pudieron consultar los préstamos internos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadLoans() }, [loadLoans])

  const filteredLoans = useMemo(() => loans.filter((loan) => {
    const matchesStatus = statusFilter === 'all' || loan.status === statusFilter
    const term = search.trim().toLocaleLowerCase('es')
    const matchesSearch = !term || `${loan.loanNumber} ${loan.memberNumber} ${loan.memberName}`.toLocaleLowerCase('es').includes(term)
    return matchesStatus && matchesSearch
  }), [loans, search, statusFilter])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (savingLoan || !memberId) return
    const amountCents = parseBobToCents(principalBob)
    if (!amountCents) { setError('Ingresa un monto válido mayor a Bs 0,00, con hasta dos decimales.'); return }
    const count = Number(installmentCount)
    if (!Number.isInteger(count) || count < 1 || count > 120) { setError('El número de cuotas debe estar entre 1 y 120.'); return }
    if (!firstDueDate) { setError('Selecciona la fecha de vencimiento de la primera cuota.'); return }
    setSavingLoan(true)
    setError('')
    try {
      const result = await createUnionLoanThroughBackend({ memberId, principalCents: amountCents, installmentCount: count, grantDate, firstDueDate, notes: loanNotes })
      setNotice(`Préstamo ${result.loan.loanNumber} registrado. El otorgamiento no se contabilizó como ingreso.`)
      setCreating(false)
      setPrincipalBob(''); setInstallmentCount('1'); setLoanNotes('')
      await loadLoans()
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar el préstamo.')
    } finally { setSavingLoan(false) }
  }

  const handlePayment = async (event: React.FormEvent, loan: UnionLoan) => {
    event.preventDefault()
    if (savingPayment || payingLoanId !== loan.id) return
    const amountCents = parseBobToCents(paymentAmount)
    if (!amountCents) { setError('Ingresa un monto de pago válido.'); return }
    if (amountCents > loan.balanceCents) { setError('El pago supera el saldo pendiente.'); return }
    if (paymentMethod === 'cash' && !activeShift) { setError('Para cobrar en efectivo debe abrir un turno de caja.'); return }
    setSavingPayment(true)
    setError('')
    try {
      const result = await collectUnionLoanPaymentThroughBackend({
        loanId: loan.id, amountCents, paymentMethod,
        shiftId: paymentMethod === 'cash' || activeShift ? activeShift?.id : undefined,
        branchId: currentBranch.id, notes: paymentNotes,
        idempotencyKey: `loan-${crypto.randomUUID()}`,
      })
      setCompletedPayment({ result, loan })
      setNotice(`Pago ${result.payment.receiptNumber} registrado. Saldo pendiente: ${formatCurrencyBob(result.balanceCents, true)}.`)
      setPayingLoanId(null); setPaymentAmount(''); setPaymentNotes('')
      await loadLoans()
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar el pago.')
    } finally { setSavingPayment(false) }
  }

  const handleDisbursement = async (loan: UnionLoan) => {
    if (savingDisbursement || loan.disbursementStatus !== 'pending') return
    if (disbursementMethod === 'cash' && !activeShift) { setError('Para desembolsar en efectivo debe abrir un turno de caja.'); return }
    if (!window.confirm(`¿Confirmas entregar ${formatCurrencyBob(loan.principalCents, true)} del préstamo ${loan.loanNumber}?`)) return
    setSavingDisbursement(true); setError('')
    try {
      const result = await disburseUnionLoanThroughBackend({ loanId: loan.id, paymentMethod: disbursementMethod, shiftId: disbursementMethod === 'cash' ? activeShift?.id : undefined, branchId: currentBranch.id, idempotencyKey: `loan-disbursement-${crypto.randomUUID()}` })
      setNotice(`Desembolso ${result.receiptNumber} registrado correctamente.`); setDisbursingLoanId(null); await loadLoans()
    } catch (err: any) { setError(err?.message || 'No se pudo registrar el desembolso.') } finally { setSavingDisbursement(false) }
  }

  return <section className="space-y-4" aria-label="Préstamos internos">
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-base font-extrabold text-slate-800">Préstamos internos</h3><p className="mt-1 text-xs text-slate-500">Saldos, vencimientos y cobros asociados a afiliados.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void loadLoans()} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw className="h-4 w-4" />Actualizar</button>
        {canCreateLoan && <button type="button" onClick={() => { setError(''); setCreating((value) => !value) }} className="flex items-center gap-2 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white"><Plus className="h-4 w-4" />Crear préstamo</button>}
      </div>
    </div>

    {(error || notice) && <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}<span>{error || notice}</span>
      <button className="ml-auto" onClick={() => { setError(''); setNotice('') }} type="button" aria-label="Cerrar aviso">×</button>
    </div>}

    {completedPayment && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs"><div><strong className="block text-emerald-900">Comprobante generado: {completedPayment.result.payment.receiptNumber}</strong><span>Pago: {formatCurrencyBob(completedPayment.result.amountCents, true)} · Saldo restante: {formatCurrencyBob(completedPayment.result.balanceCents, true)}</span></div><button type="button" onClick={async () => { const doc = printEngine.buildFromUnionLoanPayment(completedPayment.result, completedPayment.loan, members.find((member) => member.id === completedPayment.loan.memberId), currentBranch.id, currentUser.fullName); await printEngine.printDocument(doc) }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-3 py-2 font-bold text-white"><Printer className="h-4 w-4" />Imprimir comprobante</button><button type="button" onClick={() => setCompletedPayment(null)} className="rounded-lg border border-emerald-300 px-3 py-2 font-bold text-emerald-900">Cerrar</button></div>}

    {creating && <form onSubmit={handleCreate} className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs font-bold text-slate-700">Afiliado beneficiario<select required value={memberId} onChange={(event) => setMemberId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2"><option value="">Seleccionar afiliado</option>{members.map((member) => <option key={member.id} value={member.id}>{member.memberNumber} · {member.fullName}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-700">Monto original (Bs)<input required inputMode="decimal" placeholder="0,00" value={principalBob} onChange={(event) => setPrincipalBob(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700">Número de cuotas<input required type="number" min="1" max="120" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700">Fecha de otorgamiento<input required type="date" value={grantDate} onChange={(event) => setGrantDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700">Primer vencimiento<input required type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2" /></label>
      <label className="text-xs font-bold text-slate-700 sm:col-span-2 lg:col-span-1">Observaciones<input maxLength={2000} value={loanNotes} onChange={(event) => setLoanNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2" /></label>
      <p className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-3">Sin intereses ni recargos. Las diferencias de redondeo se distribuyen en el cronograma para cuadrar exactamente el monto original.</p>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button disabled={savingLoan} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{savingLoan ? 'Guardando…' : 'Guardar préstamo'}</button><button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold">Cancelar</button></div>
    </form>}

    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar préstamo o afiliado" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs" /></label>
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">Todos los estados</option><option value="active">Vigentes</option><option value="overdue">Vencidos</option><option value="paid">Pagados</option></select>
    </div>

    {loading ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Cargando préstamos…</div> : filteredLoans.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No hay préstamos para mostrar con estos filtros.</div> : <div className="space-y-3">{filteredLoans.map((loan) => <article key={loan.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-extrabold text-slate-800">{loan.loanNumber}</h4><span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${loan.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : loan.status === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{statusLabels[loan.status]}</span></div><p className="mt-1 text-xs text-slate-600">{loan.memberNumber} · {loan.memberName}</p></div>
        <div className="grid grid-cols-2 gap-3 text-xs md:min-w-[440px] lg:grid-cols-4"><div><span className="text-slate-500">Original</span><strong className="block text-slate-800">{formatCurrencyBob(loan.principalCents, true)}</strong></div><div><span className="text-slate-500">Pagado</span><strong className="block text-emerald-700">{formatCurrencyBob(loan.paidCents, true)}</strong></div><div><span className="text-slate-500">Saldo</span><strong className="block text-amber-700">{formatCurrencyBob(loan.balanceCents, true)}</strong></div><div><span className="text-slate-500">Vencido</span><strong className="block text-red-700">{formatCurrencyBob(loan.overdueBalanceCents || 0, true)}</strong></div></div>
        {canDisburse && loan.disbursementStatus === 'pending' && <button type="button" onClick={() => { setError(''); setDisbursingLoanId((id) => id === loan.id ? null : loan.id) }} className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white">Desembolsar préstamo</button>}
        {canCollect && loan.balanceCents > 0 && <button type="button" onClick={() => { setError(''); setPaymentAmount(''); setPayingLoanId((id) => id === loan.id ? null : loan.id) }} className="flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-extrabold text-emerald-950"><CircleDollarSign className="h-4 w-4" />Registrar pago</button>}
        {onOpenStatement && (() => { const member = members.find((item) => item.id === loan.memberId); return member ? <button type="button" onClick={() => onOpenStatement(member)} className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-extrabold text-emerald-800 hover:bg-emerald-50" title="Ver extracto del afiliado"><FileText className="h-4 w-4" />Ver extracto</button> : null })()}
      </div>
      {disbursingLoanId === loan.id && <div className="border-t border-slate-100 bg-blue-50/50 p-4"><label className="text-xs font-bold">Método de desembolso<select value={disbursementMethod} onChange={(event) => setDisbursementMethod(event.target.value as typeof disbursementMethod)} className="ml-2 rounded-lg border bg-white p-2"><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label><button type="button" disabled={savingDisbursement || (disbursementMethod === 'cash' && !activeShift)} onClick={() => void handleDisbursement(loan)} className="ml-3 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingDisbursement ? 'Registrando…' : 'Confirmar desembolso'}</button>{disbursementMethod === 'cash' && !activeShift && <span className="ml-2 text-[10px] text-red-700">Requiere turno abierto.</span>}</div>}
      {payingLoanId === loan.id && <form onSubmit={(event) => void handlePayment(event, loan)} className="grid gap-2 border-t border-slate-100 bg-amber-50/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold">Monto a pagar (Bs)<input required inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2" /></label>
        <label className="text-xs font-bold">Método<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className="mt-1 w-full rounded-lg border bg-white p-2"><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label>
        <label className="text-xs font-bold">Nota<input value={paymentNotes} maxLength={2000} onChange={(event) => setPaymentNotes(event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2" /></label>
        <div className="flex flex-col justify-end gap-2"><button disabled={savingPayment || (paymentMethod === 'cash' && !activeShift)} className="rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingPayment ? 'Registrando…' : 'Confirmar pago'}</button>{paymentMethod === 'cash' && !activeShift && <span className="text-[10px] text-red-700">Requiere un turno de caja abierto.</span>}</div>
      </form>}
      <details className="border-t border-slate-100"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-emerald-800">Cronograma ({loan.installments.length} cuotas) · Historial ({loan.payments.length} pagos)</summary><div className="grid gap-4 bg-slate-50 p-4 lg:grid-cols-2">
        <div><h5 className="mb-2 text-xs font-extrabold text-slate-700">Cronograma de cuotas</h5><div className="space-y-2">{loan.installments.map((installment) => <div key={installment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-2 text-[11px]"><span>#{installment.sequence} · Vence {installment.dueDate}</span><span>{formatCurrencyBob(installment.amountCents, true)}{installment.balanceCents > 0 && <span className="text-slate-500"> · Pendiente {formatCurrencyBob(installment.balanceCents, true)}</span>}</span><span className={`font-bold ${installment.status === 'paid' ? 'text-emerald-700' : installment.status === 'overdue' ? 'text-red-700' : installment.status === 'partial' ? 'text-amber-700' : 'text-slate-500'}`}>{installment.status === 'paid' ? 'Pagada' : installment.status === 'overdue' ? 'Vencida' : installment.status === 'partial' ? 'Parcial' : 'Pendiente'}</span></div>)}</div></div>
        <div><h5 className="mb-2 text-xs font-extrabold text-slate-700">Historial de pagos</h5>{loan.payments.length === 0 ? <p className="text-xs text-slate-500">Todavía no se registraron pagos.</p> : <div className="space-y-2">{loan.payments.map((payment) => <div key={payment.id} className="rounded-lg border bg-white p-2 text-[11px]"><div className="flex justify-between gap-2"><strong>{payment.receiptNumber}</strong><strong>{formatCurrencyBob(payment.amountCents, true)}</strong></div><p className="mt-1 text-slate-500">{new Date(payment.paidAtIso).toLocaleString('es-BO')} · {payment.paymentMethod} · {payment.collectedByName}</p>{payment.notes && <p className="mt-1 text-slate-600">{payment.notes}</p>}</div>)}</div>}</div>
      </div></details>
    </article>)}</div>}
  </section>
}
