import React, { useState } from 'react'
import {
  X,
  Package,
  MapPin,
  User,
  Phone,
  FileText,
  Truck,
  Boxes,
  Printer,
  ShieldCheck,
  Edit3,
  History,
  CheckCircle2,
  AlertCircle,
  Save,
} from 'lucide-react'
import type { Shipment, UserProfile } from '../../types'
import { formatCurrencyBob } from '../../domain/parcelEngine'
import { printShipmentGuidePdf, printDeliveryProofPdf } from '../../services/pdfService'
import { printEngine } from '../../services/printing/printEngineService'
import { updateShipmentThroughBackend } from '../../services/shipmentService'

interface ShipmentDetailModalProps {
  shipment: Shipment | null
  isOpen: boolean
  onClose: () => void
  currentUser: UserProfile
  currentBranchId: string
  onShipmentUpdated?: (updated: Shipment) => void
  onDeliverShipment?: (shipment: Shipment) => void
}

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({
  shipment,
  isOpen,
  onClose,
  currentUser,
  currentBranchId,
  onShipmentUpdated,
  onDeliverShipment,
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'edit'>('info')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSuccess, setEditSuccess] = useState<string | null>(null)

  // Estados del formulario de edición
  const [editSenderName, setEditSenderName] = useState('')
  const [editSenderPhone, setEditSenderPhone] = useState('')
  const [editSenderDoc, setEditSenderDoc] = useState('')
  const [editRecipientName, setEditRecipientName] = useState('')
  const [editRecipientPhone, setEditRecipientPhone] = useState('')
  const [editRecipientDoc, setEditRecipientDoc] = useState('')
  const [editDeliveryAddress, setEditDeliveryAddress] = useState('')
  const [editHandlingNotes, setEditHandlingNotes] = useState('')
  const [editPriceBob, setEditPriceBob] = useState('')
  const [priceReason, setPriceReason] = useState('')
  const [rectificationReason, setRectificationReason] = useState('')

  if (!isOpen || !shipment) return null

  const isOriginBranch = currentUser.allowedBranchIds?.includes(shipment.originBranchId) ||
    currentUser.primaryBranchId === shipment.originBranchId ||
    currentUser.role === 'directiva_admin'

  const isDestBranch = currentUser.allowedBranchIds?.includes(shipment.destinationBranchId) ||
    currentUser.primaryBranchId === shipment.destinationBranchId ||
    currentUser.role === 'directiva_admin'

  const isPaid = shipment.paymentStatus === 'paid'
  const isPostDispatch = ['dispatched', 'in_transit', 'received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery', 'delivered'].includes(shipment.status)
  const isDelivered = shipment.status === 'delivered'
  const canEdit = currentUser.role === 'directiva_admin' || currentUser.role === 'encargado_agencia' || (!isDelivered && currentUser.role === 'secretaria' && (isOriginBranch || isDestBranch))
  const canDeliver = !isDelivered && ['received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery'].includes(shipment.status) && (currentBranchId === shipment.destinationBranchId || currentUser.role === 'directiva_admin')

  const dateFormatted = shipment.createdAtIso
    ? new Date(shipment.createdAtIso).toLocaleString('es-BO', {
        timeZone: 'America/La_Paz',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Fecha reciente'

  const handleStartEdit = () => {
    setEditSenderName(shipment.sender.name || '')
    setEditSenderPhone(shipment.sender.phone || '')
    setEditSenderDoc(shipment.sender.docNumber || '')
    setEditRecipientName(shipment.recipient.name || '')
    setEditRecipientPhone(shipment.recipient.phone || '')
    setEditRecipientDoc(shipment.recipient.docNumber || '')
    setEditDeliveryAddress(shipment.deliveryAddress || '')
    setEditHandlingNotes(shipment.items?.[0]?.handlingNotes || '')
    setEditPriceBob((shipment.finalAmountCents / 100).toFixed(2))
    setPriceReason(shipment.priceAdjustmentReason || '')
    setRectificationReason('')
    setEditError(null)
    setEditSuccess(null)
    setActiveTab('edit')
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmittingEdit(true)
    setEditError(null)
    setEditSuccess(null)

    try {
      const payload: Parameters<typeof updateShipmentThroughBackend>[0] = {
        trackingCode: shipment.trackingCode,
        sender: {
          name: editSenderName.trim(),
          phone: editSenderPhone.trim(),
          docNumber: editSenderDoc.trim() || undefined,
        },
        recipient: {
          name: editRecipientName.trim(),
          phone: editRecipientPhone.trim(),
          docNumber: editRecipientDoc.trim() || undefined,
        },
        deliveryAddress: editDeliveryAddress.trim() || undefined,
        handlingNotes: editHandlingNotes.trim() || undefined,
      }

      // Edición de precio si no está cobrado y está en origen
      if (!isPaid && (shipment.status === 'received' || shipment.status === 'pending_dispatch')) {
        const numPrice = parseFloat(editPriceBob)
        if (!isNaN(numPrice) && numPrice >= 0) {
          payload.agreedAmountCents = Math.round(numPrice * 100)
          payload.priceAdjustmentReason = priceReason.trim() || undefined
        }
      }

      // Si es post-despacho, motivo obligatorio
      if (isPostDispatch) {
        if (!rectificationReason.trim() || rectificationReason.trim().length < 5) {
          throw new Error('Debe ingresar un motivo formal de rectificación (mínimo 5 caracteres).')
        }
        payload.rectificationReason = rectificationReason.trim()
      }

      const res = await updateShipmentThroughBackend(payload)
      setEditSuccess('Encomienda rectificada y registrada en auditoría exitosamente.')
      if (onShipmentUpdated) {
        onShipmentUpdated(res.shipment)
      }
      setTimeout(() => {
        setActiveTab('info')
      }, 1200)
    } catch (err: unknown) {
      console.error('Error al guardar edición de encomienda:', err)
      setEditError(err instanceof Error ? err.message : 'Error al actualizar encomienda.')
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  const handlePrintThermal = async () => {
    try {
      const docPayload = printEngine.buildFromShipment(shipment, currentUser.fullName)
      await printEngine.printDocument(docPayload)
    } catch (err) {
      console.error('Error al imprimir guía térmica:', err)
      alert('Error al enviar a impresora térmica: ' + (err instanceof Error ? err.message : 'Desconocido'))
    }
  }

  const handlePrintPdf = () => {
    printShipmentGuidePdf(shipment)
  }

  const handlePrintDeliveryProof = () => {
    if (shipment.deliveryRecord) {
      printDeliveryProofPdf(shipment)
    } else {
      alert('Esta encomienda aún no cuenta con comprobante de entrega firmado.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Encabezado Institucional */}
        <div className="bg-[#064e3b] text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#facc15] text-[#064e3b] font-black flex items-center justify-center shadow">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-black tracking-wider text-[#facc15]">
                  {shipment.trackingCode}
                </span>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                  shipment.status === 'delivered' ? 'bg-emerald-100 text-emerald-900' :
                  shipment.status === 'in_transit' ? 'bg-blue-100 text-blue-900' :
                  shipment.status === 'stored' ? 'bg-purple-100 text-purple-900' :
                  'bg-amber-100 text-amber-900'
                }`}>
                  {shipment.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-emerald-200">
                Ficha Oficial de Encomienda • Expreso Punata
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-emerald-200 hover:text-white hover:bg-emerald-800 rounded-lg transition"
            title="Cerrar Ficha"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de pestañas secundarias */}
        <div className="bg-slate-100 px-5 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('info')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'info'
                  ? 'border-[#064e3b] text-[#064e3b] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Detalles del Envío</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'history'
                  ? 'border-[#064e3b] text-[#064e3b] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Auditoría & Trazabilidad ({shipment.auditHistory?.length || 0})</span>
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={handleStartEdit}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                  activeTab === 'edit'
                    ? 'border-[#064e3b] text-[#064e3b] bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Encomienda</span>
              </button>
            )}
          </div>

          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            Reg: {dateFormatted}
          </span>
        </div>

        {/* Contenido scrolleable */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs flex-1">
          {/* TAB 1: DETALLES */}
          {activeTab === 'info' && (
            <div className="space-y-4">
              {/* Tarjeta de Ruta y Precio */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Ruta y Servicio
                  </span>
                  <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                    <MapPin className="w-4 h-4 text-[#064e3b]" />
                    <span>{shipment.originCity}</span>
                    <span className="text-slate-400 font-normal">➔</span>
                    <span>{shipment.destinationCity}</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Modalidad: <strong className="text-slate-800">{shipment.deliveryType === 'home' ? '🏠 Entrega a Domicilio' : '🏢 Retiro en Ventanilla'}</strong>
                  </p>
                  {shipment.deliveryType === 'home' && shipment.deliveryAddress && (
                    <p className="text-[11px] text-amber-900 bg-amber-50 p-1.5 rounded border border-amber-200 font-medium">
                      Dirección: {shipment.deliveryAddress}
                    </p>
                  )}
                </div>

                <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200 space-y-1 text-right">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                    Precio y Condición Financiera
                  </span>
                  <div className="text-2xl font-black text-[#064e3b] font-mono">
                    {formatCurrencyBob(shipment.finalAmountCents, true)}
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      isPaid ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}>
                      {isPaid ? `PAGADO (${shipment.paymentMethod || 'Efectivo'})` : 'POR COBRAR (COD)'}
                    </span>
                    {shipment.isPriceAdjusted && (
                      <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded border border-blue-200">
                        Tarifa Acordada
                      </span>
                    )}
                  </div>
                  {shipment.suggestedAmountCents && shipment.suggestedAmountCents !== shipment.finalAmountCents && (
                    <p className="text-[10px] text-slate-500">
                      Tarifa sugerida de tabla: {formatCurrencyBob(shipment.suggestedAmountCents, true)}
                    </p>
                  )}
                  {shipment.priceAdjustmentReason && (
                    <p className="text-[10px] text-slate-600 italic">
                      Motivo: "{shipment.priceAdjustmentReason}"
                    </p>
                  )}
                </div>
              </div>

              {/* Remitente y Destinatario */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-1">
                  <div className="flex items-center gap-1.5 text-[#064e3b] font-bold text-xs uppercase tracking-wide">
                    <User className="w-3.5 h-3.5" />
                    <span>Remitente</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{shipment.sender.name}</p>
                  <p className="text-slate-600 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>{shipment.sender.phone}</span>
                  </p>
                  {shipment.sender.docNumber && (
                    <p className="text-[11px] text-slate-500 font-mono">
                      {shipment.sender.docType || 'CI'}: {shipment.sender.docNumber}
                    </p>
                  )}
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-1">
                  <div className="flex items-center gap-1.5 text-[#064e3b] font-bold text-xs uppercase tracking-wide">
                    <User className="w-3.5 h-3.5" />
                    <span>Destinatario</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{shipment.recipient.name}</p>
                  <p className="text-slate-600 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>{shipment.recipient.phone}</span>
                  </p>
                  {shipment.recipient.docNumber && (
                    <p className="text-[11px] text-slate-500 font-mono">
                      {shipment.recipient.docType || 'CI'}: {shipment.recipient.docNumber}
                    </p>
                  )}
                </div>
              </div>

              {/* Bultos y Mercadería */}
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Contenido Declarado ({shipment.packageCount} bulto(s) • {shipment.totalWeightKg} kg total)
                </span>
                <div className="divide-y divide-slate-100">
                  {shipment.items?.map((it, idx) => (
                    <div key={idx} className="py-1.5 flex items-center justify-between text-slate-700">
                      <div>
                        <span className="font-bold text-slate-800">{it.quantity}x {it.description}</span>
                        <span className="text-slate-400 text-[11px] ml-2 font-mono">({it.packaging})</span>
                        {it.handlingNotes && (
                          <p className="text-[11px] text-amber-800 mt-0.5">Nota: {it.handlingNotes}</p>
                        )}
                      </div>
                      <span className="font-mono text-slate-600">{it.weightKg ? `${it.weightKg} kg` : '-'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Logística, Almacén y Asignación */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Despacho / Conductor
                  </span>
                  {shipment.assignedVehicle ? (
                    <div className="space-y-0.5">
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-blue-700" />
                        <span>Móvil {shipment.assignedVehicle.mobileNumber} • {shipment.assignedVehicle.vehiclePlate}</span>
                      </p>
                      <p className="text-slate-600">Chofer: {shipment.assignedVehicle.driverName}</p>
                      <p className="text-[10px] text-slate-400 font-mono">Manifiesto: {shipment.assignedVehicle.manifestId}</p>
                    </div>
                  ) : (
                    <p className="text-slate-500 italic">No asignado a vehículo aún (en espera de manifiesto).</p>
                  )}
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Almacén de Destino
                  </span>
                  {shipment.storageLocation ? (
                    <div className="space-y-0.5">
                      <p className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <Boxes className="w-3.5 h-3.5 text-[#064e3b]" />
                        <span>Estante {shipment.storageLocation.shelfId} • Módulo {shipment.storageLocation.moduleId}</span>
                      </p>
                      <p className="text-slate-500 text-[10px]">Asignado por: {shipment.storageLocation.storedByName}</p>
                    </div>
                  ) : (
                    <p className="text-slate-500 italic">Sin ubicación física asignada.</p>
                  )}
                </div>
              </div>

              {/* Registro de Entrega si está entregada */}
              {shipment.deliveryRecord && (
                <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-emerald-900 font-bold text-xs uppercase">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    <span>Constancia de Entrega Conforme</span>
                  </div>
                  <p className="text-slate-700">
                    Recibido por: <strong className="text-slate-900">{shipment.deliveryRecord.receivedByName}</strong> (CI: {shipment.deliveryRecord.receivedByDoc || shipment.deliveryRecord.receivedByDocNumber || 'N/A'}) • Relación: {shipment.deliveryRecord.recipientRelationship}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Fecha: {new Date(shipment.deliveryRecord.deliveredAt).toLocaleString('es-BO')} • Entregado por: {shipment.deliveryRecord.deliveredByName}
                  </p>
                  {shipment.deliveryRecord.signatureUrl && (
                    <div className="mt-2">
                      <span className="text-[10px] font-bold text-slate-500 block mb-1">Firma Digital Capturada:</span>
                      <img
                        src={shipment.deliveryRecord.signatureUrl}
                        alt="Firma del receptor"
                        className="h-14 bg-white p-1 rounded border border-emerald-300 object-contain"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: AUDITORÍA & TRAZABILIDAD */}
          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-700 block mb-1">Registro Original del Sistema:</span>
                <p className="text-slate-600">
                  Emitida por: <strong className="text-slate-800">{shipment.registeredByName}</strong> el {dateFormatted}.
                </p>
                <p className="text-slate-500 text-[11px] font-mono mt-0.5">
                  UID Operador: {shipment.registeredByUid} • Agencia Origen: {shipment.originBranchId.toUpperCase()}
                </p>
              </div>

              <span className="font-bold text-slate-700 block pt-1">
                Historial de Rectificaciones y Ajustes Auditados:
              </span>

              {(!shipment.auditHistory || shipment.auditHistory.length === 0) ? (
                <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                  <p>No se han registrado modificaciones o rectificaciones para esta guía.</p>
                  <p className="text-[11px]">Conserva sus datos originales de ventanilla.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {shipment.auditHistory.map((item, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                          <span>{item.operatorName} ({item.operatorRole})</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(item.changedAt).toLocaleString('es-BO')}
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-900 bg-amber-50 px-2 py-0.5 rounded font-medium">
                        Motivo: {item.reason}
                      </p>
                      <div className="text-[10px] text-slate-500 font-mono bg-slate-50 p-2 rounded overflow-x-auto">
                        <span className="font-bold text-slate-600">Cambios:</span> {JSON.stringify(item.newValues)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: FORMULARIO DE EDICIÓN Y RECTIFICACIÓN */}
          {activeTab === 'edit' && (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{editError}</span>
                </div>
              )}
              {editSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{editSuccess}</span>
                </div>
              )}

              {isPostDispatch && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl">
                  <span className="font-bold block mb-0.5">⚠️ Encomienda en Curso Operativo ({shipment.status.toUpperCase()}):</span>
                  <p className="text-[11px]">
                    Cualquier corrección posterior a despacho o recepción exige un motivo formal estricto y queda auditada bajo su nombre y fecha.
                  </p>
                </div>
              )}

              {/* Remitente */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 block">Datos del Remitente:</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={editSenderName}
                    onChange={e => setEditSenderName(e.target.value)}
                    placeholder="Nombre completo"
                    className="p-2 border rounded-lg bg-white"
                    required
                  />
                  <input
                    type="tel"
                    value={editSenderPhone}
                    onChange={e => setEditSenderPhone(e.target.value)}
                    placeholder="Teléfono"
                    className="p-2 border rounded-lg bg-white"
                    required
                  />
                  <input
                    type="text"
                    value={editSenderDoc}
                    onChange={e => setEditSenderDoc(e.target.value)}
                    placeholder="CI / Documento"
                    className="p-2 border rounded-lg bg-white"
                  />
                </div>
              </div>

              {/* Destinatario */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 block">Datos del Destinatario:</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={editRecipientName}
                    onChange={e => setEditRecipientName(e.target.value)}
                    placeholder="Nombre completo"
                    className="p-2 border rounded-lg bg-white"
                    required
                  />
                  <input
                    type="tel"
                    value={editRecipientPhone}
                    onChange={e => setEditRecipientPhone(e.target.value)}
                    placeholder="Teléfono"
                    className="p-2 border rounded-lg bg-white"
                    required
                  />
                  <input
                    type="text"
                    value={editRecipientDoc}
                    onChange={e => setEditRecipientDoc(e.target.value)}
                    placeholder="CI / Documento"
                    className="p-2 border rounded-lg bg-white"
                  />
                </div>
              </div>

              {/* Dirección y notas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Dirección Entrega a Domicilio:
                  </label>
                  <input
                    type="text"
                    value={editDeliveryAddress}
                    onChange={e => setEditDeliveryAddress(e.target.value)}
                    placeholder="Opcional si es en agencia"
                    className="w-full p-2 border rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Instrucciones / Notas de Manejo:
                  </label>
                  <input
                    type="text"
                    value={editHandlingNotes}
                    onChange={e => setEditHandlingNotes(e.target.value)}
                    placeholder="Ej. Frágil, entregar por la mañana..."
                    className="w-full p-2 border rounded-lg bg-white"
                  />
                </div>
              </div>

              {/* Edición de Precio (si no ha sido cobrado y está en origen) */}
              {!isPaid && (shipment.status === 'received' || shipment.status === 'pending_dispatch') && (
                <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-[#064e3b] uppercase">
                      Precio Acordado del Envío (Bs):
                    </label>
                    <span className="text-[10px] text-slate-500">
                      Actual: {formatCurrencyBob(shipment.finalAmountCents, true)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="0.50"
                      min="0"
                      value={editPriceBob}
                      onChange={e => setEditPriceBob(e.target.value)}
                      className="p-2 border-2 border-[#064e3b] rounded-lg font-mono font-bold text-base bg-white"
                    />
                    <input
                      type="text"
                      value={priceReason}
                      onChange={e => setPriceReason(e.target.value)}
                      placeholder="Motivo de ajuste de precio"
                      className="p-2 border rounded-lg bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Motivo de Rectificación (Obligatorio si ya fue despachado) */}
              {isPostDispatch && (
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Motivo Formal de Rectificación * (Mínimo 5 caracteres):
                  </label>
                  <textarea
                    value={rectificationReason}
                    onChange={e => setRectificationReason(e.target.value)}
                    rows={2}
                    placeholder="Explique detalladamente el motivo de la corrección operativa para la auditoría..."
                    className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                    required
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('info')}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] font-extrabold rounded-lg shadow flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmittingEdit ? 'Guardando...' : 'Guardar Rectificación'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Barra de Acciones del Pie */}
        <div className="bg-slate-100 p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrintThermal}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm text-xs transition"
              title="Imprimir ticket térmico en impresora de ventanilla"
            >
              <Printer className="w-3.5 h-3.5 text-[#facc15]" />
              <span>Ticket Térmico</span>
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="px-3.5 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm text-xs transition"
              title="Descargar Guía Oficial en PDF"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Guía PDF</span>
            </button>
            {isDelivered && (
              <button
                type="button"
                onClick={handlePrintDeliveryProof}
                className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center gap-1.5 text-xs transition shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-blue-200" />
                <span>Recibo Entrega</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canDeliver && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  if (onDeliverShipment) onDeliverShipment(shipment)
                }}
                className="px-4 py-2 bg-[#064e3b] hover:bg-[#065f46] text-[#facc15] rounded-xl font-black flex items-center gap-1.5 shadow text-xs transition"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Entregar Encomienda</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold text-xs transition"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
