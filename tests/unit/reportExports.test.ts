import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { exportReportToPdf, exportToXlsx } from '../../src/services/reportService.ts'

const nodeRequire = createRequire(import.meta.url)
const XLSXNode = nodeRequire('xlsx')

test('Exportación Excel incluye filas filtradas y una hoja separada con filtros aplicados', () => {
  const filename = join(tmpdir(), `expreso-report-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`)
  try {
    exportToXlsx(filename.replace(/\.xlsx$/, ''), ['Guía', 'Estado'], [['PUN-TEST', 'delivered']], [
      ['Período', '2026-11-01 a 2026-11-10'], ['Agencia', 'Agencia Punata'], ['Estado', 'delivered'],
    ], [{ name: 'Documentos físicos', headers: ['Título', 'Hojas'], rows: [['Acta fixture', 12]] }])
    const workbook = XLSXNode.readFile(filename)
    assert.deepEqual(workbook.SheetNames, ['Registros', 'Filtros', 'Documentos físicos'])
    assert.deepEqual(XLSXNode.utils.sheet_to_json(workbook.Sheets.Registros, { header: 1 }), [['Guía', 'Estado'], ['PUN-TEST', 'delivered']])
    assert.deepEqual(XLSXNode.utils.sheet_to_json(workbook.Sheets.Filtros, { header: 1 }), [['Filtro', 'Valor'], ['Período', '2026-11-01 a 2026-11-10'], ['Agencia', 'Agencia Punata'], ['Estado', 'delivered']])
    assert.deepEqual(XLSXNode.utils.sheet_to_json(workbook.Sheets['Documentos físicos'], { header: 1 }), [['Título', 'Hojas'], ['Acta fixture', 12]])
  } finally {
    try { unlinkSync(filename) } catch { /* El test elimina únicamente el archivo único que acaba de crear. */ }
  }
})

test('Exportación PDF mantiene membrete, período, filtros y páginas legibles en tablas extensas', () => {
  const filename = join(tmpdir(), `expreso-report-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  try {
    exportReportToPdf({
      title: 'Reporte de prueba', dateRangeStr: '2026-11-01 al 2026-11-10',
      branchLabel: 'Agencia Punata · Estado: entregado', generatedByName: 'Operador Fixture',
      kpiCards: [{ label: 'Total', value: '80' }],
      tableHeaders: ['Registro', 'Descripción'],
      tableRows: Array.from({ length: 80 }, (_, index) => [`R-${index + 1}`, `Descripción ficticia extensa de la fila ${index + 1}`]),
      filename: filename.replace(/\.pdf$/, ''),
    })
    const pdfText = readFileSync(filename, 'latin1')
    assert.ok((pdfText.match(/\/Type \/Page\b/g) || []).length > 1, 'la tabla debe continuar en más de una página')
    assert.ok(pdfText.includes('EXPRESO PUNATA'))
    assert.ok(pdfText.includes('REPORTE DE PRUEBA'))
    assert.ok(pdfText.includes('Agencia Punata'))
  } finally {
    try { unlinkSync(filename) } catch { /* El test elimina únicamente el archivo PDF que acaba de generar. */ }
  }
})
