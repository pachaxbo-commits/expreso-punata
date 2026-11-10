import * as XLSX from 'xlsx'
import { httpsCallable } from 'firebase/functions'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export type ReportType =
  | 'shipments'
  | 'cash_financial'
  | 'drivers'
  | 'dues'
  | 'payroll_expenses'
  | 'fixed_assets'
  | 'consolidated_dashboard'
  | 'members'
  | 'loans'
  | 'fines'
  | 'sports'
  | 'physical_inventory'
  | 'commissions'
  | 'consumables'
  | 'incidents'

export interface GetSystemReportInput {
  reportType: ReportType
  startDate?: string
  endDate?: string
  period?: string
  branchId?: string
  status?: string
  paymentCondition?: string
  paymentMethod?: string
  category?: string
  operatorUid?: string
  driverUid?: string
  memberId?: string
  page?: number
  pageSize?: number
}

export interface PaginationMeta {
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
}

// B1: Shipments
export interface ShipmentsReportSummary {
  totalShipments: number
  totalPackages: number
  totalWeightKg: number
  totalBilledCents: number
  totalBilledBob: number
  totalCollectedCents: number
  totalCollectedBob: number
  totalPendingCodCents: number
  totalPendingCodBob: number
  averageTurnaroundHours: number
  byStatus: Record<string, number>
  byRoute: Record<string, { count: number; amountCents: number }>
  byPaymentCondition: Record<string, { count: number; amountCents: number }>
  byPaymentMethod: Record<string, { count: number; amountCents: number }>
}

export interface ShipmentReportItem {
  id: string
  trackingCode: string
  guideNumber?: string
  senderName: string
  senderPhone?: string
  recipientName: string
  recipientPhone?: string
  originBranchId: string
  destinationBranchId: string
  status: string
  paymentTiming: string
  paymentStatus: string
  paymentMethod?: string
  amountCents: number
  amountBob: number
  totalPackages: number
  totalWeightKg: number
  createdAt: string
  deliveredAt?: string | null
}

export interface ShipmentsReportResult {
  success: boolean
  reportType: 'shipments'
  dateRange: { startIso: string; endIso: string }
  branchId: string
  summary: ShipmentsReportSummary
  pagination: PaginationMeta
  records: ShipmentReportItem[]
}

// B2: Cash & Financial
export interface CashFinancialSummary {
  commercialIncomeCents: number
  loanRepaymentsCents: number
  commercialIncomeBob: number
  contributionsIncomeCents: number
  contributionsIncomeBob: number
  driverRemittancesCents: number
  driverRemittancesBob: number
  expensesCents: number
  expensesBob: number
  refundsCents: number
  refundsBob: number
  adjustmentsCents: number
  adjustmentsBob: number
  netOperatingCents: number
  netOperatingBob: number
  initialCashTotalCents: number
  initialCashTotalBob: number
  byPaymentMethod: Record<string, { incomeCents: number; expenseCents: number }>
  byBranch: Record<string, { incomeCents: number; expenseCents: number; netCents: number }>
  shiftsSummary: {
    totalShifts: number
    openShifts: number
    closedShifts: number
    conformityCount: number
    shortageCount: number
    surplusCount: number
    totalDifferenceCents: number
    totalDifferenceBob: number
  }
}

export interface FinancialMovementRecord {
  id: string
  branchId: string
  type: string
  amountCents: number
  amountBob?: number
  paymentMethod: string
  concept?: string
  description?: string
  operatorName?: string
  shiftId?: string
  timestamp: string
}

export interface CashFinancialReportResult {
  success: boolean
  reportType: 'cash_financial'
  dateRange: { startIso: string; endIso: string }
  branchId: string
  summary: CashFinancialSummary
  pagination: PaginationMeta
  records: FinancialMovementRecord[]
}

// B3: Drivers & Custody
export interface DriverSummaryItem {
  driverUid: string
  driverName: string
  vehiclePlate: string
  mobileNumber?: string
  tripsCount: number
  completedTripsCount: number
  shipmentsCount: number
  codCollectedCents: number
  totalRemittedCents: number
  pendingCustodyCents: number
  incidentsCount: number
}

export interface DriversReportSummary {
  totalManifests: number
  totalTripsCompleted: number
  totalShipmentsTransported: number
  totalIncidentsCount: number
  activeDriversWithCustody: number
}

export interface DriversReportResult {
  success: boolean
  reportType: 'drivers'
  dateRange: { startIso: string; endIso: string }
  summary: DriversReportSummary
  driverSummaries: DriverSummaryItem[]
  records: any[]
}

// B4: Union Dues & Members
export interface DebtorItem {
  memberId: string
  memberNumber: string
  memberName: string
  totalDebtCents: number
  pendingDuesCount: number
  oldestDuePeriod: string
}

export interface UnionDuesSummary {
  membersCount: {
    total: number
    active: number
    inactive: number
    suspended: number
  }
  totalDuesIssuedCount: number
  totalDuesIssuedCents: number
  totalDuesIssuedBob: number
  totalCollectedCents: number
  totalCollectedBob: number
  totalOutstandingCents: number
  totalOutstandingBob: number
  overdueCount: number
  overdueAmountCents: number
  overdueAmountBob: number
}

