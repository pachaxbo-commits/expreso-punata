import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { buildFixedAssetLabelsPdf } from '../../src/services/fixedAssetLabelsPdfService.ts'
import { buildUnionMembersRosterPdf } from '../../src/services/unionRosterPdfService.ts'
import { exportReportToPdf, exportToXlsx } from '../../src/services/reportService.ts'
import { printEngine } from '../../src/services/printing/printEngineService.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const outputDir = 'tmp/document-audit'
mkdirSync(outputDir, { recursive: true })
const results = []

async function measure(name, action) {
  const started = performance.now()
  const result = await action()
  const elapsedMs = Number((performance.now() - started).toFixed(1))
  results.push({ name, elapsedMs, ...result })
  console.log(JSON.stringify(results.at(-1)))
}

const roster = Array.from({ length: 500 }, (_, index) => ({
  id: `perf-member-${index}`,
  memberNumber: `SOC-${String(index + 1).padStart(4, '0')}`,
  fullName: `Afiliado Ficticio ${String(index + 1).padStart(4, '0')}`,
  ci: String(1000000 + index),
  ciComplement: index % 7 === 0 ? '1A' : '',
  phone: `700${String(index).padStart(5, '0')}`,
  alternatePhone: '', address: `Calle Ficticia ${index + 1}`, locality: index % 2 ? 'Cochabamba' : 'Punata',
  birthDate: '1980-01-05', joinedAt: '2020-01-01', retiredAt: '', status: 'active', category: 'titular',
  primaryDriverUid: `perf-driver-${index % 50}`, primaryDriverName: `Conductor Ficticio ${index % 50}`,
  children: [{ id: `child-${index}`, memberId: `perf-member-${index}`, fullName: `Hijo Ficticio ${index + 1}`, ci: `${8000000 + index}`, birthDate: '2010-03-15', phone: '', address: '', driverUid: `perf-driver-${index % 50}`, driverName: `Conductor Ficticio ${index % 50}`, notes: '' }],
}))

await measure('large_member_roster_pdf_500_plus_500_children', async () => {
  const pdf = buildUnionMembersRosterPdf(roster, 'completo', new Date('2026-11-12T12:00:00Z'))
  const bytes = Buffer.from(pdf.output('arraybuffer'))
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  assert.ok(pdf.getNumberOfPages() > 50)
  const path = `${outputDir}/affiliate-roster-500.pdf`
  writeFileSync(path, bytes)
  return { records: 1000, pages: pdf.getNumberOfPages(), bytes: bytes.length, file: path }
})

for (const count of [50, 200]) {
  await measure(`qr_asset_labels_${count}`, async () => {
    const assets = Array.from({ length: count }, (_, index) => ({
      id: `perf-asset-${index + 1}`,
      assetCode: `ACT-PERF-${String(index + 1).padStart(4, '0')}`,
      barcodeQr: `ACT-PERF-${String(index + 1).padStart(4, '0')}`,
      qrPayload: `EXPRESO-PUNATA:ACTIVO:perf-asset-${index + 1}`,
      name: `Silla ficticia ${index + 1}`, category: 'muebles', description: 'Activo de auditoría',
      branchId: index % 2 ? 'cochabamba' : 'punata', patrimonialLocationId: index % 2 ? 'oficina_cochabamba' : 'sede_punata',
      physicalLocation: '', responsiblePersonName: '', acquisitionDate: '2026-11-10', status: 'available',
    }))
    assert.equal(new Set(assets.map((item) => item.qrPayload)).size, count)
    const pdf = await buildFixedAssetLabelsPdf(assets)
    assert.equal(pdf.getNumberOfPages(), Math.ceil(count / 15))
    const bytes = Buffer.from(pdf.output('arraybuffer'))
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
    const path = `${outputDir}/asset-labels-${count}.pdf`
    writeFileSync(path, bytes)
    return { records: count, pages: pdf.getNumberOfPages(), bytes: bytes.length, uniqueQrPayloads: new Set(assets.map((item) => item.qrPayload)).size, file: path }
  })
}

await measure('shipment_guide_print_payload', async () => {
  const trackingCode = 'PUN202600099'
  const receipt = printEngine.buildFromShipment({ trackingCode, originBranchId: 'punata', destinationBranchId: 'cochabamba', originCity: 'Punata', destinationCity: 'Cochabamba', createdAtIso: '2026-11-10T12:00:00Z', sender: { name: 'Remitente Prueba', phone: '70000000' }, recipient: { name: 'Destinatario Prueba', phone: '70000001' }, items: [{ description: 'Repuesto ficticio', quantity: 2, packaging: 'Caja' }], finalAmountCents: 3500, paymentTiming: 'origin_paid', paymentStatus: 'paid', paymentMethod: 'cash' }, 'Operador Auditoría')
  assert.equal(receipt.documentNumber, trackingCode)
  assert.equal(receipt.financials.amountCents, 3500)
  assert.equal(receipt.qrContent, `EXPRESO-PUNATA:${trackingCode}`)
  return { records: 1, trackingCode: receipt.documentNumber, amountCents: receipt.financials.amountCents, branchPhone: receipt.branchPhone, qrContent: receipt.qrContent }
})

