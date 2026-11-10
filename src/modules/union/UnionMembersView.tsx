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
  PlusCircle,
  RefreshCw,
  Receipt,
} from 'lucide-react'
import type {
  UnionMember,
  UnionMonthlyDue,
  CashShift,
  Branch,
  UserProfile,
  DriverDirectoryEntry,
  UnionSportsEvent,
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
  type UnionMemberChild,
  addUnionMemberChildThroughBackend,
  updateUnionMemberChildThroughBackend,
  listDriversForUnionLinksThroughBackend,
  setUnionMemberDriverLinkThroughBackend,
  getUnionMembersRosterThroughBackend,
  listUnionLoansThroughBackend,
  type UnionLoan,
  listUnionFinesThroughBackend,
  type UnionFine,
  listUnionSportsEventsThroughBackend,
} from '../../services/unionService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'
import { downloadUnionMembersRosterPdf, filterUnionRosterMembers } from '../../services/unionRosterPdfService.ts'
import { UnionLoansView } from './UnionLoansView.tsx'
import { UnionFinesView } from './UnionFinesView.tsx'
import { UnionSportsView } from './UnionSportsView.tsx'

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
  const [activeTab, setActiveTab] = useState<'members' | 'dues' | 'loans' | 'fines' | 'sports'>('members')
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended' | 'retired'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Modales
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<UnionMember | null>(null)

  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false)
  const [selectedDueToCollect, setSelectedDueToCollect] = useState<UnionMonthlyDue | null>(null)

  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false)
  const [statementData, setStatementData] = useState<MemberAccountStatementResult | null>(null)
  const [statementLoans, setStatementLoans] = useState<UnionLoan[]>([])
  const [statementFines, setStatementFines] = useState<UnionFine[]>([])
  const [statementSportsEvents, setStatementSportsEvents] = useState<UnionSportsEvent[]>([])
  const [loadingStatement, setLoadingStatement] = useState(false)
  const [childMember, setChildMember] = useState<UnionMember | null>(null)
  const [editingChild, setEditingChild] = useState<UnionMemberChild | null>(null)
  const [childrenNotice, setChildrenNotice] = useState('')
  const [activeDrivers, setActiveDrivers] = useState<DriverDirectoryEntry[]>([])
  const [savingDriverLinkFor, setSavingDriverLinkFor] = useState<string | null>(null)
  const [driverLinksNotice, setDriverLinksNotice] = useState('')
  const [driverLinksError, setDriverLinksError] = useState('')

  const [isGenerateDuesModalOpen, setIsGenerateDuesModalOpen] = useState(false)
  const [generatingDues, setGeneratingDues] = useState(false)
  const [printingRoster, setPrintingRoster] = useState(false)

  // Feedback y mensajes
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const isManagement = currentUser.role === 'directiva_admin' || currentUser.role === 'tesoreria'
  const canPrintRoster = ['directiva_admin', 'tesoreria', 'encargado_agencia'].includes(currentUser.role)
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
    return filterUnionRosterMembers(members, { searchTerm, status: statusFilter })
      .filter((member) => categoryFilter === 'all' || member.category === categoryFilter)
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
    setStatementLoans([])
    setStatementFines([])
    setStatementSportsEvents([])
    setDriverLinksNotice('')
    setDriverLinksError('')
    try {
      const res = await getMemberAccountStatementThroughBackend(member.id)
      setStatementData(res)
      try {
        setStatementLoans(await listUnionLoansThroughBackend(member.id))
      } catch (loanError: any) {
        setStatementLoans([])
        setFeedback({ type: 'error', message: loanError?.message || 'No se pudieron consultar los préstamos del afiliado.' })
      }
      try { setStatementFines(await listUnionFinesThroughBackend({ memberId: member.id })) }
      catch (fineError: any) { setFeedback({ type: 'error', message: fineError?.message || 'No se pudieron consultar las multas del afiliado.' }) }
      try { setStatementSportsEvents(await listUnionSportsEventsThroughBackend({ memberId: member.id })) }
      catch (sportsError: any) { setStatementSportsEvents([]); setFeedback({ type: 'error', message: sportsError?.message || 'No se pudo consultar el historial deportivo del afiliado.' }) }
      try {
        const drivers = await listDriversForUnionLinksThroughBackend()
        setActiveDrivers(drivers)
        setDriverLinksError('')
      } catch (driversError: any) {
        setActiveDrivers([])
        setDriverLinksError(driversError?.message || 'No se pudo consultar el directorio de conductores.')
      }
    } catch (err: any) {
      console.error('[UnionMembersView] Error extracto:', err)
      setFeedback({ type: 'error', message: err.message || 'Error al cargar el extracto de cuenta.' })
    } finally {
      setLoadingStatement(false)
    }
  }

  const handlePrintRoster = async (scope: 'completo' | 'filtrado') => {
    if (!canPrintRoster || printingRoster) return
    setPrintingRoster(true)
    try {
      const memberIds = scope === 'filtrado' ? filteredMembers.map((member) => member.id) : undefined
      const roster = memberIds && memberIds.length === 0
        ? []
        : await getUnionMembersRosterThroughBackend(memberIds)
      const pageCount = downloadUnionMembersRosterPdf(roster, scope)
      setFeedback({
        type: 'success',
        message: `Padrón ${scope} generado: ${roster.length} afiliados en ${pageCount} página${pageCount === 1 ? '' : 's'}.`,
      })
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'No se pudo generar el padrón de afiliados.' })
    } finally {
      setPrintingRoster(false)
    }
  }

  const handleDriverLinkChange = async (childId: string | null, driverUid: string) => {
    if (!statementData) return
    const key = childId || 'primary'
    setSavingDriverLinkFor(key)
    setDriverLinksError('')
    setDriverLinksNotice('')
    try {
      const result = await setUnionMemberDriverLinkThroughBackend({
        memberId: statementData.member.id,
        childId: childId || undefined,
        driverUid: driverUid || null,
      })
      setStatementData((current) => {
        if (!current) return current
        if (childId) {
          return {
            ...current,
            children: current.children.map((child) => child.id === childId
              ? { ...child, driverUid: result.relation.driverUid, driverName: result.relation.driverName, driverLinkedAtIso: result.relation.driverLinkedAtIso }
              : child),
          }
        }
        return {
          ...current,
          member: { ...current.member, primaryDriverUid: result.relation.primaryDriverUid, primaryDriverName: result.relation.primaryDriverName, primaryDriverLinkedAtIso: result.relation.primaryDriverLinkedAtIso },
        }
      })
      setDriverLinksNotice(childId ? 'Vínculo del hijo actualizado.' : 'Chofer principal actualizado.')
    } catch (err: any) {
      setDriverLinksError(err?.message || 'No se pudo guardar el vínculo del conductor.')
    } finally {
      setSavingDriverLinkFor(null)
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
                  Padrón de Afiliados y Gestión de Cuotas
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
                  <span>+ Nuevo Afiliado</span>
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
          <span>Padrón de Afiliados ({members.length})</span>
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

        <button
          type="button"
          onClick={() => setActiveTab('loans')}
          className={`px-4 py-2.5 font-bold text-xs border-b-2 transition flex items-center gap-2 ${activeTab === 'loans' ? 'border-[#064e3b] text-[#064e3b]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          <DollarSign className="w-4 h-4" />
          <span>Préstamos internos</span>
        </button>
        <button type="button" onClick={() => setActiveTab('fines')} className={`px-4 py-2.5 font-bold text-xs border-b-2 transition flex items-center gap-2 ${activeTab === 'fines' ? 'border-[#064e3b] text-[#064e3b]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          <AlertTriangle className="w-4 h-4" /><span>Multas</span>
        </button>
        <button type="button" onClick={() => setActiveTab('sports')} className={`px-4 py-2.5 font-bold text-xs border-b-2 transition flex items-center gap-2 ${activeTab === 'sports' ? 'border-[#064e3b] text-[#064e3b]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          <Calendar className="w-4 h-4" /><span>Deportes</span>
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
                placeholder="Buscar por nombre, afiliado (SOC-...), CI, móvil o placa..."
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
                <option value="retired">Retirados</option>
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
                <option value="socio_general">Afiliado General</option>
              </select>
            </div>
          </div>

          {canPrintRoster && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-emerald-900">El PDF incluye la ficha y los hijos vinculados. La impresión no modifica datos.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={printingRoster || loadingMembers}
                  onClick={() => void handlePrintRoster('filtrado')}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#064e3b] px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  {printingRoster ? 'Generando PDF…' : `Imprimir padrón de afiliados (${filteredMembers.length})`}
                </button>
                <button
                  type="button"
                  disabled={printingRoster || loadingMembers}
                  onClick={() => void handlePrintRoster('completo')}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-800 px-3 py-2 text-xs font-bold text-emerald-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" />
                  Imprimir padrón completo ({members.length})
                </button>
              </div>
            </div>
          )}

          {/* Listado de Afiliados */}
          {loadingMembers ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Cargando padrón oficial de afiliados...</p>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 shadow-sm">
              <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">
                {searchTerm ? 'No se encontraron afiliados' : 'Aún no existen afiliados registrados.'}
              </p>
              <p className="text-xs text-slate-500 mt-1 mb-3">
                {searchTerm ? 'Intente con otros criterios de búsqueda.' : 'El padrón oficial sindical está listo para incorporar al primer afiliado transportista o conductor.'}
              </p>
              {!searchTerm && (
                <button
                  type="button"
                  onClick={() => setIsMemberModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#064e3b] hover:bg-[#053d2e] text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-[#facc15]" />
                  <span>Agregar afiliado</span>
                </button>
              )}
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
                          title="Editar datos del afiliado"
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
                Puede generar las cuotas mensuales de todos los afiliados activos con un solo clic.
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

      {activeTab === 'loans' && (
        <UnionLoansView
          members={members}
          currentUser={currentUser}
          currentBranch={currentBranch}
          activeShift={effectiveShift}
        />
      )}
      {activeTab === 'fines' && <UnionFinesView members={members} canCreate={isManagement} canCollect={['directiva_admin', 'tesoreria', 'secretaria', 'encargado_agencia'].includes(currentUser.role)} activeShift={effectiveShift} branchId={currentBranch.id} />}
      {activeTab === 'sports' && <UnionSportsView members={members} canManage={isManagement} canDecide={currentUser.role === 'directiva_admin'} />}

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
              message: `Afiliado ${saved.memberNumber} - ${saved.fullName} guardado exitosamente.`,
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
          loans={statementLoans}
          fines={statementFines}
          sportsEvents={statementSportsEvents}
          loading={loadingStatement}
          canManageChildren={isManagement}
          childrenNotice={childrenNotice}
          onAddChild={() => {
            if (statementData) {
              setEditingChild(null)
              setChildrenNotice('')
              setChildMember(statementData.member)
            }
          }}
          onEditChild={(child) => {
            if (statementData) {
              setEditingChild(child)
              setChildrenNotice('')
              setChildMember(statementData.member)
            }
          }}
          drivers={activeDrivers}
          driverLinkError={driverLinksError}
          driverLinkNotice={driverLinksNotice}
          savingDriverLinkFor={savingDriverLinkFor}
          onSetDriverLink={handleDriverLinkChange}
          onClose={() => setIsStatementModalOpen(false)}
        />
      )}

      {childMember && (
        <AddChildModal
          member={childMember}
          child={editingChild}
          onClose={() => { setChildMember(null); setEditingChild(null) }}
          onSave={async (child) => {
            const savedChild = editingChild
              ? await updateUnionMemberChildThroughBackend({
                  memberId: childMember.id,
                  childId: editingChild.id,
                  child,
                })
              : (await addUnionMemberChildThroughBackend({ memberId: childMember.id, child })).child
            setStatementData((current) => current
              ? { ...current, children: editingChild
                  ? current.children.map((existing) => existing.id === savedChild.id ? savedChild : existing)
                  : [...current.children, savedChild].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || ''))) }
              : current)
            setChildrenNotice(editingChild ? 'Los datos del hijo se actualizaron correctamente.' : 'El hijo se registró correctamente.')
            setChildMember(null)
            setEditingChild(null)
          }}
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
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended' | 'honorary' | 'retired'>(
    editingMember?.status || 'active'
  )
  const [ciComplement, setCiComplement] = useState(editingMember?.ciComplement || '')
  const [alternatePhone, setAlternatePhone] = useState(editingMember?.alternatePhone || '')
  const [address, setAddress] = useState(editingMember?.address || '')
  const [locality, setLocality] = useState(editingMember?.locality || '')
  const [birthDate, setBirthDate] = useState(editingMember?.birthDate || '')
  const [joinedAt, setJoinedAt] = useState(editingMember?.joinedAt || new Date().toISOString().slice(0, 10))
  const [retiredAt, setRetiredAt] = useState(editingMember?.retiredAt || '')
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
      setErrorMessage('El número de afiliado es obligatorio (ej. SOC-001).')
      return
    }
    if (!fullName.trim() || fullName.trim().length < 3) {
      setErrorMessage('El nombre completo es obligatorio.')
      return
    }
    if (retiredAt && retiredAt < joinedAt) {
      setErrorMessage('La fecha de retiro no puede ser anterior a la fecha de ingreso.')
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
        ciComplement: ciComplement.trim(), alternatePhone: alternatePhone.trim(), address: address.trim(),
        locality: locality.trim(), birthDate, joinedAt, retiredAt,
        status: retiredAt ? 'retired' : status,
        category,
        vehiclePlate: vehiclePlate.trim().toUpperCase() || undefined,
        assignedMobileNumber: assignedMobileNumber.trim() || undefined,
        monthlyFeeBob: feeNum,
        notes: notes.trim() || undefined,
      })
      onSuccess(res.member)
    } catch (err: any) {
      console.error('[MemberFormModal] Error:', err)
      setErrorMessage(err.message || 'Error al guardar los datos del afiliado.')
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
              {editingMember ? 'EDITAR AFILIADO' : 'NUEVO AFILIADO'}
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
                Nº de Afiliado *
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
                <option value="retired">Retirado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-700">Complemento de CI<input value={ciComplement} onChange={e => setCiComplement(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-xl font-normal" /></label>
            <label className="text-xs font-bold text-slate-700">Teléfono alternativo<input value={alternatePhone} onChange={e => setAlternatePhone(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-xl font-normal" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-700">Domicilio<input value={address} onChange={e => setAddress(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-xl font-normal" /></label>
            <label className="text-xs font-bold text-slate-700">Ciudad o localidad<input value={locality} onChange={e => setLocality(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-xl font-normal" /></label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs font-bold text-slate-700">Nacimiento<input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} className="mt-1 w-full px-2 py-2 border rounded-xl font-normal" /></label>
            <label className="text-xs font-bold text-slate-700">Ingreso<input type="date" required value={joinedAt} onChange={e => setJoinedAt(e.target.value)} className="mt-1 w-full px-2 py-2 border rounded-xl font-normal" /></label>
            <label className="text-xs font-bold text-slate-700">Retiro<input type="date" value={retiredAt} onChange={e => setRetiredAt(e.target.value)} className="mt-1 w-full px-2 py-2 border rounded-xl font-normal" /></label>
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
              {loading ? 'Guardando...' : 'Guardar Afiliado'}
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
                Afiliado: <strong>{completedResult.memberNumber} — {completedResult.memberName}</strong>
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
                <span className="text-slate-500">Afiliado:</span>
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
interface AddChildModalProps {
  member: UnionMember
  child: UnionMemberChild | null
  onClose: () => void
  onSave: (child: { fullName: string; ci?: string; birthDate?: string; phone?: string; address?: string; notes?: string }) => Promise<void>
}

const AddChildModal: React.FC<AddChildModalProps> = ({ member, child, onClose, onSave }) => {
  const [fullName, setFullName] = useState(child?.fullName || '')
  const [ci, setCi] = useState(child?.ci || '')
  const [birthDate, setBirthDate] = useState(child?.birthDate || '')
  const [phone, setPhone] = useState(child?.phone || '')
  const [address, setAddress] = useState(child?.address || '')
  const [notes, setNotes] = useState(child?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedName = fullName.trim()
    if (normalizedName.length < 2) {
      setError('Ingresa el nombre completo del hijo (mínimo 2 caracteres).')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        fullName: normalizedName,
        ci: ci.trim(),
        birthDate,
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
      })
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar al hijo. Verifica tu autorización e inténtalo nuevamente.')
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="add-child-title">
      <form onSubmit={handleSubmit} className="my-auto w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between bg-[#064e3b] px-5 py-4 text-white">
          <div>
            <h3 id="add-child-title" className="font-extrabold text-[#facc15]">{child ? 'Editar hijo' : 'Agregar hijo'}</h3>
            <p className="mt-1 text-xs text-emerald-100">Afiliado: {member.fullName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar" className="rounded-lg p-1 text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-bold text-slate-700">Nombre completo <span className="text-red-600">*</span>
            <input autoFocus required minLength={2} maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-xs font-bold text-slate-700">CI (opcional)
            <input maxLength={30} value={ci} onChange={(e) => setCi(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-xs font-bold text-slate-700">Fecha de nacimiento (opcional)
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-xs font-bold text-slate-700">Teléfono (opcional)
            <input type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          <label className="text-xs font-bold text-slate-700">Domicilio (opcional)
            <input maxLength={180} value={address} onChange={(e) => setAddress(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          <label className="sm:col-span-2 text-xs font-bold text-slate-700">Observaciones (opcional)
            <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>
          {error && <p role="alert" className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={saving || fullName.trim().length < 2} className="rounded-lg bg-[#064e3b] px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Guardando…' : child ? 'Guardar cambios' : 'Guardar hijo'}</button>
        </footer>
      </form>
    </div>
  )
}

interface AccountStatementModalProps {
  isOpen: boolean
  statement: MemberAccountStatementResult | null
  loans: UnionLoan[]
  fines: UnionFine[]
  sportsEvents: UnionSportsEvent[]
  loading: boolean
  canManageChildren: boolean
  childrenNotice: string
  drivers: DriverDirectoryEntry[]
  driverLinkError: string
  driverLinkNotice: string
  savingDriverLinkFor: string | null
  onAddChild: () => void
  onEditChild: (child: UnionMemberChild) => void
  onSetDriverLink: (childId: string | null, driverUid: string) => void
  onClose: () => void
}

const AccountStatementModal: React.FC<AccountStatementModalProps> = ({
  isOpen,
  statement,
  loans,
  fines,
  sportsEvents,
  loading,
  canManageChildren,
  childrenNotice,
  drivers,
  driverLinkError,
  driverLinkNotice,
  savingDriverLinkFor,
  onAddChild,
  onEditChild,
  onSetDriverLink,
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
            <p className="text-xs font-bold text-slate-600">Calculando estado contable del afiliado...</p>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h5 className="text-sm font-extrabold text-emerald-950">Hijos ({statement.children.length})</h5>
                <p className="mt-1 text-xs text-emerald-800">Datos de hijos asociados a este afiliado.</p>
              </div>
              {canManageChildren && (
                <button type="button" onClick={onAddChild} className="shrink-0 rounded-lg bg-[#064e3b] px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">
                  Agregar hijo
                </button>
              )}
            </section>
            <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div><h5 className="text-sm font-extrabold text-slate-900">Préstamos internos ({loans.length})</h5><p className="mt-1 text-xs text-slate-600">Saldos y pagos del afiliado. El monto otorgado no se contabiliza como ingreso.</p></div>
              {loans.length === 0 ? <p className="text-xs text-slate-500">Este afiliado no tiene préstamos registrados.</p> : <div className="space-y-2">{loans.map((loan) => <article key={loan.id} className="rounded-lg border border-amber-100 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-slate-800">{loan.loanNumber} · {loan.status === 'paid' ? 'Pagado' : loan.status === 'overdue' ? 'Vencido' : 'Vigente'}</strong><span className="text-[11px] font-bold text-red-700">Saldo {formatCurrencyBob(loan.balanceCents, true)}</span></div><p className="mt-1 text-[11px] text-slate-600">Original {formatCurrencyBob(loan.principalCents, true)} · Pagado {formatCurrencyBob(loan.paidCents, true)} · Vencido {formatCurrencyBob(loan.overdueBalanceCents || 0, true)}</p><p className="mt-1 text-[10px] text-slate-500">{loan.installmentCount} cuotas · {loan.installments.filter((installment) => installment.status === 'paid').length} pagadas · {loan.payments.length} pagos recibidos</p></article>)}</div>}
            </section>
            <section className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <div><h5 className="text-sm font-extrabold text-slate-900">Historial deportivo ({sportsEvents.length} jornadas)</h5><p className="mt-1 text-xs text-slate-600">Convocatorias, asistencias, justificaciones y decisiones registradas.</p></div>
              {sportsEvents.length === 0 ? <p className="text-xs text-slate-500">Este afiliado no tiene jornadas deportivas registradas.</p> : sportsEvents.map((event) => {
                const participant = event.participants.find((entry) => entry.memberId === statement.member.id)
                if (!participant) return null
                const stateLabel = participant.attendance === 'present' ? 'Presente' : participant.attendance === 'late' ? 'Tardanza' : participant.attendance === 'absent' ? 'Ausente' : participant.attendance === 'exempt' ? 'Exento por autorización' : 'Pendiente de control'
                return <article key={event.id} className="rounded-lg border border-blue-100 bg-white p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{event.activityName}</strong><span>{event.date} · {event.scheduledTime} · {stateLabel}</span></div>{participant.sportsFine && <p className="mt-1">Multa {participant.sportsFine.fineNumber} · Importe {formatCurrencyBob(participant.sportsFine.amountCents, true)} · Pagado {formatCurrencyBob(participant.sportsFine.paidCents, true)} · Saldo {formatCurrencyBob(participant.sportsFine.balanceCents, true)} · {participant.sportsFine.status === 'voided' ? 'Anulada' : participant.sportsFine.status === 'paid' ? 'Pagada' : participant.sportsFine.status === 'partial' ? 'Parcial' : 'Pendiente'}</p>}{participant.sportsFine?.financialReviewRequired && <p className="mt-1 font-bold text-red-700">Situación financiera pendiente de revisión autorizada.</p>}{participant.justifications?.map((justification) => <p key={justification.id} className="mt-1 text-slate-600">Justificación: {justification.reason} · {justification.status === 'approved' ? 'Aprobada' : justification.status === 'rejected' ? 'Rechazada' : 'Pendiente'}{justification.decisionByName ? ` por ${justification.decisionByName}` : ''}</p>)}</article>
              })}
            </section>
            <section className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-4">
              <div><h5 className="text-sm font-extrabold text-slate-900">Multas ({fines.length})</h5><p className="mt-1 text-xs text-slate-600">Importes pendientes registrados para este afiliado.</p></div>
              {fines.length === 0 ? <p className="text-xs text-slate-500">Este afiliado no tiene multas registradas.</p> : fines.map((fine) => <article key={fine.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-red-100 bg-white p-3 text-xs"><div><strong>{fine.fineNumber} · {fine.reason}</strong><p className="mt-1 text-slate-600">{fine.category} · {fine.date}{fine.description ? ` · ${fine.description}` : ''}</p>{fine.financialReviewRequired && <p className="mt-1 font-bold text-red-700">Situación financiera pendiente de revisión autorizada.</p>}{fine.notes && <p className="mt-1 text-slate-500">Observaciones: {fine.notes}</p>}<details className="mt-2"><summary className="cursor-pointer font-bold text-emerald-800">Pagos ({fine.payments?.length || 0})</summary>{fine.payments?.map((payment) => <p key={payment.id} className="mt-1 text-slate-600">{payment.receiptNumber} · {new Date(payment.paidAtIso).toLocaleString('es-BO')} · {payment.collectedByName} · {formatCurrencyBob(payment.amountCents, true)}</p>)}</details></div><div className="text-right"><span className="block">Importe {formatCurrencyBob(fine.amountCents, true)}</span><span className="block text-emerald-700">Pagado {formatCurrencyBob(fine.paidCents || 0, true)}</span><strong className="text-red-700">Saldo {formatCurrencyBob(fine.balanceCents, true)}</strong><span className="block">{fine.status === 'paid' ? 'Pagada' : fine.status === 'partial' ? 'Parcialmente pagada' : fine.status === 'voided' ? 'Anulada por corrección' : 'Pendiente'}</span></div></article>)}
            </section>
            {childrenNotice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{childrenNotice}</p>}
            {statement.children.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">Este afiliado todavía no tiene hijos registrados.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {statement.children.map((child) => (
                  <article key={child.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h6 className="break-words text-sm font-extrabold text-slate-900">{child.fullName}</h6>
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          {child.ci && <p><span className="font-semibold">CI:</span> {child.ci}</p>}
                          {child.birthDate && <p><span className="font-semibold">Nacimiento:</span> {child.birthDate}</p>}
                          {child.phone && <p><span className="font-semibold">Teléfono:</span> {child.phone}</p>}
                          {child.address && <p className="break-words"><span className="font-semibold">Domicilio:</span> {child.address}</p>}
                          {child.notes && <p className="break-words"><span className="font-semibold">Observaciones:</span> {child.notes}</p>}
                        </div>
                      </div>
                      {canManageChildren && <button type="button" onClick={() => onEditChild(child)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-700 hover:text-emerald-800">Editar</button>}
                    </div>
                  </article>
                ))}
              </div>
            )}

            <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <h5 className="text-sm font-extrabold text-slate-900">Choferes vinculados</h5>
                <p className="mt-1 text-xs text-slate-600">Vínculos administrativos con conductores existentes. No modifican viajes, vehículos ni comisiones.</p>
              </div>
              {driverLinkError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{driverLinkError}</p>}
              {driverLinkNotice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">{driverLinkNotice}</p>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="min-w-0 text-xs font-bold text-slate-700">
                  Chofer principal del afiliado
                  {canManageChildren ? (
                    <select value={statement.member.primaryDriverUid || ''} disabled={savingDriverLinkFor === 'primary' || (drivers.length === 0 && Boolean(driverLinkError))} onChange={(event) => onSetDriverLink(null, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:opacity-60">
                      <option value="">Sin chofer vinculado</option>
                      {statement.member.primaryDriverUid && !drivers.some((driver) => driver.uid === statement.member.primaryDriverUid) && <option value={statement.member.primaryDriverUid}>{statement.member.primaryDriverName || `Conductor ${statement.member.primaryDriverUid}`} (no activo/no disponible)</option>}
                      {drivers.map((driver) => <option key={driver.uid} value={driver.uid}>{driver.fullName}{driver.assignedMobileNumber ? ` · Móvil ${driver.assignedMobileNumber}` : ''}{driver.assignedVehiclePlate ? ` · ${driver.assignedVehiclePlate}` : ''}</option>)}
                    </select>
                  ) : (
                    <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium">{drivers.find((driver) => driver.uid === statement.member.primaryDriverUid)?.fullName || statement.member.primaryDriverName || (statement.member.primaryDriverUid ? `Conductor ${statement.member.primaryDriverUid}` : 'Sin chofer vinculado')}</p>
                  )}
                </label>
                {statement.children.map((child) => {
                  const childDriver = drivers.find((driver) => driver.uid === child.driverUid)
                  const linkKey = child.id
                  return (
                    <label key={`child-driver-${child.id}`} className="min-w-0 text-xs font-bold text-slate-700">
                      Chofer vinculado · {child.fullName}
                      {canManageChildren ? (
                        <select value={child.driverUid || ''} disabled={savingDriverLinkFor === linkKey || (drivers.length === 0 && Boolean(driverLinkError))} onChange={(event) => onSetDriverLink(child.id, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:opacity-60">
                          <option value="">Sin chofer vinculado</option>
                          {child.driverUid && !drivers.some((driver) => driver.uid === child.driverUid) && <option value={child.driverUid}>{child.driverName || `Conductor ${child.driverUid}`} (no activo/no disponible)</option>}
                          {drivers.map((driver) => <option key={driver.uid} value={driver.uid}>{driver.fullName}{driver.assignedMobileNumber ? ` · Móvil ${driver.assignedMobileNumber}` : ''}{driver.assignedVehiclePlate ? ` · ${driver.assignedVehiclePlate}` : ''}</option>)}
                        </select>
                      ) : (
                        <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium">{childDriver?.fullName || child.driverName || (child.driverUid ? `Conductor ${child.driverUid}` : 'Sin chofer vinculado')}</p>
                      )}
                    </label>
                  )
                })}
              </div>
            </section>

            {/* Cabecera del afiliado */}
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
                    No se registran cuotas emitidas para este afiliado.
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
            <strong>{activeMembersCount} afiliados activos</strong> del padrón oficial.
          </p>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
          <p>
            • Operación idempotente: Los afiliados que ya tengan cuota registrada para {period} no serán duplicados.
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
