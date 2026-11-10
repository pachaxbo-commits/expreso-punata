import React, { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  Wallet,
  Truck,
  Users,
  Briefcase,
  Building2,
  Download,
  FileText,
  RefreshCw,
  Calendar,
  MapPin,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Filter,
} from 'lucide-react'
import {
  fetchSystemReport,
  exportToCsv,
  exportToXlsx,
  exportReportToPdf,
  type ReportType,
  type ShipmentsReportResult,
  type CashFinancialReportResult,
  type DriversReportResult,
  type UnionDuesReportResult,
  type PayrollExpensesReportResult,
  type FixedAssetsReportResult,
} from '../../services/reportService.ts'
import type { UserProfile, Branch } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { isEmulatedEnvironment } from '../../firebase/config.ts'

interface ReportsManagementViewProps {
  currentUser: UserProfile
  currentBranch: Branch
}

type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom'

const GENERIC_REPORTS: ReportType[] = ['members', 'loans', 'fines', 'sports', 'physical_inventory', 'commissions', 'consumables', 'incidents']
const GENERIC_REPORT_LABELS: Record<string, string> = {
  members: 'Afiliados y obligaciones', loans: 'Préstamos', fines: 'Multas y sanciones',
  sports: 'Deportes y asistencia', physical_inventory: 'Patrimonio y documentos',
  commissions: 'Comisiones de conductores', consumables: 'Almacén logístico', incidents: 'Incidencias de encomiendas',
}
const genericReportRecords = (data: any) => [
  ...(Array.isArray(data?.records) ? data.records.map((record: any) => ({ ...record, tipoRegistro: data.reportType })) : []),
  ...(Array.isArray(data?.documents) ? data.documents.map((record: any) => ({ ...record, tipoRegistro: 'documento_fisico' })) : []),
  ...(Array.isArray(data?.fines) ? data.fines.map((record: any) => ({ ...record, tipoRegistro: 'multa' })) : []),
  ...(Array.isArray(data?.attendanceRecords) ? data.attendanceRecords.map((record: any) => ({ ...record, tipoRegistro: 'asistencia_deportiva' })) : []),
  ...(Array.isArray(data?.movements) ? data.movements.map((record: any) => ({ ...record, tipoRegistro: 'movimiento_insumo' })) : []),
]
const reportDetailCount = (data: any) => Array.isArray(data?.records) ? genericReportRecords(data).length :
  (Array.isArray(data?.payrollPayments) ? data.payrollPayments.length : 0) + (Array.isArray(data?.expenses) ? data.expenses.length : 0)
const dashboardExportRows = (dashboard: any) => Object.entries(dashboard || {}).flatMap(([section, values]) =>
  Object.entries((values || {}) as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([key, value]) => [section, key, typeof value === 'number' && key.endsWith('Cents') ? formatCurrencyBob(value, true) : String(value)])
)
const genericReportColumns = (records: any[]) => Array.from(new Set(records.flatMap((record) => Object.entries(record)
  .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
  .map(([key]) => key))))
const genericReportCell = (value: any) => value === null || value === undefined ? '' : typeof value === 'number' ? value : String(value)
const laPazDateParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date()).map(({ type, value }) => [type, value])) as { year: string; month: string; day: string }

