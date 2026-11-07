import React, { useState, useMemo, useEffect } from 'react'
import {
  Package,
  Plus,
  ShieldCheck,
  Search,
  Clock,
  Truck,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
} from 'lucide-react'
import type { Shipment, UserProfile, Branch } from '../../types'
import { formatCurrencyBob } from '../../domain/parcelEngine'
import { ShipmentDetailModal } from './ShipmentDetailModal'
import { searchShipmentsServer, fetchShipmentsPage } from '../../services/shipmentService'
import { elapsedFullDays, receptionDate } from '../../utils/shipmentTiming'

interface ShipmentsManagementViewProps {
  shipments: Shipment[]
  currentUser: UserProfile
  currentBranch: Branch
  onOpenNewWizard: () => void
  onOpenDeliveryModal: (targetShipment?: Shipment) => void
  onShipmentUpdated?: (updated: Shipment) => void
  backendConnected: boolean
  isCloudEnvironment: boolean
}

export const ShipmentsManagementView: React.FC<ShipmentsManagementViewProps> = ({
  shipments,
  currentUser,
  currentBranch,
  onOpenNewWizard,
  onOpenDeliveryModal,
  onShipmentUpdated,
  backendConnected,
  isCloudEnvironment,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Estado para la ficha de detalle de encomienda
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  // Búsqueda del lado del servidor para registros fuera de ventana
  const [serverResults, setServerResults] = useState<Shipment[]>([])
  const [isSearchingServer, setIsSearchingServer] = useState(false)

  // Paginación continua del servidor para registros históricos antiguos
  const [historicalShipments, setHistoricalShipments] = useState<Shipment[]>([])
  const [lastVisibleDoc, setLastVisibleDoc] = useState<any | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  const handleLoadMoreHistory = async () => {
    if (isLoadingHistory || !hasMoreHistory) return
    setIsLoadingHistory(true)
    try {
      const res = await fetchShipmentsPage({
        branchId: currentBranch.id,
        pageSize: 30,
        lastVisibleDoc,
      })
      if (res.shipments.length > 0) {
        setHistoricalShipments(prev => [...prev, ...res.shipments])
        setLastVisibleDoc(res.lastDoc)
      }
      setHasMoreHistory(res.hasMore)
    } catch (err) {
      console.warn('Error al cargar historial del servidor:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  useEffect(() => {
    const term = searchTerm.trim()
    if (term.length < 4) {
      setServerResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearchingServer(true)
      try {
        const results = await searchShipmentsServer(term, currentBranch.id)
        setServerResults(results)
      } catch (err) {
        console.warn('Error en búsqueda de servidor:', err)
      } finally {
        setIsSearchingServer(false)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [searchTerm, currentBranch.id])

  const combinedShipments = useMemo(() => {
    const map = new Map<string, Shipment>()
    for (const s of shipments) {
      map.set(s.id, s)
    }
    for (const s of historicalShipments) {
      if (!map.has(s.id)) {
        map.set(s.id, s)
      }
    }
    for (const s of serverResults) {
      if (!map.has(s.id)) {
        map.set(s.id, s)
      }
    }
    const list = Array.from(map.values())
    list.sort((a, b) => {
      const timeA = a.createdAtIso ? new Date(a.createdAtIso).getTime() : 0
      const timeB = b.createdAtIso ? new Date(b.createdAtIso).getTime() : 0
      return timeB - timeA
    })
    return list
  }, [shipments, historicalShipments, serverResults])



  // 1. Cálculos del Resumen Diario de Operación
  const dailySummary = useMemo(() => {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())
    let registeredToday = 0
    let pendingDispatch = 0
    let inTransit = 0
    let toDeliver = 0

    for (const s of shipments) {
      const sDate = s.createdAtIso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date(s.createdAtIso)) : ''
      if (sDate === todayStr) {
        registeredToday++
      }

      if (s.status === 'received' || s.status === 'pending_dispatch') {
        pendingDispatch++
      } else if (s.status === 'dispatched' || s.status === 'in_transit') {
        inTransit++
      } else if (['received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery'].includes(s.status)) {
        if (s.destinationBranchId === currentBranch.id) {
          toDeliver++
        }
      }
    }

    return { registeredToday, pendingDispatch, inTransit, toDeliver }
  }, [shipments, currentBranch.id])

  // 2. Filtrado reactivo de encomiendas (locales + servidor)
  const filteredShipments = useMemo(() => {
    return combinedShipments.filter(s => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (paymentFilter !== 'all' && s.paymentStatus !== paymentFilter) return false

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim()
        const cleanTerm = term.replace(/-/g, '')
        const cleanTracking = (s.trackingCode || '').toLowerCase().replace(/-/g, '')

        const matchCode = cleanTracking.includes(cleanTerm) || s.trackingCode?.toLowerCase().includes(term)
        const matchSender = s.sender?.name?.toLowerCase().includes(term) || s.sender?.phone?.includes(term)
        const matchRecipient = s.recipient?.name?.toLowerCase().includes(term) || s.recipient?.phone?.includes(term)

        if (!matchCode && !matchSender && !matchRecipient) return false
      }

      return true
    })
  }, [combinedShipments, statusFilter, paymentFilter, searchTerm])

  // 3. Paginación
  const totalPages = Math.max(1, Math.ceil(filteredShipments.length / pageSize))
  const paginatedShipments = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredShipments.slice(start, start + pageSize)
  }, [filteredShipments, currentPage, pageSize])

  const handleRowClick = (shipment: Shipment) => {
    setSelectedShipment(shipment)
    setIsDetailOpen(true)
  }

  return (
    <div className="space-y-5">
      {/* ========================================================================= */}
      {/* LAYOUT PRINCIPAL DE DOS COLUMNAS (50% / 50% en escritorio)                */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ======================================================================= */}
        {/* COLUMNA IZQUIERDA: OPERACIONES DE VENTANILLA (~50%)                    */}
        {/* ======================================================================= */}
        <div className="lg:col-span-6 space-y-4">
          
          {/* Tarjeta de Encabezado de Ventanilla */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
                  Gestión de Encomiendas
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Atención de ventanilla en <strong className="text-[#064e3b]">{currentBranch.name}</strong> • Servicio Oficial Expreso Punata
                </p>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                  backendConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${backendConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {isCloudEnvironment ? 'Cloud Conectado' : 'Modo Operativo'}
                </span>
              </div>
            </div>

            {/* BOTÓN GIGANTE PRINCIPAL: NUEVA ENCOMIENDA */}
            <button
              type="button"
              onClick={onOpenNewWizard}
              data-tutorial-target="btn-new-shipment"
              className="w-full py-4 px-6 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-black text-base sm:text-lg rounded-2xl shadow-lg hover:shadow-xl border-2 border-emerald-950 flex items-center justify-center gap-3 transition-all transform active:scale-[0.99] cursor-pointer mb-3"
            >
              <div className="w-8 h-8 rounded-full bg-[#facc15] text-[#064e3b] flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5 stroke-[3]" />
              </div>
              <span className="tracking-wide uppercase">+ NUEVA ENCOMIENDA</span>
            </button>

            {/* SEGUNDO BOTÓN GRANDE: ENTREGAR ENCOMIENDA */}
            <button
              type="button"
              onClick={() => onOpenDeliveryModal()}
              data-tutorial-target="btn-deliver-shipment"
              className="w-full py-3.5 px-5 bg-emerald-900 hover:bg-emerald-950 text-white font-bold text-sm sm:text-base rounded-xl shadow border border-emerald-700 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5 text-[#facc15]" />
              <span>ENTREGAR ENCOMIENDA (FIRMA & COD)</span>
            </button>
          </div>

          {/* Tarjeta de Búsqueda Rápida de Encomienda */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Búsqueda Rápida de Guía
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                data-tutorial-target="shipment-search-input"
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value)
                  setCurrentPage(1)
                }}
                placeholder="Ingrese guía (ej. PUN202600001, PUN-2026-...) o teléfono..."
                className="w-full pl-10 pr-12 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-slate-50 focus:bg-white transition"
              />
              <div className="absolute right-3 top-2.5 flex items-center gap-1.5">
                {isSearchingServer && (
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                )}
                {searchTerm && !isSearchingServer && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              * Acepta códigos alfanuméricos limpios (<code className="font-mono text-emerald-800">PUN202600042</code>) y guías anteriores con guión.
            </p>
          </div>

          {/* Tarjetas de Resumen de Operación del Día (4 KPIs Claros) */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Operación del Día ({currentBranch.code})
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* 1. Registrados Hoy */}
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
                <div className="flex items-center gap-1.5 text-emerald-800 mb-1">
                  <Package className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase">Hoy</span>
                </div>
                <div className="text-xl font-black text-[#064e3b] font-mono">
                  {dailySummary.registeredToday}
                </div>
                <span className="text-[10px] text-slate-500">Registrados</span>
              </div>

              {/* 2. Pendientes Despacho */}
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl">
                <div className="flex items-center gap-1.5 text-amber-800 mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase">Espera</span>
                </div>
                <div className="text-xl font-black text-amber-900 font-mono">
                  {dailySummary.pendingDispatch}
                </div>
                <span className="text-[10px] text-slate-500">Pend. Despacho</span>
              </div>

              {/* 3. En Tránsito */}
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl">
                <div className="flex items-center gap-1.5 text-blue-800 mb-1">
                  <Truck className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase">Ruta</span>
                </div>
                <div className="text-xl font-black text-blue-900 font-mono">
                  {dailySummary.inTransit}
                </div>
                <span className="text-[10px] text-slate-500">En Tránsito</span>
              </div>

              {/* 4. Por Entregar en Destino */}
              <div className="bg-purple-50 border border-purple-200 p-3 rounded-xl">
                <div className="flex items-center gap-1.5 text-purple-800 mb-1">
                  <Boxes className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase">Almacén</span>
                </div>
                <div className="text-xl font-black text-purple-900 font-mono">
                  {dailySummary.toDeliver}
                </div>
                <span className="text-[10px] text-slate-500">Por Entregar</span>
              </div>
            </div>
          </div>
        </div>

        {/* ======================================================================= */}
        {/* COLUMNA DERECHA: ENVÍOS REGISTRADOS (~50%)                              */}
        {/* ======================================================================= */}
        <div className="lg:col-span-6 space-y-3">
          
          {/* Barra de Filtros de la Tabla */}
          <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Envíos ({filteredShipments.length})
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Sucursal: {currentBranch.code}
              </span>
            </div>

            {/* Filtros desplegables compactos */}
            <div className="flex items-center gap-2 text-xs">
              <select
                value={statusFilter}
                onChange={e => {
                  setStatusFilter(e.target.value)
                  setCurrentPage(1)
                }}
                className="bg-slate-50 border border-slate-300 text-slate-700 py-1.5 px-2 rounded-lg font-semibold text-[11px] focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              >
                <option value="all">Todos los estados</option>
                <option value="received">Ventanilla (Recibido)</option>
                <option value="pending_dispatch">Pendiente Despacho</option>
                <option value="dispatched">Despachado</option>
                <option value="in_transit">En Tránsito</option>
                <option value="received_at_dest">Llegado a Destino</option>
                <option value="stored">En Almacén</option>
                <option value="delivered">Entregado</option>
                <option value="uncollected">No recogida</option>
              </select>

              <select
                value={paymentFilter}
                onChange={e => {
                  setPaymentFilter(e.target.value)
                  setCurrentPage(1)
                }}
                className="bg-slate-50 border border-slate-300 text-slate-700 py-1.5 px-2 rounded-lg font-semibold text-[11px] focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
              >
                <option value="all">Todo pago</option>
                <option value="paid">Pagados</option>
                <option value="pending">Por Cobrar (COD)</option>
              </select>
            </div>
          </div>

          {/* Tabla Compacta y Profesional */}
          <div data-tutorial-target="shipments-table-row" className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {paginatedShipments.length === 0 ? (
              shipments.length === 0 && !searchTerm && statusFilter === 'all' && paymentFilter === 'all' ? (
                <div className="p-10 text-center space-y-3">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto text-emerald-700">
                    <Package className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">
                    Actualmente no hay encomiendas registradas.
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    La ventanilla está lista para emitir la primera guía oficial con tarifa base o precio acordado.
                  </p>
                  <button
                    onClick={onOpenNewWizard}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#064e3b] hover:bg-[#053d2e] text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-[#facc15]" />
                    <span>Registrar primera encomienda</span>
                  </button>
                </div>
              ) : (
                <div className="p-8 text-center space-y-2">
                  <Package className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">
                    No se encontraron encomiendas con los filtros activos.
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Pruebe limpiando el texto de búsqueda o cambiando el estado.
                  </p>
                </div>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[10px] uppercase font-bold tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Guía</th>
                      <th className="py-2.5 px-2">Fecha/Hora</th>
                      <th className="py-2.5 px-2">Remitente / Destinatario</th>
                      <th className="py-2.5 px-2">Ruta</th>
                      <th className="py-2.5 px-2 text-right">Precio</th>
                      <th className="py-2.5 px-2 text-center">Estado</th>
                      <th className="py-2.5 px-3 text-center">Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedShipments.map(s => {
                      const isPaid = s.paymentStatus === 'paid'
                      const dateShort = s.createdAtIso
                        ? new Date(s.createdAtIso).toLocaleDateString('es-BO', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'

                      return (
                        <tr
                          key={s.id}
                          onClick={() => handleRowClick(s)}
                          className="hover:bg-emerald-50/70 transition-colors cursor-pointer group"
                          title="Haga clic para ver la ficha completa de la encomienda"
                        >
                          {/* Guía */}
                          <td className="py-2.5 px-3">
                            <span className="font-mono font-bold text-slate-900 group-hover:text-[#064e3b] text-xs">
                              {s.trackingCode}
                            </span>
                          </td>

                          {/* Fecha */}
                          <td className="py-2.5 px-2 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            <div>{dateShort}</div>
                            {(() => {
                              const days = elapsedFullDays(receptionDate(s as any))
                              return days === null ? null : <div className="text-[10px] text-amber-700">{days} d desde recepción</div>
                            })()}
                          </td>

                          {/* Personas */}
                          <td className="py-2.5 px-2 max-w-[130px] truncate">
                            <div className="font-semibold text-slate-800 truncate" title={s.recipient.name}>
                              {s.recipient.name}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate" title={`De: ${s.sender.name}`}>
                              De: {s.sender.name}
                            </div>
                          </td>

                          {/* Destino */}
                          <td className="py-2.5 px-2 text-slate-700 font-medium whitespace-nowrap">
                            {s.destinationCity === 'Punata' ? 'PUN' : 'CBB'}
                          </td>

                          {/* Precio */}
                          <td className="py-2.5 px-2 text-right font-mono font-bold text-[#064e3b] whitespace-nowrap">
                            {formatCurrencyBob(s.finalAmountCents, true)}
                          </td>

                          {/* Estado */}
                          <td className="py-2.5 px-2 text-center whitespace-nowrap">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              s.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' :
                              s.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                              s.status === 'stored' ? 'bg-purple-100 text-purple-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {s.status === 'received' ? 'Recibido' :
                               s.status === 'dispatched' ? 'Despacho' :
                               s.status === 'in_transit' ? 'Tránsito' :
                               s.status === 'stored' ? 'Almacén' :
                               s.status === 'delivered' ? 'Entregado' : s.status}
                            </span>
                          </td>

                          {/* Pago */}
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                              isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}>
                              {isPaid ? 'PAGADO' : 'COD'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginación */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span>
                  Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> ({filteredShipments.length} en vista)
                </span>
                {hasMoreHistory && (
                  <button
                    type="button"
                    onClick={handleLoadMoreHistory}
                    disabled={isLoadingHistory}
                    className="ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-[11px] font-bold text-[#064e3b] shadow-xs transition"
                    title="Consultar encomiendas más antiguas directamente en el servidor Cloud"
                  >
                    {isLoadingHistory ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>{isLoadingHistory ? 'Cargando más...' : 'Cargar más antiguas (Servidor)'}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-40 transition"
                  title="Página anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-40 transition"
                  title="Página siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Ficha Completa de Encomienda */}
      <ShipmentDetailModal
        shipment={selectedShipment}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false)
          setSelectedShipment(null)
        }}
        currentUser={currentUser}
        currentBranchId={currentBranch.id}
        onShipmentUpdated={(updated) => {
          setSelectedShipment(updated)
          if (onShipmentUpdated) onShipmentUpdated(updated)
        }}
        onDeliverShipment={(target) => {
          setIsDetailOpen(false)
          onOpenDeliveryModal(target)
        }}
      />
    </div>
  )
}
