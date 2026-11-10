import React, { useEffect, useState } from 'react'
import { AlertCircle, CreditCard, Loader2, UserCircle } from 'lucide-react'
import type { UserProfile, UnionMember, UnionMonthlyDue } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { getMyUnionAccountThroughBackend, type UnionFine, type UnionLoan } from '../../services/unionService.ts'

interface Props { currentUser: UserProfile }

export const AffiliateAccountView: React.FC<Props> = ({ currentUser }) => {
  const [member, setMember] = useState<UnionMember | null>(null)
  const [dues, setDues] = useState<UnionMonthlyDue[]>([])
  const [loans, setLoans] = useState<UnionLoan[]>([])
  const [fines, setFines] = useState<UnionFine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getMyUnionAccountThroughBackend()
      .then((result) => {
        if (!active) return
        setMember(result.member)
        setDues(result.dues || [])
        setLoans(result.loans || [])
        setFines(result.fines || [])
      })
      .catch((err: any) => active && setError(err?.message || 'No se pudo cargar su cuenta de afiliado.'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [currentUser.uid])

  if (loading) return <div className="rounded-2xl bg-white p-8 text-center text-slate-600"><Loader2 className="mx-auto mb-2 animate-spin" />Cargando Mi cuenta…</div>
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"><AlertCircle className="mb-2" />{error}</div>

  const pendingDues = dues.filter((due) => due.status !== 'paid').reduce((sum, due) => sum + Number(due.balanceCents || due.amountCents || 0), 0)
  const loanBalance = loans.reduce((sum, loan) => sum + Number(loan.balanceCents || 0), 0)
  const fineBalance = fines.reduce((sum, fine) => sum + Number(fine.balanceCents || 0), 0)

  return <div className="space-y-5">
    <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
      <div className="flex items-center gap-3 mb-4"><UserCircle className="h-10 w-10 text-emerald-700" /><div><h2 className="text-xl font-extrabold text-emerald-900">Mi cuenta</h2><p className="text-sm text-slate-500">Información personal y estado de sus obligaciones</p></div></div>
      <div className="grid gap-3 md:grid-cols-3 text-sm"><div><span className="font-bold">Nombre:</span> {member?.fullName || currentUser.fullName}</div><div><span className="font-bold">Afiliado:</span> {member?.memberNumber || '—'}</div><div><span className="font-bold">Sucursal:</span> {member?.branchId || currentUser.primaryBranchId}</div></div>
    </section>
    <section className="grid gap-4 md:grid-cols-3">
      <Summary title="Cuotas y deudas" value={formatCurrencyBob(pendingDues, true)} />
      <Summary title="Saldo de préstamos" value={formatCurrencyBob(loanBalance, true)} />
      <Summary title="Saldo de multas" value={formatCurrencyBob(fineBalance, true)} />
    </section>
    <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200"><h3 className="mb-3 font-extrabold text-emerald-900">Cuotas y deudas</h3>{dues.length ? <div className="space-y-2">{dues.map((due) => <div className="flex justify-between border-b py-2 text-sm" key={due.id}><span>{due.period || due.dueDate || 'Período'}</span><span>{formatCurrencyBob(Number(due.balanceCents || due.amountCents || 0), true)} · {due.status}</span></div>)}</div> : <p className="text-sm text-slate-500">No hay cuotas registradas.</p>}</section>
    <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200"><h3 className="mb-3 font-extrabold text-emerald-900">Préstamos y pagos</h3>{loans.length ? <div className="space-y-2">{loans.map((loan) => <div className="border-b py-2 text-sm" key={loan.id}><div className="flex justify-between"><span>{loan.loanNumber}</span><span>{formatCurrencyBob(loan.balanceCents, true)} pendiente</span></div><p className="text-xs text-slate-500">{loan.payments?.length || 0} pagos registrados</p></div>)}</div> : <p className="text-sm text-slate-500">No hay préstamos registrados.</p>}</section>
    <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200"><h3 className="mb-3 font-extrabold text-emerald-900">Multas e historial de pagos</h3>{fines.length ? <div className="space-y-2">{fines.map((fine) => <div className="border-b py-2 text-sm" key={fine.id}><div className="flex justify-between"><span>{fine.category} · {fine.reason}</span><span>{formatCurrencyBob(fine.balanceCents, true)} pendiente</span></div><p className="text-xs text-slate-500">{fine.payments?.length || 0} pagos registrados</p></div>)}</div> : <p className="text-sm text-slate-500">No hay multas registradas.</p>}</section>
  </div>
}

const Summary: React.FC<{ title: string; value: string }> = ({ title, value }) => <div className="rounded-2xl bg-emerald-900 p-5 text-white"><CreditCard className="mb-2 h-5 w-5 text-amber-300" /><p className="text-xs uppercase text-emerald-200">{title}</p><strong className="text-xl">{value}</strong></div>
