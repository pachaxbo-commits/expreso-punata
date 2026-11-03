import React, { useState } from 'react'
import {
  X,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Package,
  MapPin,
  Users,
  CreditCard,
  Plus,
  Trash2,
  Printer,
  AlertCircle,
  Copy,
  Check,
  Building,
  Home,
  Truck,
} from 'lucide-react'
import type { Shipment, ParcelCustomer, ParcelItem, PaymentTiming, PaymentMethod } from '../../types/index.ts'
import { INITIAL_BRANCHES } from '../../domain/expresoPunataConfig.ts'
import { calculateParcelPricing, formatCurrencyBob } from '../../domain/parcelEngine.ts'
import { createShipmentThroughBackend, extractCustomerSuggestions } from '../../services/shipmentService.ts'
import { printShipmentGuidePdf } from '../../services/pdfService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'
import { FileText } from 'lucide-react'
import { useAuth } from '../auth/AuthContext.tsx'

interface WizardProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (shipment: Shipment) => void
  existingShipments: Shipment[]
}

export const NewShipmentWizardModal: React.FC<WizardProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingShipments,
}) => {
  const { currentBranchId, userProfile, hasRole } = useAuth()
  const isDirectiva = hasRole(['directiva_admin'])

  // Sugerencias de clientes para autocompletado rápido
  const customerSuggestions = extractCustomerSuggestions(existingShipments)

  // Paso actual (1 a 4, o 5 para éxito)
  const [step, setStep] = useState<number>(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [createdShipment, setCreatedShipment] = useState<Shipment | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  // Clave de idempotencia única por formulario abierto
  const [idempotencyKey, setIdempotencyKey] = useState<string>(
    () => `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  )

  // Estado del Paso 1: Ruta y Modalidad
  const defaultDest = currentBranchId === 'punata' ? 'cochabamba' : 'punata'
  const [originBranchId, setOriginBranchId] = useState(currentBranchId || 'punata')
  const [destinationBranchId, setDestinationBranchId] = useState(defaultDest)
  const [deliveryType, setDeliveryType] = useState<'agency' | 'home' | 'direct_driver'>('agency')
  const [deliveryAddress, setDeliveryAddress] = useState('')

  // Estado del Paso 2: Remitente y Destinatario
  const [sender, setSender] = useState<ParcelCustomer>({
    name: '',
    phone: '',
    docType: 'CI',
    docNumber: '',
  })
  const [recipient, setRecipient] = useState<ParcelCustomer>({
    name: '',
    phone: '',
    docType: 'CI',
    docNumber: '',
  })
  const [senderSearchQuery, setSenderSearchQuery] = useState('')
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('')

  // Estado del Paso 3: Ítems y Carga
  const [items, setItems] = useState<ParcelItem[]>([
    {
      description: 'Encomienda general',
      category: 'general',
      quantity: 1,
      packaging: 'paquete',
      weightKg: 2,
      isFragile: false,
      isPerishable: false,
      handlingNotes: '',
    },
  ])
  const [prohibitedNoticeAccepted, setProhibitedNoticeAccepted] = useState(true)

  // Estado del Paso 4: Pago
  const [paymentTiming, setPaymentTiming] = useState<PaymentTiming>('origin_paid')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [discountBob, setDiscountBob] = useState<number>(0)

  if (!isOpen) return null

  // Cálculo en vivo de tarifas y centavos
  const totalWeight = items.reduce((sum, it) => sum + (Number(it.weightKg) || 0), 0)
  const pricing = calculateParcelPricing(totalWeight, deliveryType, discountBob)

  // Validaciones por paso
  const canProceedStep1 = originBranchId !== destinationBranchId && (deliveryType !== 'home' || deliveryAddress.trim().length >= 4)
  const canProceedStep2 =
    sender.name.trim().length >= 2 &&
    sender.phone.trim().length >= 5 &&
    recipient.name.trim().length >= 2 &&
    recipient.phone.trim().length >= 5
  const canProceedStep3 =
    items.length > 0 &&
    items.every(it => it.description.trim().length >= 2 && it.quantity > 0) &&
    prohibitedNoticeAccepted

  const handleAddItem = () => {
    setItems(prev => [
      ...prev,
      {
        description: '',
        category: 'general',
        quantity: 1,
        packaging: 'paquete',
        weightKg: 1,
        isFragile: false,
        isPerishable: false,
      },
    ])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof ParcelItem, value: unknown) => {
    setItems(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
  }

  const handleSelectSenderSuggestion = (c: ParcelCustomer) => {
    setSender({
      name: c.name,
      phone: c.phone,
      docType: c.docType || 'CI',
      docNumber: c.docNumber || '',
    })
    setSenderSearchQuery('')
  }

  const handleSelectRecipientSuggestion = (c: ParcelCustomer) => {
    setRecipient({
      name: c.name,
      phone: c.phone,
      docType: c.docType || 'CI',
      docNumber: c.docNumber || '',
    })
    setRecipientSearchQuery('')
  }

  // Envío final transaccional al backend
  const handleSubmitShipment = async () => {
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const result = await createShipmentThroughBackend({
        originBranchId,
        destinationBranchId,
        deliveryType,
        deliveryAddress: deliveryType === 'home' ? deliveryAddress : undefined,
        sender,
        recipient,
        items,
        paymentTiming,
        paymentMethod: paymentTiming === 'origin_paid' ? paymentMethod : undefined,
        discountCents: pricing.discountCents,
        prohibitedGoodsNoticeAccepted: prohibitedNoticeAccepted,
        idempotencyKey,
      })

      setCreatedShipment(result.shipment)
      setStep(5) // Pantalla de éxito
      onSuccess(result.shipment)
    } catch (err: unknown) {
      console.error('Error al emitir guía:', err)
      const errorMsg = err instanceof Error ? err.message : 'Error inesperado al emitir la guía de encomienda.'
      setErrorMessage(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyCode = () => {
    if (createdShipment) {
      navigator.clipboard.writeText(createdShipment.trackingCode)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    }
  }

  const handleResetForNew = () => {
    setStep(1)
    setCreatedShipment(null)
    setErrorMessage(null)
    setIdempotencyKey(`idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`)
    setSender({ name: '', phone: '', docType: 'CI', docNumber: '' })
    setRecipient({ name: '', phone: '', docType: 'CI', docNumber: '' })
    setItems([
      {
        description: 'Encomienda general',
        category: 'general',
        quantity: 1,
        packaging: 'paquete',
        weightKg: 2,
        isFragile: false,
        isPerishable: false,
      },
    ])
    setPaymentTiming('origin_paid')
    setPaymentMethod('cash')
    setDiscountBob(0)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Encabezado del Modal */}
        <div className="bg-[#064e3b] text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#facc15] text-[#064e3b] flex items-center justify-center font-bold">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold tracking-tight text-white uppercase">
                Nueva Encomienda — Expreso Punata
              </h2>
              <p className="text-[11px] text-emerald-200">
                Asistente de registro en ventanilla • 4 Pasos Guiados
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-emerald-200 hover:text-white p-1 rounded-lg hover:bg-emerald-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Progreso (Paso 1 a 4) */}
        {step <= 4 && (
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 shrink-0">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { s: 1, label: '1. Ruta', icon: MapPin },
                { s: 2, label: '2. Personas', icon: Users },
                { s: 3, label: '3. Carga', icon: Package },
                { s: 4, label: '4. Cobro', icon: CreditCard },
              ].map(item => {
                const isCurrent = step === item.s
                const isCompleted = step > item.s
                const Icon = item.icon
                return (
                  <div
                    key={item.s}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                      isCurrent
                        ? 'bg-[#064e3b] text-[#facc15] shadow-sm'
                        : isCompleted
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200/70 text-slate-500'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">{item.label}</span>
                    <span className="sm:hidden">{item.s}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Mensaje de Error en Alerta */}
        {errorMessage && (
          <div className="bg-rose-50 border-l-4 border-rose-500 p-3 mx-4 mt-3 rounded text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">No se pudo registrar la encomienda</p>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Contenido Dinámico por Paso con Scroll Independiente */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {/* ============================================================ */}
          {/* PASO 1: RUTA Y MODALIDAD */}
          {/* ============================================================ */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                  Trayecto entre Agencias
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Origen */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Agencia de Origen (Emisión)
                    </label>
                    <select
                      value={originBranchId}
                      onChange={e => {
                        setOriginBranchId(e.target.value)
                        if (e.target.value === destinationBranchId) {
                          setDestinationBranchId(e.target.value === 'punata' ? 'cochabamba' : 'punata')
                        }
                      }}
                      disabled={!isDirectiva}
                      className="w-full text-xs font-bold border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-[#064e3b] disabled:bg-slate-100"
                    >
                      {INITIAL_BRANCHES.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                    {!isDirectiva && (
                      <p className="text-[10px] text-slate-500 mt-1">
                        Fijada por la sucursal de tu turno activo.
                      </p>
                    )}
                  </div>

                  {/* Destino */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Agencia de Destino (Llegada)
                    </label>
                    <select
                      value={destinationBranchId}
                      onChange={e => setDestinationBranchId(e.target.value)}
                      className="w-full text-xs font-bold border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:ring-2 focus:ring-[#064e3b]"
                    >
                      {INITIAL_BRANCHES.filter(b => b.id !== originBranchId).map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Modalidad de Entrega */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Modalidad de Entrega en Destino
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: 'agency', label: 'En Agencia', desc: 'Recojo en estante de sucursal', icon: Building },
                    { id: 'home', label: 'A Domicilio', desc: '+Bs. 12.00 (Entrega en puerta)', icon: Home },
                    { id: 'direct_driver', label: 'Conductor en Ruta', desc: 'Entrega en parada intermedia', icon: Truck },
                  ].map(m => {
                    const Icon = m.icon
                    const isSelected = deliveryType === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setDeliveryType(m.id as 'agency' | 'home' | 'direct_driver')}
                        className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'border-[#064e3b] bg-emerald-50/70 ring-2 ring-[#064e3b]'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-[#064e3b]' : 'text-slate-500'}`} />
                          <span className={`text-xs font-bold ${isSelected ? 'text-[#064e3b]' : 'text-slate-800'}`}>
                            {m.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">{m.desc}</p>
                      </button>
                    )
                  })}
                </div>

                {deliveryType === 'home' && (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Dirección exacta de entrega a domicilio <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={e => setDeliveryAddress(e.target.value)}
                      placeholder="Calle, número, zona o referencias..."
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* PASO 2: REMITENTE Y DESTINATARIO */}
          {/* ============================================================ */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Sección Remitente */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-[#064e3b] uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Datos del Remitente (Quien Envía)
                  </span>
                </div>

                {/* Autocompletar Remitente */}
                {customerSuggestions.length > 0 && (
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="🔍 Buscar cliente habitual por nombre..."
                      value={senderSearchQuery}
                      onChange={e => setSenderSearchQuery(e.target.value)}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
                    />
                    {senderSearchQuery.trim().length >= 2 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto divide-y divide-slate-100">
                        {customerSuggestions
                          .filter(c => c.name.toLowerCase().includes(senderSearchQuery.toLowerCase()))
                          .slice(0, 5)
                          .map((c, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleSelectSenderSuggestion(c)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center justify-between"
                            >
                              <span className="font-bold text-slate-800">{c.name}</span>
                              <span className="text-slate-500 font-mono text-[11px]">{c.phone}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nombre Completo <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={sender.name}
                      onChange={e => setSender({ ...sender, name: e.target.value })}
                      placeholder="Ej. Juan Pérez"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Teléfono Celular <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={sender.phone}
                      onChange={e => setSender({ ...sender, phone: e.target.value })}
                      placeholder="Ej. 71712345"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo Doc.</label>
                    <select
                      value={sender.docType}
                      onChange={e => setSender({ ...sender, docType: e.target.value as 'CI' | 'NIT' })}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                    >
                      <option value="CI">CI</option>
                      <option value="NIT">NIT</option>
                      <option value="PASAPORTE">Pasaporte</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Nro. Documento (Opcional)</label>
                    <input
                      type="text"
                      value={sender.docNumber || ''}
                      onChange={e => setSender({ ...sender, docNumber: e.target.value })}
                      placeholder="Ej. 5234123-CB"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                </div>
              </div>

              {/* Sección Destinatario */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-extrabold text-[#064e3b] uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Datos del Destinatario (Quien Recibe)
                </span>

                {/* Autocompletar Destinatario */}
                {customerSuggestions.length > 0 && (
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="🔍 Buscar destinatario habitual..."
                      value={recipientSearchQuery}
                      onChange={e => setRecipientSearchQuery(e.target.value)}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
                    />
                    {recipientSearchQuery.trim().length >= 2 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-36 overflow-y-auto divide-y divide-slate-100">
                        {customerSuggestions
                          .filter(c => c.name.toLowerCase().includes(recipientSearchQuery.toLowerCase()))
                          .slice(0, 5)
                          .map((c, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleSelectRecipientSuggestion(c)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 flex items-center justify-between"
                            >
                              <span className="font-bold text-slate-800">{c.name}</span>
                              <span className="text-slate-500 font-mono text-[11px]">{c.phone}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nombre Completo <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={recipient.name}
                      onChange={e => setRecipient({ ...recipient, name: e.target.value })}
                      placeholder="Ej. María López"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Teléfono Celular <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={recipient.phone}
                      onChange={e => setRecipient({ ...recipient, phone: e.target.value })}
                      placeholder="Ej. 72234567"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo Doc.</label>
                    <select
                      value={recipient.docType}
                      onChange={e => setRecipient({ ...recipient, docType: e.target.value as 'CI' | 'NIT' })}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                    >
                      <option value="CI">CI</option>
                      <option value="NIT">NIT</option>
                      <option value="PASAPORTE">Pasaporte</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Nro. Documento (Opcional)</label>
                    <input
                      type="text"
                      value={recipient.docNumber || ''}
                      onChange={e => setRecipient({ ...recipient, docNumber: e.target.value })}
                      placeholder="Ej. 4238912-CB"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-[#064e3b]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* PASO 3: DETALLE DE BULTOS Y TARIFA */}
          {/* ============================================================ */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Paquetes a Registrar ({items.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="px-2.5 py-1 text-xs bg-[#064e3b] text-[#facc15] font-bold rounded-lg shadow-sm hover:bg-[#065f46] flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agregar Bulto</span>
                </button>
              </div>

              {/* Lista de Ítems */}
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 relative"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">
                        Bulto #{idx + 1}
                      </span>
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-rose-500 hover:text-rose-700 p-1 rounded"
                          title="Eliminar bulto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Descripción del Contenido <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={it.description}
                          onChange={e => handleItemChange(idx, 'description', e.target.value)}
                          placeholder="Ej. Ropa, repuestos mecánicos, documentos..."
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-[#064e3b]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Categoría
                        </label>
                        <select
                          value={it.category}
                          onChange={e => handleItemChange(idx, 'category', e.target.value)}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="general">General</option>
                          <option value="documents">Documentos</option>
                          <option value="clothing">Ropa / Textil</option>
                          <option value="electronics">Electrónicos</option>
                          <option value="fragile">Frágil</option>
                          <option value="perishable">Perecedero</option>
                          <option value="parts">Repuestos</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Cantidad
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={it.quantity}
                          onChange={e => handleItemChange(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Peso (kg)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={it.weightKg || 0}
                          onChange={e => handleItemChange(idx, 'weightKg', Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Embalaje
                        </label>
                        <select
                          value={it.packaging}
                          onChange={e => handleItemChange(idx, 'packaging', e.target.value)}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="paquete">Paquete</option>
                          <option value="caja">Caja</option>
                          <option value="bolsa">Bolsa</option>
                          <option value="sobre">Sobre</option>
                          <option value="fardo">Fardo</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-3 pt-4">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={it.isFragile}
                            onChange={e => handleItemChange(idx, 'isFragile', e.target.checked)}
                            className="rounded text-[#064e3b] focus:ring-[#064e3b]"
                          />
                          Frágil
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Declaración de Contenido Permitido */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="prohibitedGoods"
                  checked={prohibitedNoticeAccepted}
                  onChange={e => setProhibitedNoticeAccepted(e.target.checked)}
                  className="rounded text-[#064e3b] focus:ring-[#064e3b] mt-0.5"
                />
                <label htmlFor="prohibitedGoods" className="text-[11px] text-amber-900 leading-snug cursor-pointer">
                  <span className="font-bold">Declaración Jurada de Contenido:</span> Se certifica que este envío no contiene sustancias ilícitas, armas, dinero en efectivo oculto ni sustancias corrosivas/peligrosas.
                </label>
              </div>

              {/* Tarjeta de Resumen Tarifario */}
              <div className="bg-[#064e3b] text-white p-4 rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-0.5 text-xs">
                  <p className="font-bold text-[#facc15] uppercase tracking-wide">
                    Tarifa Estimada (Referencial de Desarrollo)
                  </p>
                  <p className="text-emerald-200 text-[10px] italic">
                    * Importes referenciales sujetos al tarifario formal de Expreso Punata
                  </p>
                  <p className="text-emerald-200 text-[11px]">
                    Base: Bs. 15.00 (hasta 3 kg) • Exceso: {pricing.chargeableExcessWeightKg} kg • Total: {totalWeight} kg
                  </p>
                  {deliveryType === 'home' && (
                    <p className="text-emerald-200 text-[11px]">
                      + Bs. 12.00 por entrega a domicilio
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-emerald-300 block">Total Estimado</span>
                  <span className="text-xl sm:text-2xl font-black text-[#facc15] font-mono">
                    {formatCurrencyBob(pricing.finalAmountCents, true)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* PASO 4: MODALIDAD DE COBRO Y CONFIRMACIÓN */}
          {/* ============================================================ */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Opciones de Cobro */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setPaymentTiming('origin_paid')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    paymentTiming === 'origin_paid'
                      ? 'border-[#064e3b] bg-emerald-50 ring-2 ring-[#064e3b]'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-slate-800">
                      🟢 Pagado en Origen
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">
                      Cobrado
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    El remitente cancela en ventanilla ahora con caja activa.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentTiming('origin_pending')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    paymentTiming === 'origin_pending'
                      ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-600'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-slate-800">
                      🔵 Pendiente en Origen
                    </span>
                    <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded">
                      Por Cobrar
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    El remitente deja el paquete y cancelará antes de despachar.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentTiming('destination_cod')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    paymentTiming === 'destination_cod'
                      ? 'border-amber-600 bg-amber-50 ring-2 ring-amber-600'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-slate-800">
                      🟡 Contraentrega (COD)
                    </span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                      Destino
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    El destinatario cancela en sucursal de destino al retirar.
                  </p>
                </button>
              </div>

              {/* Si es pagado en origen, seleccionar medio de pago */}
              {paymentTiming === 'origin_paid' && (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Medio de Cobro en Ventanilla
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'cash', label: '💵 Efectivo' },
                      { id: 'qr', label: '📱 QR Simple' },
                      { id: 'transfer', label: '🏦 Transferencia' },
                    ].map(pm => (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setPaymentMethod(pm.id as PaymentMethod)}
                        className={`py-2 px-3 rounded-lg text-xs font-bold border text-center transition-all ${
                          paymentMethod === pm.id
                            ? 'bg-[#064e3b] text-[#facc15] border-[#064e3b] shadow-sm'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Resumen Final de la Encomienda */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2 text-xs">
                <span className="font-extrabold text-slate-700 uppercase tracking-wider block text-[11px]">
                  Confirmación de Datos
                </span>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <div>
                    <span className="font-semibold text-slate-800">Ruta:</span>{' '}
                    {originBranchId.toUpperCase()} ➔ {destinationBranchId.toUpperCase()}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800">Modalidad:</span>{' '}
                    {deliveryType === 'home' ? 'A Domicilio' : 'En Agencia'}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800">Remitente:</span> {sender.name} ({sender.phone})
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800">Destinatario:</span> {recipient.name} ({recipient.phone})
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800">Bultos:</span> {items.length} paquete(s) • {totalWeight} kg
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800">Operador:</span> {userProfile?.fullName || 'Ventanilla'}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-sm">TOTAL A LIQUIDAR:</span>
                  <span className="font-extrabold text-lg text-[#064e3b] font-mono">
                    {formatCurrencyBob(pricing.finalAmountCents, true)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* PASO 5: ÉXITO Y EMISIÓN DE GUÍA */}
          {/* ============================================================ */}
          {step === 5 && createdShipment && (
            <div className="text-center py-4 space-y-4">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div>
                <h3 className="text-lg font-black text-slate-900 tracking-tight">
                  ¡Guía de Encomienda Emitida Exitosamente!
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Registrada de forma atómica en el backend de Expreso Punata.
                </p>
              </div>

              {/* Tarjeta de Código de Guía */}
              <div className="bg-slate-50 border-2 border-emerald-500 rounded-xl p-4 max-w-sm mx-auto shadow-sm">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
                  Número de Guía Único
                </span>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-2xl font-black text-[#064e3b] tracking-wider">
                    {createdShipment.trackingCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200"
                    title="Copiar código"
                  >
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-600 flex justify-center gap-3">
                  <span>Origen: <strong>{createdShipment.originCity}</strong></span>
                  <span>Destino: <strong>{createdShipment.destinationCity}</strong></span>
                  <span>Monto: <strong>{formatCurrencyBob(createdShipment.finalAmountCents, true)}</strong></span>
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    const doc = printEngine.buildFromShipment(createdShipment, userProfile?.fullName || 'Operador')
                    await printEngine.printDocument(doc)
                  }}
                  className="px-5 py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-bold text-xs rounded-xl shadow-md flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>Ticket Térmico (80mm / 58mm)</span>
                </button>

                <button
                  type="button"
                  onClick={() => printShipmentGuidePdf(createdShipment)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  <span>Guía Completa (PDF)</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetForNew}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl"
                >
                  Registrar Otra Encomienda
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-xl"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Barra de Navegación Inferior (Paso 1 a 4) */}
        {step <= 4 && (
          <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(s => s - 1)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:bg-white flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Atrás</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-200 text-slate-500 text-xs font-semibold rounded-lg hover:bg-white transition-colors"
              >
                Cancelar
              </button>
            )}

            {step < 4 ? (
              <button
                type="button"
                disabled={
                  (step === 1 && !canProceedStep1) ||
                  (step === 2 && !canProceedStep2) ||
                  (step === 3 && !canProceedStep3)
                }
                onClick={() => setStep(s => s + 1)}
                className="px-5 py-2 bg-[#064e3b] hover:bg-[#065f46] disabled:bg-slate-300 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitShipment}
                className="px-6 py-2.5 bg-[#064e3b] hover:bg-[#065f46] disabled:bg-emerald-800 text-[#facc15] text-xs font-extrabold rounded-lg shadow-md flex items-center gap-2 transition-all"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#facc15] border-t-transparent rounded-full animate-spin" />
                    <span>Emitiendo Guía Segura...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirmar y Emitir Guía</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
