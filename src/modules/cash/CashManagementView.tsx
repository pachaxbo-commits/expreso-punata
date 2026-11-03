import React, { useState, useEffect, useMemo } from 'react'
import {
  Wallet,
  Truck,
  Clock,
  PlusCircle,
  Lock,
  ArrowDownRight,
  QrCode,
  CreditCard,
  Banknote,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Printer,
  History,
  Info,
  DollarSign,
  ChevronRight,
  AlertCircle
} from 'lucide-react'
import type { CashShift, FinancialMovement, UserProfile, Branch, PaymentMethod } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import {
  openCashShiftThroughBackend,
  closeCashShiftThroughBackend,
  registerCashExpenseThroughBackend,
  subscribeActiveCashShift,
  subscribeShiftMovements,
  fetchBranchShiftsPage,
} from '../../services/cashService.ts'
import { CashTicket80mm } from './CashTicket80mm.tsx'
import { DriverSettlementModal } from './DriverSettlementModal.tsx'

interface CashManagementViewProps {
  currentUser: UserProfile
  currentBranch: Branch
  onNavigateToShipments?: () => void
}

// Denominaciones oficiales de moneda en Bolivia
const BOLIVIAN_DENOMINATIONS = [
  { value: 200, label: 'Bs 200', type: 'billete' },
  { value: 100, label: 'Bs 100', type: 'billete' },
  { value: 50, label: 'Bs 50', type: 'billete' },
  { value: 20, label: 'Bs 20', type: 'billete' },
  { value: 10, label: 'Bs 10', type: 'billete' },
  { value: 5, label: 'Bs 5', type: 'moneda' },
  { value: 2, label: 'Bs 2', type: 'moneda' },
  { value: 1, label: 'Bs 1', type: 'moneda' },
  { value: 0.5, label: 'Bs 0.50', type: 'moneda' },
  { value: 0.2, label: 'Bs 0.20', type: 'moneda' },
  { value: 0.1, label: 'Bs 0.10', type: 'moneda' },
]

