import React, { useState, useEffect } from 'react'
import {
  X,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Printer,
  DollarSign,
  Wallet,
} from 'lucide-react'
import type { UserProfile, Branch } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import {
  settleDriverCashThroughBackend,
  subscribeActiveDrivers,
  getDriverCustodyBalanceThroughBackend,
} from '../../services/dispatchService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'

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
  const [custodyAccount, setCustodyAccount] = useState<{
    pendingRemittanceCents: number
    cashUnderCustodyCents: number
    totalCollectedCents: number
    totalRemittedCents: number
  } | null>(null)
  const [pendingRecords, setPendingRecords] = useState<any[]>([])
  const [loadingCustody, setLoadingCustody] = useState(false)
  const [amountBob, setAmountBob] = useState<string>('')
  const [shipmentCodes, setShipmentCodes] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completedSettlement, setCompletedSettlement] = useState<any | null>(null)
  const [activeIdempotencyKey, setActiveIdempotencyKey] = useState<string>('')

  useEffect(() => {
    if (isOpen) {
      setActiveIdempotencyKey(`settle-${currentUser?.uid || 'usr'}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`)
    }
  }, [isOpen, currentUser?.uid])

  // Cargar conductores activos
  useEffect(() => {
    if (!isOpen) return
    const unsubscribe = subscribeActiveDrivers(
      (list) => setDrivers(list),
      (err) => console.warn('[DriverSettlementModal] Error al cargar choferes:', err)
    )
    return () => unsubscribe()
  }, [isOpen])

  // Cargar saldo de custodia cuando cambia el conductor seleccionado
  useEffect(() => {
    if (!selectedDriverUid) {
      setCustodyAccount(null)
      setPendingRecords([])
      return
    }

    let isMounted = true
    setLoadingCustody(true)
    setErrorMessage(null)

    getDriverCustodyBalanceThroughBackend({ driverUid: selectedDriverUid })
      .then((res) => {
        if (!isMounted) return
        setCustodyAccount(res.account)
        setPendingRecords(res.pendingRecords || [])
        // Si hay guías pendientes, auto-sugerir en el campo de texto
        if (res.pendingRecords && res.pendingRecords.length > 0) {
          const codes = res.pendingRecords.map((r: any) => r.trackingCode || r.shipmentId).filter(Boolean)
          setShipmentCodes(codes.join(', '))
        } else {
          setShipmentCodes('')
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.warn('[DriverSettlementModal] Error al obtener custodia:', err)
        setCustodyAccount({
          pendingRemittanceCents: 0,
          cashUnderCustodyCents: 0,
          totalCollectedCents: 0,
          totalRemittedCents: 0,
        })
      })
      .finally(() => {
        if (isMounted) setLoadingCustody(false)
      })

    return () => {
      isMounted = false
    }
  }, [selectedDriverUid])

  useEffect(() => {
    if (isOpen) {
      setSelectedDriverUid('')
      setCustodyAccount(null)
      setPendingRecords([])
      setAmountBob('')
      setShipmentCodes('')
      setNotes('')
      setErrorMessage(null)
      setCompletedSettlement(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSetFullPendingAmount = () => {
    if (!custodyAccount || custodyAccount.pendingRemittanceCents <= 0) return
    setAmountBob((custodyAccount.pendingRemittanceCents / 100).toFixed(2))
  }

  const handleConfirm = async () => {
    if (!selectedDriverUid) {
      setErrorMessage('Seleccione al conductor que rinde los fondos.')
      return
    }

    if (!custodyAccount || custodyAccount.pendingRemittanceCents <= 0) {
      setErrorMessage('El conductor no registra saldo pendiente de rendición bajo custodia.')
      return
    }

    const num = parseFloat(amountBob)
    if (isNaN(num) || num <= 0) {
      setErrorMessage('Ingrese un monto válido mayor a 0.')
      return
    }

    const amountCents = Math.round(num * 100)
    if (amountCents > custodyAccount.pendingRemittanceCents) {
      setErrorMessage(
        `El monto a rendir (${formatCurrencyBob(amountCents, true)}) no puede superar el saldo pendiente (${formatCurrencyBob(custodyAccount.pendingRemittanceCents, true)}).`
      )
      return
    }

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
        idempotencyKey: activeIdempotencyKey || `settle-${selectedDriverUid}-${Date.now()}`,
      })

      const driverObj = drivers.find((d) => d.uid === selectedDriverUid)
      const settlementData = {
        settlementNumber: res.settlementNumber,
        driverName: driverObj?.fullName || 'Conductor',
        receivedByName: currentUser.fullName || 'Cajero',
        amountCents: res.amountCents,
        previousDriverBalanceCents: res.previousDriverBalanceCents ?? custodyAccount.pendingRemittanceCents,
        remainingDriverBalanceCents: res.remainingDriverBalanceCents ?? (custodyAccount.pendingRemittanceCents - amountCents),
        reconciledShipmentIds: res.reconciledShipmentIds || parsedShipmentIds,
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
                TRANSFERENCIA DE CUSTODIA • RENDICIÓN DE CONDUCTOR
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
              <p className="text-lg font-extrabold text-emerald-700 font-mono mt-2">
                {formatCurrencyBob(completedSettlement.amountCents, true)}
              </p>
              {completedSettlement.remainingDriverBalanceCents !== undefined && (
                <p className="text-xs font-semibold text-slate-500">
                  COD cobrado por conductor y pendiente de rendición restante: {formatCurrencyBob(completedSettlement.remainingDriverBalanceCents, true)}
                </p>
              )}
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={async () => {
                  const doc = printEngine.buildFromDriverSettlement(completedSettlement, currentUser.fullName)
                  await printEngine.printDocument(doc)
                }}
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

            {/* Panel informativo de custodia del conductor */}
            {selectedDriverUid && (
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
                    <Wallet className="w-4 h-4 text-emerald-700" />
                    <span>Libro de Custodia del Conductor</span>
                  </div>
                  {loadingCustody && (
                    <span className="text-[10px] text-emerald-600 font-medium animate-pulse">Consultando...</span>
                  )}
                </div>

                {custodyAccount && (
                  <div className="flex items-center justify-between pt-1 border-t border-emerald-200/60">
                    <div>
                      <p className="text-[11px] text-slate-600 font-semibold">COD cobrado por conductor y pendiente de rendición:</p>
                      <p className="text-sm font-extrabold font-mono text-emerald-800">
                        {formatCurrencyBob(custodyAccount.pendingRemittanceCents, true)}
                      </p>
                      {pendingRecords.length > 0 && (
                        <p className="text-[10px] text-slate-500">
                          {pendingRecords.length} cobro(s) de ruta registrado(s)
                        </p>
                      )}
                    </div>
                    {custodyAccount.pendingRemittanceCents > 0 ? (
                      <button
                        type="button"
                        onClick={handleSetFullPendingAmount}
                        className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg transition"
                      >
                        Rendir Todo
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                        Sin saldo pendiente
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Monto rendido */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Importe en Bolivianos a Rendir (Bs) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Bs</span>
                <input
                  type="number"
                  step="0.50"
                  min="0.10"
                  max={custodyAccount ? (custodyAccount.pendingRemittanceCents / 100) : undefined}
                  value={amountBob}
                  onChange={(e) => setAmountBob(e.target.value)}
                  placeholder="0.00"
                  disabled={!custodyAccount || custodyAccount.pendingRemittanceCents <= 0}
                  className="w-full pl-9 pr-3 py-2 text-xs font-bold font-mono bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#064e3b] disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>
            </div>

            {/* Encomiendas asociadas opcional */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Guías de encomienda asociadas (Opcional)
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
                disabled={loading || !selectedDriverUid || !amountBob || !custodyAccount || custodyAccount.pendingRemittanceCents <= 0}
                className="px-5 py-2.5 bg-[#064e3b] hover:bg-emerald-800 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition"
              >
                <DollarSign className="w-4 h-4 text-[#facc15]" />
                {loading ? 'Procesando Transferencia...' : (parseFloat(amountBob || '0') * 100 >= (custodyAccount?.pendingRemittanceCents || 0) ? 'Registrar Rendición Completa en Caja' : 'Registrar Rendición Parcial en Caja')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
