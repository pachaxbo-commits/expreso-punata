import React, { useState, useEffect, useMemo } from 'react'
import {
  Users,
  UserPlus,
  Calendar,
  DollarSign,
  Search,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Printer,
  X,
  Plus,
  RefreshCw,
  Receipt,
} from 'lucide-react'
import type {
  UnionMember,
  UnionMonthlyDue,
  CashShift,
  Branch,
  UserProfile,
} from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { subscribeActiveCashShift } from '../../services/cashService.ts'
import {
  manageUnionMemberThroughBackend,
  generateMonthlyDuesThroughBackend,
  collectMemberDueThroughBackend,
  getMemberAccountStatementThroughBackend,
  subscribeUnionMembers,
  subscribeUnionDues,
  type CollectMemberDueResult,
  type MemberAccountStatementResult,
} from '../../services/unionService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'

interface UnionMembersViewProps {
  currentUser: UserProfile
  currentBranch: Branch
  activeShift?: CashShift | null
}

export const UnionMembersView: React.FC<UnionMembersViewProps> = ({
  currentUser,
  currentBranch,
  activeShift,
}) => {
    const [localShift, setLocalShift] = useState<CashShift | null>(null)
  useEffect(() => {
    if (!currentUser?.uid || !currentBranch?.id) return
    const unsubscribe = subscribeActiveCashShift(currentUser.uid, currentBranch.id, (sh) => {
      setLocalShift(sh)
    })
    return () => unsubscribe()
  }, [currentUser?.uid, currentBranch?.id])
  const effectiveShift = activeShift || localShift
  const [activeTab, setActiveTab] = useState<'members' | 'dues'>('members')
  const [members, setMembers] = useState<UnionMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

  // Período para cuotas (por defecto mes actual AAAA-MM)
  const currentPeriodStr = useMemo(() => {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${d.getFullYear()}-${m}`
  }, [])

  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentPeriodStr)
  const [dues, setDues] = useState<UnionMonthlyDue[]>([])
  const [loadingDues, setLoadingDues] = useState(false)

  // Filtros de búsqueda
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Modales
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<UnionMember | null>(null)

  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false)
  const [selectedDueToCollect, setSelectedDueToCollect] = useState<UnionMonthlyDue | null>(null)

  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false)
  const [statementData, setStatementData] = useState<MemberAccountStatementResult | null>(null)
  const [loadingStatement, setLoadingStatement] = useState(false)

  const [isGenerateDuesModalOpen, setIsGenerateDuesModalOpen] = useState(false)
  const [generatingDues, setGeneratingDues] = useState(false)

  // Feedback y mensajes
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const isManagement = currentUser.role === 'directiva_admin' || currentUser.role === 'tesoreria'
  const isCashier = ['secretaria', 'encargado_agencia', 'directiva_admin', 'tesoreria'].includes(currentUser.role)

  // 1. Suscripción a socios
  useEffect(() => {
    setLoadingMembers(true)
    const unsubscribe = subscribeUnionMembers(
      (list) => {
        setMembers(list)
        setLoadingMembers(false)
      },
      (err) => {
        console.error('[UnionMembersView] Error socios:', err)
        setLoadingMembers(false)
      }
    )
    return () => unsubscribe()
  }, [])

  // 2. Suscripción a cuotas del período seleccionado
  useEffect(() => {
    setLoadingDues(true)
    const unsubscribe = subscribeUnionDues(
      selectedPeriod,
      (list) => {
        setDues(list)
        setLoadingDues(false)
      },
      (err) => {
        console.error('[UnionMembersView] Error cuotas:', err)
        setLoadingDues(false)
      }
    )
    return () => unsubscribe()
  }, [selectedPeriod])

  // Filtrado de socios
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchSearch =
        m.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.memberNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.ci && m.ci.includes(searchTerm)) ||
        (m.vehiclePlate && m.vehiclePlate.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (m.assignedMobileNumber && m.assignedMobileNumber.includes(searchTerm))

      const matchStatus = statusFilter === 'all' || m.status === statusFilter
      const matchCat = categoryFilter === 'all' || m.category === categoryFilter

      return matchSearch && matchStatus && matchCat
    })
  }, [members, searchTerm, statusFilter, categoryFilter])

  // Métricas del padrón
  const metrics = useMemo(() => {
    const totalMembers = members.length
    const activeCount = members.filter((m) => m.status === 'active').length
    const totalBilledPeriodCents = dues.reduce((acc, d) => acc + (d.amountCents || 0), 0)
    const totalCollectedPeriodCents = dues.reduce((acc, d) => acc + (d.paidAmountCents || 0), 0)
    const totalPendingPeriodCents = dues.reduce((acc, d) => acc + (d.balanceCents || 0), 0)

    return {
      totalMembers,
      activeCount,
      totalBilledPeriodCents,
      totalCollectedPeriodCents,
      totalPendingPeriodCents,
    }
  }, [members, dues])

  // Abrir modal de socio para crear o editar
  const handleOpenMemberModal = (member?: UnionMember) => {
    setEditingMember(member || null)
    setIsMemberModalOpen(true)
  }

  // Abrir extracto de cuenta de socio
  const handleOpenStatement = async (member: UnionMember) => {
    setIsStatementModalOpen(true)
    setLoadingStatement(true)
    setStatementData(null)
    try {
      const res = await getMemberAccountStatementThroughBackend(member.id)
      setStatementData(res)
    } catch (err: any) {
      console.error('[UnionMembersView] Error extracto:', err)
      setFeedback({ type: 'error', message: err.message || 'Error al cargar el extracto de cuenta.' })
    } finally {
      setLoadingStatement(false)
    }
  }

  // Abrir cobro de cuota
  const handleOpenCollect = (due: UnionMonthlyDue) => {
    setSelectedDueToCollect(due)
    setIsCollectModalOpen(true)
  }

  // Auto-cierre de feedback
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 6000)
      return () => clearTimeout(timer)
    }
  }, [feedback])

  return (
    <div className="space-y-6">
      {/* Notificación de Feedback */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between shadow-sm animate-in fade-in duration-200 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            )}
            <p className="text-xs font-bold">{feedback.message}</p>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Cabecera y Tarjetas de Métricas */}
      <div className="bg-gradient-to-r from-[#064e3b] via-[#065f46] to-[#047857] rounded-2xl p-6 text-white shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-emerald-700/60 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-amber-400 text-emerald-950 rounded-xl shadow-sm">
                <Users className="w-6 h-6" />
              </span>
              <div>
                <h2 className="text-lg font-extrabold text-[#facc15] tracking-tight uppercase">
                  Padrón de Socios y Gestión de Cuotas
                </h2>
                <p className="text-xs text-emerald-100">
                  EXPRESO PUNATA • Sindicato Mixto y Empresa de Transporte Interprovincial
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isManagement && (
              <>
                <button
                  type="button"
                  data-tutorial-target="btn-collect-member-fee"
                  onClick={() => setIsGenerateDuesModalOpen(true)}
                  className="px-3.5 py-2 bg-emerald-800/80 hover:bg-emerald-800 border border-emerald-600/70 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-sm"
                >
                  <Calendar className="w-4 h-4 text-amber-300" />
                  <span>Emitir Cuotas Mensuales</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenMemberModal()}
                  className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-emerald-950 font-extrabold rounded-xl text-xs flex items-center gap-2 transition shadow-md"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>+ Nuevo Socio</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Resumen Métricas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="bg-emerald-950/40 border border-emerald-700/50 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Total Afiliados
            </span>
            <p className="text-xl font-extrabold text-white mt-1">
              {metrics.totalMembers}
            </p>
            <span className="text-[10px] text-emerald-200">
              {metrics.activeCount} activos
            </span>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-700/50 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Cuotas Período ({selectedPeriod})
            </span>
            <p className="text-xl font-extrabold text-amber-300 font-mono mt-1">
              {formatCurrencyBob(metrics.totalBilledPeriodCents, true)}
            </p>
            <span className="text-[10px] text-emerald-200">
              {dues.length} cuotas emitidas
            </span>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-700/50 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Recaudado en Caja
            </span>
            <p className="text-xl font-extrabold text-emerald-300 font-mono mt-1">
              {formatCurrencyBob(metrics.totalCollectedPeriodCents, true)}
            </p>
            <span className="text-[10px] text-emerald-200">
              Ingreso efectivo/bancos
            </span>
          </div>

          <div className="bg-emerald-950/40 border border-emerald-700/50 p-3.5 rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Pendiente / Por Cobrar
            </span>
            <p className="text-xl font-extrabold text-amber-200 font-mono mt-1">
              {formatCurrencyBob(metrics.totalPendingPeriodCents, true)}
            </p>
            <span className="text-[10px] text-emerald-200">
              Saldo adeudado período
            </span>
          </div>
        </div>
      </div>

      {/* Selector de Pestañas Principales */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          className={`px-4 py-2.5 font-bold text-xs border-b-2 transition flex items-center gap-2 ${
            activeTab === 'members'
              ? 'border-[#064e3b] text-[#064e3b]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Padrón de Socios ({members.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('dues')}
          className={`px-4 py-2.5 font-bold text-xs border-b-2 transition flex items-center gap-2 ${
            activeTab === 'dues'
              ? 'border-[#064e3b] text-[#064e3b]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Cuotas y Mensualidades ({selectedPeriod})</span>
        </button>
      </div>

      {/* PESTAÑA 1: PADRÓN DE SOCIOS */}
      {activeTab === 'members' && (
        <div data-tutorial-target="members-table-container" className="space-y-4">
          {/* Barra de Filtros y Búsqueda */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Buscar por nombre, socio (SOC-...), CI, móvil o placa..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e: any) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">Todos los Estados</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
                <option value="suspended">Suspendidos</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">Todas las Categorías</option>
                <option value="propietario_transporte">Propietario</option>
                <option value="conductor">Conductor Afiliado</option>
                <option value="socio_general">Socio General</option>
              </select>
            </div>
          </div>

          {/* Listado de Socios */}
          {loadingMembers ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Cargando padrón oficial de socios...</p>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No se encontraron socios</p>
              <p className="text-xs text-slate-500 mt-1">
                {searchTerm ? 'Intente con otros criterios de búsqueda.' : 'Aún no hay socios registrados en el padrón.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
              {filteredMembers.map((m) => (
                <div
                  key={m.id}
                  className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50 transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-[#064e3b] font-mono font-black text-xs flex items-center justify-center shrink-0">
                      {m.memberNumber}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-extrabold text-slate-900">
                          {m.fullName}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            m.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : m.status === 'suspended'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {m.status.toUpperCase()}
                        </span>
                        <span className="text-[10px] bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded-full">
                          {m.category === 'propietario_transporte'
                            ? 'Propietario'
                            : m.category === 'conductor'
                            ? 'Conductor'
                            : 'General'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                        {m.ci && <span>CI: <strong>{m.ci}</strong></span>}
                        {m.phone && <span>Tel: <strong>{m.phone}</strong></span>}
                        {m.assignedMobileNumber && (
                          <span className="text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                            Móvil Nº {m.assignedMobileNumber} {m.vehiclePlate ? `(${m.vehiclePlate})` : ''}
                          </span>
                        )}
                        <span>Afiliado: {m.joinedAt || 'N/D'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0">
                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Cuota mensual:</span>
                      <span className="text-sm font-extrabold font-mono text-[#064e3b]">
                        {formatCurrencyBob((m.monthlyFeeCents || Math.round(m.monthlyFeeBob * 100) || 5000), true)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenStatement(m)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition flex items-center gap-1"
                        title="Ver extracto histórico y estado de cuenta"
                      >
                        <FileText className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Extracto</span>
                      </button>

                      {isManagement && (
                        <button
                          type="button"
                          onClick={() => handleOpenMemberModal(m)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-[#064e3b] hover:text-[#facc15] text-slate-600 text-xs font-bold rounded-lg transition"
                          title="Editar datos del socio"
                        >
                          Editar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PESTAÑA 2: CUOTAS Y MENSUALIDADES POR PERÍODO */}
      {activeTab === 'dues' && (
        <div className="space-y-4">
          {/* Selector de Período y Acciones */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700">Período Contable:</span>
              <input
                type="month"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                {dues.length} cuotas registradas
              </span>
            </div>

            {isManagement && (
              <button
                type="button"
                onClick={() => setIsGenerateDuesModalOpen(true)}
                className="px-3.5 py-2 bg-[#064e3b] hover:bg-emerald-800 text-[#facc15] rounded-xl text-xs font-bold flex items-center gap-2 transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Emitir Cuotas de {selectedPeriod}</span>
              </button>
            )}
          </div>

          {/* Listado de Cuotas */}
          {loadingDues ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Cargando cuotas del período {selectedPeriod}...</p>
            </div>
          ) : dues.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <Calendar className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No hay cuotas emitidas para {selectedPeriod}</p>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                Puede generar las cuotas mensuales de todos los socios activos con un solo clic.
              </p>
              {isManagement && (
                <button
                  type="button"
                  data-tutorial-target="btn-collect-member-fee"
                  onClick={() => setIsGenerateDuesModalOpen(true)}
                  className="px-4 py-2 bg-[#064e3b] text-[#facc15] font-bold text-xs rounded-xl inline-flex items-center gap-2 shadow"
                >
                  <Plus className="w-4 h-4" />
                  Emitir Cuotas de {selectedPeriod} Ahora
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
              {dues.map((due) => {
                const isPaid = due.status === 'paid'
                const isPartial = due.status === 'partial'

                return (
                  <div
                    key={due.id}
                    className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 font-mono font-bold text-xs text-[#064e3b] flex items-center justify-center shrink-0">
                        {due.memberNumber}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-slate-900">
                            {due.memberName}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isPaid
                                ? 'bg-emerald-100 text-emerald-800'
                                : isPartial
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isPaid ? 'PAGADO' : isPartial ? 'PARCIAL' : 'PENDIENTE'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                          <span>Nº Cuota: <strong>{due.dueNumber || due.id}</strong></span>
                          <span>Vencimiento: {due.dueDate || 'N/D'}</span>
                          {due.paymentsCount ? (
                            <span className="text-slate-600">
                              {due.paymentsCount} pago(s) registrado(s)
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0">
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">
                          Total: {formatCurrencyBob(due.amountCents || Math.round(due.amountBob * 100), true)}
                        </span>
                        <span
                          className={`text-sm font-extrabold font-mono ${
                            isPaid ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          Saldo: {formatCurrencyBob(due.balanceCents !== undefined ? due.balanceCents : Math.round(due.balanceBob * 100), true)}
                        </span>
                      </div>

                      {isCashier && !isPaid && (
                        <button
                          type="button"
                          onClick={() => handleOpenCollect(due)}
                          className="px-3.5 py-2 bg-[#064e3b] hover:bg-emerald-800 text-[#facc15] font-extrabold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm"
                        >
                          <DollarSign className="w-4 h-4" />
                          <span>Cobrar Cuota</span>
                        </button>
                      )}

                      {isPaid && (
                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Al Día
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          MODAL 1: ALTA / EDICIÓN DE SOCIO
         ========================================================================= */}
      {isMemberModalOpen && (
        <MemberFormModal
          isOpen={isMemberModalOpen}
          editingMember={editingMember}
          onClose={() => setIsMemberModalOpen(false)}
          onSuccess={(saved) => {
            setIsMemberModalOpen(false)
            setFeedback({
              type: 'success',
              message: `Socio ${saved.memberNumber} - ${saved.fullName} guardado exitosamente.`,
            })
          }}
        />
      )}

      {/* =========================================================================
          MODAL 2: COBRO DE CUOTA MENSUAL (CON ARQUEO DE CAJA E IMPRESIÓN)
         ========================================================================= */}
      {isCollectModalOpen && selectedDueToCollect && (
        <CollectDueModal
          isOpen={isCollectModalOpen}
          due={selectedDueToCollect}
          currentUser={currentUser}
          currentBranch={currentBranch}
          activeShift={effectiveShift}
          onClose={() => setIsCollectModalOpen(false)}
          onSuccess={(receipt) => {
            setIsCollectModalOpen(false)
            setFeedback({
              type: 'success',
              message: `Aporte registrado exitosamente. Recibo: ${receipt.receiptNumber} (${receipt.status === 'paid' ? 'Total cancelado' : 'Pago parcial'}).`,
            })
          }}
        />
      )}

      {/* =========================================================================
          MODAL 3: EXTRACTO DE CUENTA HISTÓRICO
         ========================================================================= */}
      {isStatementModalOpen && (
        <AccountStatementModal
          isOpen={isStatementModalOpen}
          statement={statementData}
          loading={loadingStatement}
          onClose={() => setIsStatementModalOpen(false)}
        />
      )}

      {/* =========================================================================
          MODAL 4: EMISIÓN MASIVA DE CUOTAS
         ========================================================================= */}
      {isGenerateDuesModalOpen && (
        <GenerateDuesModal
          isOpen={isGenerateDuesModalOpen}
          period={selectedPeriod}
          activeMembersCount={metrics.activeCount}
          loading={generatingDues}
          onClose={() => setIsGenerateDuesModalOpen(false)}
          onConfirm={async () => {
            setGeneratingDues(true)
            try {
              const res = await generateMonthlyDuesThroughBackend({ period: selectedPeriod })
              setIsGenerateDuesModalOpen(false)
              setFeedback({
                type: 'success',
                message: `Emisión de cuotas completada: ${res.generatedCount} cuotas creadas (${res.skippedCount} omitidas por existir previamente).`,
              })
            } catch (err: any) {
              setFeedback({ type: 'error', message: err.message || 'Error al emitir cuotas mensuales.' })
            } finally {
              setGeneratingDues(false)
            }
          }}
        />
      )}
    </div>
  )
}

/* =========================================================================
   SUB-MODAL 1: FORMULARIO DE SOCIO (NUEVO / EDITAR)
   ========================================================================= */
interface MemberFormModalProps {
  isOpen: boolean
  editingMember?: UnionMember | null
  onClose: () => void
  onSuccess: (member: UnionMember) => void
}

const MemberFormModal: React.FC<MemberFormModalProps> = ({
  isOpen,
  editingMember,
  onClose,
  onSuccess,
}) => {
  const [memberNumber, setMemberNumber] = useState(editingMember?.memberNumber || '')
  const [fullName, setFullName] = useState(editingMember?.fullName || '')
  const [ci, setCi] = useState(editingMember?.ci || '')
  const [phone, setPhone] = useState(editingMember?.phone || '')
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended' | 'honorary'>(
    editingMember?.status || 'active'
  )
  const [category, setCategory] = useState<'propietario_transporte' | 'conductor' | 'socio_general'>(
    editingMember?.category || 'propietario_transporte'
  )
  const [vehiclePlate, setVehiclePlate] = useState(editingMember?.vehiclePlate || '')
  const [assignedMobileNumber, setAssignedMobileNumber] = useState(
    editingMember?.assignedMobileNumber || ''
  )
  const [monthlyFeeBob, setMonthlyFeeBob] = useState<string>(
    editingMember ? String(editingMember.monthlyFeeBob || 50) : '50'
  )
  const [notes, setNotes] = useState(editingMember?.notes || '')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!memberNumber.trim()) {
      setErrorMessage('El número de socio es obligatorio (ej. SOC-001).')
      return
    }
    if (!fullName.trim() || fullName.trim().length < 3) {
      setErrorMessage('El nombre completo es obligatorio.')
      return
    }

    const feeNum = parseFloat(monthlyFeeBob)
    if (isNaN(feeNum) || feeNum < 0) {
      setErrorMessage('La cuota mensual debe ser un número válido.')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const res = await manageUnionMemberThroughBackend({
        id: editingMember?.id,
        memberNumber: memberNumber.trim().toUpperCase(),
        fullName: fullName.trim(),
        ci: ci.trim(),
        phone: phone.trim(),
        status,
        category,
        vehiclePlate: vehiclePlate.trim().toUpperCase() || undefined,
        assignedMobileNumber: assignedMobileNumber.trim() || undefined,
        monthlyFeeBob: feeNum,
        notes: notes.trim() || undefined,
      })
      onSuccess(res.member)
    } catch (err: any) {
      console.error('[MemberFormModal] Error:', err)
      setErrorMessage(err.message || 'Error al guardar los datos del socio.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        <div className="bg-[#064e3b] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#facc15]" />
            <h3 className="text-base font-extrabold text-[#facc15]">
              {editingMember ? 'EDITAR SOCIO AFILIADO' : 'NUEVO SOCIO AFILIADO'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-emerald-800 text-emerald-200 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Nº de Socio *
              </label>
              <input
                type="text"
                placeholder="ej. SOC-001"
                value={memberNumber}
                onChange={(e) => setMemberNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none uppercase"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Estado *
              </label>
              <select
                value={status}
                onChange={(e: any) => setStatus(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="suspended">Suspendido</option>
                <option value="honorary">Honorario</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
              Nombre Completo *
            </label>
            <input
              type="text"
              placeholder="Apellidos y Nombres"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Cédula de Identidad (CI)
              </label>
              <input
                type="text"
                placeholder="ej. 3456789"
                value={ci}
                onChange={(e) => setCi(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Teléfono / Celular
              </label>
              <input
                type="text"
                placeholder="ej. 71712345"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Categoría
              </label>
              <select
                value={category}
                onChange={(e: any) => setCategory(e.target.value)}
                className="w-full px-2.5 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="propietario_transporte">Propietario</option>
                <option value="conductor">Conductor</option>
                <option value="socio_general">General</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Nº Móvil
              </label>
              <input
                type="text"
                placeholder="ej. 14"
                value={assignedMobileNumber}
                onChange={(e) => setAssignedMobileNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Placa Vehículo
              </label>
              <input
                type="text"
                placeholder="ej. 4055-XYZ"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
              Cuota Mensual Ordinaria (Bs) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Bs</span>
              <input
                type="number"
                step="1"
                min="0"
                value={monthlyFeeBob}
                onChange={(e) => setMonthlyFeeBob(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
              Notas u Observaciones
            </label>
            <textarea
              rows={2}
              placeholder="Detalles sobre aportes, acuerdos o antigüedad..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-[#064e3b] hover:bg-emerald-800 text-white font-extrabold text-xs rounded-xl transition shadow disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar Socio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* =========================================================================
   SUB-MODAL 2: COBRO DE CUOTA MENSUAL
   ========================================================================= */
interface CollectDueModalProps {
  isOpen: boolean
  due: UnionMonthlyDue
  currentUser: UserProfile
  currentBranch: Branch
  activeShift?: CashShift | null
  onClose: () => void
  onSuccess: (result: CollectMemberDueResult) => void
}

const CollectDueModal: React.FC<CollectDueModalProps> = ({
  isOpen,
  due,
  currentUser,
  currentBranch,
  activeShift,
  onClose,
  onSuccess,
}) => {
  const pendingAmountBob = due.balanceCents !== undefined ? due.balanceCents / 100 : due.balanceBob || 50
  const [amountBob, setAmountBob] = useState<string>(pendingAmountBob.toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completedResult, setCompletedResult] = useState<CollectMemberDueResult | null>(null)

  if (!isOpen) return null

  const handleSetFullAmount = () => {
    setAmountBob(pendingAmountBob.toFixed(2))
  }

  const handleConfirm = async () => {
    const num = parseFloat(amountBob)
    if (isNaN(num) || num <= 0) {
      setErrorMessage('Ingrese un monto válido mayor a 0.')
      return
    }

    const amountCents = Math.round(num * 100)
    const maxBalanceCents = due.balanceCents !== undefined ? due.balanceCents : Math.round(pendingAmountBob * 100)

    if (amountCents > maxBalanceCents) {
      setErrorMessage(`El monto a pagar no puede superar el saldo adeudado (Bs ${pendingAmountBob.toFixed(2)}).`)
      return
    }

    if (paymentMethod === 'cash' && !activeShift) {
      setErrorMessage('Para cobrar en efectivo se requiere un turno de caja abierto en esta sucursal.')
      return
    }

    setLoading(true)
    setErrorMessage(null)

    try {
      const idempotencyKey = `due-pay-${due.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      const res = await collectMemberDueThroughBackend({
        dueId: due.id,
        amountCents,
        paymentMethod,
        shiftId: activeShift?.id || null,
        branchId: currentBranch.id,
        notes: notes.trim(),
        idempotencyKey,
      })

      setCompletedResult(res)
      onSuccess(res)
    } catch (err: any) {
      console.error('[CollectDueModal] Error:', err)
      setErrorMessage(err.message || 'Error al procesar el pago de la cuota.')
    } finally {
      setLoading(false)
    }
  }

  const handlePrintReceipt = async () => {
    if (!completedResult) return
    const doc = printEngine.buildFromMemberPayment(
      completedResult,
      { memberNumber: due.memberNumber, fullName: due.memberName },
      currentBranch.id,
      currentUser.fullName
    )
    await printEngine.printDocument(doc)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="bg-[#064e3b] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <DollarSign className="w-5 h-5 text-[#facc15]" />
            <div>
              <h3 className="text-sm font-extrabold text-[#facc15] uppercase">
                COBRO DE CUOTA SINDICAL
              </h3>
              <p className="text-[11px] text-emerald-200">
                {due.periodLabel || due.period} • {due.memberNumber}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-emerald-800 text-emerald-200 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {completedResult ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h4 className="text-base font-extrabold text-slate-800">
                ¡PAGO REGISTRADO EXITOSAMENTE!
              </h4>
              <p className="text-sm font-mono font-bold text-[#064e3b]">
                {completedResult.receiptNumber}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Socio: <strong>{completedResult.memberNumber} — {completedResult.memberName}</strong>
              </p>
              <p className="text-xl font-extrabold text-emerald-700 font-mono mt-2">
                Bs {completedResult.amountBob.toFixed(2)}
              </p>
              <p className="text-xs text-slate-500">
                {completedResult.remainingBalanceBob > 0
                  ? `Saldo adeudado restante: Bs ${completedResult.remainingBalanceBob.toFixed(2)}`
                  : 'Cuota cancelada en su totalidad.'}
              </p>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
              <button
                type="button"
                onClick={handlePrintReceipt}
                className="w-full py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
              >
                <Printer className="w-4 h-4 text-[#facc15]" />
                <span>Imprimir Recibo de Aporte (80mm / 58mm)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition"
            >
              Cerrar Ventana
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Socio:</span>
                <span className="font-extrabold text-slate-900">
                  {due.memberNumber} - {due.memberName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Período:</span>
                <span className="font-bold text-[#064e3b]">{due.periodLabel || due.period}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Saldo Pendiente:</span>
                <span className="font-mono font-extrabold text-red-700">
                  Bs {pendingAmountBob.toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 uppercase">
                  Monto a Pagar (Bs) *
                </label>
                <button
                  type="button"
                  onClick={handleSetFullAmount}
                  className="text-[11px] text-emerald-700 font-bold hover:underline"
                >
                  Pagar Saldo Total
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Bs</span>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max={pendingAmountBob}
                  value={amountBob}
                  onChange={(e) => setAmountBob(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-mono font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Método de Pago *
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition ${
                    paymentMethod === 'cash'
                      ? 'bg-emerald-50 border-[#064e3b] text-[#064e3b]'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Efectivo
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('qr')}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition ${
                    paymentMethod === 'qr'
                      ? 'bg-emerald-50 border-[#064e3b] text-[#064e3b]'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  QR Simple
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('transfer')}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition ${
                    paymentMethod === 'transfer'
                      ? 'bg-emerald-50 border-[#064e3b] text-[#064e3b]'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Transferencia
                </button>
              </div>
            </div>

            {paymentMethod === 'cash' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                {activeShift ? (
                  <p>
                    ✓ El cobro ingresará al turno activo de <strong>{activeShift.operatorName}</strong> ({activeShift.branchId}).
                  </p>
                ) : (
                  <p className="text-red-700 font-bold">
                    Atención: No tiene un turno de caja abierto para recibir efectivo físico.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Observaciones del Recibo
              </label>
              <input
                type="text"
                placeholder="ej. Pago mes adelantado, recibo manual provisorio..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading || (paymentMethod === 'cash' && !activeShift)}
                className="px-5 py-2 bg-[#064e3b] hover:bg-emerald-800 text-white font-extrabold text-xs rounded-xl transition shadow disabled:opacity-50"
              >
                {loading ? 'Procesando...' : 'Confirmar Cobro y Emitir Recibo'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   SUB-MODAL 3: EXTRACTO DE CUENTA HISTÓRICO
   ========================================================================= */
interface AccountStatementModalProps {
  isOpen: boolean
  statement: MemberAccountStatementResult | null
  loading: boolean
  onClose: () => void
}

const AccountStatementModal: React.FC<AccountStatementModalProps> = ({
  isOpen,
  statement,
  loading,
  onClose,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
        <div className="bg-[#064e3b] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-[#facc15]" />
            <h3 className="text-base font-extrabold text-[#facc15]">
              ESTADO DE CUENTA Y EXTRACTO DE APORTES
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-emerald-800 text-emerald-200 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading || !statement ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-600">Calculando estado contable del socio...</p>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Cabecera del socio */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-mono text-xs font-extrabold text-[#064e3b] bg-emerald-100 px-2 py-0.5 rounded">
                  {statement.member.memberNumber}
                </span>
                <h4 className="text-base font-extrabold text-slate-900 mt-1">
                  {statement.member.fullName}
                </h4>
                <p className="text-xs text-slate-500">
                  CI: {statement.member.ci || 'N/D'} • Tel: {statement.member.phone || 'N/D'}
                </p>
              </div>

              <div className="text-right">
                <span
                  className={`text-xs font-extrabold px-3 py-1 rounded-full ${
                    statement.summary.isUpToDate
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {statement.summary.isUpToDate ? 'AL DÍA' : `${statement.summary.overdueCount} EN MORA`}
                </span>
                <p className="text-sm font-extrabold font-mono text-red-700 mt-2">
                  Saldo Deudor: Bs {statement.summary.totalBalanceBob.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Resumen contable */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Facturado</span>
                <p className="text-sm font-extrabold text-slate-800 font-mono mt-0.5">
                  Bs {statement.summary.totalBilledBob.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <span className="text-[10px] font-bold text-emerald-700 uppercase">Pagado</span>
                <p className="text-sm font-extrabold text-emerald-800 font-mono mt-0.5">
                  Bs {statement.summary.totalPaidBob.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-red-50 rounded-xl border border-red-200">
                <span className="text-[10px] font-bold text-red-700 uppercase">Saldo Pendiente</span>
                <p className="text-sm font-extrabold text-red-800 font-mono mt-0.5">
                  Bs {statement.summary.totalBalanceBob.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Detalle de cuotas */}
            <div className="space-y-2">
              <h5 className="text-xs font-bold text-slate-700 uppercase">
                Historial de Cuotas ({statement.dues.length})
              </h5>

              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {statement.dues.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500 text-center">
                    No se registran cuotas emitidas para este socio.
                  </p>
                ) : (
                  statement.dues.map((d) => (
                    <div key={d.id} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-800 block">
                          {d.periodLabel || d.period}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Vence: {d.dueDate} • {d.dueNumber}
                        </span>
                      </div>

                      <div className="text-right">
                        <span
                          className={`font-bold font-mono ${
                            d.status === 'paid' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {d.status === 'paid'
                            ? `PAGADO (Bs ${(d.amountBob || ((d.amountCents ?? 0) / 100)).toFixed(2)})`
                            : `DEBE: Bs ${(d.balanceBob || ((d.balanceCents ?? 0) / 100)).toFixed(2)}`}
                        </span>
                        {d.paidAtIso && (
                          <span className="text-[10px] text-slate-400 block">
                            Cancelado el {new Date(d.paidAtIso).toLocaleDateString('es-BO')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition"
              >
                Cerrar Extracto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   SUB-MODAL 4: EMISIÓN MASIVA DE CUOTAS MENSUALES
   ========================================================================= */
interface GenerateDuesModalProps {
  isOpen: boolean
  period: string
  activeMembersCount: number
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}

const GenerateDuesModal: React.FC<GenerateDuesModalProps> = ({
  isOpen,
  period,
  activeMembersCount,
  loading,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 p-6 space-y-4">
        <div className="w-12 h-12 bg-emerald-100 text-[#064e3b] rounded-2xl flex items-center justify-center mx-auto shadow-sm">
          <Calendar className="w-6 h-6" />
        </div>

        <div className="text-center space-y-1">
          <h3 className="text-base font-extrabold text-slate-900">
            ¿Emitir Cuotas del Período {period}?
          </h3>
          <p className="text-xs text-slate-600">
            Esta acción generará la cuota mensual ordinaria para los{' '}
            <strong>{activeMembersCount} socios activos</strong> del padrón oficial.
          </p>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
          <p>
            • Operación idempotente: Los socios que ya tengan cuota registrada para {period} no serán duplicados.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-5 py-2 bg-[#064e3b] hover:bg-emerald-800 text-[#facc15] font-extrabold text-xs rounded-xl transition shadow disabled:opacity-50"
          >
            {loading ? 'Generando...' : 'Confirmar Emisión'}
          </button>
        </div>
      </div>
    </div>
  )
}
