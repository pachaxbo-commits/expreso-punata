import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Search } from 'lucide-react'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { listUnionDebtAlertsThroughBackend, type UnionDebtAlert, type UnionDebtAlertsResult } from '../../services/unionService.ts'

type Filter = 'all' | 'overdue' | 'due' | 'loan' | 'fine'

export const UnionDebtAlertsView: React.FC<{ memberId?: string; compact?: boolean; onOpenMember?: (memberId: string) => void }> = ({ memberId, compact = false, onOpenMember }) => {
  const [result, setResult] = useState<UnionDebtAlertsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const refresh = async () => {
    setLoading(true); setError('')
    try { setResult(await listUnionDebtAlertsThroughBackend(memberId)) }
    catch (err: any) { setError(err?.message || 'No se pudieron cargar las deudas.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [memberId])
  const alerts = useMemo(() => (result?.alerts || []).filter((item) =>
    (filter === 'all' || (filter === 'overdue' ? item.status === 'overdue' : item.type === filter)) &&
    (!search || `${item.memberName} ${item.memberNumber} ${item.label}`.toLowerCase().includes(search.toLowerCase()))
  ), [result, filter, search])
  const total = alerts.reduce((sum, item) => sum + item.amountCents, 0)
  const memberCount = new Set((result?.alerts || []).map((item) => item.memberId)).size
  return <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900"><AlertTriangle className="h-4 w-4 text-amber-700"/>{compact ? `Obligaciones pendientes: ${result?.alerts.length ?? '…'}` : `Afiliados con deudas pendientes: ${memberCount}`}</h3><p className="text-xs text-slate-600">Saldo registrado: {formatCurrencyBob((result?.alerts || []).reduce((sum, item) => sum + item.amountCents, 0), true)}</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}/>Actualizar</button>
    </div>
    {!compact && <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input aria-label="Buscar afiliado o deuda" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs" placeholder="Buscar afiliado o deuda" value={search} onChange={(e) => setSearch(e.target.value)}/></div>
      <select aria-label="Filtrar deudas" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="all">Todas las deudas</option><option value="overdue">Solo vencidas</option><option value="due">Cuotas</option><option value="loan">Préstamos</option><option value="fine">Multas</option></select>
    </div>}
    {loading && <p className="py-3 text-center text-xs text-slate-600">Cargando deudas…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {!loading && !error && alerts.length === 0 && <p className="py-3 text-center text-xs text-slate-600">No hay deudas pendientes para mostrar.</p>}
    {!loading && alerts.length > 0 && <div className="divide-y divide-amber-100 rounded-lg bg-white">{alerts.map((item) => <DebtRow key={`${item.type}-${item.id}`} item={item} onOpenMember={onOpenMember}/>)}</div>}
    {result?.truncated && <p className="text-xs font-semibold text-amber-900">La lista alcanzó el límite de consulta. Use la búsqueda por afiliado para consultar más registros.</p>}
    {result?.installmentScanTruncated && <p className="text-xs text-amber-900">El análisis de vencimientos de préstamos alcanzó su límite; algunos vencimientos pueden no aparecer.</p>}
    {!compact && alerts.length > 0 && <p className="text-right text-xs font-bold text-slate-700">Saldo del resultado: {formatCurrencyBob(total, true)}</p>}
  </section>
}

const DebtRow: React.FC<{ item: UnionDebtAlert; onOpenMember?: (memberId: string) => void }> = ({ item, onOpenMember }) => <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
  <div className="min-w-[180px] flex-1"><p className="text-xs font-extrabold text-slate-900">{item.memberName || item.memberNumber} <span className="font-medium text-slate-500">— {item.category}</span></p><p className="mt-0.5 text-xs text-slate-600">{item.label}{item.period ? ` · ${item.period}` : ''}{item.dueDate ? ` · Vence ${item.dueDate}` : ''}</p>{item.reviewRequired && <p className="mt-1 text-xs font-bold text-amber-800">Pendiente de revisión financiera</p>}</div>
  <span className="text-xs font-bold text-slate-700">{item.status === 'overdue' ? `Vencida${item.overdueAmountCents ? ` (${formatCurrencyBob(item.overdueAmountCents, true)})` : ''}` : 'Pendiente'}</span>
  <span className="font-mono text-sm font-extrabold text-[#064e3b]">{formatCurrencyBob(item.amountCents, true)}</span>
  {onOpenMember && <button type="button" onClick={() => onOpenMember(item.memberId)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700">Ver detalle</button>}
</div>
