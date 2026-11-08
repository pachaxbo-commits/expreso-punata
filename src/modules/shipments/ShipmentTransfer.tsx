import { useEffect, useState } from 'react'
import type { Shipment, UserProfile, Vehicle } from '../../types'
import { subscribeActiveDrivers, subscribeVehicles } from '../../services/dispatchService'
import { confirmShipmentDeparture, confirmShipmentReception } from '../../services/dispatchService'

export function ShipmentTransfer({ shipment, action, onDone }: {
  shipment: Shipment
  action: 'depart' | 'receive'
  onDone: () => void
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [vehicleId, setVehicleId] = useState('')
  const [driverUid, setDriverUid] = useState('')
  const [packages, setPackages] = useState('')
  const [condition, setCondition] = useState<'good' | 'damaged' | 'missing'>('good')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (action !== 'depart') return
    const onError = () => setError('No se pudo consultar la flota o los conductores.')
    const stopVehicles = subscribeVehicles(setVehicles, onError)
    const stopDrivers = subscribeActiveDrivers(setDrivers, onError)
    return () => { stopVehicles(); stopDrivers() }
  }, [action])

  const departing = action === 'depart'
  const expected = shipment.packageCount || 1
  const discrepant = Number(packages) !== expected || condition !== 'good'
  const disabled = busy || (departing
    ? !vehicleId || !driverUid
    : !packages || !Number.isInteger(Number(packages)) || Number(packages) < 0 || (discrepant && notes.trim().length < 5))

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      if (departing) {
        await confirmShipmentDeparture({
          shipmentId: shipment.id,
          originBranchId: shipment.originBranchId,
          destinationBranchId: shipment.destinationBranchId,
          vehicleId,
          driverUid,
        })
      } else {
        if (!shipment.manifestId) throw new Error('No se encontró el registro de salida.')
        await confirmShipmentReception({
          shipmentId: shipment.id, manifestId: shipment.manifestId,
          receivedPackages: Number(packages), condition, notes,
        })
      }
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la operación.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset data-tutorial-target="shipment-transfer" disabled={busy} className="mx-4 my-2 space-y-2 rounded-xl border border-emerald-200 p-3 text-sm">
      <legend className="px-1 font-bold text-emerald-900">{departing ? 'Salida de agencia' : 'Recepción en destino'}</legend>
      {departing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Vehículo
            <select className="block w-full rounded border p-2" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
              <option value="">Seleccionar vehículo</option>
              {vehicles.filter(v => v.status === 'active' && v.branchId === shipment.originBranchId).map(v => <option key={v.id} value={v.id}>{v.mobileNumber} · {v.plate}</option>)}
            </select>
          </label>
          <label>Conductor
            <select className="block w-full rounded border p-2" value={driverUid} onChange={e => setDriverUid(e.target.value)}>
              <option value="">Seleccionar conductor</option>
              {drivers.map(d => <option key={d.uid} value={d.uid}>{d.fullName}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Bultos recibidos de {expected}
            <input className="block w-full rounded border p-2" type="number" min="0" step="1" value={packages} onChange={e => setPackages(e.target.value)} />
          </label>
          <label>Condición física
            <select className="block w-full rounded border p-2" value={condition} onChange={e => setCondition(e.target.value as typeof condition)}>
              <option value="good">Conforme</option>
              <option value="damaged">Con daños</option>
              <option value="missing">Con faltantes</option>
            </select>
          </label>
          <label className="sm:col-span-2">Observaciones{discrepant && packages !== '' ? ' (obligatorias)' : ''}
            <textarea className="block w-full rounded border p-2" value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
        </div>
      )}
      {error && <p role="alert" className="text-rose-800">{error}</p>}
      <button type="button" disabled={disabled} onClick={confirm} className="rounded bg-emerald-900 px-3 py-2 text-white disabled:opacity-50">
        {busy ? 'Guardando…' : departing ? 'Confirmar salida' : 'Recibir encomienda'}
      </button>
    </fieldset>
  )
}
