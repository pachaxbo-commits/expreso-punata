import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'
import { formatCurrencyBob } from '../../domain/parcelEngine'

interface Accrual {
  id: string
  trackingCode: string
  driverName: string
  commissionAmountCents: number
  status: string
}

export function BranchCommissionView({ branchId }: { branchId: string }) {
  const [rows, setRows] = useState<Accrual[]>([])
  const [shipmentId, setShipmentId] = useState('')
  const [manifestId, setManifestId] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [readError, setReadError] = useState(false)

  useEffect(() => {
    let active = true
    const list = httpsCallable<{ branchId: string }, { records: Accrual[] }>(functions, 'listBranchCommissionAccruals')
    list({ branchId }).then(({ data }) => {
      if (!active) return
      setRows(data.records)
      setReadError(false)
    }).catch(() => { if (active) setReadError(true) })
    return () => { active = false }
  }, [branchId, revision])

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-bold text-emerald-900">Devengos de la agencia</h2>
      <p className="text-sm">Últimos 50 devengos registrados con agencia de origen.</p>
      {readError && <p role="alert">No se pudieron consultar los devengos.</p>}
      <form className="flex flex-wrap gap-3" onSubmit={async event => {
        event.preventDefault()
        if (busy || !shipmentId.trim() || !manifestId.trim()) return
        setBusy(true)
        try {
          await httpsCallable(functions, 'accrueDriverCommission')({ shipmentId: shipmentId.trim(), manifestId: manifestId.trim() })
          setRevision(value => value + 1)
          setMessage('Devengo registrado.')
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'No se pudo registrar el devengo.')
        } finally {
          setBusy(false)
        }
      }}>
        <label>Guía <input className="rounded border p-1" required value={shipmentId} onChange={event => setShipmentId(event.target.value)} /></label>
        <label>Referencia del manifiesto <input className="rounded border p-1" required value={manifestId} onChange={event => setManifestId(event.target.value)} /></label>
        <button className="rounded border px-3" type="submit" disabled={busy}>Devengar comisión</button>
      </form>
      {message && <p role="status">{message}</p>}
      {!readError && <ul className="divide-y">
        {rows.map(row => <li className="py-2" key={row.id}>{row.trackingCode} · {row.driverName} · {formatCurrencyBob(row.commissionAmountCents, true)} · {row.status}</li>)}
      </ul>}
    </section>
  )
}