export const ReportsManagementView: React.FC<ReportsManagementViewProps> = ({
  currentUser,
  currentBranch,
}) => {
  const role = currentUser.role

  // Determinación de pestañas permitidas según rol
  const canViewAll = ['directiva_admin', 'tesoreria', 'encargado_agencia'].includes(role)
  const isConductor = role === 'conductor'
  const isSecretaria = role === 'secretaria'

  const [activeTab, setActiveTab] = useState<ReportType>(
    isConductor ? 'drivers' : canViewAll ? 'consolidated_dashboard' : 'shipments'
  )

  // Filtros de fecha y sucursal
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [period, setPeriod] = useState<string>(() => { const date = laPazDateParts(); return `${date.year}-${date.month}` })
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isSecretaria ? currentBranch.id : 'all'
  )
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [paymentConditionFilter, setPaymentConditionFilter] = useState<string>('all')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all')
  const [memberIdFilter, setMemberIdFilter] = useState<string>('')
  const [patrimonialLocationFilter, setPatrimonialLocationFilter] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState<number>(1)

  // Estados de datos y carga
  const [loading, setLoading] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [reportData, setReportData] = useState<any>(null)

  // Inicializar fechas según preset
  const applyDatePreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset)
    const parts = laPazDateParts()
    const y = Number(parts.year)
    const m = Number(parts.month) - 1
    const d = Number(parts.day)

    const formatDate = (date: Date) => {
      const year = date.getUTCFullYear()
      const month = String(date.getUTCMonth() + 1).padStart(2, '0')
      const day = String(date.getUTCDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    if (preset === 'today') {
      const todayStr = `${parts.year}-${parts.month}-${parts.day}`
      setStartDate(todayStr)
      setEndDate(todayStr)
    } else if (preset === 'yesterday') {
      const yest = new Date(Date.UTC(y, m, d - 1))
      const yestStr = formatDate(yest)
      setStartDate(yestStr)
      setEndDate(yestStr)
    } else if (preset === 'this_week') {
      const todayUtc = new Date(Date.UTC(y, m, d))
      const dayOfWeek = todayUtc.getUTCDay() || 7 // Lunes = 1
      const monday = new Date(Date.UTC(y, m, d - dayOfWeek + 1))
      setStartDate(formatDate(monday))
      setEndDate(`${parts.year}-${parts.month}-${parts.day}`)
    } else if (preset === 'this_month') {
      const firstDay = new Date(Date.UTC(y, m, 1))
      setStartDate(formatDate(firstDay))
      setEndDate(`${parts.year}-${parts.month}-${parts.day}`)
      setPeriod(`${y}-${String(m + 1).padStart(2, '0')}`)
    } else if (preset === 'last_month') {
      const firstDayLastMonth = new Date(Date.UTC(y, m - 1, 1))
      const lastDayLastMonth = new Date(Date.UTC(y, m, 0))
      setStartDate(formatDate(firstDayLastMonth))
      setEndDate(formatDate(lastDayLastMonth))
      setPeriod(
        `${firstDayLastMonth.getUTCFullYear()}-${String(firstDayLastMonth.getUTCMonth() + 1).padStart(2, '0')}`
      )
    }
  }, [])

  useEffect(() => {
    applyDatePreset('this_month')
  }, [applyDatePreset])

  // Carga de reporte desde backend
  const loadReport = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const params: any = {
        reportType: activeTab,
        branchId: isSecretaria ? currentBranch.id : selectedBranch,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        period: activeTab === 'dues' ? period : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        paymentCondition: paymentConditionFilter,
        paymentMethod: paymentMethodFilter,
        memberId: memberIdFilter.trim() || undefined,
        patrimonialLocationId: patrimonialLocationFilter,
        page: currentPage,
        pageSize: 500,
      }
      if (isConductor) {
        params.driverUid = currentUser.uid
      }

      const res = await fetchSystemReport(params)
      setReportData(res)
    } catch (err: any) {
      console.error('Error cargando reporte:', err)
      setErrorMsg(err.message || 'Error al obtener datos del reporte.')
    } finally {
      setLoading(false)
    }
  }, [
    activeTab,
    isSecretaria,
    isConductor,
    currentUser.uid,
    currentBranch.id,
    selectedBranch,
    startDate,
    endDate,
    period,
    statusFilter,
    categoryFilter,
    paymentConditionFilter,
    paymentMethodFilter,
    memberIdFilter,
    patrimonialLocationFilter,
    currentPage,
  ])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  // Pestañas disponibles con restricciones de rol
  const tabs = [
    {
      id: 'consolidated_dashboard' as ReportType,
      label: 'Tablero Consolidado',
      icon: TrendingUp,
      visible: canViewAll,
    },
    {
      id: 'shipments' as ReportType,
      label: 'Encomiendas y Logística',
      icon: Layers,
      visible: !isConductor,
    },
    {
      id: 'cash_financial' as ReportType,
      label: 'Caja y Finanzas',
      icon: Wallet,
      visible: !isConductor,
    },
    {
      id: 'drivers' as ReportType,
      label: 'Conductores y Custodia',
      icon: Truck,
      visible: canViewAll || isConductor,
    },
    {
      id: 'dues' as ReportType,
      label: 'Socios y Mensualidades',
      icon: Users,
      visible: ['directiva_admin', 'tesoreria'].includes(role),
    },
    {
      id: 'payroll_expenses' as ReportType,
      label: 'Personal y Gastos',
      icon: Briefcase,
      visible: ['directiva_admin', 'tesoreria'].includes(role),
    },
    {
      id: 'fixed_assets' as ReportType,
      label: 'Bienes Fijos e Inventario',
      icon: Building2,
      visible: canViewAll,
    },
    { id: 'members' as ReportType, label: GENERIC_REPORT_LABELS.members, icon: Users, visible: ['directiva_admin', 'tesoreria', 'encargado_agencia'].includes(role) },
    { id: 'loans' as ReportType, label: GENERIC_REPORT_LABELS.loans, icon: Wallet, visible: ['directiva_admin', 'tesoreria', 'encargado_agencia'].includes(role) },
    { id: 'fines' as ReportType, label: GENERIC_REPORT_LABELS.fines, icon: FileText, visible: ['directiva_admin', 'tesoreria', 'encargado_agencia'].includes(role) },
    { id: 'sports' as ReportType, label: GENERIC_REPORT_LABELS.sports, icon: Users, visible: ['directiva_admin', 'tesoreria', 'encargado_agencia'].includes(role) },
    { id: 'physical_inventory' as ReportType, label: GENERIC_REPORT_LABELS.physical_inventory, icon: Building2, visible: canViewAll },
    { id: 'commissions' as ReportType, label: GENERIC_REPORT_LABELS.commissions, icon: Truck, visible: canViewAll },
    { id: 'consumables' as ReportType, label: GENERIC_REPORT_LABELS.consumables, icon: Layers, visible: canViewAll },
    { id: 'incidents' as ReportType, label: GENERIC_REPORT_LABELS.incidents, icon: AlertTriangle, visible: canViewAll },
  ].filter((t) => t.visible)

  // Formateador de sucursal
  const getBranchLabel = (id?: string) => {
    if (!id || id === 'all') return 'Todas las Agencias'
    if (id === 'punata') return 'Agencia Punata'
    if (id === 'cochabamba') return 'Agencia Cochabamba'
    return id
  }

  // =========================================================================
  // EXPORTADORES A PDF Y EXCEL / CSV
  // =========================================================================

  const handleExportPdf = () => {
    if (!reportData) return
    const dateRangeStr =
      startDate && endDate ? `${startDate} al ${endDate}` : `Período: ${period || 'Actual'}`
    const branchLabel = `${getBranchLabel(selectedBranch)} · Estado: ${statusFilter} · Categoría: ${categoryFilter} · Condición de pago: ${paymentConditionFilter} · Método: ${paymentMethodFilter}${memberIdFilter ? ` · Afiliado: ${memberIdFilter}` : ''}${patrimonialLocationFilter !== 'all' ? ` · Sede: ${patrimonialLocationFilter}` : ''}`

    if (GENERIC_REPORTS.includes(activeTab)) {
      const records = genericReportRecords(reportData)
      const headers = genericReportColumns(records)
      const rows = records.map((record) => headers.map((key) => genericReportCell(record[key])))
      const summary = reportData.summary || {}
      const kpiCards = Object.entries(summary).filter(([key, value]) => typeof value === 'number' && !key.endsWith('Bob'))
        .slice(0, 4).map(([key, value]) => ({ label: key.replace(/([A-Z])/g, ' $1').replace(/Cents$/, ' (centavos)'), value: key.endsWith('Cents') ? formatCurrencyBob(Number(value), true) : String(value) }))
      exportReportToPdf({ title: `Reporte ${GENERIC_REPORT_LABELS[activeTab] || activeTab}`, dateRangeStr,
        branchLabel,
        generatedByName: currentUser.fullName, kpiCards, tableHeaders: headers.map((key) => key.replace(/([A-Z])/g, ' $1')),
        tableRows: rows, filename: `Reporte_${activeTab}_${startDate || 'periodo'}` })
      return
    }
    if (activeTab === 'consolidated_dashboard') {
      exportReportToPdf({ title: 'Reporte General de Expreso Punata', dateRangeStr, branchLabel,
        generatedByName: currentUser.fullName,
        tableHeaders: ['Sección', 'Indicador', 'Resultado'],
        tableRows: dashboardExportRows(reportData.dashboard), filename: `Reporte_General_${startDate || 'periodo'}` })
      return
    }

    if (activeTab === 'shipments') {
      const data = reportData as ShipmentsReportResult
      const headers = [
        'Guía',
        'Origen',
        'Destino',
        'Remitente',
        'Destinatario',
        'Estado',
        'Condición',
        'Monto',
      ]
      const rows = (data.records || []).map((s) => [
        s.trackingCode,
        s.originBranchId === 'punata' ? 'Punata' : 'Cochabamba',
        s.destinationBranchId === 'punata' ? 'Punata' : 'Cochabamba',
        s.senderName,
        s.recipientName,
        s.status,
        s.paymentTiming === 'origin_paid'
          ? 'Pagado Origen'
          : s.paymentTiming === 'destination_cod'
          ? 'Por Cobrar'
          : 'Pendiente',
        formatCurrencyBob(s.amountCents, false),
      ])
      exportReportToPdf({
        title: 'Reporte Operativo de Encomiendas y Logística',
        dateRangeStr,
        branchLabel,
        generatedByName: currentUser.fullName,
        kpiCards: [
          { label: 'Total Envíos', value: String(data.summary?.totalShipments || 0) },
          { label: 'Total Facturado', value: formatCurrencyBob(data.summary?.totalBilledCents || 0, true) },
          { label: 'Cobrado', value: formatCurrencyBob(data.summary?.totalCollectedCents || 0, true) },
          { label: 'Por pagar en destino', value: formatCurrencyBob(data.summary?.totalPendingCodCents || 0, true) },
        ],
        tableHeaders: headers,
        tableRows: rows,
        filename: `Reporte_Encomiendas_${startDate || 'mes'}`,
      })
    } else if (activeTab === 'cash_financial') {
      const data = reportData as CashFinancialReportResult
      const headers = ['Fecha/Hora', 'Sucursal', 'Tipo Movimiento', 'Método', 'Operador', 'Monto']
      const rows = (data.records || []).map((m) => [
        m.timestamp ? new Date(m.timestamp).toLocaleString('es-BO') : '',
        m.branchId === 'punata' ? 'Punata' : 'Cochabamba',
        m.type,
        m.paymentMethod || 'cash',
        m.operatorName || 'Ventanilla',
        formatCurrencyBob(m.amountCents, false),
      ])
      exportReportToPdf({
        title: 'Reporte Financiero y Arqueo de Caja',
        dateRangeStr,
        branchLabel,
        generatedByName: currentUser.fullName,
        kpiCards: [
          { label: 'Ingresos Comerciales', value: formatCurrencyBob(data.summary?.commercialIncomeCents || 0, true) },
          { label: 'Aportes Mensuales', value: formatCurrencyBob(data.summary?.contributionsIncomeCents || 0, true) },
          { label: 'Recuperación de capital de préstamos', value: formatCurrencyBob(data.summary?.loanRepaymentsCents || 0, true) },
          { label: 'Remesas Conductores', value: formatCurrencyBob(data.summary?.driverRemittancesCents || 0, true) },
          { label: 'Egresos / Gastos', value: formatCurrencyBob(data.summary?.expensesCents || 0, true) },
        ],
        tableHeaders: headers,
        tableRows: rows,
        filename: `Reporte_Financiero_Caja_${startDate || 'mes'}`,
      })
    } else if (activeTab === 'drivers') {
      const data = reportData as DriversReportResult
      const headers = [
        'Conductor',
        'Móvil/Placa',
        'Viajes Totales',
        'Completados',
        'Envíos Transp.',
        'Total Rendido',
        'Custodia Pendiente',
      ]
      const rows = (data.driverSummaries || []).map((d) => [
        d.driverName,
        d.vehiclePlate || d.mobileNumber || '-',
        d.tripsCount,
        d.completedTripsCount,
        d.shipmentsCount,
        formatCurrencyBob(d.totalRemittedCents, false),
        formatCurrencyBob(d.pendingCustodyCents, false),
      ])
      exportReportToPdf({
        title: 'Reporte de Operación de Conductores y Custodia',
        dateRangeStr,
        branchLabel,
        generatedByName: currentUser.fullName,
        kpiCards: [
          { label: 'Total Manifiestos', value: String(data.summary?.totalManifests || 0) },
          { label: 'Viajes Concluidos', value: String(data.summary?.totalTripsCompleted || 0) },
          { label: 'Envíos Movilizados', value: String(data.summary?.totalShipmentsTransported || 0) },
          { label: 'Choferes con Saldo', value: String(data.summary?.activeDriversWithCustody || 0) },
        ],
        tableHeaders: headers,
        tableRows: rows,
        filename: `Reporte_Conductores_Custodia_${startDate || 'mes'}`,
      })
    } else if (activeTab === 'dues') {
      const data = reportData as UnionDuesReportResult
      const headers = ['Socio Nº', 'Nombre Completo', 'Cuotas Pendientes', 'Período Más Antiguo', 'Deuda Total']
      const rows = (data.debtors || []).map((d) => [
        d.memberNumber,
        d.memberName,
        d.pendingDuesCount,
        d.oldestDuePeriod,
        formatCurrencyBob(d.totalDebtCents, false),
      ])
      exportReportToPdf({
        title: 'Reporte de Recaudación de Mensualidades y Morosidad',
        dateRangeStr: `Período: ${data.period || 'General'}`,
        branchLabel,
        generatedByName: currentUser.fullName,
        kpiCards: [
          { label: 'Socios Activos', value: String(data.summary?.membersCount?.active || 0) },
          { label: 'Emisión Total', value: formatCurrencyBob(data.summary?.totalDuesIssuedCents || 0, true) },
          { label: 'Recaudado', value: formatCurrencyBob(data.summary?.totalCollectedCents || 0, true) },
          { label: 'Saldo Moroso', value: formatCurrencyBob(data.summary?.totalOutstandingCents || 0, true) },
        ],
        tableHeaders: headers,
        tableRows: rows,
        filename: `Reporte_Socios_Mensualidades_${data.period || 'mes'}`,
      })
    } else if (activeTab === 'payroll_expenses') {
      const data = reportData as PayrollExpensesReportResult
      const headers = ['Código/ID', 'Tipo / Categoría', 'Beneficiario / Proveedor', 'Sucursal', 'Fecha', 'Monto']
      const rows = [
        ...(data.payrollPayments || []).map((p) => [
          p.id.slice(0, 8),
          `Nómina (${p.paymentType})`,
          p.workerName,
          p.branchId,
          p.paidAtIso ? p.paidAtIso.slice(0, 10) : '',
          formatCurrencyBob(p.amountCents, false),
        ]),
        ...(data.expenses || []).map((e) => [
          e.expenseCode || e.id.slice(0, 8),
          `Gasto: ${e.category}`,
          e.supplier || '-',
          e.branchId,
          e.createdAtIso ? e.createdAtIso.slice(0, 10) : '',
          formatCurrencyBob(e.amountCents, false),
        ]),
      ]
      exportReportToPdf({
        title: 'Reporte de Nómina de Personal y Gastos Operativos',
        dateRangeStr,
        branchLabel,
        generatedByName: currentUser.fullName,
        kpiCards: [
          { label: 'Trabajadores Activos', value: String(data.summary?.activeWorkersCount || 0) },
          { label: 'Total Sueldos', value: formatCurrencyBob(data.summary?.totalPayrollPaidCents || 0, true) },
          { label: 'Gastos Operativos', value: formatCurrencyBob(data.summary?.totalOperatingExpensesCents || 0, true) },
          { label: 'Desembolso Total', value: formatCurrencyBob(data.summary?.totalDisbursedCents || 0, true) },
        ],
        tableHeaders: headers,
        tableRows: rows,
        filename: `Reporte_Nomina_Gastos_${startDate || 'mes'}`,
      })
    } else if (activeTab === 'fixed_assets') {
      const data = reportData as FixedAssetsReportResult
      const headers = ['Código', 'Activo / Equipo', 'Categoría', 'Sucursal', 'Ubicación', 'Responsable', 'Costo Adq.', 'Estado']
      const rows = (data.records || []).map((a) => [
        a.assetCode,
        a.name,
        a.category,
        a.branchId === 'punata' ? 'Punata' : 'Cochabamba',
        a.physicalLocation,
        a.responsiblePersonName,
        formatCurrencyBob(a.acquisitionCostCents, false),
        a.status,
      ])
      exportReportToPdf({
        title: 'Reporte de Inventario de Bienes Fijos y Equipos',
        branchLabel,
        generatedByName: currentUser.fullName,
        kpiCards: [
          { label: 'Total Bienes Fijos', value: String(data.summary?.totalAssetsCount || 0) },
          { label: 'Valoración Total', value: formatCurrencyBob(data.summary?.totalAcquisitionValueCents || 0, true) },
          { label: 'En Operación', value: String(data.summary?.byStatus?.in_use || 0) },
          { label: 'Bajas Registradas', value: String(data.summary?.disposedCount || 0) },
        ],
        tableHeaders: headers,
        tableRows: rows,
        filename: `Reporte_Bienes_Fijos_${new Date().toISOString().slice(0, 10)}`,
      })
    }
  }

  const handleExportData = (format: 'csv' | 'xlsx') => {
    if (!reportData) return
    const saveExport = (filename: string, headers: string[], rows: (string | number)[][], additionalSheets: Array<{ name: string; headers: string[]; rows: (string | number)[][] }> = []) => {
      const metadata: (string | number)[][] = [
        ['Reporte', GENERIC_REPORT_LABELS[activeTab] || activeTab],
        ['Período', startDate && endDate ? `${startDate} a ${endDate}` : period],
        ['Agencia', getBranchLabel(selectedBranch)],
        ['Afiliado ID', memberIdFilter || 'Todos'],
        ['Estado', statusFilter],
        ['Categoría', categoryFilter],
        ['Condición de pago', paymentConditionFilter],
        ['Método de pago', paymentMethodFilter],
        ['Sede patrimonial', patrimonialLocationFilter],
        ['Generado', new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' })],
      ]
      if (format === 'csv') {
        exportToCsv(filename, [...metadata.map(([key]) => String(key)), ...headers], [
          [...metadata.map(([, value]) => String(value)), ...headers.map(() => '')],
          ...rows.map((row) => [...metadata.map(() => ''), ...row]),
        ])
      } else {
        exportToXlsx(filename, headers, rows, metadata, additionalSheets)
      }
    }
    if (GENERIC_REPORTS.includes(activeTab)) {
      const records = genericReportRecords(reportData)
      const headers = genericReportColumns(records)
      const rows = records.map((record) => headers.map((key) => genericReportCell(record[key])))
      const filename = `Expreso_Punata_${activeTab}_${startDate || 'periodo'}`
      const additionalSheets = activeTab === 'physical_inventory' ? [
        { name: 'Bienes patrimoniales', headers: genericReportColumns(reportData.records || []), rows: (reportData.records || []).map((record: any) => genericReportColumns(reportData.records || []).map((key) => genericReportCell(record[key]))) },
        { name: 'Documentos físicos', headers: genericReportColumns(reportData.documents || []), rows: (reportData.documents || []).map((record: any) => genericReportColumns(reportData.documents || []).map((key) => genericReportCell(record[key]))) },
      ] : []
      saveExport(filename, headers, rows, additionalSheets)
      return
    }
    if (activeTab === 'consolidated_dashboard') {
      const rows = dashboardExportRows(reportData.dashboard)
      saveExport(`Expreso_Punata_Reporte_General_${startDate || 'periodo'}`, ['Sección', 'Indicador', 'Resultado'], rows)
      return
    }
    if (activeTab === 'shipments') {
      const data = reportData as ShipmentsReportResult
      const headers = [
        'Código Guía',
        'Origen',
        'Destino',
        'Remitente',
        'Teléfono Remitente',
        'Destinatario',
        'Teléfono Destinatario',
        'Estado Operativo',
        'Condición de Pago',
        'Método Pago',
        'Monto Bolivianos',
        'Monto Centavos',
        'Bultos',
        'Peso Kg',
        'Fecha Registro',
        'Fecha Entrega',
      ]
      const rows = (data.records || []).map((s) => [
        s.trackingCode,
        s.originBranchId,
        s.destinationBranchId,
        s.senderName,
        s.senderPhone || '',
        s.recipientName,
        s.recipientPhone || '',
        s.status,
        s.paymentTiming,
        s.paymentMethod || 'cash',
        (s.amountCents / 100).toFixed(2),
        s.amountCents,
        s.totalPackages,
        s.totalWeightKg,
        s.createdAt,
        s.deliveredAt || '',
      ])
      saveExport(`Expreso_Punata_Encomiendas_${startDate || 'mes'}`, headers, rows)
    } else if (activeTab === 'cash_financial') {
      const data = reportData as CashFinancialReportResult
      const headers = ['ID Movimiento', 'Sucursal', 'Tipo', 'Monto Bs', 'Monto Cents', 'Método', 'Operador', 'Fecha Hora']
      const rows = (data.records || []).map((m) => [
        m.id,
        m.branchId,
        m.type,
        (m.amountCents / 100).toFixed(2),
        m.amountCents,
        m.paymentMethod,
        m.operatorName || '',
        m.timestamp,
      ])
      saveExport(`Expreso_Punata_Caja_Finanzas_${startDate || 'mes'}`, headers, rows)
    } else if (activeTab === 'drivers') {
      const data = reportData as DriversReportResult
      const headers = [
        'UID Conductor',
        'Nombre Conductor',
        'Placa / Móvil',
        'Teléfono',
        'Viajes Totales',
        'Viajes Completados',
        'Envíos Transportados',
        'Total Rendido Bs',
        'Custodia Pendiente Bs',
        'Discrepancias / Incidentes',
      ]
      const rows = (data.driverSummaries || []).map((d) => [
        d.driverUid,
        d.driverName,
        d.vehiclePlate || d.mobileNumber || '',
        d.mobileNumber || '',
        d.tripsCount,
        d.completedTripsCount,
        d.shipmentsCount,
        (d.totalRemittedCents / 100).toFixed(2),
        (d.pendingCustodyCents / 100).toFixed(2),
        d.incidentsCount,
      ])
      saveExport(`Expreso_Punata_Conductores_Custodia_${startDate || 'mes'}`, headers, rows)
    } else if (activeTab === 'dues') {
      const data = reportData as UnionDuesReportResult
      const headers = ['Socio ID', 'Nº Socio', 'Nombre Socio', 'Cuotas Pendientes', 'Período Más Antiguo', 'Deuda Total Bs', 'Deuda Cents']
      const rows = (data.debtors || []).map((d) => [
        d.memberId,
        d.memberNumber,
        d.memberName,
        d.pendingDuesCount,
        d.oldestDuePeriod,
        (d.totalDebtCents / 100).toFixed(2),
        d.totalDebtCents,
      ])
      saveExport(`Expreso_Punata_Socios_Deudores_${data.period || 'mes'}`, headers, rows)
    } else if (activeTab === 'payroll_expenses') {
      const data = reportData as PayrollExpensesReportResult
      const headers = ['Tipo Registro', 'ID', 'Beneficiario / Proveedor', 'Categoría', 'Sucursal', 'Monto Bs', 'Fecha']
      const rows = [
        ...(data.payrollPayments || []).map((p) => [
          'Nómina',
          p.id,
          p.workerName,
          p.paymentType,
          p.branchId,
          (p.amountCents / 100).toFixed(2),
          p.paidAtIso,
        ]),
        ...(data.expenses || []).map((e) => [
          'Gasto Operativo',
          e.expenseCode || e.id,
          e.supplier || '',
          e.category,
          e.branchId,
          (e.amountCents / 100).toFixed(2),
          e.createdAtIso,
        ]),
      ]
      saveExport(`Expreso_Punata_Nomina_Gastos_${startDate || 'mes'}`, headers, rows)
    } else if (activeTab === 'fixed_assets') {
      const data = reportData as FixedAssetsReportResult
      const headers = [
        'Código Activo',
        'Nombre del Bien',
        'Categoría',
        'Sucursal',
        'Ubicación Física',
        'Responsable',
        'Costo Adquisición Bs',
        'Fecha Adquisición',
        'Estado',
      ]
      const rows = (data.records || []).map((a) => [
        a.assetCode,
        a.name,
        a.category,
        a.branchId,
        a.physicalLocation,
        a.responsiblePersonName,
        (a.acquisitionCostCents / 100).toFixed(2),
        a.acquisitionDate,
        a.status,
      ])
      saveExport(`Expreso_Punata_Inventario_Bienes_Fijos_${new Date().toISOString().slice(0, 10)}`, headers, rows)
    }
  }

  const handleExportCsv = () => handleExportData('csv')
  const handleExportXlsx = () => handleExportData('xlsx')

  return (
    <div className="space-y-5">
      {/* 1. Barra de Navegación de Reportes */}
      <div className="bg-white rounded-2xl p-2 shadow-sm border border-slate-200">
        <div className="flex overflow-x-auto scroll-smooth gap-1.5 py-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id)
                  setStatusFilter('all')
                  setCategoryFilter('all')
                  setPaymentConditionFilter('all')
                  setPaymentMethodFilter('all')
                  setMemberIdFilter('')
                  setPatrimonialLocationFilter('all')
                  setCurrentPage(1)
                }}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                  isActive
                    ? 'bg-[#064e3b] text-[#facc15] shadow-md ring-2 ring-emerald-700/20'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. Barra de Filtros y Presets de Fecha */}
      <div data-tutorial-target="reports-filters-card" className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Presets de Fecha */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-medium mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Período:
          </span>
          {(
            [
              { id: 'today', label: 'Hoy' },
              { id: 'yesterday', label: 'Ayer' },
              { id: 'this_week', label: 'Esta Semana' },
              { id: 'this_month', label: 'Este Mes' },
              { id: 'last_month', label: 'Mes Anterior' },
              { id: 'custom', label: 'Personalizado' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyDatePreset(p.id)}
              className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
                datePreset === p.id
                  ? 'bg-emerald-900 text-[#facc15] shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Inputs de Rango Personalizado */}
        {datePreset === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700 font-mono focus:ring-2 focus:ring-emerald-700"
            />
            <span className="text-slate-400 font-bold">a</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700 font-mono focus:ring-2 focus:ring-emerald-700"
            />
          </div>
        )}

        {/* Selector de Sucursal y Acciones */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!isSecretaria && (
            <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <MapPin className="w-3.5 h-3.5 text-emerald-800" />
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="bg-transparent text-slate-800 font-bold focus:outline-none cursor-pointer"
              >
                <option value="all">Todas las Agencias</option>
                <option value="punata">Agencia Punata</option>
                <option value="cochabamba">Agencia Cochabamba</option>
              </select>
            </div>
          )}

          {/* Filtro de Estado para Encomiendas */}
          {['shipments', 'loans', 'fines', 'sports', 'members', 'fixed_assets', 'physical_inventory'].includes(activeTab) && (
            <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-slate-800 font-bold focus:outline-none cursor-pointer"
              >
                <option value="all">Todos los estados</option>
                {activeTab === 'shipments' ? <><option value="received">Recibido</option><option value="in_transit">En Tránsito</option><option value="delivered">Entregado</option><option value="cancelled">Cancelado</option></> : activeTab === 'fines' ? <><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagada</option><option value="voided">Anulada</option></> : activeTab === 'loans' ? <><option value="active">Activo</option><option value="overdue">Vencido</option><option value="paid">Pagado</option></> : activeTab === 'members' ? <><option value="active">Activo</option><option value="inactive">Inactivo</option><option value="suspended">Suspendido</option><option value="retired">Retirado</option></> : activeTab === 'sports' ? <><option value="scheduled">Programada</option><option value="completed">Concluida</option></> : <option value="in_use">En uso</option>}
              </select>
            </div>
          )}

          {/* Filtro de Categoría para Gastos o Activos */}
          {['payroll_expenses', 'fixed_assets', 'fines', 'members', 'consumables', 'cash_financial'].includes(activeTab) && (
            <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-transparent text-slate-800 font-bold focus:outline-none cursor-pointer"
              >
                <option value="all">Todas las categorías</option>
                {activeTab === 'payroll_expenses' ? (
                  <>
                    <option value="combustible">Combustible</option>
                    <option value="alquiler">Alquiler</option>
                    <option value="servicios_basicos">Servicios Básicos</option>
                    <option value="mantenimiento">Mantenimiento</option>
                    <option value="viaticos">Viáticos</option>
                  </>
                ) : activeTab === 'cash_financial' ? (
                  <><option value="shipment_income">Ingreso de encomienda</option><option value="cod_income">Cobro contraentrega</option><option value="contribution_income">Cuota de afiliado</option><option value="loan_repayment">Recuperación de préstamo</option><option value="fine_income">Cobro de multa</option><option value="expense">Gasto</option><option value="refund">Devolución</option></>
                ) : activeTab === 'fines' ? (
                  <><option value="transporte">Transporte</option><option value="conflictos">Conflictos</option><option value="deportes">Deportes</option><option value="otros">Otros</option></>
                ) : activeTab === 'members' ? (
                  <><option value="propietario_transporte">Propietario</option><option value="conductor">Conductor</option><option value="socio_general">Socio general</option></>
                ) : activeTab === 'consumables' ? (
                  <><option value="thermal_rolls">Rollos térmicos</option><option value="security_seals">Precintos</option><option value="tape">Cinta</option><option value="packaging_boxes">Cajas</option><option value="envelopes">Sobres</option><option value="labels">Etiquetas</option><option value="other">Otros</option></>
                ) : (
                  <>
                    <option value="computacion">Computación</option>
                    <option value="muebles">Muebles</option>
                    <option value="balanzas_pesaje">Balanzas / Pesaje</option>
                    <option value="herramientas">Herramientas</option>
                  </>
                )}
              </select>
            </div>
          )}

          {activeTab === 'physical_inventory' && <select value={patrimonialLocationFilter} onChange={(event) => setPatrimonialLocationFilter(event.target.value)} aria-label="Filtrar por sede patrimonial" className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl"><option value="all">Todas las sedes patrimoniales</option><option value="sede_punata">Sede Punata</option><option value="oficina_punata">Oficina Punata</option><option value="oficina_cochabamba">Oficina Cochabamba</option></select>}

          {activeTab === 'shipments' && <select value={paymentConditionFilter} onChange={(event) => setPaymentConditionFilter(event.target.value)} aria-label="Filtrar por condición de pago" className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl"><option value="all">Todas las condiciones</option><option value="origin_paid">Pagado en origen</option><option value="origin_pending">Pendiente en origen</option><option value="destination_cod">Contraentrega en destino</option></select>}
          {['shipments', 'cash_financial'].includes(activeTab) && <select value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)} aria-label="Filtrar por método de pago" className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl"><option value="all">Todos los métodos</option><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select>}

          {['members', 'loans', 'fines', 'sports'].includes(activeTab) && <input value={memberIdFilter} onChange={(event) => setMemberIdFilter(event.target.value)} placeholder="ID de afiliado (opcional)" aria-label="Filtrar por ID de afiliado" className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl" />}

          <button
            type="button"
            onClick={loadReport}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition shadow-xs"
            title="Recargar datos"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-700' : ''}`} />
          </button>

          {
            <div data-tutorial-target="reports-export-actions" className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={loading || !reportData}
                className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>

              <button
                type="button"
                onClick={handleExportXlsx}
                disabled={loading || !reportData}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                title="Descargar libro nativo Microsoft Excel"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={loading || !reportData}
                className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                title="Descargar datos en formato plano CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>
          }
        </div>
      </div>

      {/* 3. Manejo de Errores */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-xs text-red-800">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 4. Estado de Carga */}
      {loading && (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-800 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Calculando reporte en tiempo real...</p>
          <p className="text-xs text-slate-400 mt-1">
            {isEmulatedEnvironment
              ? 'Consultando registros del Firebase Emulator local (demo aislado)'
              : 'Consultando registros de Firebase Cloud'}
          </p>
        </div>
      )}

      {!loading && (reportData?.truncated || (Number(reportData?.pagination?.totalRecords) > reportDetailCount(reportData))) && <p role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">La consulta alcanzó el límite de lectura o de registros por página. Los indicadores pueden cubrir un conjunto mayor que el detalle exportado; ajuste los filtros para acotar el período.</p>}

      {/* 5. VISTAS DE REPORTES ESPECIALIZADOS */}
      {!loading && reportData && (
        <>
          {/* ================================================================= */}
          {/* TABLERO CONSOLIDADO EJECUTIVO */}
          {/* ================================================================= */}
          {activeTab === 'consolidated_dashboard' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Encomiendas */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Total Facturado Encomiendas</span>
                    <Layers className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-xl font-black text-slate-900 font-mono">
                    {formatCurrencyBob(reportData.dashboard?.shipments?.totalBilledCents || 0, true)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex justify-between">
                    <span>{reportData.dashboard?.shipments?.totalCount || 0} envíos</span>
                    <span className="text-emerald-700 font-bold">
                      {reportData.dashboard?.shipments?.deliveredCount || 0} entregados
                    </span>
                  </div>
                </div>

                {/* Recaudado Ventanilla */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Cobros Efectivos Ventanilla</span>
                    <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-xl font-black text-emerald-700 font-mono">
                    {formatCurrencyBob(reportData.dashboard?.finances?.commercialIncomeCents || 0, true)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex justify-between">
                    <span>Aportes Socios:</span>
                    <span className="font-bold text-slate-700">
                      {formatCurrencyBob(reportData.dashboard?.finances?.contributionsIncomeCents || 0, true)}
                    </span>
                  </div>
                </div>

                {/* Custodia Pendiente Choferes */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Custodia en Choferes (COD)</span>
                    <Truck className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-xl font-black text-amber-700 font-mono">
                    {formatCurrencyBob(reportData.dashboard?.drivers?.totalPendingCustodyCents || 0, true)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex justify-between">
                    <span>Remitido a Caja:</span>
                    <span className="font-bold text-emerald-700">
                      {formatCurrencyBob(reportData.dashboard?.finances?.driverRemittancesCents || 0, true)}
                    </span>
                  </div>
                </div>

                {/* Egresos Operativos */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Egresos Totales del Período</span>
                    <ArrowDownRight className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="text-xl font-black text-red-700 font-mono">
                    {formatCurrencyBob(reportData.dashboard?.finances?.expensesCents || 0, true)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 flex justify-between">
                    <span>Neto Operativo:</span>
                    <span className="font-extrabold text-[#064e3b]">
                      {formatCurrencyBob(reportData.dashboard?.finances?.netOperatingCents || 0, true)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Detalle Ejecutivo */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-800" />
                  <span>Resumen de Patrimonio e Infraestructura</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500">Total Bienes y Equipos Registrados:</span>
                    <div className="text-lg font-bold text-slate-800 mt-1">
                      {reportData.dashboard?.fixedAssets?.totalCount || 0} activos
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500">Valoración Histórica de Adquisición:</span>
                    <div className="text-lg font-bold text-emerald-800 mt-1 font-mono">
                      {formatCurrencyBob(reportData.dashboard?.fixedAssets?.totalValueCents || 0, true)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
                <article className="bg-white p-4 rounded-xl border border-slate-200"><p className="text-xs text-slate-500">Afiliados activos / retirados</p><p className="mt-1 font-black text-lg">{reportData.dashboard?.members?.activeCount || 0} / {reportData.dashboard?.members?.retiredCount || 0}</p><p className="text-[11px] text-slate-500">Total: {reportData.dashboard?.members?.totalCount || 0} · Cuotas cobradas {formatCurrencyBob(reportData.dashboard?.members?.duesCollectedCents || 0, true)} · pendientes {formatCurrencyBob(reportData.dashboard?.members?.duesPendingCents || 0, true)}</p></article>
                <article className="bg-white p-4 rounded-xl border border-slate-200"><p className="text-xs text-slate-500">Saldo de préstamos por cobrar</p><p className="mt-1 font-black text-lg text-amber-700">{formatCurrencyBob(reportData.dashboard?.loans?.balanceReceivableCents || 0, true)}</p><p className="text-[11px] text-slate-500">Capital recuperado: {formatCurrencyBob(reportData.dashboard?.loans?.capitalRecoveredCents || 0, true)} · no es ingreso operativo</p></article>
                <article className="bg-white p-4 rounded-xl border border-slate-200"><p className="text-xs text-slate-500">Multas cobradas / pendientes</p><p className="mt-1 font-black text-lg">{formatCurrencyBob(reportData.dashboard?.fines?.collectedCents || 0, true)} / {formatCurrencyBob(reportData.dashboard?.fines?.pendingCents || 0, true)}</p><p className="text-[11px] text-slate-500">Solo el cobro efectivo cuenta como entrada de Caja.</p></article>
                <article className="bg-white p-4 rounded-xl border border-slate-200"><p className="text-xs text-slate-500">Capital de préstamo recuperado en el período</p><p className="mt-1 font-black text-lg text-blue-700">{formatCurrencyBob(reportData.dashboard?.finances?.loanRepaymentsCents || 0, true)}</p><p className="text-[11px] text-slate-500">Entrada de caja separada del ingreso operativo.</p></article>
                <article className="bg-white p-4 rounded-xl border border-slate-200"><p className="text-xs text-slate-500">Deportes y documentos físicos</p><p className="mt-1 font-black text-lg">{reportData.dashboard?.sports?.eventCount || 0} jornadas · {reportData.dashboard?.physicalInventory?.documentCount || 0} documentos</p><p className="text-[11px] text-slate-500">Presentes {reportData.dashboard?.sports?.present || 0} · tardanzas {reportData.dashboard?.sports?.late || 0} · ausencias {reportData.dashboard?.sports?.absent || 0} · exenciones autorizadas {reportData.dashboard?.sports?.authorizedExemptions || 0} · solicitudes {reportData.dashboard?.sports?.exemptionRequests || 0} · sanciones {reportData.dashboard?.sports?.sanctioned || 0} · hojas {reportData.dashboard?.physicalInventory?.documentSheets || 0}</p></article>
              </div>
              <article className="bg-white p-4 rounded-xl border border-slate-200"><h3 className="text-xs font-bold text-slate-700 mb-3">Encomiendas por agencia de origen</h3><div className="space-y-2">{Object.entries(reportData.dashboard?.shipments?.byOriginAgency || {}).map(([agency, count]: any) => { const total = Math.max(1, reportData.dashboard?.shipments?.totalCount || 0); return <div key={agency} className="grid grid-cols-[120px_1fr_40px] items-center gap-2 text-xs"><span className="capitalize text-slate-600">{agency.replace(/_/g, ' ')}</span><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-700" style={{ width: `${Math.max(4, (Number(count) / total) * 100)}%` }} /></div><strong className="text-right">{count}</strong></div> })}</div></article>
            </div>
          )}

          {GENERIC_REPORTS.includes(activeTab) && (() => {
            const records = genericReportRecords(reportData)
            const columns = genericReportColumns(records)
            const metrics = Object.entries(reportData.summary || {}).filter(([key, value]) => typeof value === 'number' && !key.endsWith('Bob'))
            return <section className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{metrics.map(([key, value]) => <article key={key} className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[11px] text-slate-500 capitalize">{key.replace(/([A-Z])/g, ' $1').replace(/Cents$/, ' (centavos)')}</div><div className="text-lg font-black text-slate-900 mt-1">{key.endsWith('Cents') ? formatCurrencyBob(Number(value), true) : Number(value).toLocaleString('es-BO')}</div></article>)}</div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div className="px-4 py-3 bg-slate-50 border-b text-xs font-bold text-slate-700">{GENERIC_REPORT_LABELS[activeTab] || activeTab} · {records.length} registros</div><div className="overflow-auto max-h-[70vh]"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>{columns.map((key) => <th key={key} className="px-3 py-2 whitespace-nowrap">{key.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.map((record, index) => <tr key={record.id || `${record.tipoRegistro}-${index}`} className="hover:bg-slate-50">{columns.map((key) => <td key={key} className="px-3 py-2 max-w-xs truncate" title={String(record[key] ?? '')}>{typeof record[key] === 'number' && key.endsWith('Cents') ? formatCurrencyBob(record[key], true) : genericReportCell(record[key])}</td>)}</tr>)}{records.length === 0 && <tr><td colSpan={Math.max(columns.length, 1)} className="px-4 py-8 text-center text-slate-500">No hay registros para los filtros seleccionados.</td></tr>}</tbody></table></div></div>
            </section>
          })()}

          {/* ================================================================= */}
          {/* REPORTE B1: ENCOMIENDAS Y LOGÍSTICA */}
          {/* ================================================================= */}
          {activeTab === 'shipments' && (
            <div className="space-y-5">
              {/* Tarjetas KPI */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Total Encomiendas</span>
                  <div className="text-lg font-black text-slate-900 mt-1">
                    {reportData.summary?.totalShipments || 0}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {reportData.summary?.totalPackages || 0} bultos • {reportData.summary?.totalWeightKg || 0} kg
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Facturación Total</span>
                  <div className="text-lg font-black text-slate-900 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalBilledCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-emerald-700 font-semibold">100% valor guías</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Cobrado Efectivo/QR</span>
                  <div className="text-lg font-black text-emerald-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalCollectedCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">En ventanilla / origen</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Por pagar en destino</span>
                  <div className="text-lg font-black text-amber-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalPendingCodCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">Cobro contraentrega</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Ruta Punata ➔ Cbba</span>
                  <div className="text-lg font-black text-slate-800 mt-1">
                    {reportData.summary?.byRoute?.punata_to_cochabamba?.count || 0}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatCurrencyBob(reportData.summary?.byRoute?.punata_to_cochabamba?.amountCents || 0, false)}
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Ruta Cbba ➔ Punata</span>
                  <div className="text-lg font-black text-slate-800 mt-1">
                    {reportData.summary?.byRoute?.cochabamba_to_punata?.count || 0}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatCurrencyBob(reportData.summary?.byRoute?.cochabamba_to_punata?.amountCents || 0, false)}
                  </span>
                </div>
              </div>

              {/* Tabla de Registros */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Listado de Encomiendas Registradas ({reportData.pagination?.totalRecords || 0})
                  </span>
                  <span className="text-xs text-slate-500">
                    Tiempo prom. entrega: <strong>{reportData.summary?.averageTurnaroundHours || 0} hrs</strong>
                  </span>
                </div>
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
                  Pendientes de retiro: <strong>{reportData.summary?.byStatus?.uncollected || 0}</strong>
                  <span className="ml-2 text-amber-700">(estado independiente de devueltas, extraviadas y deterioradas)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Guía</th>
                        <th className="px-4 py-2.5">Trayecto</th>
                        <th className="px-4 py-2.5">Remitente</th>
                        <th className="px-4 py-2.5">Destinatario</th>
                        <th className="px-4 py-2.5">Estado</th>
                        <th className="px-4 py-2.5">Pago</th>
                        <th className="px-4 py-2.5 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(reportData.records || []).map((s: any) => (
                        <tr key={s.id} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{s.trackingCode}</td>
                          <td className="px-4 py-2.5 capitalize text-slate-600">
                            {s.originBranchId} ➔ {s.destinationBranchId}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">{s.senderName}</td>
                          <td className="px-4 py-2.5 text-slate-700">{s.recipientName}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                s.status === 'delivered'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : s.status === 'in_transit'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {s.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                s.paymentStatus === 'paid'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {s.paymentTiming === 'destination_cod' ? 'Por pagar' : s.paymentTiming === 'origin_pending' ? 'Pendiente en origen' : 'Pagado en origen'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                            {formatCurrencyBob(s.amountCents, true)}
                          </td>
                        </tr>
                      ))}
                      {(reportData.records || []).length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                            No se encontraron encomiendas en el período seleccionado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* REPORTE B2: CAJA Y FINANZAS */}
          {/* ================================================================= */}
          {activeTab === 'cash_financial' && (
            <div className="space-y-5">
              {/* Tarjetas KPI Financieras */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Ingresos Encomiendas</span>
                  <div className="text-lg font-black text-emerald-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.commercialIncomeCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">Ventanilla Origen + Por pagar en destino</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Aportes / Mensualidades</span>
                  <div className="text-lg font-black text-slate-800 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.contributionsIncomeCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">Recaudado de socios</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Capital recuperado de préstamos</span>
                  <div className="text-lg font-black text-blue-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.loanRepaymentsCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">Entrada efectiva de caja; excluida del ingreso operativo</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Remesas de Conductores</span>
                  <div className="text-lg font-black text-blue-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.driverRemittancesCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">Custodia entregada a caja</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Egresos / Gastos</span>
                  <div className="text-lg font-black text-red-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.expensesCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">Gastos autorizados de turno</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-emerald-300 bg-emerald-50/40 shadow-xs">
                  <span className="text-[11px] text-emerald-900 font-bold">Flujo Operativo Neto</span>
                  <div className="text-lg font-black text-[#064e3b] mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.netOperatingCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-emerald-700">Ingresos Totales - Egresos</span>
                </div>
              </div>

              {/* Auditoría de Turnos de Caja */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-slate-700 uppercase mb-3">
                  Auditoría de Cierres y Arqueos de Caja en el Período
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500">Turnos Totales:</span>
                    <div className="text-base font-bold text-slate-800 mt-0.5">
                      {reportData.summary?.shiftsSummary?.totalShifts || 0} (
                      {reportData.summary?.shiftsSummary?.closedShifts || 0} cerrados)
                    </div>
                  </div>

                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900">
                    <span className="text-emerald-700">Arqueos Conformes (Exactos):</span>
                    <div className="text-base font-bold mt-0.5">
                      {reportData.summary?.shiftsSummary?.conformityCount || 0} turnos
                    </div>
                  </div>

                  <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-red-900">
                    <span className="text-red-700">Turnos con Faltante:</span>
                    <div className="text-base font-bold mt-0.5">
                      {reportData.summary?.shiftsSummary?.shortageCount || 0} turnos
                    </div>
                  </div>

                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900">
                    <span className="text-amber-700">Diferencia Acumulada:</span>
                    <div className="text-base font-bold font-mono mt-0.5">
                      {formatCurrencyBob(reportData.summary?.shiftsSummary?.totalDifferenceCents || 0, true)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Movimientos Financieros */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Detalle de Movimientos Financieros ({reportData.pagination?.totalRecords || 0})
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Fecha y Hora</th>
                        <th className="px-4 py-2.5">Agencia</th>
                        <th className="px-4 py-2.5">Concepto / Tipo</th>
                        <th className="px-4 py-2.5">Método</th>
                        <th className="px-4 py-2.5">Operador</th>
                        <th className="px-4 py-2.5 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(reportData.records || []).map((m: any) => (
                        <tr key={m.id} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 font-mono text-slate-600">
                            {m.timestamp ? new Date(m.timestamp).toLocaleString('es-BO') : '-'}
                          </td>
                          <td className="px-4 py-2.5 capitalize font-semibold text-slate-700">{m.branchId}</td>
                          <td className="px-4 py-2.5 text-slate-800">{m.type}</td>
                          <td className="px-4 py-2.5 uppercase font-mono text-[11px] text-slate-500">
                            {m.paymentMethod || 'cash'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{m.operatorName || 'Ventanilla'}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                            {formatCurrencyBob(m.amountCents, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* REPORTE B3: CONDUCTORES Y CUSTODIA */}
          {/* ================================================================= */}
          {activeTab === 'drivers' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Manifiestos de Despacho</span>
                  <div className="text-lg font-black text-slate-900 mt-1">
                    {reportData.summary?.totalManifests || 0}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Viajes Concluidos</span>
                  <div className="text-lg font-black text-emerald-700 mt-1">
                    {reportData.summary?.totalTripsCompleted || 0}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Envíos Transportados</span>
                  <div className="text-lg font-black text-slate-800 mt-1">
                    {reportData.summary?.totalShipmentsTransported || 0}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Conductores con Saldo Custodia</span>
                  <div className="text-lg font-black text-amber-700 mt-1">
                    {reportData.summary?.activeDriversWithCustody || 0}
                  </div>
                </div>
              </div>

              {/* Tabla de Rendición de Conductores */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Cuentas de Custodia y Operación por Conductor
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Conductor</th>
                        <th className="px-4 py-2.5">Vehículo / Placa</th>
                        <th className="px-4 py-2.5">Viajes</th>
                        <th className="px-4 py-2.5">Envíos</th>
                        <th className="px-4 py-2.5">Incidentes</th>
                        <th className="px-4 py-2.5 text-right">Rendido a Caja</th>
                        <th className="px-4 py-2.5 text-right">Custodia Pendiente</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(reportData.driverSummaries || []).map((d: any) => (
                        <tr key={d.driverUid} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 font-bold text-slate-900">{d.driverName}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-600">
                            {d.vehiclePlate || d.mobileNumber || '-'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">
                            {d.completedTripsCount} / {d.tripsCount}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">{d.shipmentsCount}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                d.incidentsCount === 0
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {d.incidentsCount}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-700 font-bold">
                            {formatCurrencyBob(d.totalRemittedCents, true)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-amber-700 font-black">
                            {formatCurrencyBob(d.pendingCustodyCents, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* REPORTE B4: SOCIOS Y MENSUALIDADES */}
          {/* ================================================================= */}
          {activeTab === 'dues' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Socios Activos</span>
                  <div className="text-lg font-black text-slate-900 mt-1">
                    {reportData.summary?.membersCount?.active || 0}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Total afiliados: {reportData.summary?.membersCount?.total || 0}
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Emisión Total Cuotas</span>
                  <div className="text-lg font-black text-slate-900 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalDuesIssuedCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {reportData.summary?.totalDuesIssuedCount || 0} cuotas emitidas
                  </span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Total Recaudado</span>
                  <div className="text-lg font-black text-emerald-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalCollectedCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-emerald-600 font-semibold">Ingresado a caja</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Saldo Moroso Total</span>
                  <div className="text-lg font-black text-red-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalOutstandingCents || 0, true)}
                  </div>
                  <span className="text-[10px] text-red-600 font-semibold">
                    {reportData.summary?.overdueCount || 0} cuotas vencidas
                  </span>
                </div>
              </div>

              {/* Padrón de Morosidad */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Padrón de Socios con Saldos Pendientes ({reportData.debtors?.length || 0})
                  </span>
                  <span className="text-xs text-slate-400">Ordenado por mayor morosidad</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Nº Socio</th>
                        <th className="px-4 py-2.5">Nombre Completo</th>
                        <th className="px-4 py-2.5">Cuotas Deudoras</th>
                        <th className="px-4 py-2.5">Cuota Más Antigua</th>
                        <th className="px-4 py-2.5 text-right">Deuda Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(reportData.debtors || []).map((d: any) => (
                        <tr key={d.memberId} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{d.memberNumber}</td>
                          <td className="px-4 py-2.5 text-slate-800 font-semibold">{d.memberName}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded">
                              {d.pendingDuesCount} meses
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-500">{d.oldestDuePeriod}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-black text-red-700">
                            {formatCurrencyBob(d.totalDebtCents, true)}
                          </td>
                        </tr>
                      ))}
                      {(reportData.debtors || []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            ¡Excelente! No hay socios con morosidad en el período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* REPORTE B5: PERSONAL Y GASTOS OPERATIVOS */}
          {/* ================================================================= */}
          {activeTab === 'payroll_expenses' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Trabajadores Activos</span>
                  <div className="text-lg font-black text-slate-900 mt-1">
                    {reportData.summary?.activeWorkersCount || 0}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Total Nómina Pagada</span>
                  <div className="text-lg font-black text-blue-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalPayrollPaidCents || 0, true)}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Gastos Operativos</span>
                  <div className="text-lg font-black text-amber-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalOperatingExpensesCents || 0, true)}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Desembolso Total</span>
                  <div className="text-lg font-black text-red-700 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalDisbursedCents || 0, true)}
                  </div>
                </div>
              </div>

              {/* Desglose de Gastos por Categoría */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="text-xs font-bold text-slate-700 uppercase mb-3">
                  Distribución de Gastos Operativos por Categoría
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {Object.entries(reportData.summary?.byExpenseCategory || {}).map(([cat, cents]: any) => (
                    <div key={cat} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-slate-500 capitalize">{cat.replace(/_/g, ' ')}:</span>
                      <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">
                        {formatCurrencyBob(cents, true)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* REPORTE B6: BIENES FIJOS E INVENTARIO */}
          {/* ================================================================= */}
          {activeTab === 'fixed_assets' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Total Bienes Registrados</span>
                  <div className="text-lg font-black text-slate-900 mt-1">
                    {reportData.summary?.totalAssetsCount || 0}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Valor Histórico Inventario</span>
                  <div className="text-lg font-black text-emerald-800 mt-1 font-mono">
                    {formatCurrencyBob(reportData.summary?.totalAcquisitionValueCents || 0, true)}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Activos en Uso / Operativos</span>
                  <div className="text-lg font-black text-blue-700 mt-1">
                    {reportData.summary?.byStatus?.in_use || 0}
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
                  <span className="text-[11px] text-slate-500">Bajas de Activos</span>
                  <div className="text-lg font-black text-slate-500 mt-1">
                    {reportData.summary?.disposedCount || 0}
                  </div>
                </div>
              </div>

              {/* Listado de Inventario */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Inventario de Bienes Fijos y Equipos
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5">Código</th>
                        <th className="px-4 py-2.5">Bien / Equipo</th>
                        <th className="px-4 py-2.5">Categoría</th>
                        <th className="px-4 py-2.5">Agencia</th>
                        <th className="px-4 py-2.5">Ubicación</th>
                        <th className="px-4 py-2.5">Responsable</th>
                        <th className="px-4 py-2.5 text-right">Valor Adquisición</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(reportData.records || []).map((a: any) => (
                        <tr key={a.id} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{a.assetCode}</td>
                          <td className="px-4 py-2.5 font-semibold text-slate-800">{a.name}</td>
                          <td className="px-4 py-2.5 capitalize text-slate-600">{a.category}</td>
                          <td className="px-4 py-2.5 capitalize text-slate-700">{a.branchId}</td>
                          <td className="px-4 py-2.5 text-slate-600">{a.physicalLocation}</td>
                          <td className="px-4 py-2.5 text-slate-600">{a.responsiblePersonName}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                            {formatCurrencyBob(a.acquisitionCostCents, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
