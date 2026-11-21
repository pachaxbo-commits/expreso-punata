import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'

interface TicketSummary {
  operationNumber: string
  originBranchId: string
  destinationBranchId: string
  travelDate: string
  quantity: number
  usedCount: number
  paymentStatus: string
}

export function AffiliatePassengerTicketsView({ branchId }: { branchId: string }) {
  const [operationNumber, setOperationNumber] = useState('')
  const [travelDate, setTravelDate] = useState('')
  const [filters, setFilters] = useState({ operationNumber: '', travelDate: '' })
  const [rows, setRows] = useState<TicketSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    const list = httpsCallable<{ branchId: string; operationNumber: string; travelDate: string }, { operations: TicketSummary[] }>(
      functions, 'listAffiliatePassengerTickets',
    )
    list({ branchId, ...filters }).then(({ data }) => {
      if (active) { setRows(data.operations); setStatus('ready') }
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [branchId, filters])

  return <section className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="font-bold text-emerald-900">Consulta de pasajes</h2>
    <p className="text-sm">Hasta 30 operaciones de la agencia. Filtra por fecha o busca por número para consultar operaciones anteriores.</p>
    <form className="flex flex-wrap gap-3 print:hidden" onSubmit={event => {
      event.preventDefault()
      setStatus('loading')
      setFilters({ operationNumber, travelDate })
    }}>
      <label>Operación <input className="rounded border p-1" value={operationNumber} maxLength={40} onChange={event => setOperationNumber(event.target.value)} /></label>
      <label>Fecha de viaje <input className="rounded border p-1" type="date" value={travelDate} onChange={event => setTravelDate(event.target.value)} /></label>
      <button className="rounded border px-2" type="submit">Consultar</button>
      {status === 'ready' && rows.length > 0 && <button type="button" onClick={() => window.print()}>Imprimir consulta</button>}
    </form>
    {status === 'loading' && <p role="status">Consultando…</p>}
    {status === 'error' && <p role="alert">No se pudo consultar la agencia seleccionada.</p>}
    {status === 'ready' && (rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr><th>Operación</th><th>Ruta</th><th>Viaje</th><th>Uso</th><th>Pago</th></tr></thead>
      <tbody>{rows.map(row => <tr className="border-t" key={row.operationNumber}>
        <td>{row.operationNumber}</td><td>{row.originBranchId} → {row.destinationBranchId}</td>
        <td>{row.travelDate}</td><td>{row.usedCount} de {row.quantity}</td><td>{row.paymentStatus.replace(/_/g, ' ')}</td>
      </tr>)}</tbody>
    </table></div> : <p>No se encontraron pasajes.</p>)}
  </section>
}
