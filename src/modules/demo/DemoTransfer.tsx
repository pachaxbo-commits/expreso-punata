import { useState } from 'react'
import type { Shipment, UserProfile } from '../../types'

export function DemoTransfer({ shipments, user, branch, onUpdate, onDeliver }: {
  shipments: Shipment[]
  user: UserProfile
  branch: string
  onUpdate: (shipment: Shipment) => void
  onDeliver: (shipment: Shipment) => void
}) {
  const [guide, setGuide] = useState('')
  const [count, setCount] = useState('')
  const [condition, setCondition] = useState('good')
  const [notes, setNotes] = useState('')
  const shipment = shipments.find(s => s.trackingCode.toUpperCase() === guide.trim().toUpperCase())
  const driver = user.role === 'conductor'
  const atOrigin = !driver && shipment?.originBranchId === branch
  const atDestination = !driver && shipment?.destinationBranchId === branch
  const custody = shipment?.auditHistory?.some(e => e.reason === 'Custodia confirmada')
  const discrepancy = Number(count) !== shipment?.packageCount || condition !== 'good'

  function record(reason: string, next: Partial<Shipment> = {}) {
    if (!shipment) return
    onUpdate({
      ...shipment, ...next,
      auditHistory: [...(shipment.auditHistory || []), {
        reason, changedAt: new Date().toISOString(), operatorUid: user.uid,
        operatorName: user.fullName, operatorRole: user.role, branchId: branch,
        previousStatus: shipment.status, newStatus: next.status || shipment.status,
        previousValues: { status: shipment.status }, newValues: next,
      }],
    })
  }

  return (
    <section data-tutorial-target={driver ? "shipment-custody" : "shipment-transfer"} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-bold">Traslado por guía · Simulación</h2>
      <label className="block">Guía de la demo
        <input className="ml-2 rounded border p-2" value={guide} onChange={e => { setGuide(e.target.value); setCount(''); setCondition('good'); setNotes('') }} />
      </label>
      {shipment && (atOrigin || atDestination || (driver && shipment.singleTransfer)) && (
        <div className="space-y-2">
          <p>{shipment.trackingCode} · {shipment.status} · {shipment.paymentStatus === 'paid' ? 'Pagada' : 'Por pagar'}</p>
          {atOrigin && ['received', 'pending_dispatch'].includes(shipment.status) && !shipment.manifestId && (
            <>
              <p>Asignación de prueba: vehículo Demo 1 y conductor Demo.</p>
              <button type="button" className="rounded bg-emerald-900 px-3 py-2 text-white disabled:opacity-50" onClick={() => record('Salida confirmada · Demo 1 y conductor Demo', { status: 'in_transit', singleTransfer: true })}>Confirmar salida</button>
            </>
          )}
          {driver && shipment.singleTransfer && shipment.status === 'in_transit' && !custody && (
            <button type="button" className="rounded bg-emerald-900 px-3 py-2 text-white disabled:opacity-50" onClick={() => record('Custodia confirmada')}>Confirmar custodia</button>
          )}
          {atDestination && shipment.singleTransfer && shipment.status === 'in_transit' && (
            custody ? <div className="flex flex-wrap gap-2">
              <label>Bultos de {shipment.packageCount}<input type="number" min="0" step="1" value={count} onChange={e => setCount(e.target.value)} /></label>
              <label>Condición<select value={condition} onChange={e => setCondition(e.target.value)}>
                <option value="good">Conforme</option><option value="damaged">Dañado</option><option value="missing">Faltante</option>
              </select></label>
              <label>Observación<input value={notes} onChange={e => setNotes(e.target.value)} /></label>
              <button type="button" className="rounded bg-emerald-900 px-3 py-2 text-white disabled:opacity-50" disabled={!count || !Number.isInteger(Number(count)) || Number(count) < 0 || (discrepancy && notes.trim().length < 5)}
                onClick={() => record(discrepancy ? `Incidencia de recepción: ${count} bultos · ${notes.trim()}` : 'Recepción conforme',
                  { status: discrepancy ? 'incident_investigation' : 'received_at_dest' })}>Recibir encomienda</button>
            </div> : <p>Pendiente de aceptación de custodia.</p>
          )}
          {atDestination && shipment.status === 'received_at_dest' && (
            <div className="flex gap-4">
              {shipment.paymentTiming === 'destination_cod' && shipment.paymentStatus !== 'paid' &&
                <button type="button" className="rounded bg-emerald-900 px-3 py-2 text-white disabled:opacity-50" onClick={() => record('Cobro en destino · efectivo', { paymentStatus: 'paid', paymentMethod: 'cash' })}>Cobrar en destino</button>}
              {shipment.paymentStatus === 'paid' && <button type="button" className="rounded bg-emerald-900 px-3 py-2 text-white disabled:opacity-50" onClick={() => onDeliver(shipment)}>Entregar con firma</button>}
            </div>
          )}
          <details><summary>Historial del traslado</summary>
            <ol>{shipment.auditHistory?.map((entry, i) => <li key={i}>{entry.reason} · {entry.operatorName}</li>)}</ol>
          </details>
        </div>
      )}
    </section>
  )
}