await measure('report_pdf_2000_rows', async () => {
  const path = `${outputDir}/general-report-2000.pdf`
  exportReportToPdf({
    title: 'Reporte general de auditoría', subtitle: 'Datos ficticios de verificación',
    dateRangeStr: '2026-01-01 al 2026-12-31', branchLabel: 'Punata y Cochabamba', generatedByName: 'Usuario Auditoría',
    kpiCards: [{ label: 'Registros', value: '2.000' }, { label: 'Importe total', value: 'Bs 20.000,00' }],
    tableHeaders: ['Guía', 'Afiliado', 'Estado', 'Importe (Bs)'],
    tableRows: Array.from({ length: 2000 }, (_, index) => [`PUN${String(index + 1).padStart(9, '0')}`, `Afiliado ${index + 1}`, 'Entregada', '10,00']),
    filename: path.replace(/\.pdf$/, ''),
  })
  const bytes = readFileSync(path)
  const raw = bytes.toString('latin1')
  const pages = (raw.match(/\/Type \/Page\b/g) || []).length
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  assert.ok(pages > 10)
  assert.ok(raw.includes('REPORTE GENERAL DE AUDITOR'))
  return { rows: 2000, pages, bytes: bytes.length, containsReportHeading: true, file: path }
})

await measure('excel_export_2000_rows_with_filters_and_financial_summary', async () => {
  const base = `${outputDir}/section-report-2000`
  const rows = Array.from({ length: 2000 }, (_, index) => [`PUN${String(index + 1).padStart(9, '0')}`, `Afiliado ${index + 1}`, 'Entregada', (1000 + index) / 100])
  const movements = Array.from({ length: 5000 }, (_, index) => [`MOV-${index + 1}`, index % 2 ? 'Ingreso comercial' : 'Cuota', (1000 + index) / 100])
  exportToXlsx(base, ['Guía', 'Afiliado', 'Estado', 'Importe (Bs)'], rows,
    [['Período', '2026-01-01 a 2026-12-31'], ['Agencia', 'Todas'], ['Estado', 'Entregada']],
    [{ name: 'Caja', headers: ['Movimiento', 'Categoría', 'Importe (Bs)'], rows: movements }])
  const workbook = XLSX.readFile(`${base}.xlsx`)
  assert.deepEqual(workbook.SheetNames, ['Registros', 'Filtros', 'Caja'])
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Registros, { header: 1 }).length, 2001)
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Caja, { header: 1 }).length, 5001)
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Filtros, { header: 1 }).length, 4)
  const path = `${base}.xlsx`
  return { rows: 2000, financialRows: 5000, sheets: workbook.SheetNames, bytes: statSync(path).size, file: path }
})

await measure('existing_receipt_payloads_affiliate_loan_fine_and_cash', async () => {
  const memberReceipt = printEngine.buildFromMemberPayment({ receiptNumber: 'REC-SOC-001', memberNumber: 'SOC-001', memberName: 'Afiliada Ficticia', amountCents: 5000, amountBob: 50, period: '2026-11', paymentMethod: 'cash', status: 'paid' }, { fullName: 'Afiliada Ficticia', category: 'titular' }, 'punata', 'Operador')
  const loanReceipt = printEngine.buildFromUnionLoanPayment({ amountCents: 2500, balanceCents: 7500, payment: { receiptNumber: 'REC-PRE-001', paymentMethod: 'cash' } }, { loanNumber: 'PRE-001', memberNumber: 'SOC-001' }, { memberNumber: 'SOC-001', fullName: 'Afiliada Ficticia' }, 'punata', 'Operador')
  const fineReceipt = printEngine.buildFromUnionFinePayment({ amountCents: 1000, balanceCents: 0, payment: { receiptNumber: 'REC-MUL-001', paymentMethod: 'cash' } }, { category: 'transporte', reason: 'Falta ficticia', memberNumber: 'SOC-001', memberName: 'Afiliada Ficticia' }, 'punata', 'Operador')
  const cashReceipt = printEngine.buildFromCashMovement({ type: 'shipment_income', amountCents: 3500, branchId: 'punata', trackingCode: 'PUN202600099', paymentMethod: 'cash' }, 'Operador')
  assert.equal(memberReceipt.financials.amountCents, 5000)
  assert.equal(loanReceipt.financials.amountCents, 2500)
  assert.equal(fineReceipt.financials.amountCents, 1000)
  assert.equal(cashReceipt.financials.amountCents, 3500)
  assert.equal(loanReceipt.documentNumber, 'REC-PRE-001')
  assert.equal(fineReceipt.documentNumber, 'REC-MUL-001')
  return { checkedPayloads: ['cuota', 'préstamo', 'multa', 'Caja'] }
})

writeFileSync(`${outputDir}/document-audit-results.json`, JSON.stringify(results, null, 2))
console.log(`RESULTS_FILE=${outputDir}/document-audit-results.json`)
