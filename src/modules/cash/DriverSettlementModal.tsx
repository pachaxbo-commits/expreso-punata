import React, { useState, useEffect } from 'react'
import {
  X,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Printer,
  DollarSign,
} from 'lucide-react'
import type { UserProfile, Branch } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import {
  settleDriverCashThroughBackend,
  subscribeActiveDrivers,
} from '../../services/dispatchService.ts'
import { printDriverSettlementTicket80mm } from '../../services/pdfService.ts'

interface DriverSettlementModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  currentUser: UserProfile
  currentBranch: Branch
  currentShiftId?: string | null
}

export const DriverSettlementModal: React.FC<DriverSettlementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentUser,
  currentBranch,
  currentShiftId,
}) => {
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [selectedDriverUid, setSelectedDriverUid] = useState<string>('')
  const [amountBob, setAmountBob] = useState<string>('')
  const [shipmentCodes, setShipmentCodes] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completedSettlement, setCompletedSettlement] = useState<any | null>(null)

  // Cargar conductores activos
  useEffect(() => {
    if (!isOpen) return
    const unsubscribe = subscribeActiveDrivers(
      (list) => setDrivers(list),
      (err) => console.warn('[DriverSettlementModal] Error al cargar choferes:', err)
    )
    return () => unsubscribe()
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      setSelectedDriverUid('')
      setAmountBob('')
      setShipmentCodes('')
      setNotes('')
      setErrorMessage(null)
      setCompletedSettlement(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleConfirm = async () => {
    if (!selectedDriverUid) {
      setErrorMessage('Seleccione al conductor que rinde los fondos.')
      return
    }

    const num = parseFloat(amountBob)
    if (isNaN(num) || num <= 0) {
      setErrorMessage('Ingrese un monto válido mayor a 0.')
      return
    }

    const amountCents = Math.round(num * 100)

    setLoading(true)
    setErrorMessage(null)

    try {
      const parsedShipmentIds = shipmentCodes
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)

      const res = await settleDriverCashThroughBackend({
        driverUid: selectedDriverUid,
        amountCents,
        shipmentIds: parsedShipmentIds,
        paymentMethod: 'cash',
        notes: notes.trim(),
      })

      const driverObj = drivers.find((d) => d.uid === selectedDriverUid)
      const settlementData = {
        settlementNumber: res.settlementNumber,
        driverName: driverObj?.fullName || 'Conductor',
        receivedByName: currentUser.fullName || 'Cajero',
        amountCents: res.amountCents,
        createdAtIso: res.settledAtIso,
        notes: notes.trim(),
      }

      setCompletedSettlement(settlementData)
      onSuccess()
    } catch (err: any) {
      console.error('[DriverSettlementModal] Error:', err)
      setErrorMessage(err.message || 'Error al procesar la rendición en caja.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
        {/* Cabecera */}
        <div className="bg-[#064e3b] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center font-extrabold shadow-sm">
              <Truck className="w-5 h-5 text-[#064e3b]" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-[#facc15] tracking-tight">
                RENDICIÓN DE FONDOS DE CONDUCTOR
              </h2>
              <p className="text-xs text-emerald-100">
                Agencia {currentBranch.name} • Ingreso de cobros de ruta a turno de caja
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-emerald-800 text-emerald-200 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PANTALLA DE ÉXITO */}
        {completedSettlement ? (
          <div className="p-6 text-center space-y-5">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-slate-800">
                ¡RENDICIÓN REGISTRADA EXITOSAMENTE!
              </h3>
              <p className="text-sm font-mono font-bold text-[#064e3b]">
                {completedSettlement.settlementNumber}
              </p>
              <p className="text-xs text-slate-600">
                Conductor: <strong>{completedSettlement.driverName}</strong>
              </p>
              <p className="text-base font-extrabold text-slate-900 font-mono mt-2">
                {formatCurrencyBob(completedSettlement.amountCents, true)}
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => printDriverSettlementTicket80mm(completedSettlement)}
                className="w-full py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
              >
                <Printer className="w-4 h-4 text-[#facc15]" />
                Imprimir Recibo Térmico 80mm
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition"
            >
              Cerrar Ventana
            </button>
          </div>
        ) : (
          /* FORMULARIO */
          <div className="p-6 space-y-4">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p>{errorMessage}</p>
              </div>
            )}

            {!currentShiftId && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  Atención: Debe tener un turno de caja abierto en esta sucursal para recibir y custodiar los fondos.
                </p>
              </div>
            )}

            {/* Selector de conductor */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Conductor que rinde *
              </label>
              <select
                value={selectedDriverUid}
                onChange={(e) => setSelectedDriverUid(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#064e3b] font-medium"
              >
                <option value="">-- Seleccionar Conductor --</option>
                {drivers.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.fullName} {d.assignedMobileNumber ? `(Móvil ${d.assignedMobileNumber})` : ''} - {d.phone || 'Sin tel'}
                  </option>
                ))}
              </select>
            </div>

            {/* Monto rendido */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Importe en Bolivianos (Bs) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Bs</span>
                <input
                  type="number"
                  step="0.50"
                  min="0.10"
                  value={amountBob}
                  onChange={(e) => setAmountBob(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold font-mono bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>
            </div>

            {/* Encomiendas asociadas opcional */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Guías de encomienda asociadas (Opcional, separadas por coma)
              </label>
              <input
                type="text"
                value={shipmentCodes}
                onChange={(e) => setShipmentCodes(e.target.value)}
                placeholder="Ej. PUN-2026-00010, PUN-2026-00012"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#064e3b] font-mono"
              />
            </div>

            {/* Observaciones */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Concepto / Observaciones
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Rendición de cobranzas en ruta Punata - Cochabamba"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>

            {/* Botones */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading || !selectedDriverUid || !amountBob}
                className="px-5 py-2.5 bg-[#064e3b] hover:bg-emerald-800 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition"
              >
                <DollarSign className="w-4 h-4 text-[#facc15]" />
                {loading ? 'Procesando...' : 'Registrar Rendición en Caja'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
