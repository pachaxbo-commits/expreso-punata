import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'
import { formatCurrencyBob } from '../../domain/parcelEngine'

interface DailyReport {
  day: string
  branchId: string
  registered: number
  delivered: number
  pending: number
  tickets: number
  collections: number
  income: { shipments: number; cod: number; tickets: number }
}

export function DailyOperationsView({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [report, setReport] = useState<DailyReport | null>(null)
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    const fetchReport = httpsCallable<{ branchId: string }, DailyReport>(functions, 'getDailyOperationsReport')
    fetchReport({ branchId }).then(({ data }) => {
      if (active) setReport(data)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [branchId, refresh])

  const current = report?.branchId === branchId ? report : null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-emerald-900">Reporte del día</h2>
      <p className="text-sm text-slate-600">{branchName}{current && ' · ' + current.day}</p>
      {failed && <p role="alert">No se pudo cargar el reporte. Intente actualizar.</p>}
      {!failed && !current && <p role="status">Cargando reporte…</p>}
      {current && !failed && (
        <dl className="my-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt>Encomiendas registradas</dt><dd>{current.registered}</dd></div>
          <div><dt>Entregas registradas</dt><dd>{current.delivered}</dd></div>
          <div><dt>Pendientes entre las guías registradas hoy</dt><dd>{current.pending}</dd></div>
          <div><dt>Operaciones de pasajes</dt><dd>{current.tickets}</dd></div>
          <div><dt>Movimientos de cobro</dt><dd>{current.collections}</dd></div>
          <div><dt>Cobros de encomiendas</dt><dd>{formatCurrencyBob(current.income.shipments, true)}</dd></div>
          <div><dt>Cobros en destino</dt><dd>{formatCurrencyBob(current.income.cod, true)}</dd></div>
          <div><dt>Cobros de pasajes</dt><dd>{formatCurrencyBob(current.income.tickets, true)}</dd></div>
          <div><dt>Ingresos operativos</dt><dd>{formatCurrencyBob(current.income.shipments + current.income.cod + current.income.tickets, true)}</dd></div>
        </dl>
      )}
      <div className="flex gap-3 print:hidden">
        <button type="button" onClick={() => { setFailed(false); setReport(null); setRefresh(value => value + 1) }}>Actualizar reporte</button>
        <button type="button" disabled={!current || failed} onClick={() => window.print()}>Imprimir reporte</button>
      </div>
    </section>
  )
}
