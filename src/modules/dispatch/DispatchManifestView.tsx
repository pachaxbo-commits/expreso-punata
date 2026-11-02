import React, { useState, useEffect } from 'react'
import {
  Truck,
  Package,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Printer,
  ShieldCheck,
  MapPin,
  FileText,
} from 'lucide-react'
import type {
  Shipment,
  DispatchManifest,
  Vehicle,
  UserProfile,
  Branch,
} from '../../types/index.ts'
import {
  createDispatchManifestThroughBackend,
  driverConfirmCustodyThroughBackend,
  receiveDispatchManifestThroughBackend,
  manageVehicleThroughBackend,
  subscribeManifestsByBranch,
  subscribeDriverManifests,
  subscribeVehicles,
  subscribeActiveDrivers,
} from '../../services/dispatchService.ts'
import {
  printDispatchManifestPdf,
  printDispatchManifestTicket80mm,
} from '../../services/pdfService.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'

interface DispatchManifestViewProps {
  currentUser: UserProfile
  currentBranch: Branch
  shipments: Shipment[]
}

export const DispatchManifestView: React.FC<DispatchManifestViewProps> = ({
  currentUser,
  currentBranch,
  shipments,
}) => {
  const isDriver = currentUser.role === 'conductor'
  const isManagerOrAdmin = currentUser.role === 'directiva_admin' || currentUser.role === 'encargado_agencia'

  // Subpestañas disponibles según rol
  const [subTab, setSubTab] = useState<'dispatch' | 'reception' | 'my_trips' | 'fleet' | 'history'>(
    isDriver ? 'my_trips' : 'dispatch'
  )

  const [manifests, setManifests] = useState<DispatchManifest[]>([])
  const [driverTrips, setDriverTrips] = useState<DispatchManifest[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Estado para creación de manifiesto
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<string[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('')
  const [selectedDriverUid, setSelectedDriverUid] = useState<string>('')
  const [departureNotes, setDepartureNotes] = useState<string>('')

  // Estado para modal de recepción
  const [selectedManifestForReception, setSelectedManifestForReception] = useState<DispatchManifest | null>(null)
  const [receptionInspections, setReceptionInspections] = useState<Record<string, {
    receivedPackages: number
    condition: 'good' | 'damaged' | 'missing'
    notes: string
  }>>({})
  const [receptionGeneralNotes, setReceptionGeneralNotes] = useState<string>('')

  // Estado para modal de vehículo
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false)
  const [newMobileNumber, setNewMobileNumber] = useState('')
  const [newPlate, setNewPlate] = useState('')
  const [newCapacityKg, setNewCapacityKg] = useState('1500')
  const [newVehicleNotes, setNewVehicleNotes] = useState('')

  // Suscripciones en tiempo real
  useEffect(() => {
    const unsubManifests = subscribeManifestsByBranch(currentBranch.id, (list) => {
      setManifests(list)
    })

    const unsubVehicles = subscribeVehicles((list) => {
      setVehicles(list)
    })

    const unsubDrivers = subscribeActiveDrivers((list) => {
      setDrivers(list)
    })

    let unsubDriverTrips: (() => void) | null = null
    if (currentUser.uid) {
      unsubDriverTrips = subscribeDriverManifests(currentUser.uid, (list) => {
        setDriverTrips(list)
      })
    }

    return () => {
      unsubManifests()
      unsubVehicles()
      unsubDrivers()
      if (unsubDriverTrips) unsubDriverTrips()
    }
  }, [currentBranch.id, currentUser.uid])

  // Actualizar chofer por defecto si se selecciona un vehículo que tiene chofer asignado
  useEffect(() => {
    if (selectedVehicleId) {
      const v = vehicles.find((x) => x.id === selectedVehicleId)
      if (v && v.assignedDriverUid) {
        setSelectedDriverUid(v.assignedDriverUid)
      }
    }
  }, [selectedVehicleId, vehicles])

  // Encomiendas disponibles para despacho en la sucursal actual
  const readyShipments = shipments.filter(
    (s) =>
      s.originBranchId === currentBranch.id &&
      (s.status === 'received' || s.status === 'pending_dispatch') &&
      !s.assignedVehicle?.manifestId
  )

  // Manifiestos en tránsito hacia mi sucursal
  const incomingManifests = manifests.filter(
    (m) =>
      m.destinationBranchId === currentBranch.id &&
      (m.status === 'dispatched' || m.status === 'in_transit')
  )

  // Toggle selección de encomienda
  const toggleSelectShipment = (id: string) => {
    setSelectedShipmentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const selectAllShipments = () => {
    if (selectedShipmentIds.length === readyShipments.length) {
      setSelectedShipmentIds([])
    } else {
      setSelectedShipmentIds(readyShipments.map((s) => s.id))
    }
  }

  // Cálculos de carga seleccionada
  const selectedShipmentsList = readyShipments.filter((s) => selectedShipmentIds.includes(s.id))
  const selectedTotalPackages = selectedShipmentsList.reduce((acc, s) => acc + (s.packageCount || 1), 0)
  const selectedTotalWeight = selectedShipmentsList.reduce((acc, s) => acc + (s.totalWeightKg || 0), 0)
  const selectedTotalCodCents = selectedShipmentsList
    .filter((s) => s.paymentTiming === 'destination_cod' && s.paymentStatus !== 'paid')
    .reduce((acc, s) => acc + (s.finalAmountCents || 0), 0)

  // Despachar Manifiesto
  const handleCreateManifest = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (selectedShipmentIds.length === 0) {
      setErrorMsg('Debe seleccionar al menos una encomienda para despachar.')
      return
    }
    if (!selectedVehicleId) {
      setErrorMsg('Debe seleccionar el vehículo o móvil de transporte.')
      return
    }
    if (!selectedDriverUid) {
      setErrorMsg('Debe asignar al conductor responsable del viaje.')
      return
    }

    const destinationBranchId = currentBranch.id === 'punata' ? 'cochabamba' : 'punata'

    try {
      setLoading(true)
      const res = await createDispatchManifestThroughBackend({
        originBranchId: currentBranch.id,
        destinationBranchId,
        vehicleId: selectedVehicleId,
        driverUid: selectedDriverUid,
        shipmentIds: selectedShipmentIds,
        departureNotes,
      })

      setSuccessMsg(`¡Manifiesto ${res.manifestNumber} generado exitosamente! Total encomiendas: ${res.totalShipments}.`)
      setSelectedShipmentIds([])
      setDepartureNotes('')
    } catch (err: any) {
      console.error('[handleCreateManifest] Error:', err)
      setErrorMsg(err.message || 'Error al despachar manifiesto.')
    } finally {
      setLoading(false)
    }
  }

  // Confirmar custodia por el conductor
  const handleDriverAcceptCustody = async (manifestId: string) => {
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      setLoading(true)
      const res = await driverConfirmCustodyThroughBackend(manifestId, 'Custodia aceptada y carga asegurada')
      setSuccessMsg(`Custodia del viaje ${res.manifestNumber} confirmada. ¡Buen viaje!`)
    } catch (err: any) {
      console.error('[handleDriverAcceptCustody] Error:', err)
      setErrorMsg(err.message || 'Error al confirmar custodia.')
    } finally {
      setLoading(false)
    }
  }

  // Abrir modal de recepción
  const openReceptionModal = (manifest: DispatchManifest) => {
    setSelectedManifestForReception(manifest)
    setReceptionGeneralNotes('')
    const initialInspections: Record<string, any> = {}
    manifest.shipmentSummaries?.forEach((s) => {
      initialInspections[s.shipmentId] = {
        receivedPackages: s.packageCount,
        condition: 'good',
        notes: '',
      }
    })
    setReceptionInspections(initialInspections)
  }

  // Enviar recepción formal
  const handleConfirmReception = async () => {
    if (!selectedManifestForReception) return
    setErrorMsg(null)
    setSuccessMsg(null)

    const payload = {
      manifestId: selectedManifestForReception.id,
      receptionNotes: receptionGeneralNotes,
      receivedShipments: Object.entries(receptionInspections).map(([sId, val]) => ({
        shipmentId: sId,
        receivedPackages: val.receivedPackages,
        condition: val.condition,
        notes: val.notes,
      })),
    }

    try {
      setLoading(true)
      const res = await receiveDispatchManifestThroughBackend(payload)
      setSuccessMsg(`¡Manifiesto ${res.manifestNumber} recibido formalmente en agencia! Discrepancias: ${res.discrepanciesCount}.`)
      setSelectedManifestForReception(null)
    } catch (err: any) {
      console.error('[handleConfirmReception] Error:', err)
      setErrorMsg(err.message || 'Error al recibir el manifiesto.')
    } finally {
      setLoading(false)
    }
  }

  // Guardar nuevo vehículo
  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!newMobileNumber || !newPlate) {
      setErrorMsg('Debe ingresar número de móvil y placa.')
      return
    }

    try {
      setLoading(true)
      await manageVehicleThroughBackend({
        action: 'create',
        vehicleData: {
          mobileNumber: newMobileNumber,
          plate: newPlate,
          branchId: currentBranch.id,
          capacityKg: Number(newCapacityKg) || 1500,
          notes: newVehicleNotes,
        },
      })
      setSuccessMsg(`Vehículo Móvil ${newMobileNumber} (${newPlate}) registrado en el padrón de flota.`)
      setIsVehicleModalOpen(false)
      setNewMobileNumber('')
      setNewPlate('')
      setNewVehicleNotes('')
    } catch (err: any) {
      console.error('[handleSaveVehicle] Error:', err)
      setErrorMsg(err.message || 'Error al registrar vehículo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Cabecera del Módulo */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-[#064e3b]" />
            <h2 className="text-base font-extrabold text-slate-800">
              Despachos, Manifiestos y Flota en Ruta
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Control de viajes interagencias, asignación de carga, custodia de conductores y recepción bulto a bulto.
          </p>
        </div>

        {/* Sub-navegación */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold">
          {!isDriver && (
            <button
              type="button"
              onClick={() => setSubTab('dispatch')}
              className={`px-3 py-1.5 rounded-md transition ${
                subTab === 'dispatch' ? 'bg-[#064e3b] text-[#facc15] shadow font-bold' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Despachar Salidas ({readyShipments.length})
            </button>
          )}

          {!isDriver && (
            <button
              type="button"
              onClick={() => setSubTab('reception')}
              className={`px-3 py-1.5 rounded-md transition relative ${
                subTab === 'reception' ? 'bg-[#064e3b] text-[#facc15] shadow font-bold' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Recepción en Destino
              {incomingManifests.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 bg-amber-500 text-white rounded-full text-[10px] font-extrabold">
                  {incomingManifests.length}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setSubTab('my_trips')}
            className={`px-3 py-1.5 rounded-md transition ${
              subTab === 'my_trips' ? 'bg-[#064e3b] text-[#facc15] shadow font-bold' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Mis Viajes (Conductor)
          </button>

          <button
            type="button"
            onClick={() => setSubTab('fleet')}
            className={`px-3 py-1.5 rounded-md transition ${
              subTab === 'fleet' ? 'bg-[#064e3b] text-[#facc15] shadow font-bold' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Padrón de Flota ({vehicles.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3 py-1.5 rounded-md transition ${
              subTab === 'history' ? 'bg-[#064e3b] text-[#facc15] shadow font-bold' : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Historial de Manifiestos
          </button>
        </div>
      </div>

      {/* Alertas de Éxito / Error */}
      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-800 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-900 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* 1. SUBPESTAÑA: DESPACHAR SALIDAS */}
      {subTab === 'dispatch' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Columna Izquierda: Selección de Encomiendas */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="selectAll"
                  checked={readyShipments.length > 0 && selectedShipmentIds.length === readyShipments.length}
                  onChange={selectAllShipments}
                  disabled={readyShipments.length === 0}
                  className="w-4 h-4 rounded text-[#064e3b] focus:ring-[#064e3b] cursor-pointer"
                />
                <label htmlFor="selectAll" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Seleccionar Todo ({readyShipments.length} encomiendas listas)
                </label>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                Origen: {currentBranch.name} ➔ Destino: {currentBranch.id === 'punata' ? 'Cochabamba' : 'Punata'}
              </span>
            </div>

            {readyShipments.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Package className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-500">No hay encomiendas pendientes de despacho en esta agencia.</p>
                <p className="text-[11px] text-slate-400">Las encomiendas recibidas en ventanilla aparecerán aquí automáticamente.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 overflow-y-auto max-h-[500px]">
                {readyShipments.map((s) => {
                  const isSelected = selectedShipmentIds.includes(s.id)
                  const isCod = s.paymentTiming === 'destination_cod' && s.paymentStatus !== 'paid'
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggleSelectShipment(s.id)}
                      className={`p-3 transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected ? 'bg-emerald-50/70 border-l-4 border-[#064e3b]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // handled by div click
                          className="w-4 h-4 rounded text-[#064e3b] focus:ring-[#064e3b] pointer-events-none"
                        />
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[#064e3b] bg-emerald-100/60 px-2 py-0.5 rounded">
                              {s.trackingCode}
                            </span>
                            <span className="text-[11px] text-slate-700 font-semibold">
                              {s.sender?.name} ➔ {s.recipient?.name}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {s.packageCount} bulto(s) • {s.totalWeightKg || 0} kg • {s.items?.[0]?.description || 'Carga general'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-slate-800 font-mono block">
                          {formatCurrencyBob(s.finalAmountCents, true)}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            isCod ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isCod ? 'Contraentrega (COD)' : 'Pagado'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Columna Derecha: Configuración de Salida y Generación */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide border-b border-slate-100 pb-2 flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-[#064e3b]" />
              <span>Configuración de Despacho</span>
            </h3>

            {/* Resumen de Carga Seleccionada */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Guías Seleccionadas:</span>
                <span className="font-bold text-slate-800">{selectedShipmentIds.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Bultos Físicos:</span>
                <span className="font-bold text-slate-800">{selectedTotalPackages}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Peso Total Estimado:</span>
                <span className="font-bold text-slate-800">{selectedTotalWeight} kg</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-[#b45309]">
                <span className="font-semibold">COD a Cobrar en Destino:</span>
                <span className="font-extrabold font-mono">{formatCurrencyBob(selectedTotalCodCents, true)}</span>
              </div>
            </div>

            <form onSubmit={handleCreateManifest} className="space-y-3">
              {/* Selector de Móvil / Vehículo */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Móvil / Vehículo Asignado *
                </label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white"
                  required
                >
                  <option value="">-- Seleccione Vehículo --</option>
                  {vehicles.filter((v) => v.status === 'active').map((v) => (
                    <option key={v.id} value={v.id}>
                      Móvil {v.mobileNumber} — Placa: {v.plate} ({v.brand || 'Flota'})
                    </option>
                  ))}
                </select>
                {vehicles.length === 0 && (
                  <p className="text-[10px] text-amber-700 mt-0.5">
                    No hay vehículos registrados. Agregue uno en la pestaña Padrón de Flota.
                  </p>
                )}
              </div>

              {/* Selector de Conductor */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Conductor Responsable *
                </label>
                <select
                  value={selectedDriverUid}
                  onChange={(e) => setSelectedDriverUid(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white"
                  required
                >
                  <option value="">-- Seleccione Conductor --</option>
                  {drivers.map((d) => (
                    <option key={d.uid} value={d.uid}>
                      {d.fullName} ({d.phone || 'S/N'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Observaciones de Salida */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observaciones de Salida (Opcional)
                </label>
                <textarea
                  value={departureNotes}
                  onChange={(e) => setDepartureNotes(e.target.value)}
                  placeholder="Ej. Salida 14:30 sin novedad, carga embalada con precintos..."
                  rows={2}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>

              <button
                type="submit"
                disabled={loading || selectedShipmentIds.length === 0 || !selectedVehicleId || !selectedDriverUid}
                className="w-full py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-extrabold text-xs rounded-lg shadow transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Truck className="w-4 h-4" />
                <span>{loading ? 'Generando Manifiesto...' : 'Generar Manifiesto de Despacho'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 2. SUBPESTAÑA: RECEPCIÓN EN DESTINO */}
      {subTab === 'reception' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Manifiestos en Camino hacia {currentBranch.name} ({incomingManifests.length})
              </h3>
              <p className="text-xs text-slate-500">
                Confirme la descarga física de cada paquete, reporte faltantes o daños y certifique la recepción.
              </p>
            </div>
          </div>

          {incomingManifests.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-bold text-slate-700">No hay despachos pendientes de llegada a esta agencia.</p>
              <p className="text-[11px] text-slate-400">Todos los viajes hacia {currentBranch.name} han sido recibidos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {incomingManifests.map((m) => (
                <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-extrabold text-[#064e3b] bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                      {m.manifestNumber}
                    </span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                      {m.driverCustodyStatus === 'accepted' ? 'En Tránsito (Custodia Chofer)' : 'Despachado (Salida)'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <MapPin className="w-3.5 h-3.5 text-[#064e3b]" />
                      <span>{m.originBranchId === 'punata' ? 'Punata' : 'Cochabamba'} ➔ {m.destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba'}</span>
                    </div>
                    <p>Móvil: <strong className="text-slate-800">N° {m.mobileNumber}</strong> ({m.vehiclePlate})</p>
                    <p>Conductor: <strong className="text-slate-800">{m.driverName}</strong></p>
                    <p>Carga: <strong className="text-slate-800">{m.totalShipments} guías</strong> • {m.totalPackages} bultos • {m.totalWeightKg} kg</p>
                    {m.totalCodAmountCents > 0 && (
                      <p className="text-amber-800 font-bold">Por cobrar en esta ventanilla: {formatCurrencyBob(m.totalCodAmountCents, true)}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => openReceptionModal(m)}
                      className="flex-1 py-2 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-extrabold text-xs rounded-lg shadow flex items-center justify-center gap-1.5 transition"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Verificar y Recibir en Destino</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => printDispatchManifestPdf(m)}
                      className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                      title="Ver Manifiesto PDF"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. SUBPESTAÑA: MIS VIAJES (ROL CONDUCTOR) */}
      {subTab === 'my_trips' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Mis Viajes y Carga Asignada
              </h3>
              <p className="text-xs text-slate-500">
                Visualice sus hojas de ruta, confirme la custodia al cargar y consulte el importe por cobrar a entregar.
              </p>
            </div>
          </div>

          {driverTrips.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
              <Truck className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-600">No tiene viajes activos asignados actualmente.</p>
              <p className="text-[11px] text-slate-400">Cuando la ventanilla despache un viaje a su nombre, aparecerá en esta sección.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {driverTrips.map((trip) => {
                const isDelivered = trip.status === 'received'
                const isAccepted = trip.driverCustodyStatus === 'accepted'
                return (
                  <div key={trip.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-[#064e3b] bg-emerald-100/60 px-2.5 py-1 rounded">
                          {trip.manifestNumber}
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          {trip.originBranchId === 'punata' ? 'Punata' : 'Cochabamba'} ➔ {trip.destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isDelivered
                              ? 'bg-emerald-100 text-emerald-800'
                              : isAccepted
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isDelivered ? 'Entregado en Destino' : isAccepted ? 'En Ruta (Custodia Aceptada)' : 'Pendiente de Custodia'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Móvil / Placa</span>
                        <strong className="text-slate-800">Móvil {trip.mobileNumber} ({trip.vehiclePlate})</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Total Encomiendas</span>
                        <strong className="text-slate-800">{trip.totalShipments} guías ({trip.totalPackages} bultos)</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Peso de Carga</span>
                        <strong className="text-slate-800">{trip.totalWeightKg} kg</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Total a Cobrar (COD)</span>
                        <strong className="text-amber-800 font-mono font-extrabold">{formatCurrencyBob(trip.totalCodAmountCents, true)}</strong>
                      </div>
                    </div>

                    {/* Botones de Acción */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => printDispatchManifestTicket80mm(trip)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Ticket 80mm Chofer</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => printDispatchManifestPdf(trip)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Manifiesto A4</span>
                        </button>
                      </div>

                      {!isDelivered && !isAccepted && (
                        <button
                          type="button"
                          onClick={() => handleDriverAcceptCustody(trip.id)}
                          disabled={loading}
                          className="px-4 py-1.5 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-extrabold text-xs rounded-lg shadow flex items-center gap-1.5 transition"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>Confirmar Carga Recibida (Aceptar Custodia)</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. SUBPESTAÑA: PADRÓN DE FLOTA */}
      {subTab === 'fleet' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Flota y Móviles de Expreso Punata
              </h3>
              <p className="text-xs text-slate-500">
                Padrón oficial de vehículos que realizan el transporte diario entre Punata y Cochabamba.
              </p>
            </div>

            {isManagerOrAdmin && (
              <button
                type="button"
                onClick={() => setIsVehicleModalOpen(true)}
                className="px-3.5 py-2 bg-[#064e3b] text-[#facc15] font-extrabold text-xs rounded-lg shadow flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar Móvil</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {vehicles.map((v) => (
              <div key={v.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-sm text-[#064e3b] bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
                    Móvil N° {v.mobileNumber}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      v.status === 'active'
                        ? 'bg-emerald-100 text-emerald-800'
                        : v.status === 'in_maintenance'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {v.status === 'active' ? 'Activo' : v.status === 'in_maintenance' ? 'En Mantenimiento' : 'Inactivo'}
                  </span>
                </div>

                <div className="text-xs text-slate-600 space-y-1">
                  <p>Placa: <strong className="text-slate-800 font-mono text-sm">{v.plate}</strong></p>
                  <p>Agencia Base: <span className="font-semibold">{v.branchId === 'punata' ? 'Punata' : 'Cochabamba'}</span></p>
                  <p>Capacidad: <span>{v.capacityKg || 1500} kg</span></p>
                  {v.assignedDriverName && (
                    <p>Conductor Habitual: <strong className="text-slate-700">{v.assignedDriverName}</strong></p>
                  )}
                  {v.notes && <p className="text-slate-400 italic text-[11px]">{v.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. SUBPESTAÑA: HISTORIAL DE MANIFIESTOS */}
      {subTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Historial de Manifiestos de Carga
              </h3>
              <p className="text-xs text-slate-500">
                Registro inmutable de despachos y recepciones completadas en Expreso Punata.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm overflow-hidden">
            {manifests.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No hay registros de manifiestos todavía.</div>
            ) : (
              manifests.map((m) => {
                const dateStr = m.dispatchedAtIso
                  ? new Date(m.dispatchedAtIso).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })
                  : 'Fecha reciente'
                const hasDiscrepancies = (m.discrepancies?.length || 0) > 0

                return (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50 transition">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-[#064e3b] bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                          {m.manifestNumber}
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          {m.originBranchId === 'punata' ? 'Punata' : 'Cochabamba'} ➔ {m.destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba'}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            m.status === 'received'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {m.status === 'received' ? 'Recibido en Destino' : 'En Ruta'}
                        </span>
                        {hasDiscrepancies && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                            {m.discrepancies?.length} Discrepancia(s)
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500">
                        <span>Móvil {m.mobileNumber} ({m.vehiclePlate})</span> • <span>Chofer: {m.driverName}</span> • <span>{m.totalShipments} guías ({m.totalPackages} bultos)</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Despachado: {dateStr} por {m.dispatchedByName}
                        {m.receivedByName && ` • Recibido por: ${m.receivedByName}`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => printDispatchManifestPdf(m)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-[#064e3b] hover:text-[#facc15] text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Manifiesto A4</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => printDispatchManifestTicket80mm(m)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-[#064e3b] hover:text-[#facc15] text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Ticket 80mm</span>
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* MODAL DE RECEPCIÓN BULTO A BULTO */}
      {selectedManifestForReception && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Recepción Física de Manifiesto en Destino</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Manifiesto: <strong className="text-slate-800">{selectedManifestForReception.manifestNumber}</strong> • Móvil {selectedManifestForReception.mobileNumber} • Chofer: {selectedManifestForReception.driverName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedManifestForReception(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide block">
                Verificación de Encomiendas Recibidas:
              </span>

              {selectedManifestForReception.shipmentSummaries?.map((s) => {
                const insp = receptionInspections[s.shipmentId] || {
                  receivedPackages: s.packageCount,
                  condition: 'good',
                  notes: '',
                }

                return (
                  <div key={s.shipmentId} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono text-xs font-bold text-[#064e3b] bg-white px-2 py-0.5 rounded border border-slate-200">
                          {s.trackingCode}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 ml-2">
                          Para: {s.recipientName} ({s.packageCount} bultos esperados)
                        </span>
                      </div>

                      <select
                        value={insp.condition}
                        onChange={(e) => {
                          const cond = e.target.value as any
                          setReceptionInspections((prev) => ({
                            ...prev,
                            [s.shipmentId]: {
                              ...insp,
                              condition: cond,
                              receivedPackages: cond === 'missing' ? 0 : insp.receivedPackages,
                            },
                          }))
                        }}
                        className={`text-xs font-bold px-2 py-1 rounded-lg border focus:outline-none cursor-pointer ${
                          insp.condition === 'good'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : insp.condition === 'damaged'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-red-100 text-red-800 border-red-300'
                        }`}
                      >
                        <option value="good">✓ Conforme / Buen Estado</option>
                        <option value="damaged">⚠ Dañado / Averiado</option>
                        <option value="missing">✕ Faltante / No Arribó</option>
                      </select>
                    </div>

                    {insp.condition !== 'good' && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={insp.notes}
                          onChange={(e) => {
                            const noteVal = e.target.value
                            setReceptionInspections((prev) => ({
                              ...prev,
                              [s.shipmentId]: { ...insp, notes: noteVal },
                            }))
                          }}
                          placeholder="Especifique el daño o detalle de la discrepancia..."
                          className="flex-1 text-xs p-1.5 border border-amber-300 bg-amber-50 rounded-lg focus:outline-none"
                          required
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Observaciones Generales */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Observaciones Generales de la Recepción
              </label>
              <textarea
                value={receptionGeneralNotes}
                onChange={(e) => setReceptionGeneralNotes(e.target.value)}
                placeholder="Ej. Carga descargada en ventanilla y cotejada con chofer conforme..."
                rows={2}
                className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>

            {/* Botones */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setSelectedManifestForReception(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 font-bold text-xs rounded-lg hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReception}
                disabled={loading}
                className="px-5 py-2 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-extrabold text-xs rounded-lg shadow transition disabled:opacity-50"
              >
                {loading ? 'Certificando Recepción...' : 'Confirmar Recepción Formal en Destino'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE REGISTRO DE VEHÍCULO */}
      {isVehicleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#064e3b]" />
                <span>Registrar Nuevo Móvil en la Flota</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsVehicleModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Número de Móvil Interno *</label>
                <input
                  type="text"
                  value={newMobileNumber}
                  onChange={(e) => setNewMobileNumber(e.target.value)}
                  placeholder="Ej. 08, 12, 24"
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Placa Oficial del Vehículo *</label>
                <input
                  type="text"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                  placeholder="Ej. 4589-KLP"
                  className="w-full p-2 border border-slate-300 rounded-lg font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Capacidad Máxima de Carga (kg)</label>
                <input
                  type="number"
                  value={newCapacityKg}
                  onChange={(e) => setNewCapacityKg(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Notas u Observaciones</label>
                <input
                  type="text"
                  value={newVehicleNotes}
                  onChange={(e) => setNewVehicleNotes(e.target.value)}
                  placeholder="Ej. Minibús Toyota HiAce blanco con parrilla"
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsVehicleModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 bg-[#064e3b] text-[#facc15] font-extrabold rounded-lg shadow disabled:opacity-50"
                >
                  {loading ? 'Guardando...' : 'Guardar Móvil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
