import React, { useState, useEffect } from 'react'
import { Printer, Download, X, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react'
import type { CashShift } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { generateCashShiftTicketPdf } from '../../services/pdfService.ts'
import QRCode from 'qrcode'

interface CashTicket80mmProps {
  shift: CashShift
  onClose: () => void
}

export const CashTicket80mm: React.FC<CashTicket80mmProps> = ({ shift, onClose }) => {
  const [ticketWidth, setTicketWidth] = useState<'80mm' | '58mm'>('80mm')
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [qrUrl, setQrUrl] = useState<string>('')

  const bd = shift.breakdown || {
    initialCashCents: shift.initialCashCents || 0,
    cashIncomeCents: 0,
    qrIncomeCents: 0,
    transferIncomeCents: 0,
    totalIncomeCents: 0,
    expensesCents: 0,
    netCashCents: shift.expectedCashCents || 0,
    pendingIncomeCents: 0,
  }

  const branchName = shift.branchId === 'punata' ? 'Agencia Punata' : 'Agencia Cochabamba'
  const diffCents = shift.differenceCents || 0
  const diffStatus = shift.differenceStatus || (diffCents === 0 ? 'conforme' : diffCents > 0 ? 'sobrante' : 'faltante')

  useEffect(() => {
    const qrData = `EXPRESO PUNATA\nTurno: ${shift.shiftNumber || shift.id}\nSucursal: ${shift.branchId}\nOperador: ${shift.operatorName}\nEsperado: ${formatCurrencyBob(shift.expectedCashCents || 0)}\nContado: ${formatCurrencyBob(shift.actualCashCents || 0)}\nEstado: ${diffStatus.toUpperCase()}`
    QRCode.toDataURL(qrData, { width: 140, margin: 0 })
      .then(setQrUrl)
      .catch((err) => console.error('Error al generar QR:', err))
  }, [shift, diffStatus])

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPdf = async () => {
    setIsGeneratingPdf(true)
    try {
      const blob = await generateCashShiftTicketPdf(shift, ticketWidth)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `comprobante-arqueo-${shift.shiftNumber || shift.id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Error al descargar PDF:', err)
      alert('Error al generar el comprobante PDF.')
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      {/* Contenedor del Modal */}
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col max-h-[92vh]">
        {/* Encabezado */}
        <div className="bg-[#064e3b] text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-tight text-white">
              Comprobante de Arqueo de Caja
            </h3>
            <p className="text-[11px] text-emerald-200">
              Formato Térmico Oficial • {ticketWidth}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTicketWidth(ticketWidth === '80mm' ? '58mm' : '80mm')}
              className="text-[11px] bg-emerald-800 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-md font-bold transition-colors"
              title="Cambiar formato de ancho de papel"
            >
              {ticketWidth === '80mm' ? 'Cambiar a 58mm' : 'Cambiar a 80mm'}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-emerald-100 hover:text-white hover:bg-emerald-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Vista previa del ticket térmico */}
        <div className="p-4 overflow-y-auto flex-1 bg-slate-100 flex justify-center">
          <div
            id="thermal-print-area"
            className={`bg-white shadow-md border border-slate-300 p-4 font-mono text-[11px] text-slate-800 transition-all ${
              ticketWidth === '80mm' ? 'w-[320px]' : 'w-[240px]'
            }`}
            style={{ fontFamily: 'Courier Prime, Courier, monospace' }}
          >
            {/* Cabecera */}
            <div className="text-center space-y-0.5 mb-2">
              <h2 className="text-sm font-black text-slate-900 tracking-wider">EXPRESO PUNATA</h2>
              <p className="text-[10px] text-slate-600">Servicio de Transporte y Encomiendas</p>
              <p className="text-[10px] font-bold text-slate-700">{branchName.toUpperCase()}</p>
              <p className="text-[9px] text-slate-400">Punata - Cochabamba • Bolivia</p>
            </div>

            <div className="border-t border-dashed border-slate-400 my-2" />

            {/* Datos del Turno */}
            <div className="text-center font-bold text-[11px] text-slate-900 mb-2">
              COMPROBANTE DE ARQUEO DE CAJA
            </div>

            <div className="space-y-1 text-[10px]">
              <div className="flex justify-between">
                <span className="text-slate-500">N° Turno:</span>
                <span className="font-bold text-slate-900">{shift.shiftNumber || shift.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Operador:</span>
                <span className="font-semibold text-slate-800">{shift.operatorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Apertura:</span>
                <span className="text-slate-700">
                  {shift.openedAt ? new Date(shift.openedAt).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : 'N/D'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cierre:</span>
                <span className="text-slate-700">
                  {shift.closedAt ? new Date(shift.closedAt).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : 'Abierto'}
                </span>
              </div>
            </div>

            <div className="border-t border-dashed border-slate-400 my-2" />

            {/* Resumen Financiero */}
            <div className="space-y-1 text-[10px]">
              <div className="font-bold text-slate-700 text-center mb-1">RESUMEN DE FONDOS</div>

              <div className="flex justify-between">
                <span>Fondo Inicial (Sencillo):</span>
                <span className="font-semibold">{formatCurrencyBob(shift.initialCashCents || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ingresos en Efectivo:</span>
                <span className="font-semibold text-emerald-800">{formatCurrencyBob(bd.cashIncomeCents || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ingresos por Pago QR:</span>
                <span className="font-semibold text-blue-700">{formatCurrencyBob(bd.qrIncomeCents || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Ingresos Transferencia:</span>
                <span className="font-semibold text-purple-700">{formatCurrencyBob(bd.transferIncomeCents || 0)}</span>
              </div>

              <div className="border-t border-dotted border-slate-300 pt-1 flex justify-between font-bold">
                <span>Total Ventas Cobradas:</span>
                <span>{formatCurrencyBob(bd.totalIncomeCents || 0)}</span>
              </div>

              {bd.expensesCents > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>(-) Egresos Autorizados:</span>
                  <span>-{formatCurrencyBob(bd.expensesCents)}</span>
                </div>
              )}

              {bd.pendingIncomeCents && bd.pendingIncomeCents > 0 ? (
                <div className="flex justify-between text-amber-700 text-[9px] italic">
                  <span>Pendientes (No en Caja):</span>
                  <span>{formatCurrencyBob(bd.pendingIncomeCents)}</span>
                </div>
              ) : null}
            </div>

            <div className="border-t border-dashed border-slate-400 my-2" />

            {/* Arqueo y Diferencia */}
            <div className="space-y-1 text-[10px]">
              <div className="flex justify-between font-bold">
                <span>Efectivo Esperado:</span>
                <span className="text-slate-900">{formatCurrencyBob(shift.expectedCashCents || 0)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Efectivo Contado:</span>
                <span className="text-slate-900">
                  {shift.actualCashCents !== null && shift.actualCashCents !== undefined
                    ? formatCurrencyBob(shift.actualCashCents)
                    : 'No registrado'}
                </span>
              </div>

              <div
                className={`flex justify-between items-center p-1 rounded font-bold text-[10px] mt-1 ${
                  diffStatus === 'conforme'
                    ? 'bg-emerald-50 text-emerald-800'
                    : diffStatus === 'sobrante'
                    ? 'bg-blue-50 text-blue-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                <div className="flex items-center gap-1">
                  {diffStatus === 'conforme' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                  ) : diffStatus === 'sobrante' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-blue-600" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  )}
                  <span>DIFERENCIA ({diffStatus.toUpperCase()}):</span>
                </div>
                <span>{formatCurrencyBob(diffCents)}</span>
              </div>

              {shift.closingNotes && (
                <p className="text-[9px] text-slate-500 italic mt-1 bg-slate-50 p-1 rounded">
                  Obs: {shift.closingNotes}
                </p>
              )}
            </div>

            {/* Código QR */}
            {qrUrl && (
              <div className="flex flex-col items-center justify-center my-3">
                <img src={qrUrl} alt="QR Verificación" className="w-20 h-20 border border-slate-200 p-0.5 rounded" />
                <span className="text-[8px] text-slate-400 mt-0.5">Control Interno • PACHAX</span>
              </div>
            )}

            <div className="border-t border-dashed border-slate-400 my-2" />

            {/* Firmas */}
            <div className="grid grid-cols-2 gap-3 mt-6 pt-2 text-[9px] text-center text-slate-600">
              <div className="border-t border-slate-400 pt-1">
                <p className="font-semibold text-slate-800">Firma Operador</p>
                <p className="text-[8px] text-slate-400">Entregó Conforme</p>
              </div>
              <div className="border-t border-slate-400 pt-1">
                <p className="font-semibold text-slate-800">Revisión / Auditoría</p>
                <p className="text-[8px] text-slate-400">Recibió Conforme</p>
              </div>
            </div>

            <p className="text-[8px] text-center text-slate-400 mt-4">
              EXPRESO PUNATA • Sistema Web 1.0
            </p>
          </div>
        </div>

        {/* Barra de Acciones */}
        <div className="bg-slate-50 p-3 border-t border-slate-200 flex items-center justify-between shrink-0 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cerrar
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isGeneratingPdf ? 'Generando...' : 'Descargar PDF'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-[#064e3b] bg-[#facc15] hover:bg-[#eab308] rounded-lg shadow-sm transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir Ticket</span>
            </button>
          </div>
        </div>
      </div>

      {/* Estilos de Impresión Nativa @media print para 80mm / 58mm */}
      <style>{`
        @media print {
          @page {
            margin: 0;
            size: ${ticketWidth === '80mm' ? '80mm auto' : '58mm auto'};
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * {
            visibility: hidden !important;
          }
          #thermal-print-area, #thermal-print-area * {
            visibility: visible !important;
          }
          #thermal-print-area {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: ${ticketWidth === '80mm' ? '74mm' : '52mm'} !important;
            max-width: ${ticketWidth === '80mm' ? '74mm' : '52mm'} !important;
            margin: 0 !important;
            padding: 2mm 3mm !important;
            border: none !important;
            box-shadow: none !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-size: ${ticketWidth === '80mm' ? '9.5px' : '8px'} !important;
            line-height: 1.25 !important;
            overflow: visible !important;
          }
          .fixed, .backdrop-blur-sm, [class*="bg-slate-900"] {
            background: transparent !important;
          }
        }
      `}</style>
    </div>
  )
}
