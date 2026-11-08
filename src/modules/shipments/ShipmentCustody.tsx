import { useEffect, useState } from 'react'
import type { DispatchManifest } from '../../types'
import { driverConfirmCustodyThroughBackend, subscribeDriverManifests } from '../../services/dispatchService'

export function ShipmentCustody({ uid, includeLegacy = false }: { uid: string; includeLegacy?: boolean }) {
  const [trips, setTrips] = useState<DispatchManifest[]>([])
  const [pendingId, setPendingId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => subscribeDriverManifests(uid, setTrips, () => setError('No se pudo consultar la carga asignada.'), true, includeLegacy), [uid, includeLegacy])

  async function accept(id: string) {
    setPendingId(id)
    setError('')
    try {
      await driverConfirmCustodyThroughBackend(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la custodia.')
    } finally {
      setPendingId('')
    }
  }

  const pending = trips.filter(trip => (includeLegacy || trip.singleTransfer) && ['dispatched', 'in_transit'].includes(trip.status) && trip.driverCustodyStatus === 'pending')
  return (
    <section data-tutorial-target="shipment-custody" className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-bold">Encomiendas asignadas</h2>
      {error && <p role="alert">{error}</p>}
      {!pending.length && <p>No hay guías pendientes de aceptar.</p>}
      {pending.map(trip => (
        <div key={trip.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2">
          <span>{trip.shipmentSummaries[0]?.trackingCode} · {trip.originBranchId} → {trip.destinationBranchId} · Móvil {trip.mobileNumber}</span>
          <button type="button" className="rounded bg-emerald-900 px-3 py-2 text-white" disabled={!!pendingId} onClick={() => accept(trip.id)}>
            Confirmar custodia
          </button>
        </div>
      ))}
    </section>
  )
}
