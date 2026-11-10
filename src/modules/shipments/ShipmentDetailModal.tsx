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
  AlertTriangle,
  Save,
  MessageCircle,
} from 'lucide-react'
import type { Shipment, UserProfile } from '../../types'
import { formatCurrencyBob } from '../../domain/parcelEngine'
import { printShipmentGuidePdf, printDeliveryProofPdf } from '../../services/pdfService'
import { printEngine } from '../../services/printing/printEngineService'
import { cancelShipmentThroughBackend, fetchCurrentShipment, updateShipmentThroughBackend } from '../../services/shipmentService'
import { reportShipmentIncident } from '../../services/incidentService'
import { applyOfficialBranchPhone } from '../../services/branchContactService.ts'
import { buildWhatsAppChatUrl } from '../../services/whatsappService.ts'

import { ShipmentTransfer } from './ShipmentTransfer'
import { DemoTransfer } from '../demo/DemoTransfer'

export interface DemoTransferHandlers {
  onUpdate: (shipment: Shipment) => void
  onDeliver: (shipment: Shipment) => void
}

interface ShipmentDetailModalProps {
  shipment: Shipment | null
  isOpen: boolean
  onClose: () => void
  currentUser: UserProfile
  currentBranchId: string
  simpleTransferEnabled?: boolean
  onShipmentUpdated?: (updated: Shipment) => void
  onDeliverShipment?: (shipment: Shipment) => void
  demoTransfer?: DemoTransferHandlers
}

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({
  shipment,
  isOpen,
  onClose,
  currentUser,
  currentBranchId,
  simpleTransferEnabled,
  onShipmentUpdated,
  onDeliverShipment,
  demoTransfer,
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'edit' | 'incidents'>('info')
  const [incidentType, setIncidentType] = useState<'uncollected' | 'returned' | 'lost' | 'damaged' | 'exceptional_delivery'>('damaged')
  const [incidentDesc, setIncidentDesc] = useState('')
  const [incidentResponsible, setIncidentResponsible] = useState('')
  const [incidentEvidenceUrl, setIncidentEvidenceUrl] = useState('')
  const [isSubmittingIncident, setIsSubmittingIncident] = useState(false)
  const [incidentSuccess, setIncidentSuccess] = useState<string | null>(null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancellationError, setCancellationError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)


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


  const handleReportIncident = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shipment) return
    if (!incidentDesc.trim() || incidentDesc.trim().length < 10) {
      alert('La descripción debe tener al menos 10 caracteres.')
      return
    }

    try {
      setIsSubmittingIncident(true)
      const res = await reportShipmentIncident({
        shipmentId: shipment.id,
        incidentType,
        description: incidentDesc.trim(),
        responsiblePerson: incidentResponsible.trim(),
        evidenceUrl: incidentEvidenceUrl.trim(),
        branchId: currentBranchId,
      })
      setIncidentSuccess(`Incidencia ${res.incident.incidentNumber} registrada exitosamente.`)
      setIncidentDesc('')
      setIncidentResponsible('')
      setIncidentEvidenceUrl('')
      if (onShipmentUpdated) {
        onShipmentUpdated({
          ...shipment,
          status: incidentType === 'exceptional_delivery' ? 'delivered' : (incidentType as any),
          hasIncident: true,
          currentIncidentNumber: res.incident.incidentNumber,
        })
      }
    } catch (err: any) {
      alert(err.message || 'Error registrando incidencia.')
    } finally {
      setIsSubmittingIncident(false)
    }
  }

  if (!isOpen || !shipment) return null

  const isOriginBranch = currentUser.allowedBranchIds?.includes(shipment.originBranchId) ||
    currentUser.primaryBranchId === shipment.originBranchId ||
    currentUser.role === 'directiva_admin'

  const isDestBranch = currentUser.allowedBranchIds?.includes(shipment.destinationBranchId) ||
    currentUser.primaryBranchId === shipment.destinationBranchId ||
    currentUser.role === 'directiva_admin'

  const isPaid = shipment.paymentStatus === 'paid'
  const isPostDispatch = ['dispatched', 'in_transit', 'received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery', 'delivered'].includes(shipment.status)
  const canTransfer = simpleTransferEnabled && currentUser.isActive &&
    ['secretaria', 'encargado_agencia', 'directiva_admin'].includes(currentUser.role)
  const transferAction = canTransfer && isOriginBranch && !shipment.manifestId &&
    ['received', 'pending_dispatch'].includes(shipment.status) ? 'depart'
    : canTransfer && isDestBranch && shipment.singleTransfer && shipment.manifestId &&
      ['in_transit', 'dispatched'].includes(shipment.status) ? 'receive' : null
  const isDelivered = shipment.status === 'delivered'
  const canEdit = currentUser.role === 'directiva_admin' || currentUser.role === 'encargado_agencia' || (!isDelivered && currentUser.role === 'secretaria' && (isOriginBranch || isDestBranch))
  const canDeliver = !isDelivered && ['received_at_dest', 'stored', 'ready_for_pickup', 'in_delivery'].includes(shipment.status) && (currentBranchId === shipment.destinationBranchId || currentUser.role === 'directiva_admin')
  const hasFinancialOrCustodyReferences = Boolean(
    shipment.cashShiftId ||
    shipment.financialMovementId ||
    shipment.manifestId ||
    shipment.assignedVehicle?.manifestId ||
    shipment.driverCustody ||
    shipment.deliveryRecord,
  )
  const canCancel = !isPaid && !hasFinancialOrCustodyReferences &&
    ['received', 'pending_dispatch'].includes(shipment.status) &&
    (currentUser.role === 'directiva_admin' || isOriginBranch)

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
      const docPayload = await applyOfficialBranchPhone(printEngine.buildFromShipment(shipment, currentUser.fullName), shipment.originBranchId)
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

  const handleCancelShipment = async () => {
    if (!shipment) return
    if (cancellationReason.trim().length < 5) {
      setCancellationError('Ingresa un motivo de al menos 5 caracteres.')
      return
    }
    setIsCancelling(true)
    setCancellationError(null)
    try {
      await cancelShipmentThroughBackend({ trackingCode: shipment.trackingCode, reason: cancellationReason.trim() })
      onShipmentUpdated?.({ ...shipment, status: 'cancelled' as Shipment['status'], cancellationReason: cancellationReason.trim() } as Shipment)
      setShowCancelDialog(false)
      setCancellationReason('')
    } catch (err) {
      setCancellationError(err instanceof Error ? err.message : 'No se pudo anular la encomienda.')
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      {showCancelDialog && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <h3 className="font-black text-slate-900">Anular encomienda {shipment.trackingCode}</h3>
            <p className="text-xs text-slate-600">Estado actual: <strong>{shipment.status}</strong>. La operación será lógica y quedará registrada para administración.</p>
            <textarea autoFocus value={cancellationReason} onChange={e => { setCancellationReason(e.target.value); setCancellationError(null) }} placeholder="Motivo obligatorio de la anulación" className={`w-full min-h-24 p-3 text-sm rounded-lg border ${cancellationError ? 'border-rose-500' : 'border-slate-300'}`} />
            {cancellationError && <p className="text-xs text-rose-700 font-semibold">{cancellationError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCancelDialog(false)} className="px-3 py-2 border rounded-lg text-xs font-bold">Cancelar</button>
              <button type="button" disabled={isCancelling} onClick={handleCancelShipment} className="px-3 py-2 bg-rose-700 text-white rounded-lg text-xs font-bold">{isCancelling ? 'Anulando...' : 'Confirmar anulación'}</button>
            </div>
          </div>
        </div>
      )}
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
            <button
              type="button"
              onClick={() => setActiveTab('incidents')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'incidents'
                  ? 'border-[#064e3b] text-[#064e3b] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Incidencias & Rezagos</span>
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
          {activeTab === 'info' && transferAction && (
            <ShipmentTransfer key={shipment.id + transferAction} shipment={shipment} action={transferAction} onDone={async () => {
              const updated = await fetchCurrentShipment(shipment.id).catch(() => null)
              if (updated) onShipmentUpdated?.(updated)
              onClose()
            }} />
          )}
          {activeTab === 'info' && demoTransfer && (
            <DemoTransfer
              shipments={[shipment]}
              user={currentUser}
              branch={currentBranchId}
              onUpdate={updated => {
                demoTransfer.onUpdate(updated)
                onShipmentUpdated?.(updated)
              }}
              onDeliver={demoTransfer.onDeliver}
              initialShipment={shipment}
            />
          )}
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
                      {isPaid ? `PAGADO (${shipment.paymentMethod || 'Efectivo'})` : shipment.paymentTiming === 'destination_cod' ? 'POR PAGAR' : 'PENDIENTE EN ORIGEN'}
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
                  {buildWhatsAppChatUrl(shipment.sender.phone) ? (
                    <a href={buildWhatsAppChatUrl(shipment.sender.phone) || undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900"><MessageCircle className="w-3.5 h-3.5"/>Contactar por WhatsApp</a>
                  ) : <span className="text-[10px] text-slate-400">WhatsApp no disponible: teléfono no válido</span>}
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
                  {buildWhatsAppChatUrl(shipment.recipient.phone) ? (
                    <a href={buildWhatsAppChatUrl(shipment.recipient.phone) || undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900"><MessageCircle className="w-3.5 h-3.5"/>Contactar por WhatsApp</a>
                  ) : <span className="text-[10px] text-slate-400">WhatsApp no disponible: teléfono no válido</span>}
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
                      {(item.branchId || item.previousStatus || item.newStatus) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[11px] text-slate-600 bg-slate-50 p-2 rounded">
                          <span>Sucursal: <strong>{(item.branchId || shipment.originBranchId || '').toUpperCase()}</strong></span>
                          {item.previousStatus && (
                            <span>Estado anterior: <strong>{item.previousStatus}</strong></span>
                          )}
                          {item.newStatus && (
                            <span>Estado nuevo: <strong>{item.newStatus}</strong></span>
                          )}
                        </div>
                      )}
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

          {/* TAB 4: INCIDENCIAS, DEVOLUCIONES Y REZAGOS */}
          {activeTab === 'incidents' && (
            <div className="space-y-4">
              {incidentSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>{incidentSuccess}</span>
                </div>
              )}

              {/* Historial de incidencias registradas */}
              {Array.isArray(shipment.incidentHistory) && shipment.incidentHistory.length > 0 && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider">
                    Historial de Incidencias Operativas
                  </h4>
                  <div className="space-y-2">
                    {shipment.incidentHistory.map((inc: any, i: number) => (
                      <div key={i} className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-rose-800">[{inc.incidentNumber}]</span>
                          <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                            {inc.incidentType}
                          </span>
                        </div>
                        <p className="text-slate-700 font-medium">{inc.description}</p>
                        <p className="text-[10px] text-slate-400">
                          Reportado por {inc.reportedBy} el {new Date(inc.dateIso).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Formulario de Registro de Incidencia */}
              <form onSubmit={handleReportIncident} className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                  <h4 className="text-xs font-black uppercase text-amber-900 tracking-wider">
                    Registrar Novedad / Incidencia / Rezago
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Tipo de Incidencia *</label>
                    <select
                      value={incidentType}
                      onChange={e => setIncidentType(e.target.value as any)}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white font-bold"
                    >
                      <option value="damaged">Dañada / Averiada (rotura o deterioro)</option>
                      <option value="lost">Extraviada / Pérdida en ruta o almacén</option>
                      <option value="uncollected">Rezagada / No recogida tras plazo legal</option>
                      <option value="returned">Devuelta a origen</option>
                      <option value="exceptional_delivery">Entrega Excepcional (autorizada sin cobro COD o especial)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Responsable Identificado</label>
                    <input
                      type="text"
                      placeholder="Ej. Chofer móvil 12, estibador..."
                      value={incidentResponsible}
                      onChange={e => setIncidentResponsible(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Descripción Detallada del Motivo y Circunstancias * (Mínimo 10 caracteres)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Describa el estado de la encomienda, roturas visibles o motivo por el que se rezaga..."
                    value={incidentDesc}
                    onChange={e => setIncidentDesc(e.target.value)}
                    required
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Enlace de Evidencia / Acta / Foto (opcional)
                  </label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={incidentEvidenceUrl}
                    onChange={e => setIncidentEvidenceUrl(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white font-mono"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmittingIncident}
                    className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-bold text-xs shadow flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{isSubmittingIncident ? 'Registrando...' : 'Confirmar y Actualizar Estado'}</span>
                  </button>
                </div>
              </form>
            </div>
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
            {canCancel && (
              <button type="button" onClick={() => { setCancellationError(null); setShowCancelDialog(true) }} className="px-3 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl font-bold text-xs">Anular encomienda</button>
            )}
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
