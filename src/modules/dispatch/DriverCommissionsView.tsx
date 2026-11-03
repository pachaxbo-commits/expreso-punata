import React, { useState, useEffect } from 'react'
import {
  Coins,
  Receipt,
  UserCheck,
  CheckCircle,
  AlertCircle,
  Plus,
  RefreshCw,
  Printer,
  X,
} from 'lucide-react'
import type {
  UserProfile,
  Branch,
  DriverCommissionAccount,
  DriverCommissionRecord,
  DriverCommissionVoucher,
} from '../../types/index.ts'
import {
  fetchAllDriverCommissionAccounts,
  fetchDriverCommissionRecords,
  settleDriverCommission,
  accrueDriverCommission,
} from '../../services/commissionService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'

interface DriverCommissionsViewProps {
  currentUser: UserProfile
  currentBranch: Branch
}

export const DriverCommissionsView: React.FC<DriverCommissionsViewProps> = ({
  currentUser,
  currentBranch,
}) => {
  const [accounts, setAccounts] = useState<DriverCommissionAccount[]>([])
  const [selectedDriverUid, setSelectedDriverUid] = useState<string | null>(null)
  const [records, setRecords] = useState<DriverCommissionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Modales
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false)
  const [settleAmountBob, setSettleAmountBob] = useState<string>('')
  const [settleNotes, setSettleNotes] = useState<string>('')
  const [isSettling, setIsSettling] = useState(false)
  const [lastVoucher, setLastVoucher] = useState<DriverCommissionVoucher | null>(null)

  // Modal para devengar manual
  const [isAccrueModalOpen, setIsAccrueModalOpen] = useState(false)
  const [accrueTrackingCode, setAccrueTrackingCode] = useState('')
  const [accrueShippingAmountBob, setAccrueShippingAmountBob] = useState('15')
  const [accrueRuleType, setAccrueRuleType] = useState<'percentage' | 'fixed_per_shipment'>('percentage')
  const [accrueRuleValue, setAccrueRuleValue] = useState('10')
  const [isAccruing, setIsAccruing] = useState(false)

  const loadAccounts = async () => {
    try {
      setLoading(true)
      const data = await fetchAllDriverCommissionAccounts()
      setAccounts(data)
      if (data.length > 0 && !selectedDriverUid) {
        setSelectedDriverUid(data[0].driverUid)
      }
    } catch (err: any) {
      console.error('Error cargando cuentas de choferes:', err)
      setFeedback({ type: 'error', message: err.message || 'Error al cargar comisiones de choferes.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  useEffect(() => {
    if (selectedDriverUid) {
      loadRecords(selectedDriverUid)
    } else {
      setRecords([])
    }
  }, [selectedDriverUid])

  const loadRecords = async (driverUid: string) => {
    try {
      setLoadingRecords(true)
      const data = await fetchDriverCommissionRecords(driverUid)
      setRecords(data)
    } catch (err: any) {
      console.error('Error cargando asientos de comisión:', err)
    } finally {
      setLoadingRecords(false)
    }
  }

  const selectedAccount = accounts.find((a) => a.driverUid === selectedDriverUid) || null

  const handleOpenSettleModal = () => {
    if (!selectedAccount) return
    const pendingBob = (selectedAccount.pendingCents || 0) / 100
    setSettleAmountBob(pendingBob > 0 ? pendingBob.toFixed(2) : '0.00')
    setSettleNotes('')
    setLastVoucher(null)
    setIsSettleModalOpen(true)
  }

  const handleExecuteSettlement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccount) return

    const amountNum = parseFloat(settleAmountBob)
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Por favor ingrese un monto válido mayor a 0.')
      return
    }

    const amountCents = Math.round(amountNum * 100)
    if (amountCents > selectedAccount.pendingCents) {
      alert(`El monto no puede superar el saldo pendiente de Bs. ${(selectedAccount.pendingCents / 100).toFixed(2)}.`)
      return
    }

    try {
      setIsSettling(true)
      const result = await settleDriverCommission({
        driverUid: selectedAccount.driverUid,
        amountCents,
        branchId: currentBranch.id,
        notes: settleNotes,
      })

      setLastVoucher(result.voucher)
      setFeedback({ type: 'success', message: result.message })
      await loadAccounts()
      await loadRecords(selectedAccount.driverUid)
    } catch (err: any) {
      console.error('Error liquidando comisiones:', err)
      alert(err.message || 'Error al liquidar comisiones.')
    } finally {
      setIsSettling(false)
    }
  }

  const handlePrintVoucher = (voucher: DriverCommissionVoucher) => {
    try {
      const docPayload = printEngine.buildFromCommissionVoucher(voucher, currentUser.fullName)
      printEngine.printDocument(docPayload)
    } catch (err: any) {
      alert('Error enviando a imprimir: ' + err.message)
    }
  }

  const handleExecuteAccrue = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccount) return
    if (!accrueTrackingCode.trim()) {
      alert('Ingrese el código de guía.')
      return
    }

    const shipAmt = parseFloat(accrueShippingAmountBob)
    if (isNaN(shipAmt) || shipAmt < 0) {
      alert('Ingrese un flete válido.')
      return
    }

    const ruleVal = parseFloat(accrueRuleValue)
    if (isNaN(ruleVal) || ruleVal <= 0) {
      alert('Ingrese un valor de regla válido.')
      return
    }

    try {
      setIsAccruing(true)
      const res = await accrueDriverCommission({
        driverUid: selectedAccount.driverUid,
        shipmentId: accrueTrackingCode.trim(),
        trackingCode: accrueTrackingCode.trim(),
        shippingAmountCents: Math.round(shipAmt * 100),
        ruleType: accrueRuleType,
        ruleValue: accrueRuleType === 'percentage' ? ruleVal : Math.round(ruleVal * 100),
      })

      setFeedback({
        type: 'success',
        message: `Comisión de Bs. ${(res.commissionAmountCents / 100).toFixed(2)} devengada exitosamente.`,
      })
      setIsAccrueModalOpen(false)
      setAccrueTrackingCode('')
      await loadAccounts()
      await loadRecords(selectedAccount.driverUid)
    } catch (err: any) {
      alert(err.message || 'Error al devengar comisión.')
    } finally {
      setIsAccruing(false)
    }
  }

  // Métricas consolidadas
  const totalAccruedAll = accounts.reduce((sum, a) => sum + (a.accruedCents || 0), 0)
  const totalPaidAll = accounts.reduce((sum, a) => sum + (a.paidCents || 0), 0)
  const totalPendingAll = accounts.reduce((sum, a) => sum + (a.pendingCents || 0), 0)
  const driversWithBalance = accounts.filter((a) => (a.pendingCents || 0) > 0).length

  return (
    <div className="space-y-6">
      {/* Encabezado y KPIs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Coins className="w-6 h-6 text-[#064e3b]" />
            <h2 className="text-xl font-black text-slate-800">Comisiones de Conductores</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestión independiente de comisiones devengadas por transporte (separadas de la custodia COD).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAccounts}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
            title="Recargar datos"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-slate-500">Total Devengado</p>
          <p className="text-xl font-black text-slate-800 mt-1">Bs. {(totalAccruedAll / 100).toFixed(2)}</p>
          <span className="text-[10px] text-slate-400">Comisiones ganadas históricas</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-slate-500">Total Liquidado</p>
          <p className="text-xl font-black text-emerald-700 mt-1">Bs. {(totalPaidAll / 100).toFixed(2)}</p>
          <span className="text-[10px] text-slate-400">Pagado en caja a choferes</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/30 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-amber-800">Saldo Pendiente Global</p>
          <p className="text-xl font-black text-amber-900 mt-1">Bs. {(totalPendingAll / 100).toFixed(2)}</p>
          <span className="text-[10px] text-amber-700 font-semibold">{driversWithBalance} choferes con saldo</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-slate-500">Conductores Activos</p>
          <p className="text-xl font-black text-slate-800 mt-1">{accounts.length}</p>
          <span className="text-[10px] text-slate-400">En padrón de transporte</span>
        </div>
      </div>

      {/* Layout 2 columnas: Lista de choferes a la izquierda, Asientos a la derecha */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna 1: Directorio de Cuentas */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider">Cuentas de Conductores</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {accounts.length}
            </span>
          </div>

          <div className="divide-y divide-slate-100 overflow-y-auto max-h-[500px]">
            {loading ? (
              <div className="p-6 text-center text-xs text-slate-400">Cargando cuentas...</div>
            ) : accounts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No hay cuentas de choferes inicializadas aún.
              </div>
            ) : (
              accounts.map((acc) => {
                const isSelected = acc.driverUid === selectedDriverUid
                const pendingBob = (acc.pendingCents || 0) / 100
                return (
                  <button
                    key={acc.driverUid}
                    type="button"
                    onClick={() => setSelectedDriverUid(acc.driverUid)}
                    className={`w-full text-left p-3.5 transition flex items-center justify-between ${
                      isSelected ? 'bg-emerald-50/70 border-l-4 border-[#064e3b]' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-800">{acc.driverName || 'Conductor'}</p>
                      <p className="text-[10px] text-slate-400">Devengado: Bs. {((acc.accruedCents || 0) / 100).toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-xs font-black ${
                          pendingBob > 0 ? 'text-amber-700' : 'text-slate-500'
                        }`}
                      >
                        Bs. {pendingBob.toFixed(2)}
                      </p>
                      <span className="text-[9px] uppercase font-bold text-slate-400">Pendiente</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Columna 2: Detalle de la Cuenta y Asientos */}
        <div className="lg:col-span-2 space-y-4">
          {selectedAccount ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-[#064e3b]" />
                    <h3 className="text-base font-black text-slate-800">{selectedAccount.driverName}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Saldo pendiente por liquidar:{' '}
                    <strong className="text-amber-800 text-sm">
                      Bs. {((selectedAccount.pendingCents || 0) / 100).toFixed(2)}
                    </strong>{' '}
                    (Devengado acumulado: Bs. {((selectedAccount.accruedCents || 0) / 100).toFixed(2)})
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAccrueModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Devengar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenSettleModal}
                    disabled={(selectedAccount.pendingCents || 0) <= 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#064e3b] hover:bg-[#065f46] disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold shadow transition"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    <span>Liquidar Comisión</span>
                  </button>
                </div>
              </div>

              {/* Listado de Asientos de Comisión */}
              <div>
                <h4 className="text-xs font-black uppercase text-slate-600 mb-3 tracking-wider">
                  Asientos de Comisión ({records.length})
                </h4>

                {loadingRecords ? (
                  <div className="p-6 text-center text-xs text-slate-400">Cargando asientos de guía...</div>
                ) : records.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    No se registran asientos de comisión para este conductor.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-2.5">Guía</th>
                          <th className="p-2.5">Fecha</th>
                          <th className="p-2.5">Flete Base</th>
                          <th className="p-2.5">Regla</th>
                          <th className="p-2.5">Comisión</th>
                          <th className="p-2.5">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {records.map((r) => {
                          const statusColor =
                            r.status === 'paid'
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.status === 'partially_paid'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          const statusLabel =
                            r.status === 'paid'
                              ? 'Liquidada'
                              : r.status === 'partially_paid'
                              ? 'Parcial'
                              : 'Devengada'

                          return (
                            <tr key={r.id} className="hover:bg-slate-50">
                              <td className="p-2.5 font-bold font-mono text-[#064e3b]">{r.trackingCode}</td>
                              <td className="p-2.5 text-slate-500">
                                {r.createdAtIso ? new Date(r.createdAtIso).toLocaleDateString() : '-'}
                              </td>
                              <td className="p-2.5 font-mono">Bs. {(r.baseShippingAmountCents / 100).toFixed(2)}</td>
                              <td className="p-2.5 text-[11px] text-slate-600">
                                {r.ruleApplied?.type === 'percentage'
                                  ? `${r.ruleApplied.value}%`
                                  : `Bs. ${(r.ruleApplied?.value / 100).toFixed(2)}`}
                              </td>
                              <td className="p-2.5 font-bold font-mono text-slate-800">
                                Bs. {(r.commissionAmountCents / 100).toFixed(2)}
                              </td>
                              <td className="p-2.5">
                                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${statusColor}`}>
                                  {statusLabel}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center text-slate-400 text-xs">
              Seleccione un conductor del panel lateral para gestionar sus comisiones.
            </div>
          )}
        </div>
      </div>

      {/* Modal de Liquidación de Comisiones */}
      {isSettleModalOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#064e3b]" />
                <h3 className="text-sm font-black text-slate-800">Liquidar Comisión a Conductor</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSettleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {lastVoucher ? (
              <div className="p-5 space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-2">
                  <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto" />
                  <p className="text-sm font-black text-emerald-900">Comisión Liquidada Exitosamente</p>
                  <p className="text-xs text-emerald-800 font-mono font-bold">Vale: {lastVoucher.voucherNumber}</p>
                  <p className="text-base font-black text-slate-800">Bs. {lastVoucher.settledAmountBob.toFixed(2)}</p>
                  <p className="text-[11px] text-slate-500">
                    Saldo restante por cobrar: Bs. {(lastVoucher.remainingPendingCents / 100).toFixed(2)}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintVoucher(lastVoucher)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl text-xs font-bold shadow"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimir Vale Térmico</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSettleModalOpen(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleExecuteSettlement} className="p-5 space-y-4 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                  <p className="font-bold text-slate-700">Conductor: {selectedAccount.driverName}</p>
                  <p className="text-slate-500">
                    Saldo pendiente total:{' '}
                    <strong className="text-amber-800">
                      Bs. {((selectedAccount.pendingCents || 0) / 100).toFixed(2)}
                    </strong>
                  </p>
                  <p className="text-[10px] text-slate-400">Sucursal de egreso de caja: {currentBranch.name}</p>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Monto a liquidar y pagar (Bs.)</label>
                  <input
                    type="number"
                    step="0.50"
                    min="0.50"
                    max={((selectedAccount.pendingCents || 0) / 100).toFixed(2)}
                    value={settleAmountBob}
                    onChange={(e) => setSettleAmountBob(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold focus:ring-2 focus:ring-[#064e3b] outline-none"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Se descontará de la caja activa del turno y se emitirá el vale correlativo.
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Observaciones / Justificación</label>
                  <textarea
                    rows={2}
                    value={settleNotes}
                    onChange={(e) => setSettleNotes(e.target.value)}
                    placeholder="Ej. Pago correspondiente a manifiesto de la mañana..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-[#064e3b]"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsSettleModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSettling}
                    className="flex-1 py-2.5 bg-[#064e3b] hover:bg-[#065f46] disabled:bg-slate-300 text-white rounded-xl font-bold shadow"
                  >
                    {isSettling ? 'Procesando...' : 'Confirmar y Pagar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal para devengar comisión manual */}
      {isAccrueModalOpen && selectedAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-xs font-black text-slate-800">Devengar Comisión Manual</h3>
              <button
                type="button"
                onClick={() => setIsAccrueModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteAccrue} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Código de Guía</label>
                <input
                  type="text"
                  placeholder="Ej. PUN202600001"
                  value={accrueTrackingCode}
                  onChange={(e) => setAccrueTrackingCode(e.target.value.toUpperCase())}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono uppercase font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Flete Base de la Guía (Bs.)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={accrueShippingAmountBob}
                  onChange={(e) => setAccrueShippingAmountBob(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Regla de Comisión</label>
                <select
                  value={accrueRuleType}
                  onChange={(e) => setAccrueRuleType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                >
                  <option value="percentage">Porcentaje sobre flete (%)</option>
                  <option value="fixed_per_shipment">Monto fijo por guía (Bs.)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {accrueRuleType === 'percentage' ? 'Porcentaje (%)' : 'Importe (Bs.)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={accrueRuleValue}
                  onChange={(e) => setAccrueRuleValue(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAccrueModalOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isAccruing}
                  className="flex-1 py-2 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl font-bold shadow"
                >
                  {isAccruing ? 'Guardando...' : 'Devengar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
