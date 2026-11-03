import React, { useState } from 'react'
import {
  Boxes,
  Package,
  Search,
  MapPin,
  Clock,
  AlertCircle,
  Move,
} from 'lucide-react'
import type { Shipment, Branch, UserProfile } from '../../types/index.ts'
import { assignShipmentStorageThroughBackend } from '../../services/dispatchService.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'

interface StorageManagementViewProps {
  currentUser: UserProfile
  currentBranch: Branch
  shipments: Shipment[]
}

const DEFAULT_SHELVES = [
  {
    id: 'ESTANTE-A',
    name: 'Estante A — Carga General y Paquetería',
    code: 'EST-A',
    description: 'Cajas medianas, repuestos y encomiendas estándar',
  },
  {
    id: 'ESTANTE-B',
    name: 'Estante B — Frágiles y Electrónica',
    code: 'EST-B',
    description: 'Televisores, celulares, computación y vidrio con etiqueta delicada',
  },
  {
    id: 'ESTANTE-C',
    name: 'Estante C — Bultos Grandes y Fardos',
    code: 'EST-C',
    description: 'Fardos de ropa, bultos pesados, sacos y bidones',
  },
]

export const StorageManagementView: React.FC<StorageManagementViewProps> = ({
  currentUser,
  currentBranch,
  shipments,
}) => {
  const [selectedShelfId, setSelectedShelfId] = useState<string>('ESTANTE-A')
  const [selectedModuleNum, setSelectedModuleNum] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [shipmentToAssign, setShipmentToAssign] = useState<Shipment | null>(null)

  const [targetShelfId, setTargetShelfId] = useState('ESTANTE-A')
  const [targetModuleNum, setTargetModuleNum] = useState<number>(1)
  const [targetPosition, setTargetPosition] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Encomiendas llegadas a esta sucursal que requieren almacenamiento o ya están guardadas
  const branchShipments = shipments.filter(
    (s) =>
      s.destinationBranchId === currentBranch.id &&
      (s.status === 'received_at_dest' || s.status === 'stored')
  )

  // Encomiendas sin ubicación física asignada
  const pendingStorage = branchShipments.filter(
    (s) => s.status === 'received_at_dest' || !s.storageLocation
  )

  // Encomiendas ya almacenadas
  const storedShipments = branchShipments.filter(
    (s) => s.status === 'stored' && s.storageLocation
  )

  // Conteo de paquetes por estante y módulo
  const getModuleCount = (shelfId: string, moduleNum: number) => {
    return storedShipments.filter(
      (s) =>
        s.storageLocation?.shelfId === shelfId &&
        s.storageLocation?.moduleNumber === moduleNum
    ).length
  }

  // Filtrado de encomiendas según búsqueda o módulo seleccionado
  const filteredShipments = storedShipments.filter((s) => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim()
      const matchCode = s.trackingCode.toLowerCase().includes(term)
      const matchRecipient = s.recipient.name.toLowerCase().includes(term) || s.recipient.phone.includes(term)
      const matchShelf = s.storageLocation?.shelfName?.toLowerCase().includes(term)
      return matchCode || matchRecipient || matchShelf
    }

    if (selectedShelfId && selectedModuleNum !== null) {
      return (
        s.storageLocation?.shelfId === selectedShelfId &&
        s.storageLocation?.moduleNumber === selectedModuleNum
      )
    }

    return s.storageLocation?.shelfId === selectedShelfId
  })

  // Verificar si un paquete lleva más de 3 días en almacén
  const isAgingPackage = (storedAt?: string) => {
    if (!storedAt) return false
    const diffHours = (Date.now() - new Date(storedAt).getTime()) / (1000 * 60 * 60)
    return diffHours > 72 // Más de 72 horas (3 días)
  }

  const openAssignModal = (shipment: Shipment) => {
    setShipmentToAssign(shipment)
    setTargetShelfId(shipment.storageLocation?.shelfId || 'ESTANTE-A')
    setTargetModuleNum(shipment.storageLocation?.moduleNumber || 1)
    setTargetPosition(shipment.storageLocation?.position || '')
    setIsAssignModalOpen(true)
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  const handleSaveStorageLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shipmentToAssign) return
    setErrorMsg(null)
    setSuccessMsg(null)

    const shelf = DEFAULT_SHELVES.find((s) => s.id === targetShelfId) || DEFAULT_SHELVES[0]

    try {
      setLoading(true)
      const res = await assignShipmentStorageThroughBackend({
        shipmentId: shipmentToAssign.id,
        shelfId: targetShelfId,
        shelfName: shelf.name,
        moduleId: `MOD-${targetModuleNum}`,
        moduleNumber: targetModuleNum,
        position: targetPosition,
      })

      setSuccessMsg(`Encomienda ${res.trackingCode} asignada físicamente a ${shelf.code} / M-${targetModuleNum}.`)
      setIsAssignModalOpen(false)
      setShipmentToAssign(null)
    } catch (err: any) {
      console.error('[handleSaveStorageLocation] Error:', err)
      setErrorMsg(err.message || 'Error al ubicar en almacén.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-[#064e3b]" />
            <h2 className="text-base font-extrabold text-slate-800">
              Almacén Físico y Módulos de Destino — {currentBranch.name}
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Organización por estantes y módulos numerados para entrega inmediata a destinatarios • Encargado: {currentUser.fullName}
          </p>
        </div>

        {/* Buscador de ubicación por guía */}
        <div className="relative min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por guía exacta (PUN-2026-...) o cliente..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
          />
        </div>
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-bold">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center justify-between">
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* Franja de Encomiendas Recién Llegadas Pendientes de Ubicación */}
      {pendingStorage.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700" />
              <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                Encomiendas recién llegadas sin ubicación en estante ({pendingStorage.length})
              </h3>
            </div>
            <span className="text-[11px] text-amber-800 font-semibold">
              Ubique los paquetes físicamente para localizarlos con rapidez en ventanilla
            </span>
          </div>

          <div data-tutorial-target="storage-reception-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {pendingStorage.map((s) => (
              <div
                key={s.id}
                className="bg-white p-3 rounded-lg border border-amber-200 flex items-center justify-between gap-2 shadow-sm"
              >
                <div>
                  <span className="font-mono text-xs font-extrabold text-[#064e3b] block">
                    {s.trackingCode}
                  </span>
                  <span className="text-[11px] text-slate-700 font-medium block truncate max-w-[170px]">
                    {s.recipient?.name} ({s.packageCount} bultos)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {s.items?.[0]?.description || 'Carga general'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => openAssignModal(s)}
                  className="px-2.5 py-1.5 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] text-[11px] font-bold rounded-lg shadow shrink-0 flex items-center gap-1 transition"
                >
                  <MapPin className="w-3 h-3" />
                  <span>Ubicar</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selector de Estantes y Mapa de Módulos (1 a 5) */}
      <div data-tutorial-target="storage-racks-grid" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {DEFAULT_SHELVES.map((shelf) => {
          const isSelected = selectedShelfId === shelf.id
          return (
            <div
              key={shelf.id}
              onClick={() => {
                setSelectedShelfId(shelf.id)
                setSelectedModuleNum(null)
              }}
              className={`bg-white rounded-xl border p-4 shadow-sm transition cursor-pointer space-y-3 ${
                isSelected ? 'border-[#064e3b] ring-2 ring-[#064e3b]/30' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div>
                  <span className="font-extrabold text-xs text-[#064e3b] uppercase tracking-wide block">
                    {shelf.name}
                  </span>
                  <p className="text-[10px] text-slate-400">{shelf.description}</p>
                </div>
              </div>

              {/* Los 5 Módulos Numerados */}
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((num) => {
                  const count = getModuleCount(shelf.id, num)
                  const isModSelected = isSelected && selectedModuleNum === num
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedShelfId(shelf.id)
                        setSelectedModuleNum(num)
                      }}
                      className={`p-2 rounded-lg border text-center transition ${
                        isModSelected
                          ? 'bg-[#064e3b] text-[#facc15] border-[#064e3b] font-bold shadow'
                          : count > 0
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold hover:bg-emerald-100'
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <span className="block text-[9px] uppercase font-mono">M-{num}</span>
                      <span className="block text-xs font-bold">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Listado de Encomiendas en el Módulo Seleccionado */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Encomiendas en Almacén ({filteredShipments.length})
            </span>
            {selectedModuleNum !== null && (
              <span className="text-[10px] bg-[#064e3b] text-[#facc15] font-bold px-2 py-0.5 rounded-full">
                Módulo M-{selectedModuleNum}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {DEFAULT_SHELVES.find((s) => s.id === selectedShelfId)?.code}
          </span>
        </div>

        {filteredShipments.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Package className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs font-bold text-slate-600">No hay encomiendas almacenadas en esta ubicación.</p>
            <p className="text-[11px] text-slate-400">Seleccione otro módulo o utilice el buscador.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredShipments.map((s) => {
              const isOld = isAgingPackage(s.storageLocation?.storedAt)
              const isCod = s.paymentTiming === 'destination_cod' && s.paymentStatus !== 'paid'

              return (
                <div
                  key={s.id}
                  className="p-4 hover:bg-slate-50 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-[#064e3b] bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                        {s.trackingCode}
                      </span>
                      <span className="text-xs font-bold text-slate-800">
                        {s.recipient?.name} ({s.recipient?.phone})
                      </span>
                      {isOld && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Antigua (&gt; 3 días)</span>
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-500">
                      <span>{s.packageCount} bulto(s)</span> • <span>{s.totalWeightKg || 0} kg</span> • Remitente: <span>{s.sender?.name}</span>
                    </div>

                    <div className="inline-flex items-center gap-1.5 text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-mono">
                      <MapPin className="w-3 h-3 text-[#064e3b]" />
                      <strong>{s.storageLocation?.shelfName || s.storageLocation?.shelfId}</strong> ➔ Módulo {s.storageLocation?.moduleNumber}
                      {s.storageLocation?.position && <span>({s.storageLocation.position})</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
                    <div className="text-right">
                      <span className="font-mono font-extrabold text-xs text-slate-800 block">
                        {formatCurrencyBob(s.finalAmountCents, true)}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                          isCod ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {isCod ? 'Cobrar en Entrega' : 'Pagado'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => openAssignModal(s)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-[#064e3b] hover:text-[#facc15] text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 transition"
                      title="Mover de módulo o reubicar"
                    >
                      <Move className="w-3.5 h-3.5" />
                      <span>Reubicar</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* MODAL PARA UBICAR / REUBICAR EN ALMACÉN */}
      {isAssignModalOpen && shipmentToAssign && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#064e3b]" />
                  <span>Ubicación Física en Almacén</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Guía: <strong className="text-slate-800 font-mono">{shipmentToAssign.trackingCode}</strong> • {shipmentToAssign.recipient?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveStorageLocation} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Estante de Almacenamiento *</label>
                <select
                  value={targetShelfId}
                  onChange={(e) => setTargetShelfId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white"
                >
                  {DEFAULT_SHELVES.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Módulo del Estante (1 al 5) *</label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((mNum) => (
                    <button
                      key={mNum}
                      type="button"
                      onClick={() => setTargetModuleNum(mNum)}
                      className={`p-2.5 rounded-lg border text-center font-bold text-xs transition ${
                        targetModuleNum === mNum
                          ? 'bg-[#064e3b] text-[#facc15] border-[#064e3b]'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      M-{mNum}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Posición o Referencia (Opcional)</label>
                <input
                  type="text"
                  value={targetPosition}
                  onChange={(e) => setTargetPosition(e.target.value)}
                  placeholder="Ej. Fila superior, al fondo, caja etiquetada..."
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 font-bold rounded-lg hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 bg-[#064e3b] text-[#facc15] font-extrabold rounded-lg shadow disabled:opacity-50"
                >
                  {loading ? 'Guardando...' : 'Asignar Ubicación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
