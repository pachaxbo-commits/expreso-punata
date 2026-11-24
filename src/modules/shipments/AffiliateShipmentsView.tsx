import { useEffect, useState } from 'react'
import { observedHttpsCallable as httpsCallable } from '../../firebase/observedCallable.ts'
import { functions } from '../../firebase/config'

interface ShipmentSummary {
  trackingCode?: string
  status?: string
  originBranchId?: string
  destinationBranchId?: string
  createdAtIso?: string
  packageCount?: number
}

export function AffiliateShipmentsView({ branchId }: { branchId: string }) {
  const [input, setInput] = useState('')
  const [code, setCode] = useState('')
  const [rows, setRows] = useState<ShipmentSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let active = true
    setStatus('loading')
    const fetchShipments = httpsCallable<{ branchId: string; trackingCode: string }, { shipments: ShipmentSummary[] }>(functions, 'listAffiliateShipments')
    fetchShipments({ branchId, trackingCode: code }).then(({ data }) => {
      if (!active) return
      setRows(data.shipments)
      setStatus('ready')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [branchId, code])

  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold text-emerald-900">Consulta de encomiendas</h2>
      <p className="text-sm text-slate-600">Últimas 30 guías de la agencia. Busca por número para consultar una guía anterior.</p>
      <form className="my-3 flex flex-wrap items-end gap-2 print:hidden" onSubmit={event => { event.preventDefault(); setCode(input.trim()) }}>
        <label className="text-sm">Número de guía <input className="rounded border p-2" value={input} onChange={event => setInput(event.target.value)} maxLength={40} /></label>
        <button className="rounded border p-2 text-sm" type="submit">Buscar guía</button>
        <button className="rounded border p-2 text-sm" type="button" onClick={() => { setInput(''); setCode('') }}>Mostrar recientes</button>
        {status === 'ready' && rows.length > 0 && <button className="rounded border p-2 text-sm" type="button" onClick={() => window.print()}>Imprimir consulta</button>}
      </form>
      {status === 'loading' && <p role="status">Consultando…</p>}
      {status === 'error' && <p role="alert">No se pudo consultar la agencia seleccionada.</p>}
      {status === 'ready' && (rows.length ? <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr><th>Guía</th><th>Ruta</th><th>Estado</th><th>Bultos</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index} className="border-t">
            <td>{row.trackingCode || '—'}</td><td>{row.originBranchId} → {row.destinationBranchId}</td>
            <td>{row.status?.replace(/_/g, ' ') || '—'}</td><td>{row.packageCount ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p>No se encontraron guías.</p>)}
    </section>
  )
}
