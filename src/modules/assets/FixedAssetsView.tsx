import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Building2,
  Plus,
  Search,
  Printer,
  History,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  X,
  FileText,
  User,
  MapPin,
  Wrench,
  Trash2,
  QrCode,
  Download,
} from 'lucide-react'
import type { FixedAsset, FixedAssetAuditLog, FixedAssetCategory, FixedAssetStatus, PatrimonialLocationId, UserProfile } from '../../types/index.ts'
import {
  createFixedAssetBatch,
  manageFixedAsset,
  subscribeFixedAssets,
  subscribeAssetAuditLogs,
} from '../../services/assetService.ts'
import { printEngine } from '../../services/printing/printEngineService.ts'
import { downloadFixedAssetLabelsPdf } from '../../services/fixedAssetLabelsPdfService.ts'

interface FixedAssetsViewProps {
  currentBranchId: string
  userProfile: UserProfile
}

const CATEGORY_LABELS: Record<FixedAssetCategory, string> = {
  computacion: 'Computación y Sistemas',
  muebles: 'Muebles y Enseres',
  herramientas: 'Herramientas y Repuestos',
  comunicacion: 'Equipos de Comunicación',
  balanzas_pesaje: 'Balanzas y Básculas',
  oficina: 'Material y Oficina',
  otro: 'Otros Activos',
  inmuebles: 'Inmuebles',
}

const LOCATION_LABELS: Record<PatrimonialLocationId, string> = { sede_punata: 'Sede Punata', oficina_punata: 'Oficina Punata', oficina_cochabamba: 'Oficina Cochabamba' }