export interface UnionDueRecord {
  id: string
  memberId: string
  memberNumber: string
  memberName: string
  period: string
  amountCents: number
  paidAmountCents: number
  balanceCents: number
  status: string
  dueDate?: string
}

export interface UnionDuesReportResult {
  success: boolean
  reportType: 'dues'
  period: string
  summary: UnionDuesSummary
  debtors: DebtorItem[]
  records: UnionDueRecord[]
}

// B5: Payroll & Operational Expenses
export interface TopSupplierItem {
  supplier: string
  count: number
  totalCents: number
}

export interface PayrollExpensesSummary {
  activeWorkersCount: number
  totalWorkersCount: number
  totalPayrollPaidCents: number
  totalPayrollPaidBob: number
  totalOperatingExpensesCents: number
  totalOperatingExpensesBob: number
  totalDisbursedCents: number
  totalDisbursedBob: number
  byExpenseCategory: Record<string, number>
  topSuppliers: TopSupplierItem[]
}

export interface WorkerPaymentRecord {
  id: string
  workerId: string
  workerName: string
  amountCents: number
  amountBob?: number
  paymentType: string
  periodMonth?: string
  branchId: string
  paidAtIso: string
}

export interface OperationalExpenseRecord {
  id: string
  expenseCode: string
  branchId: string
  category: string
  amountCents: number
  amountBob?: number
  supplier?: string
  receiptNumber?: string
  approvedByName?: string
  createdAtIso: string
}

export interface PayrollExpensesReportResult {
  success: boolean
  reportType: 'payroll_expenses'
  dateRange: { startIso: string; endIso: string }
  branchId: string
  summary: PayrollExpensesSummary
  payrollPayments: WorkerPaymentRecord[]
  expenses: OperationalExpenseRecord[]
}

// B6: Fixed Assets
export interface DisposedAssetRecord {
  id: string
  assetCode: string
  name: string
  category: string
  branchId: string
  disposedReason: string
  disposedAtIso?: string | null
  disposedByName: string
}

export interface FixedAssetRecord {
  id: string
  assetCode: string
  name: string
  category: string
  branchId: string
  physicalLocation: string
  responsiblePersonName: string
  acquisitionCostCents: number
  acquisitionCostBob?: number
  acquisitionDate: string
  status: string
}

export interface FixedAssetsSummary {
  totalAssetsCount: number
  totalAcquisitionValueCents: number
  totalAcquisitionValueBob: number
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  byBranch: Record<string, { count: number; valueCents: number }>
  disposedCount: number
}

export interface FixedAssetsReportResult {
  success: boolean
  reportType: 'fixed_assets'
  branchId: string
  summary: FixedAssetsSummary
  disposedAssets: DisposedAssetRecord[]
  records: FixedAssetRecord[]
}

// Consolidated Dashboard
export interface ConsolidatedDashboardResult {
  success: boolean
  reportType: 'consolidated_dashboard'
  dateRange: { startIso: string; endIso: string }
  dashboard: {
    shipments: {
      totalCount: number
      deliveredCount: number
      inTransitCount: number
      pendingCount?: number
      cancelledCount?: number
      byOriginAgency?: Record<string, number>
      totalBilledCents: number
      totalBilledBob: number
      totalCollectedCents: number
      totalCollectedBob: number
    }
    finances: {
      commercialIncomeCents: number
      commercialIncomeBob: number
      contributionsIncomeCents: number
      contributionsIncomeBob: number
      loanRepaymentsCents?: number
      loanRepaymentsBob?: number
      driverRemittancesCents: number
      driverRemittancesBob: number
      expensesCents: number
      expensesBob: number
      netOperatingCents: number
      netOperatingBob: number
    }
    drivers: {
      totalPendingCustodyCents: number
      totalPendingCustodyBob: number
    }
    fixedAssets: {
      totalCount: number
      totalValueCents: number
      totalValueBob: number
    }
    members?: { totalCount: number; activeCount: number; retiredCount: number; duesCollectedCents: number; duesPendingCents: number }
    loans?: { count: number; principalReceivableCents: number; capitalRecoveredCents: number; balanceReceivableCents: number; operatingIncomeCents: number }
    fines?: { count: number; amountCents: number; collectedCents: number; pendingCents: number }
    sports?: { eventCount: number; present: number; late: number; absent: number; exempt: number; exemptionRequests: number; authorizedExemptions: number; sanctioned: number }
    physicalInventory?: { documentCount: number; documentSheets: number }
  }
}

/**
 * Consulta el endpoint centralizado de reportes en Cloud Functions
 */
export async function fetchSystemReport(input: GetSystemReportInput): Promise<any> {
  const { functions } = await import('../firebase/config.ts')
  const getSystemReportFn = httpsCallable<GetSystemReportInput, any>(functions, 'getSystemReport')
  const result = await getSystemReportFn(input)
  return result.data
}

/**
 * Exportador genérico a CSV con BOM UTF-8 (\uFEFF) para compatibilidad total con Excel en español
 */

