import React, { useEffect, useState } from 'react'
import {
  Boxes,
  Package,
  Search,
  MapPin,
  Clock,
  AlertCircle,
  Move,
  Camera,
} from 'lucide-react'
import type { Shipment, Branch, UserProfile } from '../../types/index.ts'
import { assignShipmentStorageThroughBackend, getShipmentStoragePhotoUrl, uploadShipmentStoragePhoto, manageShelfThroughBackend } from '../../services/dispatchService.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { printShipmentStorageLabelPdf } from '../../services/pdfService.ts'

interface StorageManagementViewProps {
  currentUser: UserProfile
  currentBranch: Branch
  shipments: Shipment[]
}

const LEGACY_SHELVES = [
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
void LEGACY_SHELVES

const PHYSICAL_MODULES = Array.from({ length: 5 }, (_, index) => {
  const moduleNumber = index + 1
  return {
    id: `MODULO-${moduleNumber}`,
    name: `Módulo ${moduleNumber}`,
    code: `MOD-${moduleNumber}`,
    description: 'Estantería del Almacén 1; configure pisos y espacios según la distribución real.',
  }
})

type ModuleConfiguration = {
  floorCount?: number
  rowCountPerFloor?: number
  spaceCountPerFloor?: number
  capacityPerSpace?: number
}

export const StorageManagementView: React.FC<StorageManagementViewProps> = ({
  currentUser,
  currentBranch,
  shipments,
}) => {
  const [selectedShelfId, setSelectedShelfId] = useState<string>('MODULO-1')
  const [selectedModuleNum, setSelectedModuleNum] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [shipmentToAssign, setShipmentToAssign] = useState<Shipment | null>(null)

  const [targetShelfId, setTargetShelfId] = useState('MODULO-1')
  const [targetModuleNum, setTargetModuleNum] = useState<number>(1)
  const [targetWarehouseId, setTargetWarehouseId] = useState('ALMACEN-1')
  const [targetRowNumber, setTargetRowNumber] = useState<number>(1)
  const [targetFloorNumber, setTargetFloorNumber] = useState<number>(1)
  const [targetSpaceNumber, setTargetSpaceNumber] = useState<number>(1)
  const [targetPosition, setTargetPosition] = useState('')
  const [storagePhoto, setStoragePhoto] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [configFloorCount, setConfigFloorCount] = useState<number | ''>('')
  const [configRowCount, setConfigRowCount] = useState<number | ''>('')
  const [configSpaceCount, setConfigSpaceCount] = useState<number | ''>('')
  const [configSaving, setConfigSaving] = useState(false)
  const [moduleConfigurations, setModuleConfigurations] = useState<Record<string, ModuleConfiguration>>({})
  const canConfigureModules = currentUser.role === 'encargado_agencia' || currentUser.role === 'directiva_admin'

  useEffect(() => {
    let cancelled = false
    manageShelfThroughBackend({ action: 'list', branchId: currentBranch.id })
      .then((result) => {
        if (cancelled) return
        const next: Record<string, ModuleConfiguration> = {}
        for (const shelf of result.shelves || []) {
          if (shelf.id?.startsWith('MODULO-')) {
            next[shelf.id] = {
              floorCount: shelf.floorCount,
              rowCountPerFloor: shelf.rowCountPerFloor,
              spaceCountPerFloor: shelf.spaceCountPerFloor,
              capacityPerSpace: shelf.capacityPerSpace || 1,
            }
          }
        }
        setModuleConfigurations(next)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [currentBranch.id])

  useEffect(() => {
    const configuration = moduleConfigurations[selectedShelfId]
    setConfigFloorCount(configuration?.floorCount ?? '')
    setConfigRowCount(configuration?.rowCountPerFloor ?? '')
    setConfigSpaceCount(configuration?.spaceCountPerFloor ?? '')
  }, [moduleConfigurations, selectedShelfId])

  const saveModuleConfiguration = async () => {
    if (!canConfigureModules) {
      setErrorMsg(`Tu rol '${currentUser.role}' puede consultar y ubicar encomiendas, pero no modificar la estructura. Se requiere encargado_agencia o directiva_admin.`)
      return
    }
    if (!configFloorCount || !configRowCount || !configSpaceCount) {
      setErrorMsg('Indique la cantidad real de pisos, filas/repisas y espacios antes de guardar.')
      return
    }
    try {
      setConfigSaving(true)
      await manageShelfThroughBackend({
        action: 'create_or_update',
        branchId: currentBranch.id,
        shelfData: {
          id: selectedShelfId,
          name: PHYSICAL_MODULES.find((module) => module.id === selectedShelfId)?.name || selectedShelfId,
          code: selectedShelfId.replace('MODULO-', 'MOD-'),
          moduleCount: 1,
          floorCount: Number(configFloorCount),
          rowCountPerFloor: Number(configRowCount),
          spaceCountPerFloor: Number(configSpaceCount),
          capacityPerSpace: 1,
          physicalWarehouseId: 'ALMACEN-1',
          physicalWarehouseName: 'Almacén 1',
        },
      })
      setModuleConfigurations((current) => ({
        ...current,
        [selectedShelfId]: {
          floorCount: Number(configFloorCount),
          rowCountPerFloor: Number(configRowCount),
          spaceCountPerFloor: Number(configSpaceCount),
          capacityPerSpace: 1,
        },
      }))
      setSuccessMsg(`${selectedShelfId} configurado: ${configFloorCount} pisos y ${configSpaceCount} espacios por piso.`)
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo guardar la configuración física.')
    } finally {
      setConfigSaving(false)
    }
  }

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

  const handleQuickLocate = () => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) {
      setErrorMsg('Ingrese el número de guía para ubicar una encomienda.')
      return
    }
    const shipment = branchShipments.find((s) =>
      s.trackingCode.toLowerCase() === term || s.trackingCode.toLowerCase().replace(/-/g, '') === term.replace(/-/g, '')
    )
    if (!shipment) {
      setErrorMsg(`No se encontró una encomienda con la guía ${searchTerm.trim()} en esta sucursal.`)
      return
    }
    openAssignModal(shipment)
  }

  useEffect(() => {
    let cancelled = false
    storedShipments.forEach((shipment) => {
      const path = shipment.storagePhoto?.storagePath
      if (path && !photoUrls[shipment.id]) {
        getShipmentStoragePhotoUrl(path).then((url) => {
          if (!cancelled) setPhotoUrls((current) => ({ ...current, [shipment.id]: url }))
        }).catch(() => undefined)
      }
    })
    return () => { cancelled = true }
  }, [storedShipments, photoUrls])

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
    setTargetShelfId(shipment.storageLocation?.shelfId || 'MODULO-1')
    setTargetModuleNum(shipment.storageLocation?.moduleNumber || 1)
    setTargetWarehouseId(shipment.storageLocation?.warehouseId || 'ALMACEN-1')
    setTargetRowNumber(shipment.storageLocation?.rowNumber || 1)
    setTargetFloorNumber(shipment.storageLocation?.floorNumber || 1)
    setTargetSpaceNumber(shipment.storageLocation?.spaceNumber || 1)
    setTargetPosition(shipment.storageLocation?.position || '')
    setStoragePhoto(null)
    setPhotoPreviewUrl(null)
    setIsAssignModalOpen(true)
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  const handleSaveStorageLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shipmentToAssign) return
    setErrorMsg(null)
    setSuccessMsg(null)

    const shelf = PHYSICAL_MODULES.find((s) => s.id === targetShelfId) || PHYSICAL_MODULES[0]

    try {
      setLoading(true)
      let photo = undefined
      if (storagePhoto) {
        photo = {
          ...(await uploadShipmentStoragePhoto(shipmentToAssign.id, storagePhoto)),
          capturedAtIso: new Date().toISOString(),
        }
      }
      const res = await assignShipmentStorageThroughBackend({
        shipmentId: shipmentToAssign.id,
        warehouseId: targetWarehouseId,
        warehouseName: 'Almacén 1',
        shelfId: targetShelfId,
        shelfName: shelf.name,
        moduleId: `MOD-${targetModuleNum}`,
        moduleNumber: targetModuleNum,
        rowNumber: targetRowNumber,
        floorNumber: targetFloorNumber,
        spaceNumber: targetSpaceNumber,
        position: targetPosition,
        photo,
      })

      setSuccessMsg(`Encomienda ${res.trackingCode} asignada físicamente a ${shelf.code} / M-${targetModuleNum}.`)
      setIsAssignModalOpen(false)
      setShipmentToAssign(null)
      setStoragePhoto(null)
      setPhotoPreviewUrl(null)
    } catch (err: any) {
      console.error('[handleSaveStorageLocation] Error:', err)
      setErrorMsg(err.message || 'Error al ubicar en almacén.')
    } finally {
      setLoading(false)
    }
  }

  const handlePhotoSelected = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Seleccione una imagen válida.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('La fotografía no puede superar 2 MB.')
      return
    }
    setStoragePhoto(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
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
        <button
          type="button"
          onClick={handleQuickLocate}
          className="w-full sm:w-auto px-4 py-2 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] text-xs font-extrabold rounded-lg shadow-sm flex items-center justify-center gap-2"
          title="Buscar una guía y abrir directamente el formulario de ubicación"
        >
          <MapPin className="w-4 h-4" />
          Ubicar encomienda
        </button>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h3 className="text-xs font-extrabold text-slate-800">Configuración física — Almacén 1</h3>
          <p className="text-[11px] text-slate-500">Configure cada módulo con la distribución real. No se crean pisos ni espacios automáticamente.</p>
        </div>
        {!canConfigureModules && <p className="w-full text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">Edición restringida para tu rol ({currentUser.role}). Solicita a un encargado o a Directiva que configure los pisos y espacios.</p>}
        <label className="text-xs font-bold text-slate-700">Módulo
          <select value={selectedShelfId} onChange={(e) => setSelectedShelfId(e.target.value)} className="block mt-1 p-2 border border-slate-300 rounded-lg bg-white">
            {PHYSICAL_MODULES.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">Pisos
          <input type="number" min="1" value={configFloorCount} disabled={!canConfigureModules} onChange={(e) => setConfigFloorCount(e.target.value ? Number(e.target.value) : '')} className="block mt-1 w-20 p-2 border border-slate-300 rounded-lg disabled:bg-slate-100" />
        </label>
        <label className="text-xs font-bold text-slate-700">Espacios por piso
          <input type="number" min="1" value={configSpaceCount} disabled={!canConfigureModules} onChange={(e) => setConfigSpaceCount(e.target.value ? Number(e.target.value) : '')} className="block mt-1 w-24 p-2 border border-slate-300 rounded-lg disabled:bg-slate-100" />
        </label>
        <label className="text-xs font-bold text-slate-700">Filas/repisas por piso
          <input type="number" min="1" value={configRowCount} disabled={!canConfigureModules} onChange={(e) => setConfigRowCount(e.target.value ? Number(e.target.value) : '')} className="block mt-1 w-24 p-2 border border-slate-300 rounded-lg disabled:bg-slate-100" />
        </label>
        <button type="button" onClick={saveModuleConfiguration} disabled={configSaving || !canConfigureModules} className="px-3 py-2 bg-[#064e3b] text-[#facc15] text-xs font-bold rounded-lg disabled:opacity-50">
          {configSaving ? 'Guardando...' : 'Guardar configuración'}
        </button>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PHYSICAL_MODULES.map((shelf) => {
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
                {[Number(shelf.id.replace('MODULO-', '')) || 1].map((num) => {
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
      {selectedModuleNum !== null && (() => {
        const moduleId = `MODULO-${selectedModuleNum}`
        const configuration = moduleConfigurations[moduleId]
        const configured = Number.isInteger(configuration?.floorCount) && Number.isInteger(configuration?.spaceCountPerFloor)
        return <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-extrabold text-slate-800">Módulo {selectedModuleNum}: pisos y espacios</h3>
            <span className="text-[11px] text-slate-500">{getModuleCount(moduleId, selectedModuleNum)} encomienda(s)</span>
          </div>
          {!configured ? <p className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-center">Pendiente de configurar</p> : <div className="space-y-3">
            {Array.from({ length: configuration.floorCount as number }, (_, floorIndex) => <div key={floorIndex + 1}>
              <div className="text-[11px] font-bold text-slate-700 mb-1">Piso {floorIndex + 1}</div>
              {Array.from({ length: configuration.rowCountPerFloor || 1 }, (_, rowIndex) => <div key={rowIndex + 1} className="mb-2">
                <div className="text-[10px] font-semibold text-slate-500 mb-1">Fila/repisa {rowIndex + 1}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-1.5">
                  {Array.from({ length: configuration.spaceCountPerFloor as number }, (_, spaceIndex) => {
                    const floor = floorIndex + 1
                    const row = rowIndex + 1
                    const space = spaceIndex + 1
                    const shipment = storedShipments.find((item) => item.storageLocation?.shelfId === moduleId && item.storageLocation?.moduleNumber === selectedModuleNum && item.storageLocation?.floorNumber === floor && (item.storageLocation?.rowNumber || 1) === row && item.storageLocation?.spaceNumber === space)
                    return <div key={space} className={`rounded-lg border p-2 text-center text-[10px] ${shipment ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`} title={shipment ? shipment.trackingCode : 'Espacio libre'}><span className="block font-bold">Espacio {space}</span><span className="block font-mono">{shipment ? shipment.trackingCode : 'Libre'}</span></div>
                  })}
                </div>
              </div>)}
            </div>)}
          </div>}
        </div>
      })()}

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
            {PHYSICAL_MODULES.find((s) => s.id === selectedShelfId)?.code}
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
                      <span>{s.storageLocation?.warehouseName || s.storageLocation?.warehouseId || 'Almacén 1'}</span> /
                      <strong>{s.storageLocation?.shelfName || s.storageLocation?.shelfId}</strong> ➔ Módulo {s.storageLocation?.moduleNumber}
                      {s.storageLocation?.position && <span>({s.storageLocation.position})</span>}
                      {s.storageLocation?.rowNumber && <span> / Fila {s.storageLocation.rowNumber}</span>}
                      {s.storageLocation?.floorNumber && <span> / Piso {s.storageLocation.floorNumber}</span>}
                      {s.storageLocation?.spaceNumber && <span> / Espacio {s.storageLocation.spaceNumber}</span>}
                    </div>
                    {photoUrls[s.id] && <img src={photoUrls[s.id]} alt={`Evidencia ${s.trackingCode}`} className="mt-2 h-16 w-16 rounded-lg object-cover border border-slate-200" />}
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
                    <button
                      type="button"
                      onClick={() => printShipmentStorageLabelPdf(s)}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg"
                      title="Imprimir etiqueta interna con ubicación actual"
                    >
                      Imprimir ubicación
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
                <label className="block font-bold text-slate-700 mb-1">Almacén / zona *</label>
                <select value={targetWarehouseId} onChange={(e) => setTargetWarehouseId(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white">
                  <option value="ALMACEN-1">Almacén 1</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Estante de Almacenamiento *</label>
                <select
                  value={targetShelfId}
                  onChange={(e) => setTargetShelfId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white"
                >
                  {PHYSICAL_MODULES.map((sh) => (
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
                      onClick={() => {
                        setTargetModuleNum(mNum)
                        setTargetShelfId(`MODULO-${mNum}`)
                      }}
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

              <div className="grid grid-cols-3 gap-2">
                <label className="font-bold text-slate-700">Fila
                  <input type="number" min="1" value={targetRowNumber} onChange={(e) => setTargetRowNumber(Number(e.target.value))} className="mt-1 w-full p-2 border border-slate-300 rounded-lg" required />
                </label>
                <label className="font-bold text-slate-700">Piso
                  <input type="number" min="1" value={targetFloorNumber} onChange={(e) => setTargetFloorNumber(Number(e.target.value))} className="mt-1 w-full p-2 border border-slate-300 rounded-lg" required />
                </label>
                <label className="font-bold text-slate-700">Espacio
                  <input type="number" min="1" value={targetSpaceNumber} onChange={(e) => setTargetSpaceNumber(Number(e.target.value))} className="mt-1 w-full p-2 border border-slate-300 rounded-lg" required />
                </label>
              </div>

              <div className="rounded-lg border border-dashed border-slate-300 p-3">
                <label className="flex items-center gap-2 font-bold text-slate-700 mb-2"><Camera className="w-4 h-4 text-[#064e3b]" /> Fotografía de evidencia (opcional)</label>
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => handlePhotoSelected(e.target.files?.[0])} className="w-full text-xs" />
                <p className="mt-1 text-[10px] text-slate-500">JPG, PNG o WebP, máximo 2 MB. Se guarda en Firebase Storage.</p>
                {photoPreviewUrl && <img src={photoPreviewUrl} alt="Vista previa de la encomienda" className="mt-2 h-24 w-24 rounded-lg object-cover border border-slate-200" />}
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