const STATUS_LABELS: Record<FixedAssetStatus, { label: string; color: string }> = {
  in_use: { label: 'En Uso Activo', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  available: { label: 'Disponible', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  in_maintenance: { label: 'En Mantenimiento', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  damaged: { label: 'Dañado / Para Reparar', color: 'bg-rose-100 text-rose-800 border-rose-300' },
  out_of_service: { label: 'Fuera de Servicio', color: 'bg-slate-200 text-slate-800 border-slate-300' },
  lost: { label: 'Extraviado / Perdido', color: 'bg-red-100 text-red-900 border-red-300' },
  disposed: { label: 'Dado de Baja', color: 'bg-gray-100 text-gray-500 border-gray-300 line-through' },
}

export const FixedAssetsView: React.FC<FixedAssetsViewProps> = ({
  currentBranchId,
  userProfile,
}) => {
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState<'all' | PatrimonialLocationId>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedForLabels, setSelectedForLabels] = useState<string[]>([])
  const [selectedAssetForTransfer, setSelectedAssetForTransfer] = useState<FixedAsset | null>(null)
  const [selectedAssetForEdit, setSelectedAssetForEdit] = useState<FixedAsset | null>(null)
  const [editForm, setEditForm] = useState<Partial<FixedAsset>>({})
  const [selectedAssetForAudit, setSelectedAssetForAudit] = useState<FixedAsset | null>(null)
  const [selectedAssetForStatus, setSelectedAssetForStatus] = useState<FixedAsset | null>(null)
  const [selectedAssetForDispose, setSelectedAssetForDispose] = useState<FixedAsset | null>(null)
  const [auditLogs, setAuditLogs] = useState<FixedAssetAuditLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Form states
  const [isSubmitting, setIsSubmitting] = useState(false)
  const batchRetryRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const [newAsset, setNewAsset] = useState({
    name: '',
    category: 'oficina' as FixedAssetCategory,
    description: '',
    branchId: (currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata') as 'punata' | 'cochabamba',
    patrimonialLocationId: (currentBranchId === 'cochabamba' ? 'oficina_cochabamba' : 'oficina_punata') as PatrimonialLocationId,
    physicalLocation: '',
    responsiblePersonName: '',
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionCostBob: '',
    notes: '',
    quantity: '1',
    propertyType: '',
    address: '',
  })

  const [transferForm, setTransferForm] = useState({
    patrimonialLocationId: 'oficina_punata' as PatrimonialLocationId,
    responsiblePersonName: '',
  })

  const [statusForm, setStatusForm] = useState<{
    status: FixedAssetStatus
    notes: string
  }>({
    status: 'in_use',
    notes: '',
  })

  const [disposeReason, setDisposeReason] = useState('')

  // Permisos
  const canManage = ['directiva_admin', 'encargado_agencia', 'tesoreria'].includes(userProfile.role)
  const canReadAllBranches = ['directiva_admin', 'tesoreria'].includes(userProfile.role)
  const assetBranchScope = canReadAllBranches ? undefined : (currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata')

  // Suscripción a Firestore en tiempo real
  useEffect(() => {
    setLoading(true)
    const unsubscribe = subscribeFixedAssets(
      (data) => {
        setAssets(data)
        setLoading(false)
      },
      (err) => {
        console.error('Error cargando activos fijos:', err)
        setErrorMsg('Error de conexión al cargar bienes fijos.')
        setLoading(false)
      },
      assetBranchScope
    )
    return () => unsubscribe()
  }, [assetBranchScope])

  // Suscripción a logs de auditoría cuando se abre el modal
  useEffect(() => {
    if (!selectedAssetForAudit) {
      setAuditLogs([])
      return
    }
    setLoadingLogs(true)
    const unsubscribe = subscribeAssetAuditLogs(
      selectedAssetForAudit.id,
      (logs) => {
        setAuditLogs(logs)
        setLoadingLogs(false)
      },
      (err) => {
        console.error('Error cargando auditoría de activo:', err)
        setLoadingLogs(false)
      }
    )
    return () => unsubscribe()
  }, [selectedAssetForAudit])

  // Filtrado
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      if (branchFilter !== 'all' && (a.patrimonialLocationId || (a.branchId === 'cochabamba' ? 'oficina_cochabamba' : 'oficina_punata')) !== branchFilter) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      if (statusFilter !== 'all' && a.status !== statusFilter) return false

      if (search.trim()) {
        const q = search.toLowerCase().trim()
        const matchCode = a.assetCode?.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.qrPayload?.toLowerCase().includes(q)
        const matchName = a.name?.toLowerCase().includes(q)
        const matchResp = a.responsiblePersonName?.toLowerCase().includes(q)
        const matchLoc = (a.patrimonialLocationId ? LOCATION_LABELS[a.patrimonialLocationId] : a.physicalLocation)?.toLowerCase().includes(q)
        if (!matchCode && !matchName && !matchResp && !matchLoc) return false
      }
      return true
    }).sort((left, right) => {
      const leftLocation = left.patrimonialLocationId ? LOCATION_LABELS[left.patrimonialLocationId] : left.branchId
      const rightLocation = right.patrimonialLocationId ? LOCATION_LABELS[right.patrimonialLocationId] : right.branchId
      return leftLocation.localeCompare(rightLocation, 'es') || left.assetCode.localeCompare(right.assetCode, 'es')
    })
  }, [assets, branchFilter, categoryFilter, statusFilter, search])

  // Métricas
  const metrics = useMemo(() => {
    const totalCount = assets.length
    const inUseCount = assets.filter((a) => a.status === 'in_use').length
    const inMaintenanceCount = assets.filter((a) => a.status === 'in_maintenance').length
    const disposedCount = assets.filter((a) => a.status === 'disposed').length
    const totalCostBob = assets
      .filter((a) => a.status !== 'disposed')
      .reduce((acc, curr) => acc + (curr.acquisitionCostBob || 0), 0)

    return { totalCount, inUseCount, inMaintenanceCount, disposedCount, totalCostBob }
  }, [assets])

  // Handlers
  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAsset.name.trim() || !newAsset.patrimonialLocationId || !Number.isInteger(Number(newAsset.quantity)) || Number(newAsset.quantity) < 1 || Number(newAsset.quantity) > 200) {
      setErrorMsg('Complete el nombre, la sede u oficina y una cantidad entera entre 1 y 200.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMsg(null)
      const costBob = parseFloat(newAsset.acquisitionCostBob) || 0
      const batchFingerprint = JSON.stringify({ ...newAsset, acquisitionCostBob: costBob })
      if (!batchRetryRef.current || batchRetryRef.current.fingerprint !== batchFingerprint) batchRetryRef.current = { fingerprint: batchFingerprint, key: crypto.randomUUID() }
      const res = await createFixedAssetBatch({
        name: newAsset.name.trim(),
        category: newAsset.category,
        description: newAsset.description.trim(),
        branchId: newAsset.branchId,
        patrimonialLocationId: newAsset.patrimonialLocationId,
        physicalLocation: '',
        responsiblePersonName: newAsset.responsiblePersonName.trim(),
        acquisitionDate: newAsset.acquisitionDate,
        acquisitionCostBob: costBob,
        acquisitionCostCents: Math.round(costBob * 100),
        status: 'available',
        notes: newAsset.notes.trim(),
        quantity: Number(newAsset.quantity),
        propertyType: newAsset.propertyType.trim(),
        address: newAsset.address.trim(),
        batchRequestId: batchRetryRef.current.key,
      })

      setSuccessMsg(res.message || 'Bien registrado exitosamente.')
      setSelectedForLabels(res.assets.map((asset) => asset.id))
      batchRetryRef.current = null
      setShowCreateModal(false)
      setNewAsset({
        name: '',
        category: 'oficina',
        description: '',
        branchId: currentBranchId === 'cochabamba' ? 'cochabamba' : 'punata',
        patrimonialLocationId: currentBranchId === 'cochabamba' ? 'oficina_cochabamba' : 'oficina_punata',
        physicalLocation: '',
        responsiblePersonName: '',
        acquisitionDate: new Date().toISOString().slice(0, 10),
        acquisitionCostBob: '',
        notes: '',
        quantity: '1',
        propertyType: '',
        address: '',
      })
    } catch (err: any) {
      console.error('Error registrando activo fijo:', err)
      setErrorMsg(err.message || 'No se pudo registrar el activo.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAssetForTransfer) return

    try {
      setIsSubmitting(true)
      setErrorMsg(null)
      const res = await manageFixedAsset({
        id: selectedAssetForTransfer.id,
        action: 'transfer',
        patrimonialLocationId: transferForm.patrimonialLocationId,
        responsiblePersonName: transferForm.responsiblePersonName.trim(),
      })
      setSuccessMsg(res.message || 'Transferencia registrada.')
      setSelectedAssetForTransfer(null)
    } catch (err: any) {
      console.error('Error transfiriendo activo:', err)
      setErrorMsg(err.message || 'Error al transferir activo.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditAsset = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedAssetForEdit) return
    try {
      setIsSubmitting(true); setErrorMsg(null)
      const costCents = Math.round(Number(editForm.acquisitionCostBob || 0) * 100)
      await manageFixedAsset({ id: selectedAssetForEdit.id, action: 'update', name: editForm.name, category: editForm.category, description: editForm.description, patrimonialLocationId: editForm.patrimonialLocationId, propertyType: editForm.propertyType, address: editForm.address, acquisitionDate: editForm.acquisitionDate, acquisitionCostCents: costCents, responsiblePersonName: editForm.responsiblePersonName, status: editForm.status, notes: editForm.notes })
      setSuccessMsg(`Activo ${selectedAssetForEdit.assetCode} actualizado; su identificador QR se conserva.`); setSelectedAssetForEdit(null)
    } catch (err: any) { setErrorMsg(err.message || 'No se pudo actualizar el bien.') } finally { setIsSubmitting(false) }
  }

  const handleChangeStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAssetForStatus) return

    try {
      setIsSubmitting(true)
      setErrorMsg(null)
      const res = await manageFixedAsset({
        id: selectedAssetForStatus.id,
        action: 'changeStatus',
        status: statusForm.status,
        notes: statusForm.notes.trim(),
      })
      setSuccessMsg(res.message || 'Estado actualizado.')
      setSelectedAssetForStatus(null)
    } catch (err: any) {
      console.error('Error cambiando estado:', err)
      setErrorMsg(err.message || 'Error al cambiar estado.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDispose = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAssetForDispose) return
    if (!disposeReason.trim() || disposeReason.trim().length < 5) {
      setErrorMsg('Debe especificar un motivo detallado para dar de baja el activo.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMsg(null)
      const res = await manageFixedAsset({
        id: selectedAssetForDispose.id,
        action: 'dispose',
        disposedReason: disposeReason.trim(),
      })
      setSuccessMsg(res.message || 'Activo dado de baja con éxito.')
      setSelectedAssetForDispose(null)
      setDisposeReason('')
    } catch (err: any) {
      console.error('Error dando de baja activo:', err)
      setErrorMsg(err.message || 'Error al procesar baja.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePrintLabel = async (asset: FixedAsset) => {
    try {
      setErrorMsg(null)
      const doc = printEngine.buildFromFixedAssetLabel(asset, asset.branchId)
      await printEngine.printDocument(doc)
      setSuccessMsg(`Etiqueta de activo ${asset.assetCode} enviada a impresión.`)
    } catch (err: any) {
      console.error('Error imprimiendo etiqueta de activo:', err)
      setErrorMsg(`Error de impresión: ${err.message}`)
    }
  }

  const handleBulkLabels = async () => {
    try {
      setErrorMsg(null)
      const selected = assets.filter((asset) => selectedForLabels.includes(asset.id))
      await downloadFixedAssetLabelsPdf(selected)
      setSuccessMsg(`${selected.length} etiqueta(s) QR preparadas en PDF.`)
    } catch (err: any) { setErrorMsg(err.message || 'No se pudo generar el PDF de etiquetas.') }
  }

  return (
    <div data-tutorial-target="assets-table-container" className="space-y-4">
      {/* Mensajes de Alerta */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl flex items-center justify-between text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl flex items-center justify-between text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* HEADER Y MÉTRICAS */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#064e3b]" />
              <h3 className="text-base font-bold text-slate-800">
                Inventario de Bienes Fijos — EXPRESO PUNATA
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Control oficial y trazable de equipos de computación, muebles, impresoras, balanzas y activos por agencia.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow hover:bg-[#053e2f] transition-all flex items-center gap-2 self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar Bien Fijo</span>
            </button>
          )}
        </div>

        {/* Tarjetas de Métricas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
            <span className="text-[11px] text-slate-500 block font-medium">Total de Activos</span>
            <span className="text-lg font-bold text-slate-800">{metrics.totalCount}</span>
          </div>
          <div className="bg-emerald-50 p-2.5 rounded-lg border border-emerald-100">
            <span className="text-[11px] text-emerald-700 block font-medium">En Uso Activo</span>
            <span className="text-lg font-bold text-emerald-800">{metrics.inUseCount}</span>
          </div>
          <div className="bg-amber-50 p-2.5 rounded-lg border border-amber-100">
            <span className="text-[11px] text-amber-700 block font-medium">Mantenimiento</span>
            <span className="text-lg font-bold text-amber-800">{metrics.inMaintenanceCount}</span>
          </div>
          <div className="bg-blue-50 p-2.5 rounded-lg border border-blue-100">
            <span className="text-[11px] text-blue-700 block font-medium">Valor Total Inventario</span>
            <span className="text-lg font-bold text-[#064e3b]">
              Bs {metrics.totalCostBob.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* FILTROS Y BÚSQUEDA */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-2.5 items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por numeral, QR, nombre o responsable..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b] focus:border-[#064e3b]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Filtro Sucursal */}
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value as any)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
          >
            <option value="all">Todas las sedes y oficinas</option>
            <option value="sede_punata">Sede Punata</option>
            <option value="oficina_punata">Oficina Punata</option>
            <option value="oficina_cochabamba">Oficina Cochabamba</option>
          </select>

          {/* Filtro Categoría */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
          >
            <option value="all">Todas las Categorías</option>
            {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
              <option key={cat} value={cat}>
                {label}
              </option>
            ))}
          </select>

          {/* Filtro Estado */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
          >
            <option value="all">Todos los Estados</option>
            {Object.entries(STATUS_LABELS).map(([st, { label }]) => (
              <option key={st} value={st}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3">
        <label className="text-xs text-slate-600 flex items-center gap-2"><input type="checkbox" checked={filteredAssets.length > 0 && filteredAssets.every((asset) => selectedForLabels.includes(asset.id))} onChange={(event) => setSelectedForLabels(event.target.checked ? filteredAssets.map((asset) => asset.id) : [])} /> Seleccionar todos los bienes filtrados</label>
        <button type="button" disabled={!selectedForLabels.length} onClick={handleBulkLabels} className="px-3 py-2 bg-[#064e3b] text-white rounded-lg text-xs font-bold flex gap-1 items-center disabled:opacity-40"><Download className="w-4 h-4"/> Imprimir etiquetas QR ({selectedForLabels.length})</button>
      </div>

      {/* LISTA / GRID DE ACTIVOS */}
      {loading ? (
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#064e3b] mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Cargando inventario de bienes fijos...</p>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center space-y-3">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-xs text-slate-500 font-medium">
            {search || branchFilter !== 'all' || categoryFilter !== 'all' || statusFilter !== 'all'
              ? 'No se encontraron bienes fijos con los filtros seleccionados.'
              : 'No hay bienes fijos registrados en el inventario.'}
          </p>
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3.5 py-1.5 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow hover:bg-[#053e2f]"
            >
              Registrar Primer Activo
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredAssets.map((asset) => {
            const statusConfig = STATUS_LABELS[asset.status] || STATUS_LABELS.available
            return (
              <div
                key={asset.id}
                className={`bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 transition-all hover:border-slate-300 flex flex-col justify-between ${
                  asset.status === 'disposed' ? 'opacity-70 bg-slate-50' : ''
                }`}
              >
                <div>
                  {/* Encabezado de la tarjeta */}
                  <div className="flex items-center justify-between gap-2">
                    <input type="checkbox" aria-label={`Seleccionar ${asset.assetCode} para etiquetas`} checked={selectedForLabels.includes(asset.id)} onChange={(event) => setSelectedForLabels((previous) => event.target.checked ? [...previous, asset.id] : previous.filter((id) => id !== asset.id))} />
                    <span className="font-mono text-xs font-black bg-slate-100 px-2.5 py-1 rounded border border-slate-200 text-[#064e3b]">
                      {asset.assetCode}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${statusConfig.color}`}
                    >
                      {statusConfig.label}
                    </span>
                  </div>

                  {/* Nombre y categoría */}
                  <h4 className="text-sm font-bold text-slate-900 mt-2 line-clamp-1">{asset.name}</h4>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block">
                    {CATEGORY_LABELS[asset.category] || asset.category}
                  </span>

                  {asset.description && (
                    <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{asset.description}</p>
                  )}

                  {/* Detalles de ubicación y responsable */}
                  <div className="space-y-1.5 border-t border-slate-100 pt-2.5 mt-3 text-[11px] text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate">
                      Ubicación: <strong className="text-slate-800">{asset.patrimonialLocationId ? LOCATION_LABELS[asset.patrimonialLocationId] : `Registro histórico · ${asset.physicalLocation}`}</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate">
                        Responsable: <strong className="text-slate-800">{asset.responsiblePersonName}</strong>
                      </span>
                    </div>
                    {asset.acquisitionCostBob !== undefined && asset.acquisitionCostBob > 0 && (
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span>
                          Costo Adquisición: <strong className="text-[#064e3b]">Bs {asset.acquisitionCostBob.toFixed(2)}</strong> ({asset.acquisitionDate})
                        </span>
                      </div>
                    )}
                    {asset.disposedReason && (
                      <div className="bg-rose-50 border border-rose-100 p-1.5 rounded text-[10px] text-rose-800 mt-1">
                        <strong>Motivo de baja:</strong> {asset.disposedReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Acciones de la tarjeta */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2 gap-1">
                  <button
                    type="button"
                    onClick={() => handlePrintLabel(asset)}
                    title="Imprimir Etiqueta Térmica"
                    className="p-1.5 bg-slate-100 text-slate-700 hover:bg-[#064e3b] hover:text-white rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Etiqueta</span>
                  </button>
                  <button type="button" onClick={() => void downloadFixedAssetLabelsPdf([asset]).then(() => setSuccessMsg(`Etiqueta QR ${asset.assetCode} descargada.`)).catch((err) => setErrorMsg(err.message || 'No se pudo generar la etiqueta.'))} title="Descargar etiqueta QR en PDF" className="p-1.5 bg-slate-100 text-slate-700 hover:bg-emerald-700 hover:text-white rounded-lg flex items-center gap-1 text-[11px] font-semibold"><QrCode className="w-3.5 h-3.5"/><span>PDF QR</span></button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedAssetForAudit(asset)}
                      title="Ver Historial y Auditoría"
                      className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>

                    {canManage && asset.status !== 'disposed' && (
                      <>
                        <button type="button" onClick={() => { setSelectedAssetForEdit(asset); setEditForm({ ...asset, acquisitionCostBob: asset.acquisitionCostBob || 0 }) }} title="Editar ficha de inventario" className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg text-[10px] font-bold">Editar</button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAssetForTransfer(asset)
                            setTransferForm({
                              patrimonialLocationId: asset.patrimonialLocationId || (asset.branchId === 'cochabamba' ? 'oficina_cochabamba' : 'oficina_punata'),
                              responsiblePersonName: asset.responsiblePersonName,
                            })
                          }}
                          title="Transferir Ubicación o Responsable"
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAssetForStatus(asset)
                            setStatusForm({
                              status: asset.status,
                              notes: '',
                            })
                          }}
                          title="Cambiar Estado / Mantenimiento"
                          className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedAssetForDispose(asset)}
                          title="Dar de Baja Definitiva"
                          className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL 1: REGISTRAR BIEN FIJO */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#064e3b]" />
                <h3 className="text-sm font-bold text-slate-900">Registrar bienes patrimoniales</h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAsset} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nombre del Activo / Equipo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Impresora Térmica Xprinter 80mm, Computadora Dell i5"
                  value={newAsset.name}
                  onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Categoría *
                  </label>
                  <select
                    value={newAsset.category}
                    onChange={(e) => setNewAsset({ ...newAsset, category: e.target.value as any, quantity: e.target.value === 'inmuebles' ? '1' : newAsset.quantity })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                      <option key={cat} value={cat}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Sede u oficina *
                  </label>
                  <select
                    value={newAsset.patrimonialLocationId}
                    onChange={(e) => setNewAsset({ ...newAsset, patrimonialLocationId: e.target.value as PatrimonialLocationId, branchId: e.target.value === 'oficina_cochabamba' ? 'cochabamba' : 'punata' })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  >
                    <option value="sede_punata">Sede Punata</option>
                    <option value="oficina_punata">Oficina Punata</option>
                    <option value="oficina_cochabamba">Oficina Cochabamba</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="text-[11px] font-bold text-slate-700">Cantidad de bienes<input type="number" min="1" max="200" step="1" disabled={newAsset.category === 'inmuebles'} value={newAsset.quantity} onChange={(e) => setNewAsset({ ...newAsset, quantity: e.target.value })} className="mt-1 w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg disabled:bg-slate-100" /></label>
                {newAsset.category === 'inmuebles' && <label className="text-[11px] font-bold text-slate-700">Tipo de inmueble<input value={newAsset.propertyType} onChange={(e) => setNewAsset({ ...newAsset, propertyType: e.target.value })} placeholder="Sede, oficina..." className="mt-1 w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg" /></label>}
              </div>
              {newAsset.category === 'inmuebles' && <input value={newAsset.address} onChange={(e) => setNewAsset({ ...newAsset, address: e.target.value })} placeholder="Dirección del inmueble" className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg" />}

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Responsable Asignado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Nombre y cargo del responsable"
                  value={newAsset.responsiblePersonName}
                  onChange={(e) => setNewAsset({ ...newAsset, responsiblePersonName: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Fecha Adquisición
                  </label>
                  <input
                    type="date"
                    value={newAsset.acquisitionDate}
                    onChange={(e) => setNewAsset({ ...newAsset, acquisitionDate: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Valor registrado total en Bs (opcional, no se multiplica por cantidad)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={newAsset.acquisitionCostBob}
                    onChange={(e) => setNewAsset({ ...newAsset, acquisitionCostBob: e.target.value })}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Descripción o Número de Serie
                </label>
                <textarea
                  rows={2}
                  placeholder="Marca, modelo, número de serie o características..."
                  value={newAsset.description}
                  onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#064e3b]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow hover:bg-[#053e2f] transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Registrando...' : 'Guardar Activo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: TRANSFERENCIA */}
      {selectedAssetForTransfer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Transferir Activo Fijo</h3>
              </div>
              <button onClick={() => setSelectedAssetForTransfer(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
              <span className="font-mono font-bold text-[#064e3b]">{selectedAssetForTransfer.assetCode}</span>
              <p className="font-semibold text-slate-800">{selectedAssetForTransfer.name}</p>
              <p className="text-[11px] text-slate-500">
                Ubicación actual: {selectedAssetForTransfer.patrimonialLocationId ? LOCATION_LABELS[selectedAssetForTransfer.patrimonialLocationId] : `Registro histórico · ${selectedAssetForTransfer.physicalLocation}`}
              </p>
            </div>

            <form onSubmit={handleTransfer} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nueva sede u oficina patrimonial *
                </label>
                <select
                  value={transferForm.patrimonialLocationId}
                  onChange={(e) => setTransferForm({ ...transferForm, patrimonialLocationId: e.target.value as PatrimonialLocationId })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value="sede_punata">Sede Punata</option>
                  <option value="oficina_punata">Oficina Punata</option>
                  <option value="oficina_cochabamba">Oficina Cochabamba</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nuevo Responsable Asignado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Nombre de la persona que recibe"
                  value={transferForm.responsiblePersonName}
                  onChange={(e) => setTransferForm({ ...transferForm, responsiblePersonName: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedAssetForTransfer(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg shadow hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Guardando...' : 'Confirmar Transferencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CAMBIO DE ESTADO / MANTENIMIENTO */}
      {selectedAssetForStatus && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Estado / Mantenimiento</h3>
              </div>
              <button onClick={() => setSelectedAssetForStatus(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
              <span className="font-mono font-bold text-[#064e3b]">{selectedAssetForStatus.assetCode}</span>
              <p className="font-semibold text-slate-800">{selectedAssetForStatus.name}</p>
            </div>

            <form onSubmit={handleChangeStatus} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nuevo Estado *
                </label>
                <select
                  value={statusForm.status}
                  onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value as any })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-600"
                >
                  <option value="in_use">En Uso Activo</option>
                  <option value="available">Disponible en Almacén</option>
                  <option value="in_maintenance">En Mantenimiento Técnico</option>
                  <option value="damaged">Dañado / Para Reparar</option>
                  <option value="out_of_service">Fuera de Servicio</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Observaciones / Motivo del Cambio
                </label>
                <textarea
                  rows={3}
                  placeholder="Detalles del mantenimiento, falla técnica o cambio..."
                  value={statusForm.notes}
                  onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedAssetForStatus(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg shadow hover:bg-amber-700 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Actualizando...' : 'Actualizar Estado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: BAJA DEFINITIVA */}
      {selectedAssetForDispose && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-rose-700">
                <Trash2 className="w-5 h-5" />
                <h3 className="text-sm font-bold">Dar de Baja Activo Fijo</h3>
              </div>
              <button onClick={() => setSelectedAssetForDispose(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-xs space-y-1">
              <p className="font-bold">¡Atención! Acción de Control Patrimonial</p>
              <p>
                Al dar de baja el activo <strong>{selectedAssetForDispose.assetCode}</strong> ({selectedAssetForDispose.name}),
                dejará de computarse como bien en uso de la empresa. Esta acción quedará registrada permanentemente en la auditoría.
              </p>
            </div>

            <form onSubmit={handleDispose} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Justificación / Motivo de Baja *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="ej. Obsolescencia técnica irreparable, rotura definitiva durante mudanza, descarte autorizado por directiva..."
                  value={disposeReason}
                  onChange={(e) => setDisposeReason(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedAssetForDispose(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-rose-700 text-white text-xs font-bold rounded-lg shadow hover:bg-rose-800 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Procesando...' : 'Confirmar Baja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: HISTORIAL Y AUDITORÍA */}
      {selectedAssetForAudit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-[#064e3b]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Historial de Auditoría del Activo</h3>
                  <span className="font-mono text-xs font-bold text-[#064e3b]">{selectedAssetForAudit.assetCode} — {selectedAssetForAudit.name}</span>
                </div>
              </div>
              <button onClick={() => setSelectedAssetForAudit(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {loadingLogs ? (
                <div className="text-center py-6 text-xs text-slate-500">Cargando registros de auditoría...</div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500">No hay movimientos registrados para este activo.</div>
              ) : (
                auditLogs.map((log) => (
                  <div key={log.id} className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px] bg-slate-200 px-1.5 py-0.5 rounded">
                        {log.action}
                      </span>
                      <span className="text-[10px] text-slate-400">{log.timestampIso ? new Date(log.timestampIso).toLocaleString('es-BO') : ''}</span>
                    </div>
                    <p className="text-slate-700">{log.details}</p>
                    {log.previousLocation && log.newLocation && (
                      <p className="text-[11px] text-slate-500">
                        De: <span className="line-through">{log.previousLocation}</span> ➔ <strong>{log.newLocation}</strong>
                      </p>
                    )}
                    {log.previousResponsible && log.newResponsible && (
                      <p className="text-[11px] text-slate-500">
                        Resp: <span className="line-through">{log.previousResponsible}</span> ➔ <strong>{log.newResponsible}</strong>
                      </p>
                    )}
                    <span className="text-[10px] text-slate-400 block pt-1">
                      Por: <strong>{log.performedByName}</strong>
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 flex justify-end flex-shrink-0">
              <button
                type="button"
                onClick={() => setSelectedAssetForAudit(null)}
                className="px-4 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAssetForEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleEditAsset} className="bg-white rounded-2xl max-w-xl w-full p-5 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center"><div><h3 className="font-bold text-sm">Editar ficha patrimonial</h3><p className="font-mono text-xs text-[#064e3b]">{selectedAssetForEdit.assetCode} · QR estable</p></div><button type="button" onClick={() => setSelectedAssetForEdit(null)}><X className="w-4 h-4"/></button></div>
            <input required minLength={2} value={editForm.name || ''} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="Nombre del bien" className="w-full p-2.5 border rounded-lg text-sm"/>
            <div className="grid grid-cols-2 gap-2"><select value={editForm.category || 'otro'} onChange={(event) => setEditForm({ ...editForm, category: event.target.value as FixedAssetCategory })} className="p-2.5 border rounded-lg text-sm">{Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={editForm.patrimonialLocationId || 'oficina_punata'} onChange={(event) => setEditForm({ ...editForm, patrimonialLocationId: event.target.value as PatrimonialLocationId })} className="p-2.5 border rounded-lg text-sm">{Object.entries(LOCATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            <textarea rows={2} value={editForm.description || ''} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} placeholder="Descripción" className="w-full p-2.5 border rounded-lg text-sm"/>
            {editForm.category === 'inmuebles' && <div className="grid grid-cols-2 gap-2"><input value={editForm.propertyType || ''} onChange={(event) => setEditForm({ ...editForm, propertyType: event.target.value })} placeholder="Tipo de inmueble" className="p-2.5 border rounded-lg text-sm"/><input value={editForm.address || ''} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} placeholder="Dirección" className="p-2.5 border rounded-lg text-sm"/></div>}
            <div className="grid grid-cols-2 gap-2"><label className="text-xs">Fecha de adquisición/incorporación<input type="date" value={editForm.acquisitionDate || ''} onChange={(event) => setEditForm({ ...editForm, acquisitionDate: event.target.value })} className="mt-1 w-full p-2 border rounded text-sm"/></label><label className="text-xs">Valor registrado (Bs)<input type="number" min="0" step="0.01" value={editForm.acquisitionCostBob || 0} onChange={(event) => setEditForm({ ...editForm, acquisitionCostBob: Number(event.target.value) })} className="mt-1 w-full p-2 border rounded text-sm"/></label></div>
            <div className="grid grid-cols-2 gap-2"><input value={editForm.responsiblePersonName || ''} onChange={(event) => setEditForm({ ...editForm, responsiblePersonName: event.target.value })} placeholder="Responsable (opcional)" className="p-2.5 border rounded-lg text-sm"/><select value={editForm.status || 'available'} onChange={(event) => setEditForm({ ...editForm, status: event.target.value as FixedAssetStatus })} className="p-2.5 border rounded-lg text-sm">{Object.entries(STATUS_LABELS).filter(([key]) => key !== 'disposed').map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div>
            <textarea rows={2} value={editForm.notes || ''} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} placeholder="Observaciones" className="w-full p-2.5 border rounded-lg text-sm"/>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setSelectedAssetForEdit(null)} className="px-3 py-2 border rounded-lg text-sm">Cancelar</button><button disabled={isSubmitting} className="px-3 py-2 bg-[#064e3b] text-white rounded-lg text-sm">{isSubmitting ? 'Guardando…' : 'Guardar cambios'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