/**
 * Exportador auténtico a formato Microsoft Excel (.xlsx) nativo
 */
export function exportToXlsx(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  metadata: (string | number)[][] = [],
  additionalSheets: Array<{ name: string; headers: string[]; rows: (string | number)[][] }> = [],
) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  XLSX.utils.book_append_sheet(wb, ws, 'Registros')
  if (metadata.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Filtro', 'Valor'], ...metadata]), 'Filtros')
  for (const sheet of additionalSheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]), sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (val: string | number) => {
    if (val === null || val === undefined) return '""'
    const str = String(val).replace(/"/g, '""')
    return `"${str}"`
  }

  const csvContent =
    '\uFEFF' +
    [headers.map(escapeCell).join(';')]
      .concat(rows.map((row) => row.map(escapeCell).join(';')))
      .join('\r\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Exportador a PDF con membrete oficial EXPRESO PUNATA, diseño corporativo azul/dorado y tablas formateadas
 */
export function exportReportToPdf(params: {
  title: string
  subtitle?: string
  dateRangeStr?: string
  branchLabel?: string
  generatedByName?: string
  kpiCards?: { label: string; value: string }[]
  tableHeaders: string[]
  tableRows: (string | number)[][]
  filename: string
}) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const pageWidth = doc.internal.pageSize.getWidth()

  // 1. Encabezado con franja azul institucional
  doc.setFillColor(30, 58, 138) // Azul primario
  doc.rect(0, 0, pageWidth, 28, 'F')

  // Logotipo y Nombre institucional
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('EXPRESO PUNATA', 14, 12)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(224, 231, 255)
  doc.text('Transporte Interprovincial de Carga y Encomiendas • Punata - Cochabamba', 14, 18)
  doc.text('Sistema de Gestión Operativa y Financiera PACHAX', 14, 23)

  // Metadatos de impresión a la derecha
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' })}`, pageWidth - 14, 12, { align: 'right' })
  doc.text(`Hora: ${new Date().toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })}`, pageWidth - 14, 17, { align: 'right' })
  if (params.generatedByName) {
    doc.text(`Usuario: ${params.generatedByName}`, pageWidth - 14, 22, { align: 'right' })
  }

  // 2. Título del Reporte y Filtros
  let yPos = 36
  doc.setTextColor(17, 24, 39)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  const titleLines = doc.splitTextToSize(params.title.toUpperCase(), pageWidth - 28)
  doc.text(titleLines, 14, yPos)
  yPos += Math.max(0, titleLines.length - 1) * 5

  yPos += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(75, 85, 99)
  const metaText = [
    params.branchLabel ? `Sucursal: ${params.branchLabel}` : null,
    params.dateRangeStr ? `Período: ${params.dateRangeStr}` : null,
  ]
    .filter(Boolean)
    .join('  |  ')
  if (metaText) {
    const metaLines = doc.splitTextToSize(metaText, pageWidth - 28)
    doc.text(metaLines, 14, yPos)
    yPos += Math.max(6, metaLines.length * 4.5)
  }

  // 3. Tarjetas KPI / Resumen Ejecutivo
  if (params.kpiCards && params.kpiCards.length > 0) {
    yPos += 2
    const visibleCards = params.kpiCards.slice(0, 8)
    const cardRows = Math.ceil(visibleCards.length / 4)
    const cardGap = 4
    const cardHeight = 20
    for (let row = 0; row < cardRows; row++) {
      const rowCards = visibleCards.slice(row * 4, row * 4 + 4)
      const totalGap = (rowCards.length - 1) * cardGap
      const cardWidth = (pageWidth - 28 - totalGap) / rowCards.length
      rowCards.forEach((kpi, idx) => {
        const xPos = 14 + idx * (cardWidth + cardGap)
        doc.setFillColor(243, 244, 246)
        doc.setDrawColor(209, 213, 219)
        doc.roundedRect(xPos, yPos, cardWidth, cardHeight, 1.5, 1.5, 'FD')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(107, 114, 128)
        doc.text(doc.splitTextToSize(kpi.label, cardWidth - 6).slice(0, 2), xPos + 3, yPos + 5)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9.5)
        doc.setTextColor(17, 24, 39)
        doc.text(doc.splitTextToSize(kpi.value, cardWidth - 6).slice(0, 2), xPos + 3, yPos + 16)
      })
      yPos += cardHeight + 4
    }
  }

  // 4. Tabla de Datos usando autoTable
  autoTable(doc, {
    startY: yPos,
    head: [params.tableHeaders],
    body: params.tableRows,
    theme: 'striped',
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [31, 41, 55],
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
    margin: { left: 14, right: 14, bottom: 20 },
    didDrawPage: (data) => {
      // Pie de página oficial
      const pageNumber = data.pageNumber
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(156, 163, 175)
      doc.text(
        `EXPRESO PUNATA 1.0 • Documento Oficial de Reportes • Página ${pageNumber}`,
        14,
        doc.internal.pageSize.getHeight() - 10
      )
    },
  })

  doc.save(`${params.filename}.pdf`)
}
