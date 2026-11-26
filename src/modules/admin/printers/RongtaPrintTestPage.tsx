import { useState } from 'react'
import { createSyntheticShipmentTicket } from '../../../services/printing/syntheticShipmentTicket.ts'
import { printEngine } from '../../../services/printing/printEngineService.ts'
import { getDefaultPrinter } from '../../../services/printing/printerProfiles.ts'

export function RongtaPrintTestPage({ currentBranchId = 'punata' }: { currentBranchId?: string }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('La prueba usa el diseño guardado y datos ficticios.')

  async function print(copies: 1 | 2) {
    if (busy) return
    setBusy(true)
    setStatus('Preparando la impresión…')
    try {
      const printer = getDefaultPrinter(currentBranchId)
      if (printer.connectionType !== 'browser_dialog' || !['58mm', '80mm'].includes(printer.paperFormat)) {
        setStatus('Selecciona una impresora de navegador de 58 u 80 mm en Impresoras.')
        return
      }
      const result = await printEngine.printDocument(createSyntheticShipmentTicket(currentBranchId), printer, copies)
      setStatus(result.message)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo preparar la prueba.')
    } finally {
      setBusy(false)
    }
  }

  return <section data-testid="rongta-print-test" className="space-y-4 rounded-xl border bg-white p-5">
    <h2 className="text-lg font-bold">Prueba de impresión</h2>
    <p className="text-sm">Con impresión directa, Chrome confirma los dos trabajos. En el modo normal, confirma cada diálogo. Comprueba las copias y los cortes en el papel.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void print(1)} className="rounded border px-4 py-2 disabled:opacity-50">Imprimir ticket de cliente</button>
      <button type="button" disabled={busy} onClick={() => void print(2)} className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50">Imprimir cliente + agencia</button>
    </div>
    <p role="status" className="text-sm">{status}</p>
  </section>
}
