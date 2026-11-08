import { printEngine } from '../../services/printing/printEngineService.ts'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  X,
  CheckCircle2,
  AlertTriangle,
  PenTool,
  RotateCcw,
  Printer,
  DollarSign,
  Search,
  ShieldCheck,
  Boxes,
} from 'lucide-react'
import type { Shipment, UserProfile, Branch } from '../../types/index.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { deliverShipmentThroughBackend } from '../../services/dispatchService.ts'
import {
  printDeliveryProofPdf,
  
} from '../../services/pdfService.ts'

interface ShipmentDeliveryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (shipment: Shipment) => void
  currentUser: UserProfile
  currentBranch: Branch
  initialShipment?: Shipment | null
  availableShipments?: Shipment[]
}

export const ShipmentDeliveryModal: React.FC<ShipmentDeliveryModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentUser,
  currentBranch,
  initialShipment,
  availableShipments = [],
}) => {
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(initialShipment || null)
  const [searchCode, setSearchCode] = useState('')
  const [receivedByName, setReceivedByName] = useState('')
  const [receivedByDocType, setReceivedByDocType] = useState('CI')
  const [receivedByDocNumber, setReceivedByDocNumber] = useState('')
  const [recipientRelationship, setRecipientRelationship] = useState<'titular' | 'familiar' | 'apoderado' | 'empleado' | 'otro'>('titular')
  const [authorizationNote, setAuthorizationNote] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')

  // Canvas de firma digital
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  // Estado de procesamiento y éxito
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completedShipment, setCompletedShipment] = useState<Shipment | null>(null)
  const [savedSignatureDataUrl, setSavedSignatureDataUrl] = useState<string>('')

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    setHasSignature(false)
  }, [])

  // Manejadores de dibujo en el canvas (táctil y ratón)
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    setIsDrawing(true)
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    ctx.beginPath()
    ctx.moveTo(clientX - rect.left, clientY - rect.top)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    ctx.lineTo(clientX - rect.left, clientY - rect.top)
    ctx.stroke()
    setHasSignature(true)
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  // Sincronizar initialShipment cuando se abre el modal
  useEffect(() => {
    if (initialShipment) {
      setSelectedShipment(initialShipment)
      setReceivedByName(initialShipment.recipient?.name || '')
      setReceivedByDocNumber(initialShipment.recipient?.docNumber || '')
      setReceivedByDocType(initialShipment.recipient?.docType === 'NINGUNO' ? 'CI' : (initialShipment.recipient?.docType || 'CI'))
    } else {
      setSelectedShipment(null)
      setReceivedByName('')
      setReceivedByDocNumber('')
      setAuthorizationNote('')
    }
    setCompletedShipment(null)
    setErrorMessage(null)
    clearSignature()
  }, [isOpen, initialShipment])

  // Inicializar canvas cuando se muestra
  useEffect(() => {
    if (!isOpen || completedShipment) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Ajustar escala para pantallas retina / alta resolución
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [isOpen, selectedShipment, completedShipment])

  // Filtrar o seleccionar encomienda por código
  const handleSelectShipment = (s: Shipment) => {
    setSelectedShipment(s)
    setReceivedByName(s.recipient?.name || '')
    setReceivedByDocNumber(s.recipient?.docNumber || '')
    setReceivedByDocType(s.recipient?.docType === 'NINGUNO' ? 'CI' : (s.recipient?.docType || 'CI'))
    setRecipientRelationship('titular')
    setAuthorizationNote('')
    setErrorMessage(null)
    clearSignature()
  }

  const isCodPending = selectedShipment &&
    selectedShipment.paymentTiming === 'destination_cod' &&
    selectedShipment.paymentStatus !== 'paid'

  // Envío final de entrega
  const handleConfirmDelivery = async () => {
    if (!selectedShipment) {
      setErrorMessage('Seleccione una encomienda para entregar.')
      return
    }

    if (!receivedByName || receivedByName.trim().length < 3) {
      setErrorMessage('Ingrese el nombre completo de quien retira (mínimo 3 caracteres).')
      return
    }

    if (!receivedByDocNumber || receivedByDocNumber.trim().length < 4) {
      setErrorMessage('Ingrese el número de documento de identidad (mínimo 4 caracteres).')
      return
    }

    if (recipientRelationship !== 'titular' && !authorizationNote.trim()) {
      setErrorMessage('Indique el motivo o nota de autorización para retiro por un tercero.')
      return
    }

    if (!hasSignature || !canvasRef.current) {
      setErrorMessage('La firma digital manuscrita en el recuadro es obligatoria para la entrega.')
      return
    }

    const signatureDataUrl = canvasRef.current.toDataURL('image/png')

    setLoading(true)
    setErrorMessage(null)

    try {
      const res = await deliverShipmentThroughBackend({
        shipmentId: selectedShipment.id,
        receivedByName: receivedByName.trim(),
        receivedByDocType,
        receivedByDocNumber: receivedByDocNumber.trim(),
        recipientRelationship,
        authorizationNote: authorizationNote.trim(),
        signatureDataUrl,
        paymentMethod: isCodPending ? paymentMethod : undefined,
      })

      const updatedShipment: Shipment = {
        ...selectedShipment,
        status: 'delivered',
        deliveryRecord: res.deliveryRecord,
        storageLocation: undefined,
        paymentStatus: res.paymentCollected ? 'paid' : selectedShipment.paymentStatus,
        paymentMethod: res.paymentCollected ? paymentMethod : selectedShipment.paymentMethod,
      }

      setSavedSignatureDataUrl(signatureDataUrl)
      setCompletedShipment(updatedShipment)
      onSuccess(updatedShipment)
    } catch (err: any) {
      console.error('[ShipmentDeliveryModal] Error al entregar:', err)
      setErrorMessage(err.message || 'Error al procesar la entrega en ventanilla.')
    } finally {
      setLoading(false)
    }
  }

  const isDriver = currentUser?.role === 'conductor'

  // Lista de encomiendas entregables (ventanilla de sucursal o conductor en ruta)
  const deliverableShipments = availableShipments.filter(s => {
    if (isDriver) {
      const isAssigned = s.assignedVehicle?.driverUid === currentUser.uid
      return isAssigned && ['in_transit', 'dispatched', 'received_at_dest', 'stored'].includes(s.status)
    }
    return s.destinationBranchId === currentBranch.id &&
      ['received_at_dest', 'stored', 'in_delivery', 'ready_for_pickup'].includes(s.status)
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-6 border border-slate-200">
        {/* Cabecera */}
        <div className="bg-[#064e3b] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center font-extrabold shadow-sm">
              <ShieldCheck className="w-5 h-5 text-[#064e3b]" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-[#facc15] tracking-tight">
                {isDriver ? 'ENTREGA EN RUTA • CONDUCTOR' : 'ENTREGA FINAL DE ENCOMIENDA'}
              </h2>
              <p className="text-xs text-emerald-100">
                {isDriver
                  ? 'Entrega en trayecto • Verificación, firma digital y custodia de fondos'
                  : `Agencia ${currentBranch.name} • Verificación de identidad y firma manuscrita`}
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

        {/* PANTALLA DE ÉXITO POST-ENTREGA */}
        {completedShipment ? (
          <div className="p-6 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-extrabold text-slate-800">
                ¡ENCOMIENDA ENTREGADA CONFORME!
              </h3>
              <p className="text-sm font-mono font-bold text-[#064e3b]">
                Guía: {completedShipment.trackingCode}
              </p>
              <p className="text-xs text-slate-600">
                Retirada por: <strong className="text-slate-800">{completedShipment.deliveryRecord?.receivedByName}</strong> ({completedShipment.deliveryRecord?.recipientRelationship})
              </p>
              {completedShipment.paymentTiming === 'destination_cod' && (
                <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 py-1 px-3 rounded-full inline-block mt-1">
                  ✓ Cobro en destino de {formatCurrencyBob(completedShipment.finalAmountCents, true)} ingresado a caja.
                </p>
              )}
            </div>

            {/* Botones de Impresión de Comprobante */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <p className="text-xs font-bold text-slate-700">Comprobantes de Entrega:</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => printDeliveryProofPdf(completedShipment)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
                >
                  <Printer className="w-4 h-4 text-[#facc15]" />
                  Acta de Conformidad (PDF A5)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const doc = printEngine.buildFromShipment(completedShipment, currentUser.fullName, true, savedSignatureDataUrl)
                    await printEngine.printDocument(doc)
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
                >
                  <Printer className="w-4 h-4 text-emerald-400" />
                  Ticket Térmico 80mm
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition"
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        ) : (
          /* FORMULARIO DE ENTREGA */
          <div className="p-6 space-y-5">
            {/* Mensaje de Error */}
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p>{errorMessage}</p>
              </div>
            )}

            {/* 1. Selección o Búsqueda de Guía */}
            {!selectedShipment ? (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Buscar Encomienda por Código de Guía:
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={searchCode}
                    onChange={(e) => setSearchCode(e.target.value)}
                    placeholder="Ej. PUN-2026-00042..."
                    className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#064e3b] font-mono"
                  />
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Disponibles en almacén ({deliverableShipments.length}):
                  </p>
                  {deliverableShipments.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3 text-center">
                      No hay encomiendas listas para entrega en esta sucursal.
                    </p>
                  ) : (
                    deliverableShipments
                      .filter((s) => !searchCode.trim() || s.trackingCode.toLowerCase().includes(searchCode.trim().toLowerCase()) || s.recipient?.name?.toLowerCase().includes(searchCode.trim().toLowerCase()))
                      .map((s) => (
                        <div
                          key={s.id}
                          onClick={() => handleSelectShipment(s)}
                          className="p-2.5 rounded-xl border border-slate-200 hover:border-emerald-600 hover:bg-emerald-50/50 cursor-pointer flex items-center justify-between text-xs transition"
                        >
                          <div>
                            <span className="font-mono font-extrabold text-[#064e3b] mr-2">
                              {s.trackingCode}
                            </span>
                            <span className="text-slate-700 font-semibold">
                              Para: {s.recipient?.name}
                            </span>
                            <span className="text-slate-400 text-[11px] ml-2">
                              ({s.packageCount} blt - {s.totalWeightKg} kg)
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-slate-800">
                              {formatCurrencyBob(s.finalAmountCents, true)}
                            </span>
                            <span className={`block text-[10px] font-bold ${s.paymentTiming === 'destination_cod' ? 'text-amber-800' : 'text-emerald-700'}`}>
                              {s.paymentStatus === 'paid' ? 'PAGADO' : s.paymentTiming === 'destination_cod' ? 'POR PAGAR' : 'PENDIENTE EN ORIGEN'}
                            </span>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            ) : (
              /* Encomienda Seleccionada (Resumen) */
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 relative space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedShipment(null)}
                  className="absolute top-2.5 right-2.5 text-[11px] font-bold text-slate-500 hover:text-slate-800"
                >
                  Cambiar Guía
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-extrabold text-sm text-[#064e3b] bg-emerald-100/70 px-2.5 py-0.5 rounded border border-emerald-300">
                    {selectedShipment.trackingCode}
                  </span>
                  <span className="text-xs text-slate-600">
                    {selectedShipment.originCity} ➔ {selectedShipment.destinationCity}
                  </span>
                  {selectedShipment.storageLocation && (
                    <span className="inline-flex items-center gap-1 text-[11px] bg-purple-100 text-purple-900 px-2 py-0.5 rounded font-medium">
                      <Boxes className="w-3 h-3" />
                      {selectedShipment.storageLocation.shelfId} / {selectedShipment.storageLocation.moduleId}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-700 flex flex-wrap gap-x-4">
                  <span><strong>Destinatario:</strong> {selectedShipment.recipient?.name} ({selectedShipment.recipient?.phone})</span>
                  <span><strong>Bultos:</strong> {selectedShipment.packageCount} ({selectedShipment.totalWeightKg} kg)</span>
                </div>

                {/* Banner de Cobro COD */}
                {isCodPending ? (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-amber-900">
                      <DollarSign className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <strong className="block">ENCOMIENDA POR PAGAR</strong>
                        <span>Debe cobrar antes de entregar al cliente.</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-extrabold text-base text-amber-950 font-mono">
                        {formatCurrencyBob(selectedShipment.finalAmountCents, true)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    Flete pagado en origen. No cobrar ningún monto adicional.
                  </div>
                )}
              </div>
            )}

            {/* 2. Datos de quien retira */}
            {selectedShipment && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                      Nombre Completo de quien Retira *
                    </label>
                    <input
                      type="text"
                      value={receivedByName}
                      onChange={(e) => setReceivedByName(e.target.value)}
                      placeholder="Ej. Juan Pérez Morales"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                        Tipo Doc
                      </label>
                      <select
                        value={receivedByDocType}
                        onChange={(e) => setReceivedByDocType(e.target.value)}
                        className="w-full px-2 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#064e3b]"
                      >
                        <option value="CI">CI</option>
                        <option value="NIT">NIT</option>
                        <option value="PASAPORTE">Pasaporte</option>
                        <option value="OTRO">Otro</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                        Número de Documento *
                      </label>
                      <input
                        type="text"
                        value={receivedByDocNumber}
                        onChange={(e) => setReceivedByDocNumber(e.target.value)}
                        placeholder="Ej. 5234123 Cbba"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#064e3b] font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                      Parentesco / Vínculo con el Destinatario
                    </label>
                    <select
                      value={recipientRelationship}
                      onChange={(e) => setRecipientRelationship(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#064e3b]"
                    >
                      <option value="titular">Titular Destinatario</option>
                      <option value="familiar">Familiar (Esposo/a, Hijo/a, Hermano/a)</option>
                      <option value="apoderado">Apoderado con Carta Poder / Mensaje</option>
                      <option value="empleado">Empleado / Chofer de Empresa</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>

                  {isCodPending && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                        Método de Cobro en Caja
                      </label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as any)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#064e3b] font-semibold text-[#064e3b]"
                      >
                        <option value="cash">Efectivo en Ventanilla</option>
                        <option value="qr">Pago QR Simple</option>
                        <option value="transfer">Transferencia Bancaria</option>
                      </select>
                    </div>
                  )}
                </div>

                {recipientRelationship !== 'titular' && (
                  <div>
                    <label className="block text-[11px] font-bold text-amber-900 uppercase mb-1">
                      Nota de Autorización (Obligatoria para retiro por terceros) *
                    </label>
                    <input
                      type="text"
                      value={authorizationNote}
                      onChange={(e) => setAuthorizationNote(e.target.value)}
                      placeholder="Ej. Autorizado por destinatario mediante mensaje de WhatsApp / llamada..."
                      className="w-full px-3 py-2 text-xs bg-amber-50/50 border border-amber-300 rounded-lg focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                )}

                {/* 3. Canvas de Firma Digital Manuscrita */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-700 uppercase flex items-center gap-1.5">
                      <PenTool className="w-3.5 h-3.5 text-[#064e3b]" />
                      Firma Manuscrita Digital de Quien Recibe *
                    </label>
                    <button
                      type="button"
                      onClick={clearSignature}
                      className="text-[11px] text-slate-500 hover:text-red-700 flex items-center gap-1 font-semibold"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Limpiar Firma
                    </button>
                  </div>
                  <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50 touch-none">
                    <canvas
                      ref={canvasRef}
                      className="w-full h-32 cursor-crosshair block"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 italic">
                    El receptor debe firmar directamente con el dedo o puntero sobre la pantalla táctil o con el ratón.
                  </p>
                </div>
              </div>
            )}

            {/* Botones de Acción */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancelar
              </button>
              {selectedShipment && (
                <button
                  type="button"
                  onClick={handleConfirmDelivery}
                  disabled={loading || !hasSignature}
                  className={`px-5 py-2.5 text-xs font-bold rounded-xl shadow-md flex items-center gap-2 transition ${
                    loading || !hasSignature
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : isCodPending
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold'
                      : 'bg-[#064e3b] hover:bg-emerald-800 text-white'
                  }`}
                >
                  {loading ? (
                    'Procesando entrega...'
                  ) : isCodPending ? (
                    <>
                      <DollarSign className="w-4 h-4" />
                      Cobrar {formatCurrencyBob(selectedShipment.finalAmountCents, true)} y Entregar
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-[#facc15]" />
                      Confirmar Entrega Conforme
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
