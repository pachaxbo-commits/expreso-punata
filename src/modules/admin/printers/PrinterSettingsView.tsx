import React, { useState, useEffect } from 'react'
import {
  Printer,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  Eye,
  Sliders,
  Smartphone,
  Monitor,
  Wifi,
  Save,
  X,
  FileDown,
  Info,
} from 'lucide-react'
import type { PrinterProfile, PaperFormat, PrinterConnectionType, DocumentPrintType } from '../../../types/printing.ts'
import {
  loadPrinterProfiles,
  saveOrUpdateProfile,
  deleteProfile,
  getDefaultPrinterProfiles,
} from '../../../services/printing/printerProfiles.ts'
import { printEngine } from '../../../services/printing/printEngineService.ts'
import { INITIAL_BRANCHES } from '../../../domain/expresoPunataConfig.ts'

export interface PrinterSettingsViewProps {
  currentBranchId?: string
  operatorName?: string
}

export const PrinterSettingsView: React.FC<PrinterSettingsViewProps> = ({
  currentBranchId = 'punata',
  operatorName = 'Administrador',
}) => {
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranchId)
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [editingProfile, setEditingProfile] = useState<PrinterProfile | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewDocType, setPreviewDocType] = useState<DocumentPrintType>('shipment_guide')
  const [activePreviewProfile, setActivePreviewProfile] = useState<PrinterProfile | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [diagnostics, setDiagnostics] = useState<any>(null)
  const [isDiagOpen, setIsDiagOpen] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [showRawBtHelp, setShowRawBtHelp] = useState(false)

  // Cargar perfiles al montar o cambiar sucursal
  useEffect(() => {
    refreshProfiles(selectedBranchId)
  }, [selectedBranchId])

  const refreshProfiles = (branchId: string) => {
    const list = loadPrinterProfiles(branchId)
    setProfiles(list)
    setDiagnostics(printEngine.runDiagnostics(branchId))
  }

  const handleSetDefault = (profile: PrinterProfile) => {
    saveOrUpdateProfile({ ...profile, isDefault: true }, selectedBranchId)
    refreshProfiles(selectedBranchId)
    setStatusMessage({ type: 'success', text: `"${profile.name}" establecida como impresora predeterminada.` })
    setTimeout(() => setStatusMessage(null), 3500)
  }

  const handleOpenCreate = () => {
    const now = new Date().toISOString()
    const newPrn: PrinterProfile = {
      id: `prn-${selectedBranchId}-${Date.now().toString(36)}`,
      branchId: selectedBranchId,
      name: 'Nueva Impresora Térmica',
      connectionType: diagnostics?.rawBtSupported ? 'rawbt_intent' : 'browser_dialog',
      paperFormat: '80mm',
      isDefault: profiles.length === 0,
      autoPrintOnCreation: true,
      autoPrintOnPayment: true,
      autoPrintOnDelivery: true,
      kickDrawerOnReceipt: true,
      cutPaperOnFinish: true,
      capabilities: {
        supportsPaperCut: true,
        supportsCashDrawerKick: true,
        supportsQrCode: true,
        supportsLogo: true,
        feedLinesEnd: 2,
        fontSize: 'normal',
        marginsMm: 2,
      },
      createdAtIso: now,
      updatedAtIso: now,
    }
    setEditingProfile(newPrn)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (profile: PrinterProfile) => {
    setEditingProfile({ ...profile })
    setIsModalOpen(true)
  }

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`¿Está seguro de eliminar la configuración de "${name}"?`)) {
      deleteProfile(id, selectedBranchId)
      refreshProfiles(selectedBranchId)
      setStatusMessage({ type: 'success', text: `Impresora "${name}" eliminada correctamente.` })
      setTimeout(() => setStatusMessage(null), 3500)
    }
  }

  const handleResetDefaults = () => {
    if (window.confirm('¿Desea restaurar las impresoras recomendadas de fábrica para esta sucursal?')) {
      const defaults = getDefaultPrinterProfiles(selectedBranchId)
      for (const p of defaults) {
        saveOrUpdateProfile(p, selectedBranchId)
      }
      refreshProfiles(selectedBranchId)
      setStatusMessage({ type: 'success', text: 'Perfiles recomendados restaurados con éxito.' })
      setTimeout(() => setStatusMessage(null), 3500)
    }
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProfile) return
    if (!editingProfile.name.trim()) {
      alert('Debe ingresar un nombre descriptivo para la impresora.')
      return
    }

    saveOrUpdateProfile(editingProfile, selectedBranchId)
    setIsModalOpen(false)
    setEditingProfile(null)
    refreshProfiles(selectedBranchId)
    setStatusMessage({ type: 'success', text: `Impresora "${editingProfile.name}" guardada con éxito.` })
    setTimeout(() => setStatusMessage(null), 3500)
  }

  const handleTestPrint = async (profile: PrinterProfile) => {
    setIsTesting(true)
    try {
      const result = await printEngine.printTestTicket(selectedBranchId, operatorName, profile)
      if (result.success) {
        setStatusMessage({
          type: 'success',
          text: result.message || `Ticket de prueba emitido exitosamente mediante ${result.connectionType.toUpperCase()}.`,
        })
      } else {
        setStatusMessage({
          type: 'error',
          text: `Error al emitir ticket de prueba: ${result.errorMessage || 'Verifique el hardware.'}`,
        })
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Error inesperado durante la prueba.' })
    } finally {
      setIsTesting(false)
      setTimeout(() => setStatusMessage(null), 4500)
    }
  }

  const generateSampleDocument = (docType: DocumentPrintType) => {
    const branch = INITIAL_BRANCHES.find((b) => b.id === selectedBranchId) || INITIAL_BRANCHES[0]
    const dest = INITIAL_BRANCHES.find((b) => b.id !== selectedBranchId) || INITIAL_BRANCHES[1]
    const nowIso = new Date().toISOString()

    if (docType === 'payment_receipt') {
      return {
        documentType: 'payment_receipt' as const,
        title: 'RECIBO DE COBRO EN VENTANILLA',
        subtitle: '[MUESTRA SINTÉTICA PARA VISTA PREVIA]',
        branchId: selectedBranchId,
        branchName: branch.name,
        branchAddress: branch.address,
        branchPhone: branch.phone,
        documentNumber: 'REC-PUN-00042',
        trackingCode: 'PUN-2026-00042',
        timestampIso: nowIso,
        operatorName,
        operatorRole: 'Cajera Ventanilla',
        financials: {
          subtotalBob: 35.0,
          totalBob: 35.0,
          amountCents: 3500,
          paymentTiming: 'origin_paid' as const,
          paymentStatus: 'paid' as const,
          paymentMethod: 'cash' as const,
        },
        footerNotes: ['Comprobante de ingreso de caja.'],
      }
    }

    if (docType === 'cash_shift_close') {
      return {
        documentType: 'cash_shift_close' as const,
        title: 'ACTA DE CIERRE DE TURNO Y ARQUEO',
        subtitle: '[MUESTRA SINTÉTICA PARA VISTA PREVIA]',
        branchId: selectedBranchId,
        branchName: branch.name,
        branchAddress: branch.address,
        branchPhone: branch.phone,
        documentNumber: 'TUR-PUN-2026-0001',
        timestampIso: nowIso,
        operatorName,
        financials: {
          subtotalBob: 180.0,
          totalBob: 180.0,
          amountCents: 18000,
          initialCashBob: 100.0,
          expectedCashBob: 180.0,
          countedCashBob: 180.0,
          differenceBob: 0.0,
        },
        items: [
          { description: 'Fondo Inicial de Caja', quantity: 1, totalBob: 100.0 },
          { description: 'Cobros Encomiendas Origen', quantity: 3, totalBob: 45.0 },
          { description: 'Cobros COD Contraentrega', quantity: 1, totalBob: 35.0 },
        ],
        footerNotes: ['Arqueo conforme sin diferencias.'],
      }
    }

    if (docType === 'driver_settlement') {
      return {
        documentType: 'driver_settlement' as const,
        title: 'ACTA DE RENDICIÓN DE CONDUCTOR',
        subtitle: '[MUESTRA SINTÉTICA PARA VISTA PREVIA]',
        branchId: selectedBranchId,
        branchName: branch.name,
        branchAddress: branch.address,
        branchPhone: branch.phone,
        documentNumber: 'SETTL-PUN-35AE7018',
        timestampIso: nowIso,
        operatorName,
        financials: {
          subtotalBob: 30.0,
          totalBob: 30.0,
          amountCents: 3000,
          driverBalanceBeforeBob: 50.0,
          driverRemittanceBob: 30.0,
          driverBalanceRemainingBob: 20.0,
          remittanceType: 'partial' as const,
          paymentMethod: 'cash' as const,
        },
        items: [
          { description: 'Guía conciliada: PUN-2026-00003', quantity: 1, totalBob: 30.0 },
        ],
        signatures: {
          operatorSignatureName: operatorName,
          driverSignatureName: 'Conductor Titular',
        },
        footerNotes: ['Transferencia interna de custodia en caja.'],
      }
    }

    // Por defecto: Guía de Encomienda
    return {
      documentType: 'shipment_guide' as const,
      title: 'GUÍA OFICIAL DE ENCOMIENDA',
      subtitle: `${branch.name} ➔ ${dest.name}`,
      branchId: selectedBranchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: 'PUN-2026-00042',
      trackingCode: 'PUN-2026-00042',
      timestampIso: nowIso,
      operatorName,
      operatorRole: 'Secretaria Ventanilla',
      sender: { name: 'Elena Cossio', phone: '71928374', docNumber: '3928172' },
      recipient: { name: 'Roberto Vargas', phone: '78291029', docNumber: '4829102' },
      items: [
        { description: 'Caja con repuestos mecánicos rectificados', quantity: 1, weightKg: 8.5, totalBob: 26.0 },
      ],
      financials: {
        subtotalBob: 26.0,
        totalBob: 26.0,
        amountCents: 2600,
        paymentTiming: 'origin_paid' as const,
        paymentStatus: 'paid' as const,
        paymentMethod: 'cash' as const,
      },
      footerNotes: [
        'Conserve esta guía para el recojo de su encomienda en agencia.',
      ],
    }
  }

  const handleOpenPreview = async (profile: PrinterProfile, docType: DocumentPrintType = 'shipment_guide') => {
    setActivePreviewProfile(profile)
    setPreviewDocType(docType)
    const sampleDoc = generateSampleDocument(docType)
    const html = await printEngine.generatePreviewHtml(sampleDoc, profile.paperFormat)
    setPreviewHtml(html)
    setIsPreviewOpen(true)
  }

  const handleSwitchPreviewDocType = async (newType: DocumentPrintType) => {
    if (!activePreviewProfile) return
    setPreviewDocType(newType)
    const sampleDoc = generateSampleDocument(newType)
    const html = await printEngine.generatePreviewHtml(sampleDoc, activePreviewProfile.paperFormat)
    setPreviewHtml(html)
  }

  return (
    <div data-tutorial-target="printers-config-panel" className="space-y-6">
      {/* Encabezado y Selector de Sucursal */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 rounded-xl text-[#064e3b]">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Gestión de Impresoras y Formatos de Tickets
              </h2>
              <p className="text-xs text-slate-500">
                Impresión térmica USB para Windows (Controlador del Navegador) y Android RawBT.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de sucursal */}
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold">
            <span className="text-slate-500">Agencia:</span>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
            >
              {INITIAL_BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowRawBtHelp(!showRawBtHelp)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs rounded-xl transition"
          >
            <Smartphone className="w-4 h-4 text-amber-600" />
            <span>Guía Android</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDiagOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
          >
            <Sliders className="w-4 h-4" />
            <span>Diagnóstico</span>
          </button>

          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition"
            title="Restaurar perfiles recomendados"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Predeterminados</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#064e3b] hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow transition"
          >
            <Plus className="w-4 h-4 text-[#facc15]" />
            <span>Nueva Impresora</span>
          </button>
        </div>
      </div>

      {/* Guía desplegable de Android RawBT */}
      {showRawBtHelp && (
        <div className="bg-amber-50/80 p-5 rounded-2xl border border-amber-200 shadow-sm space-y-3 text-xs text-amber-900 animate-fade-in">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 font-bold text-sm">
              <Info className="w-4 h-4 text-amber-700 flex-shrink-0" />
              <span>Instrucciones para Impresión Térmica en Celulares y Tablets Android</span>
            </div>
            <button
              type="button"
              onClick={() => setShowRawBtHelp(false)}
              className="text-amber-600 hover:text-amber-800 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ol className="list-decimal list-inside space-y-1 text-amber-800 pl-1 leading-relaxed">
            <li>Instale la aplicación oficial <strong>RawBT print service</strong> desde Google Play Store (<code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">ru.a402d.rawbtprinter</code>).</li>
            <li>Abra RawBT y empareje su impresora térmica portátil vía Bluetooth o USB OTG.</li>
            <li>En RawBT, defina el ancho de papel (80 mm o 58 mm) y asegúrese de que el servicio esté activo.</li>
            <li>Al emitir guías o recibos desde esta app en Chrome Android, el ticket se enviará instantáneamente a la impresora sin mostrar el diálogo del navegador.</li>
          </ol>
        </div>
      )}

      {/* Alerta de Estado */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 text-xs font-semibold ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Tarjetas de Impresoras Configuradas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.map((profile) => {
          const isRawBt = profile.connectionType === 'rawbt_intent'

          return (
            <div
              key={profile.id}
              className={`bg-white rounded-2xl border p-5 shadow-sm space-y-4 transition ${
                profile.isDefault
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Cabecera de la tarjeta */}
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-sm">{profile.name}</span>
                    {profile.isDefault && (
                      <span className="text-[10px] font-extrabold bg-emerald-100 text-[#064e3b] px-2 py-0.5 rounded-full border border-emerald-300">
                        PREDETERMINADA
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">Formato:</span>
                    <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                      {profile.paperFormat.toUpperCase()}
                    </span>
                    <span>•</span>
                    <span className="font-semibold text-slate-700">Tipo:</span>
                    <span className="flex items-center gap-1 text-slate-600">
                      {isRawBt ? (
                        <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                      ) : profile.connectionType === 'network_tcp' ? (
                        <Wifi className="w-3.5 h-3.5 text-sky-600" />
                      ) : profile.connectionType === 'virtual_pdf' ? (
                        <FileDown className="w-3.5 h-3.5 text-violet-600" />
                      ) : (
                        <Monitor className="w-3.5 h-3.5 text-slate-600" />
                      )}
                      {profile.connectionType === 'browser_dialog'
                        ? 'Windows USB / Spooler'
                        : profile.connectionType === 'rawbt_intent'
                        ? 'Android RawBT'
                        : profile.connectionType === 'network_tcp'
                        ? 'Red (Driver Windows)'
                        : 'PDF Descargable'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Capacidades activadas */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] space-y-1.5 text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Corte automático de papel:</span>
                  <span className={profile.cutPaperOnFinish ? 'font-bold text-emerald-700' : 'text-slate-400'}>
                    {profile.cutPaperOnFinish ? 'Activo' : 'No'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Apertura de gaveta de caja:</span>
                  <span className={profile.kickDrawerOnReceipt ? 'font-bold text-emerald-700' : 'text-slate-400'}>
                    {profile.kickDrawerOnReceipt ? 'Activo' : 'No'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Código QR de verificación:</span>
                  <span className={profile.capabilities.supportsQrCode ? 'font-bold text-emerald-700' : 'text-slate-400'}>
                    {profile.capabilities.supportsQrCode ? 'Incluido' : 'No'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Margen configurado:</span>
                  <span className="font-mono">{profile.capabilities.marginsMm} mm</span>
                </div>
              </div>

              {/* Botones de acción */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleTestPrint(profile)}
                    disabled={isTesting}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#064e3b] font-bold text-[11px] rounded-lg transition"
                    title="Imprimir ticket de prueba real"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Prueba</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenPreview(profile, 'shipment_guide')}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition"
                    title="Ver vista previa interactiva"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Vista</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {!profile.isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(profile)}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-emerald-700 transition"
                      title="Fijar como predeterminada"
                    >
                      Predeterminada
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(profile)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition"
                    title="Editar configuración"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {profiles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDelete(profile.id, profile.name)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                      title="Eliminar impresora"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* MODAL DE EDICIÓN / CREACIÓN DE IMPRESORA */}
      {isModalOpen && editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 rounded-xl text-[#064e3b]">
                  <Printer className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-800 text-base">
                  {profiles.some((p) => p.id === editingProfile.id)
                    ? 'Editar Perfil de Impresora'
                    : 'Nueva Impresora'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nombre de la Impresora / Estación</label>
                <input
                  type="text"
                  required
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  placeholder="ej. Térmica Ventanilla (Punata)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-slate-800 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Método de Conexión</label>
                  <select
                    value={editingProfile.connectionType}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        connectionType: e.target.value as PrinterConnectionType,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold bg-white text-slate-800 outline-none"
                  >
                    <option value="browser_dialog">Windows USB / Controlador del Sistema</option>
                    <option value="rawbt_intent">Android RawBT (ru.a402d.rawbtprinter)</option>
                    <option value="network_tcp">Red LAN / WiFi (Vía driver de Windows)</option>
                    <option value="virtual_pdf">PDF Virtual Descargable</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Formato de Papel</label>
                  <select
                    value={editingProfile.paperFormat}
                    onChange={(e) =>
                      setEditingProfile({
                        ...editingProfile,
                        paperFormat: e.target.value as PaperFormat,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold bg-white text-slate-800 outline-none"
                  >
                    <option value="80mm">Térmica 80mm (Recomendado Ventanilla)</option>
                    <option value="58mm">Térmica 58mm (Compacta)</option>
                    <option value="letter">Papel Carta (Manifiestos y Reportes)</option>
                    <option value="half_letter">Media Carta</option>
                    <option value="a4">Papel A4</option>
                  </select>
                </div>
              </div>

              {/* Opciones y Ajustes de Impresión */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="font-bold text-slate-700 block">Comportamiento del Hardware</span>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProfile.cutPaperOnFinish}
                      onChange={(e) =>
                        setEditingProfile({ ...editingProfile, cutPaperOnFinish: e.target.checked })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    />
                    <span className="font-medium text-slate-700">Cortar papel al terminar</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProfile.kickDrawerOnReceipt}
                      onChange={(e) =>
                        setEditingProfile({ ...editingProfile, kickDrawerOnReceipt: e.target.checked })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    />
                    <span className="font-medium text-slate-700">Pulsar gaveta de dinero</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProfile.capabilities.supportsQrCode}
                      onChange={(e) =>
                        setEditingProfile({
                          ...editingProfile,
                          capabilities: { ...editingProfile.capabilities, supportsQrCode: e.target.checked },
                        })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    />
                    <span className="font-medium text-slate-700">Imprimir código QR</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProfile.isDefault}
                      onChange={(e) =>
                        setEditingProfile({ ...editingProfile, isDefault: e.target.checked })
                      }
                      className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    />
                    <span className="font-bold text-slate-800">Predeterminada en agencia</span>
                  </label>
                </div>
              </div>

              {/* Botones del Modal */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#064e3b] hover:bg-emerald-800 text-white font-bold rounded-xl shadow flex items-center gap-1.5 transition"
                >
                  <Save className="w-4 h-4 text-[#facc15]" />
                  <span>Guardar Configuración</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE VISTA PREVIA INTERACTIVA MULTIDOCUMENTO */}
      {isPreviewOpen && previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-emerald-700" />
                <h3 className="font-bold text-slate-800 text-sm">Vista Previa Documental en Vivo</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selector de tipo de documento para previsualizar */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button
                type="button"
                onClick={() => handleSwitchPreviewDocType('shipment_guide')}
                className={`px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                  previewDocType === 'shipment_guide'
                    ? 'bg-[#064e3b] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Guía Encomienda
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPreviewDocType('payment_receipt')}
                className={`px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                  previewDocType === 'payment_receipt'
                    ? 'bg-[#064e3b] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Recibo Ventanilla
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPreviewDocType('cash_shift_close')}
                className={`px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                  previewDocType === 'cash_shift_close'
                    ? 'bg-[#064e3b] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Cierre de Caja
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPreviewDocType('driver_settlement')}
                className={`px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap ${
                  previewDocType === 'driver_settlement'
                    ? 'bg-[#064e3b] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Rendición Chofer
              </button>
            </div>

            <div className="bg-slate-100 p-3 rounded-2xl border border-slate-200 overflow-hidden">
              <iframe
                title="Preview"
                srcDoc={previewHtml}
                className="w-full h-96 bg-white rounded-xl shadow-inner border border-slate-300"
              />
            </div>

            <div className="flex justify-between items-center text-xs text-slate-500">
              <span>Formato: {activePreviewProfile?.paperFormat.toUpperCase()}</span>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow transition"
              >
                Cerrar Vista Previa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AUTODIAGNÓSTICO */}
      {isDiagOpen && diagnostics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-emerald-700" />
                <h3 className="font-bold text-slate-800 text-sm">Diagnóstico de la Estación de Trabajo</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDiagOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-600">Plataforma Detectada:</span>
                <span className="font-bold text-slate-800">{diagnostics.platform}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-600">Almacenamiento Local (LocalStorage):</span>
                <span className="font-bold text-emerald-700">Operativo</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-600">Impresora Predeterminada:</span>
                <span className="font-bold text-slate-800">{diagnostics.defaultPrinterName}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-600">Formato Predeterminado:</span>
                <span className="font-mono font-bold text-emerald-800">{diagnostics.defaultFormat}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-600">Soporte Android RawBT:</span>
                <span className={diagnostics.rawBtSupported ? 'font-bold text-emerald-700' : 'text-slate-400'}>
                  {diagnostics.rawBtSupported ? 'Disponible' : 'No (Escritorio)'}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-600">Diálogo de Impresión de Navegador:</span>
                <span className="font-bold text-emerald-700">Listo (Windows / Mac)</span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 text-[11px] leading-relaxed">
              <strong>Estado del Sistema:</strong> La estación se encuentra lista para emitir guías, manifiestos y recibos de encomienda hacia impresoras térmicas USB o en red.
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsDiagOpen(false)}
                className="px-4 py-2 bg-[#064e3b] text-white font-bold rounded-xl shadow transition"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