export const CashManagementView: React.FC<CashManagementViewProps> = ({
  currentUser,
  currentBranch,
}) => {
  // Estado reactivo del turno activo y movimientos
  const [activeShift, setActiveShift] = useState<CashShift | null>(null)
  const [movements, setMovements] = useState<FinancialMovement[]>([])
  const [historyShifts, setHistoryShifts] = useState<CashShift[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filtros de movimientos
  const [movementSearch, setMovementSearch] = useState('')
  const [movementFilterMethod, setMovementFilterMethod] = useState<'all' | PaymentMethod | 'expense'>('all')

  // Filtros de historial y paginación real de Firestore mediante cursores
  const [activeSubTab, setActiveSubTab] = useState<'active' | 'history'>('active')
  const [historyBranch, setHistoryBranch] = useState<string>(currentBranch.id)
  const [historyPage, setHistoryPage] = useState<number>(1)
  const [cursorStack, setCursorStack] = useState<(any | null)[]>([null])
  const [hasNextPage, setHasNextPage] = useState<boolean>(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false)
  const historyPageSize = 10

  // Modales
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false)
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false)
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false)
  const [isDriverSettlementOpen, setIsDriverSettlementOpen] = useState(false)
  const [ticketShiftToPrint, setTicketShiftToPrint] = useState<CashShift | null>(null)

  // Mensajes de error / éxito
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 1. Suscripción en tiempo real al turno activo
  useEffect(() => {
    setIsLoading(true)
    const unsubscribe = subscribeActiveCashShift(
      currentUser.uid,
      currentBranch.id,
      (shift) => {
        setActiveShift(shift)
        setIsLoading(false)
      },
      (err) => {
        console.error('Error al suscribir a turno activo:', err)
        setIsLoading(false)
      }
    )
    return () => unsubscribe()
  }, [currentUser.uid, currentBranch.id])

  // 2. Suscripción en tiempo real a los movimientos del turno activo
  useEffect(() => {
    if (!activeShift?.id) {
      setMovements([])
      return
    }

    const unsubscribe = subscribeShiftMovements(
      activeShift.id,
      (movs) => {
        setMovements(movs)
      },
      (err) => console.error('Error al suscribir a movimientos:', err)
    )
    return () => unsubscribe()
  }, [activeShift?.id])

  // 3. Consulta paginada real de turnos de la sucursal mediante cursores (orderBy openedAt desc + startAfter)
  const loadHistoryPage = async (pageIndex: number, cursor: any | null) => {
    setIsLoadingHistory(true)
    try {
      const res = await fetchBranchShiftsPage(historyBranch, historyPageSize, cursor)
      setHistoryShifts(res.shifts)
      setHasNextPage(res.hasMore)
      if (res.lastDoc) {
        setCursorStack((prev) => {
          const next = [...prev]
          next[pageIndex] = res.lastDoc
          return next
        })
      }
    } catch (err) {
      console.error('Error al cargar historial paginado de turnos:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  useEffect(() => {
    setHistoryPage(1)
    setCursorStack([null])
    loadHistoryPage(1, null)
  }, [historyBranch])

  const handleNextPage = () => {
    const nextCursor = cursorStack[historyPage]
    const nextPage = historyPage + 1
    setHistoryPage(nextPage)
    loadHistoryPage(nextPage, nextCursor)
  }

  const handlePrevPage = () => {
    if (historyPage <= 1) return
    const prevPage = historyPage - 1
    const prevCursor = cursorStack[prevPage - 1] || null
    setHistoryPage(prevPage)
    loadHistoryPage(prevPage, prevCursor)
  }

  // Filtrado de movimientos
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Filtro por método / tipo
      if (movementFilterMethod === 'expense') {
        if (m.type !== 'expense') return false
      } else if (movementFilterMethod !== 'all') {
        if (m.paymentMethod !== movementFilterMethod || m.type === 'expense') return false
      }

      // Filtro por búsqueda
      if (!movementSearch) return true
      const q = movementSearch.toLowerCase()
      const conceptMatch = m.concept.toLowerCase().includes(q)
      const guideMatch = m.trackingCode ? m.trackingCode.toLowerCase().includes(q) : false
      const refMatch = m.referenceId ? m.referenceId.toLowerCase().includes(q) : false
      return conceptMatch || guideMatch || refMatch
    })
  }, [movements, movementFilterMethod, movementSearch])

  // Temporizador de tiempo transcurrido desde apertura
  const [elapsedTimeStr, setElapsedTimeStr] = useState<string>('')
  useEffect(() => {
    if (!activeShift?.openedAt) {
      setElapsedTimeStr('')
      return
    }

    const updateElapsed = () => {
      const start = new Date(activeShift.openedAt).getTime()
      const now = Date.now()
      const diffMs = Math.max(0, now - start)
      const hours = Math.floor(diffMs / (1000 * 60 * 60))
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
      setElapsedTimeStr(`${hours}h ${minutes}m`)
    }

    updateElapsed()
    const interval = setInterval(updateElapsed, 60000)
    return () => clearInterval(interval)
  }, [activeShift?.openedAt])

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedbackMessage({ type, text })
    setTimeout(() => setFeedbackMessage(null), 5000)
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Mensaje de Feedback */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-bold flex items-center justify-between shadow-sm animate-in fade-in duration-150 ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button onClick={() => setFeedbackMessage(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold">
            Cerrar
          </button>
        </div>
      )}

      {/* Cabecera Principal y Selector de Subpestañas */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#facc15]" />
            <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
              Control de Caja y Turnos Operativos — {currentBranch.name}
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Gestión de turnos, arqueo con denominaciones bolivianas, cobro de encomiendas y rendición en tiempo real.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs font-bold">
            <button
              onClick={() => setActiveSubTab('active')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeSubTab === 'active'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Turno Activo
            </button>
            <button
              onClick={() => setActiveSubTab('history')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeSubTab === 'history'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Historial de Turnos</span>
            </button>
          </div>
        </div>
      </div>

      {/* SUBPESTAÑA 1: TURNO ACTIVO */}
      {activeSubTab === 'active' && (
        <div className="space-y-5">
          {isLoading ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-semibold">Cargando estado de caja en tiempo real...</p>
            </div>
          ) : !activeShift ? (
            /* Estado: CAJA CERRADA */
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-700 relative overflow-hidden">
              <div className="relative z-10 max-w-xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-600 text-slate-300 text-[11px] font-bold mb-4">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Caja Cerrada en {currentBranch.name}</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight mb-2">
                  No tiene un turno de caja abierto actualmente
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 mb-6 leading-relaxed">
                  Para registrar cobros de encomiendas en origen o ventanilla, debe iniciar su turno formal indicando el fondo inicial en efectivo (cambio / sencillo).
                </p>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setIsOpenShiftModalOpen(true)}
                    className="inline-flex items-center gap-2 bg-[#facc15] hover:bg-[#eab308] text-[#064e3b] px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg transition-all"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Abrir Turno de Caja</span>
                  </button>
                  <button
                    onClick={() => setActiveSubTab('history')}
                    className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold border border-slate-600 transition-colors"
                  >
                    <History className="w-4 h-4 text-slate-400" />
                    <span>Ver Turnos Anteriores</span>
                  </button>
                </div>
              </div>

              {/* Decoración gráfica de fondo */}
              <Wallet className="absolute right-[-20px] bottom-[-20px] w-64 h-64 text-white/5 pointer-events-none" />
            </div>
          ) : (
            /* Estado: CAJA ABIERTA */
            <div className="space-y-5">
              {/* Banner de Estado del Turno Activo */}
              <div data-tutorial-target="cash-status-card" className="bg-[#064e3b] text-white p-5 rounded-2xl shadow-lg border border-emerald-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-[#facc15] text-[#064e3b] flex items-center justify-center font-black shrink-0 shadow-md">
                    <Wallet className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-[#facc15] tracking-wider uppercase">
                        {activeShift.shiftNumber || activeShift.id}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/80 text-emerald-200 border border-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        TURNO ACTIVO
                      </span>
                    </div>
                    <h3 className="text-base font-extrabold text-white mt-0.5">
                      Operador: {activeShift.operatorName}
                    </h3>
                    <div className="flex items-center gap-3 text-[11px] text-emerald-200 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-emerald-300" />
                        Abierto hace {elapsedTimeStr || 'unos instantes'}
                      </span>
                      <span>•</span>
                      <span>
                        {new Date(activeShift.openedAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Botones de Acción Rápida */}
                <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                  <button
                    onClick={() => setIsDriverSettlementOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-800/80 hover:bg-emerald-700/80 rounded-xl border border-emerald-600 transition-colors"
                    title="Registrar rendición de cobranzas de conductor en ruta"
                  >
                    <Truck className="w-3.5 h-3.5 text-amber-300" />
                    <span>Rendición Chofer</span>
                  </button>
                  <button
                    onClick={() => setIsExpenseModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-800/80 hover:bg-emerald-700/80 rounded-xl border border-emerald-600 transition-colors"
                  >
                    <ArrowDownRight className="w-3.5 h-3.5 text-amber-300" />
                    <span>Egreso Menor</span>
                  </button>
                  <button
                    data-tutorial-target="btn-close-cash-shift"
                    onClick={() => setIsCloseShiftModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-black text-red-950 bg-red-400 hover:bg-red-300 rounded-xl shadow-md transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Cerrar Turno (Arqueo)</span>
                  </button>
                </div>
              </div>

              {/* Tarjetas de Resumen Financiero (KPIs) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Efectivo Físico Esperado en Gaveta */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Efectivo en Gaveta</span>
                    <Banknote className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-800 tracking-tight">
                    {formatCurrencyBob(activeShift.expectedCashCents || 0)}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 font-medium">
                    Fondo inicial + cobros en efectivo - egresos
                  </p>
                </div>

                {/* 2. Total Recaudación Comercial */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Total Cobrado</span>
                    <DollarSign className="w-4 h-4 text-[#064e3b]" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                    {formatCurrencyBob(activeShift.breakdown?.totalIncomeCents || 0)}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                    <span>Efectivo: {formatCurrencyBob(activeShift.breakdown?.cashIncomeCents || 0)}</span>
                  </div>
                </div>

                {/* 3. Cobros Electrónicos (QR + Transferencia) */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Cobros Digitales</span>
                    <QrCode className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-blue-700 tracking-tight">
                    {formatCurrencyBob(
                      (activeShift.breakdown?.qrIncomeCents || 0) + (activeShift.breakdown?.transferIncomeCents || 0)
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    QR: {formatCurrencyBob(activeShift.breakdown?.qrIncomeCents || 0)} • Banco: {formatCurrencyBob(activeShift.breakdown?.transferIncomeCents || 0)}
                  </p>
                </div>

                {/* 4. Fondo Inicial de Caja */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Fondo Inicial</span>
                    <Wallet className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-slate-700 tracking-tight">
                    {formatCurrencyBob(activeShift.initialCashCents || 0)}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 font-medium">
                    Sencillo base separado de las ventas
                  </p>
                </div>
              </div>

              {/* Sección de Movimientos Financieros del Turno */}
              <div data-tutorial-target="cash-movements-section" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Cabecera y Filtros de la Lista */}
                <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-tight">
                      Movimientos del Turno ({filteredMovements.length})
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Registro auditable inmutable en tiempo real de ingresos y egresos.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Buscador */}
                    <div className="relative min-w-[200px]">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar por guía o concepto..."
                        value={movementSearch}
                        onChange={(e) => setMovementSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                      />
                    </div>

                    {/* Filtro por Método */}
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-bold text-slate-600">
                      <button
                        onClick={() => setMovementFilterMethod('all')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          movementFilterMethod === 'all' ? 'bg-white text-slate-900 shadow-sm' : ''
                        }`}
                      >
                        Todos
                      </button>
                      <button
                        onClick={() => setMovementFilterMethod('cash')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          movementFilterMethod === 'cash' ? 'bg-white text-emerald-800 shadow-sm' : ''
                        }`}
                      >
                        Efectivo
                      </button>
                      <button
                        onClick={() => setMovementFilterMethod('qr')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          movementFilterMethod === 'qr' ? 'bg-white text-blue-700 shadow-sm' : ''
                        }`}
                      >
                        QR
                      </button>
                      <button
                        onClick={() => setMovementFilterMethod('transfer')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          movementFilterMethod === 'transfer' ? 'bg-white text-purple-700 shadow-sm' : ''
                        }`}
                      >
                        Banco
                      </button>
                      <button
                        onClick={() => setMovementFilterMethod('expense')}
                        className={`px-2.5 py-1 rounded-md transition-colors ${
                          movementFilterMethod === 'expense' ? 'bg-white text-red-700 shadow-sm' : ''
                        }`}
                      >
                        Egresos
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tabla de Movimientos */}
                {filteredMovements.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 font-medium">
                    {movements.length === 0
                      ? 'No hay movimientos registrados en este turno aún. Los cobros de encomiendas aparecerán aquí automáticamente.'
                      : 'No se encontraron movimientos con los filtros seleccionados.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-3">Hora</th>
                          <th className="p-3">Concepto / Guía</th>
                          <th className="p-3">Método</th>
                          <th className="p-3">Tipo</th>
                          <th className="p-3 text-right">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {filteredMovements.map((mov) => {
                          const isExpense = mov.type === 'expense' || mov.amountCents < 0
                          const isInit = mov.type === 'initial_cash'
                          const amountFormatted = formatCurrencyBob(Math.abs(mov.amountCents))

                          return (
                            <tr key={mov.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="p-3 text-slate-500 whitespace-nowrap">
                                {mov.timestamp ? new Date(mov.timestamp).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/D'}
                              </td>
                              <td className="p-3">
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{mov.concept}</span>
                                  {mov.trackingCode && (
                                    <span className="text-[10px] bg-emerald-50 text-emerald-800 font-extrabold px-1.5 py-0.5 rounded border border-emerald-200">
                                      {mov.trackingCode}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  ID: {mov.id} • Operador: {mov.operatorName}
                                </div>
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                {mov.paymentMethod === 'cash' && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                    <Banknote className="w-3 h-3" />
                                    <span>Efectivo</span>
                                  </span>
                                )}
                                {mov.paymentMethod === 'qr' && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                                    <QrCode className="w-3 h-3" />
                                    <span>Pago QR</span>
                                  </span>
                                )}
                                {mov.paymentMethod === 'transfer' && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-800 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                                    <CreditCard className="w-3 h-3" />
                                    <span>Transferencia</span>
                                  </span>
                                )}
                                {mov.paymentMethod === 'none' && (
                                  <span className="text-[11px] text-slate-400">N/A</span>
                                )}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                {isInit ? (
                                  <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                    Fondo Base
                                  </span>
                                ) : isExpense ? (
                                  <span className="text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                                    Egreso
                                  </span>
                                ) : mov.type === 'driver_remittance' ? (
                                  <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                    {mov.settlementType === 'partial' || mov.concept?.includes('parcial') ? 'Rendición Parcial' : 'Rendición Completa'}
                                  </span>
                                ) : mov.type === 'cod_income' ? (
                                  <span className="text-[10px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                                    COD ingresado a Caja
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                    Cobro Encomienda (Origen)
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right whitespace-nowrap font-bold">
                                <span
                                  className={
                                    isExpense
                                      ? 'text-red-600'
                                      : isInit
                                      ? 'text-slate-600'
                                      : 'text-emerald-700'
                                  }
                                >
                                  {isExpense ? `-${amountFormatted}` : `+${amountFormatted}`}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBPESTAÑA 2: HISTORIAL DE TURNOS */}
      {activeSubTab === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-tight">
                Historial de Turnos de Caja
              </h3>
              <p className="text-xs text-slate-500">
                Turnos cerrados y arqueos archivados para auditoría y comprobantes térmicos.
              </p>
            </div>

            {/* Selector de sucursal para Administrador y Tesorería */}
            {(currentUser.role === 'directiva_admin' || currentUser.role === 'tesoreria') && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Sucursal:</span>
                <select
                  value={historyBranch}
                  onChange={(e) => {
                    setHistoryBranch(e.target.value)
                    setHistoryPage(1)
                  }}
                  className="p-1.5 text-xs font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                >
                  <option value="punata">Agencia Punata</option>
                  <option value="cochabamba">Agencia Cochabamba</option>
                  <option value="all">Todas las Agencias (Global)</option>
                </select>
              </div>
            )}
          </div>

          {historyShifts.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400 font-medium">
              No hay turnos registrados en el historial para esta sucursal.
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">N° Turno</th>
                    <th className="p-3">Operador</th>
                    <th className="p-3">Sucursal</th>
                    <th className="p-3">Apertura / Cierre</th>
                    <th className="p-3">Fondo Base</th>
                    <th className="p-3">Venta Total</th>
                    <th className="p-3">Esperado</th>
                    <th className="p-3">Contado</th>
                    <th className="p-3">Diferencia</th>
                    <th className="p-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {historyShifts.map((sh) => {
                      const isClosed = sh.status === 'closed'
                    const diffStatus = sh.differenceStatus || (sh.differenceCents === 0 ? 'conforme' : (sh.differenceCents || 0) > 0 ? 'sobrante' : 'faltante')

                    return (
                      <tr key={sh.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-bold text-slate-900 whitespace-nowrap">
                          {sh.shiftNumber || sh.id}
                        </td>
                        <td className="p-3 whitespace-nowrap text-slate-800">
                          {sh.operatorName}
                        </td>
                        <td className="p-3 whitespace-nowrap capitalize text-slate-600">
                          {sh.branchId}
                        </td>
                        <td className="p-3 whitespace-nowrap text-slate-500">
                          <div>{new Date(sh.openedAt).toLocaleDateString('es-BO')}</div>
                          <div className="text-[10px] text-slate-400">
                            {sh.closedAt ? new Date(sh.closedAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }) : 'Abierto'}
                          </div>
                        </td>
                        <td className="p-3 whitespace-nowrap font-medium text-slate-700">
                          {formatCurrencyBob(sh.initialCashCents || 0)}
                        </td>
                        <td className="p-3 whitespace-nowrap font-bold text-slate-900">
                          {formatCurrencyBob(sh.breakdown?.totalIncomeCents || 0)}
                        </td>
                        <td className="p-3 whitespace-nowrap text-slate-700">
                          {formatCurrencyBob(sh.expectedCashCents || 0)}
                        </td>
                        <td className="p-3 whitespace-nowrap text-slate-800 font-bold">
                          {sh.actualCashCents !== null && sh.actualCashCents !== undefined
                            ? formatCurrencyBob(sh.actualCashCents)
                            : '-'}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {isClosed ? (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                diffStatus === 'conforme'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : diffStatus === 'sobrante'
                                  ? 'bg-blue-50 text-blue-800 border border-blue-200'
                                  : 'bg-red-50 text-red-800 border border-red-200'
                              }`}
                            >
                              <span>{diffStatus.toUpperCase()}</span>
                              <span>({formatCurrencyBob(sh.differenceCents || 0)})</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                              EN CURSO
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => setTicketShiftToPrint(sh)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            title="Ver e imprimir ticket de arqueo"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Ticket</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Aviso explícito de límites y paginación con cursores del servidor */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  Turnos de caja (Página {historyPage} • {historyShifts.length} registros). Paginación autoritativa en Firestore con cursores (startAfter). Para balances consolidados, consulte Reportes.
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={historyPage <= 1 || isLoadingHistory}
                  onClick={handlePrevPage}
                  className="px-2.5 py-1 text-xs font-bold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  Anterior
                </button>
                <span className="px-2 py-1 font-bold text-slate-700">Página {historyPage}</span>
                <button
                  type="button"
                  disabled={!hasNextPage || isLoadingHistory}
                  onClick={handleNextPage}
                  className="px-2.5 py-1 text-xs font-bold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  {isLoadingHistory ? 'Cargando...' : 'Siguiente'}
                </button>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* MODAL 1: ABRIR TURNO DE CAJA */}
      {isOpenShiftModalOpen && (
        <OpenShiftModal
          currentBranch={currentBranch}
          onClose={() => setIsOpenShiftModalOpen(false)}
          onSuccess={(shift) => {
            setActiveShift(shift)
            setIsOpenShiftModalOpen(false)
            showFeedback('success', `Turno ${shift.shiftNumber || shift.id} abierto correctamente.`)
          }}
        />
      )}

      {/* MODAL 2: CERRAR TURNO (ARQUEO GUIADO CON DENOMINACIONES BOLIVIANAS) */}
      {isCloseShiftModalOpen && activeShift && (
        <CloseShiftModal
          shift={activeShift}
          onClose={() => setIsCloseShiftModalOpen(false)}
          onSuccess={(closedShift) => {
            setIsCloseShiftModalOpen(false)
            setActiveShift(null)
            setTicketShiftToPrint(closedShift)
            showFeedback('success', `Turno ${closedShift.shiftNumber || closedShift.id} cerrado correctamente. Arqueo completado.`)
          }}
        />
      )}

      {/* MODAL 3: REGISTRAR EGRESO MENOR */}
      {isExpenseModalOpen && activeShift && (
        <RegisterExpenseModal
          currentBranch={currentBranch}
          currentUserRole={currentUser.role}
          onClose={() => setIsExpenseModalOpen(false)}
          onSuccess={() => {
            setIsExpenseModalOpen(false)
            showFeedback('success', 'Egreso autorizado registrado correctamente.')
          }}
        />
      )}

      {/* MODAL 4: COMPROBANTE TÉRMICO DE 80 MM (CON DISPARO A IMPRESORA Y PDF) */}
      {ticketShiftToPrint && (
        <CashTicket80mm
          shift={ticketShiftToPrint}
          onClose={() => setTicketShiftToPrint(null)}
        />
      )}

      {/* MODAL 5: RENDICIÓN DE CONDUCTOR */}
      {isDriverSettlementOpen && (
        <DriverSettlementModal
          isOpen={isDriverSettlementOpen}
          onClose={() => setIsDriverSettlementOpen(false)}
          onSuccess={() => {
            setIsDriverSettlementOpen(false)
            showFeedback('success', 'Rendición de conductor registrada en caja correctamente.')
          }}
          currentUser={currentUser}
          currentBranch={currentBranch}
          currentShiftId={activeShift?.id}
        />
      )}
    </div>
  )
}

/**
 * =============================================================================
 * SUBCOMPONENTE: OpenShiftModal (Apertura de Turno con Fondo Inicial)
 * =============================================================================
 */
interface OpenShiftModalProps {
  currentBranch: Branch
  onClose: () => void
  onSuccess: (shift: CashShift) => void
}

const OpenShiftModal: React.FC<OpenShiftModalProps> = ({ currentBranch, onClose, onSuccess }) => {
  const [initialCashBob, setInitialCashBob] = useState<string>('0')
  const [notes, setNotes] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setErrorMessage(null)

    const cashBobNum = parseFloat(initialCashBob) || 0
    if (cashBobNum < 0) {
      setErrorMessage('El fondo inicial no puede ser negativo.')
      setIsSubmitting(false)
      return
    }

    const initialCashCents = Math.round(cashBobNum * 100)

    try {
      const res = await openCashShiftThroughBackend({
        branchId: currentBranch.id,
        initialCashCents,
        notes: notes.trim(),
      })
      onSuccess(res.shift)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al abrir el turno de caja.'
      setErrorMessage(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
        <div className="bg-[#064e3b] text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#facc15] text-[#064e3b] flex items-center justify-center font-black">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-tight text-white">
                Apertura de Turno de Caja
              </h3>
              <p className="text-[11px] text-emerald-200">
                {currentBranch.name} • Registro Oficial
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-800">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Fondo Inicial en Efectivo (Bolivianos) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">Bs</span>
              <input
                type="number"
                step="0.50"
                min="0"
                required
                value={initialCashBob}
                onChange={(e) => setInitialCashBob(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm font-extrabold text-slate-900 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Ingrese el monto en gaveta destinado a cambio o sencillo. Se registrará separado de los ingresos del día.
            </p>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Observaciones de Apertura (Opcional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Recibido de la secretaria del turno anterior..."
              className="w-full p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
            />
          </div>

          <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-amber-800 text-[11px] flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Al abrir caja, todas las encomiendas cobradas en ventanilla durante su turno se vincularán de forma transaccional e inmutable a este arqueo.
            </span>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 font-extrabold text-[#064e3b] bg-[#facc15] hover:bg-[#eab308] rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              {isSubmitting ? 'Abriendo Turno...' : 'Confirmar y Abrir Turno'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * =============================================================================
 * SUBCOMPONENTE: CloseShiftModal (Arqueo Guiado con Calculadora de Denominaciones)
 * =============================================================================
 */
interface CloseShiftModalProps {
  shift: CashShift
  onClose: () => void
  onSuccess: (closedShift: CashShift) => void
}

const CloseShiftModal: React.FC<CloseShiftModalProps> = ({ shift, onClose, onSuccess }) => {
  // Calculadora de denominaciones: cantidad de cada billete/moneda
  const [denominations, setDenominations] = useState<Record<string, number>>({
    '200': 0,
    '100': 0,
    '50': 0,
    '20': 0,
    '10': 0,
    '5': 0,
    '2': 0,
    '1': 0,
    '0.5': 0,
    '0.2': 0,
    '0.1': 0,
  })

  const [useDenominations, setUseDenominations] = useState(true)
  const [manualActualCashBob, setManualActualCashBob] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [step, setStep] = useState<1 | 2>(1) // Paso 1: Conteo; Paso 2: Confirmación
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Cálculo automático del efectivo contado sumando denominaciones
  const countedCashCents = useMemo(() => {
    if (!useDenominations) {
      const num = parseFloat(manualActualCashBob) || 0
      return Math.round(num * 100)
    }

    let totalCents = 0
    for (const [denomStr, count] of Object.entries(denominations)) {
      const denomVal = parseFloat(denomStr) || 0
      const countVal = Math.max(0, count || 0)
      totalCents += Math.round(denomVal * 100) * countVal
    }
    return totalCents
  }, [useDenominations, manualActualCashBob, denominations])

  const expectedCashCents = shift.expectedCashCents || 0
  const differenceCents = countedCashCents - expectedCashCents
  const differenceStatus = differenceCents === 0 ? 'conforme' : differenceCents > 0 ? 'sobrante' : 'faltante'

  const handleDenomChange = (denomStr: string, valueStr: string) => {
    const val = parseInt(valueStr, 10) || 0
    setDenominations((prev) => ({
      ...prev,
      [denomStr]: Math.max(0, val),
    }))
  }

  const handleConfirmClose = async () => {
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      let cleanBreakdown: Record<string, number> | undefined = undefined
      if (useDenominations) {
        cleanBreakdown = {}
        for (const [k, v] of Object.entries(denominations)) {
          const countInt = Math.max(0, Math.round(Number(v) || 0))
          if (countInt > 0) {
            cleanBreakdown[k] = countInt
          }
        }
      }

      const res = await closeCashShiftThroughBackend({
        shiftId: shift.id,
        actualCashCents: countedCashCents,
        actualCashBreakdown: cleanBreakdown,
        notes: notes.trim(),
      })
      onSuccess(res.shift)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cerrar el turno de caja.'
      setErrorMessage(msg)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        {/* Encabezado */}
        <div className="bg-[#064e3b] text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-400 text-red-950 flex items-center justify-center font-black">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-tight text-white">
                Cierre y Arqueo de Caja — {shift.shiftNumber || shift.id}
              </h3>
              <p className="text-[11px] text-emerald-200">
                Paso {step} de 2 • {step === 1 ? 'Conteo de Efectivo Físico' : 'Confirmación Definitiva'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-800">
            &times;
          </button>
        </div>

        {/* Cuerpo con Scroll */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {/* Selector de modo: Calculadora o Monto Directo */}
              <div className="flex items-center justify-between bg-slate-100 p-1 rounded-xl font-bold">
                <button
                  type="button"
                  onClick={() => setUseDenominations(true)}
                  className={`w-1/2 py-1.5 rounded-lg text-center transition-all ${
                    useDenominations ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Calculadora de Billetes y Monedas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseDenominations(false)
                    setManualActualCashBob((countedCashCents / 100).toFixed(2))
                  }}
                  className={`w-1/2 py-1.5 rounded-lg text-center transition-all ${
                    !useDenominations ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Ingreso Manual Total
                </button>
              </div>

              {useDenominations ? (
                /* Grilla de Denominaciones Bolivianas */
                <div data-tutorial-target="cash-count-drawer" className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BOLIVIAN_DENOMINATIONS.map((denom) => (
                      <div key={denom.value} className="bg-slate-50 p-2 rounded-xl border border-slate-200 flex flex-col justify-between">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-extrabold text-slate-800 text-[11px]">{denom.label}</span>
                          <span className="text-[9px] uppercase font-bold text-slate-400">{denom.type}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={denominations[String(denom.value)] || ''}
                            onChange={(e) => handleDenomChange(String(denom.value), e.target.value)}
                            className="w-full text-center py-1 font-bold text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                          />
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">
                            = {formatCurrencyBob(Math.round(denom.value * 100) * (denominations[String(denom.value)] || 0))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Entrada Manual */
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Efectivo Total Contado (Bs) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">Bs</span>
                    <input
                      type="number"
                      step="0.10"
                      min="0"
                      required
                      value={manualActualCashBob}
                      onChange={(e) => setManualActualCashBob(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 text-base font-extrabold text-slate-900 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                </div>
              )}

              {/* Tarjeta de Comparación en Vivo */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-bold">Efectivo Físico Esperado por Sistema:</span>
                  <span className="font-extrabold text-slate-900">{formatCurrencyBob(expectedCashCents)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-black border-t border-slate-200 pt-2">
                  <span className="text-slate-700">Efectivo Físico Contado:</span>
                  <span className="text-emerald-800">{formatCurrencyBob(countedCashCents)}</span>
                </div>

                <div
                  className={`p-2.5 rounded-lg flex items-center justify-between font-bold text-xs mt-2 ${
                    differenceStatus === 'conforme'
                      ? 'bg-emerald-100/70 text-emerald-900 border border-emerald-300'
                      : differenceStatus === 'sobrante'
                      ? 'bg-blue-100/70 text-blue-900 border border-blue-300'
                      : 'bg-red-100/70 text-red-900 border border-red-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {differenceStatus === 'conforme' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-700" />
                    )}
                    <span>Resultado: {differenceStatus.toUpperCase()}</span>
                  </div>
                  <span className="text-sm font-black">
                    {differenceCents === 0 ? 'Exacto (Bs 0.00)' : formatCurrencyBob(differenceCents)}
                  </span>
                </div>
              </div>

              {/* Observaciones */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Observaciones de Cierre {differenceCents !== 0 ? '(Requerido por Diferencia)' : '(Opcional)'}
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    differenceCents !== 0
                      ? 'Explique el motivo del sobrante o faltante en caja...'
                      : 'Novedades del turno o comprobante de entrega conforme...'
                  }
                  className="w-full p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            /* Confirmación Definitiva */
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs space-y-2">
                <div className="font-extrabold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>¿Está seguro de cerrar definitivamente este turno de caja?</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Una vez cerrado, el arqueo quedará congelado en el historial y no se podrán registrar nuevos cobros ni modificaciones bajo este número de turno.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex justify-between text-slate-600">
                  <span>Turno:</span>
                  <span className="font-bold text-slate-900">{shift.shiftNumber || shift.id}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Operador:</span>
                  <span className="font-bold text-slate-900">{shift.operatorName}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Efectivo Esperado:</span>
                  <span className="font-bold text-slate-900">{formatCurrencyBob(expectedCashCents)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Efectivo Contado:</span>
                  <span className="font-bold text-emerald-800">{formatCurrencyBob(countedCashCents)}</span>
                </div>
                <div className="flex justify-between font-bold pt-2 border-t border-slate-100">
                  <span>Diferencia Final:</span>
                  <span
                    className={
                      differenceStatus === 'conforme'
                        ? 'text-emerald-700'
                        : differenceStatus === 'sobrante'
                        ? 'text-blue-700'
                        : 'text-red-700'
                    }
                  >
                    {differenceStatus.toUpperCase()} ({formatCurrencyBob(differenceCents)})
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Barra de Acciones */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (differenceCents !== 0 && !notes.trim()) {
                    setErrorMessage('Debe ingresar una observación explicando la diferencia en caja.')
                    return
                  }
                  setStep(2)
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2 font-black text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md transition-all"
              >
                <span>Revisar y Cerrar</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setStep(1)}
                className="px-4 py-2 font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-xl disabled:opacity-50"
              >
                Atrás
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmClose}
                className="px-6 py-2 font-black text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {isSubmitting ? 'Cerrando y Archivando...' : 'Confirmar Cierre Definitivo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * =============================================================================
 * SUBCOMPONENTE: RegisterExpenseModal (Registro de Egreso de Caja)
 * =============================================================================
 */
interface RegisterExpenseModalProps {
  currentBranch: Branch
  currentUserRole: string
  onClose: () => void
  onSuccess: () => void
}

const RegisterExpenseModal: React.FC<RegisterExpenseModalProps> = ({
  currentBranch,
  currentUserRole,
  onClose,
  onSuccess,
}) => {
  const [amountBob, setAmountBob] = useState<string>('')
  const [concept, setConcept] = useState<string>('')
  const [category, setCategory] = useState<string>('oficina')
  const [voucherNumber, setVoucherNumber] = useState<string>('')
  const [authorizationCode, setAuthorizationCode] = useState<string>('')
  // Clave de idempotencia única y ESTABLE durante todos los reintentos de este formulario
  const [idempotencyKey] = useState<string>(
    () => `exp_${currentBranch.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const num = parseFloat(amountBob) || 0
  const isSecretaria = currentUserRole === 'secretaria'
  const requiresSupervisorApproval = isSecretaria && num > 150

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setErrorMessage(null)

    if (num <= 0) {
      setErrorMessage('El monto del egreso debe ser mayor a cero.')
      setIsSubmitting(false)
      return
    }

    if (!concept.trim()) {
      setErrorMessage('Debe indicar el concepto del egreso.')
      setIsSubmitting(false)
      return
    }

    if (requiresSupervisorApproval && !authorizationCode.trim()) {
      setErrorMessage('Los egresos mayores a Bs 150.00 requieren un Código de Autorización emitido por Encargado de Agencia o Directiva.')
      setIsSubmitting(false)
      return
    }

    const amountCents = Math.round(num * 100)

    try {
      await registerCashExpenseThroughBackend({
        branchId: currentBranch.id,
        amountCents,
        concept: concept.trim(),
        category,
        voucherNumber: voucherNumber.trim() || undefined,
        idempotencyKey,
        authorizationCode: authorizationCode.trim() || undefined,
      })
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar el egreso.'
      setErrorMessage(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
        <div className="bg-[#064e3b] text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowDownRight className="w-5 h-5 text-amber-300" />
            <h3 className="text-sm font-extrabold uppercase tracking-tight text-white">
              Registrar Egreso de Caja
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-800">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label className="font-bold text-slate-700 block mb-1">Monto del Egreso (Bs) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">Bs</span>
              <input
                type="number"
                step="0.50"
                min="0.50"
                required
                value={amountBob}
                onChange={(e) => setAmountBob(e.target.value)}
                placeholder="0.00"
                className="w-full pl-9 pr-3 py-2 text-sm font-extrabold text-slate-900 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Concepto / Motivo *</label>
            <input
              type="text"
              required
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej. Compra de cinta de embalaje y marcadores..."
              className="w-full p-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Categoría</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              >
                <option value="oficina">Material de Oficina</option>
                <option value="limpieza">Limpieza y Aseo</option>
                <option value="transporte">Transporte Menor</option>
                <option value="refrigerio">Refrigerio / Alimentación</option>
                <option value="insumos">Insumos y Embalaje</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="servicios_basicos">Servicios Básicos</option>
                <option value="otro">Otro Egreso Autorizado</option>
              </select>
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">N° Comprobante / Recibo</label>
              <input
                type="text"
                value={voucherNumber}
                onChange={(e) => setVoucherNumber(e.target.value)}
                placeholder="Ej. REC-0042"
                className="w-full p-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
          </div>

          {requiresSupervisorApproval && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Egreso mayor a Bs 150.00 requiere autorización verificable</span>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Código de Autorización (AUT-EXP-...) *</label>
                <input
                  type="text"
                  required
                  value={authorizationCode}
                  onChange={(e) => setAuthorizationCode(e.target.value.toUpperCase())}
                  placeholder="Ej. AUT-EXP-2026-XXXX..."
                  className="w-full p-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] text-xs font-mono font-bold uppercase"
                />
                <p className="text-[10px] text-amber-700 mt-1">
                  Emitido por Encargado de Agencia o Directiva desde el sistema. Válido por 24 horas.
                </p>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 font-extrabold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              {isSubmitting ? 'Registrando...' : 'Registrar Egreso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
