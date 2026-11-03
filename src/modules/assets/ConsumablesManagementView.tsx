import React, { useState, useEffect } from 'react'
import {
  Boxes,
  Plus,
  AlertTriangle,
  Search,
  CheckCircle,
  X,
  History,
} from 'lucide-react'
import type {
  UserProfile,
  Branch,
  ConsumableItem,
  ConsumableMovement,
  ConsumableCategory,
} from '../../types/index.ts'
import {
  fetchBranchConsumables,
  fetchConsumableMovements,
  createConsumableItem,
  recordConsumableEntry,
  recordConsumableConsumption,
  recordConsumableAdjustment,
} from '../../services/consumableService.ts'
import { INITIAL_BRANCHES } from '../../domain/expresoPunataConfig.ts'

interface ConsumablesManagementViewProps {
  currentUser: UserProfile
  currentBranch: Branch
}

const CATEGORY_LABELS: Record<ConsumableCategory, string> = {
  thermal_rolls: 'Rollos Térmicos (80/58mm)',
  security_seals: 'Precintos de Seguridad',
  tape: 'Cinta de Embalar',
  packaging_boxes: 'Cajas de Cartón',
  envelopes: 'Sobres Manila',
  labels: 'Etiquetas Autoadhesivas',
  other: 'Otros Insumos',
}

export const ConsumablesManagementView: React.FC<ConsumablesManagementViewProps> = ({
  currentUser: _currentUser,
  currentBranch,
}) => {
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranch.id)
  const [items, setItems] = useState<ConsumableItem[]>([])
  const [movements, setMovements] = useState<ConsumableMovement[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [_loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Modales
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false)
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false)
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ConsumableItem | null>(null)

  // Form states
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<ConsumableCategory>('thermal_rolls')
  const [newUnit, setNewUnit] = useState('rollos')
  const [newInitialStock, setNewInitialStock] = useState('10')
  const [newMinStock, setNewMinStock] = useState('5')
  const [newCostBob, setNewCostBob] = useState('8.50')

  const [actionQuantity, setActionQuantity] = useState('1')
  const [actionReason, setActionReason] = useState('')
  const [actionRefDoc, setActionRefDoc] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await fetchBranchConsumables(selectedBranchId)
      setItems(data)
      const movs = await fetchConsumableMovements(selectedBranchId)
      setMovements(movs)
    } catch (err: any) {
      console.error('Error cargando consumibles:', err)
      setFeedback({ type: 'error', message: err.message || 'Error al cargar inventario de consumibles.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [selectedBranchId])

  const filteredItems = items.filter((it) => {
    const q = searchQuery.toLowerCase()
    return (
      it.code.toLowerCase().includes(q) ||
      it.name.toLowerCase().includes(q) ||
      CATEGORY_LABELS[it.category]?.toLowerCase().includes(q)
    )
  })

  // KPIs
  const totalItemsCount = items.length
  const totalStockCount = items.reduce((sum, it) => sum + (it.currentStock || 0), 0)
  const lowStockCount = items.filter((it) => it.isLowStock || (it.currentStock || 0) <= it.minStockAlert).length
  const totalValuationBob = items.reduce(
    (sum, it) => sum + (it.currentStock || 0) * (it.costPerUnitBob || (it.costPerUnitCents ? it.costPerUnitCents / 100 : 0)),
    0
  )

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      await createConsumableItem({
        code: newCode.trim(),
        name: newName.trim(),
        category: newCategory,
        branchId: selectedBranchId === 'all' ? currentBranch.id : selectedBranchId,
        unit: newUnit.trim(),
        currentStock: parseInt(newInitialStock, 10) || 0,
        minStockAlert: parseInt(newMinStock, 10) || 5,
        costPerUnitCents: Math.round(parseFloat(newCostBob || '0') * 100),
      })
      setFeedback({ type: 'success', message: 'Insumo registrado exitosamente en el catálogo.' })
      setIsCreateModalOpen(false)
      setNewCode('')
      setNewName('')
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Error al crear consumible.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecordEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return
    const qty = parseInt(actionQuantity, 10)
    if (isNaN(qty) || qty <= 0) {
      alert('La cantidad debe ser mayor a 0.')
      return
    }

    try {
      setIsSubmitting(true)
      await recordConsumableEntry({
        id: selectedItem.id,
        quantity: qty,
        reason: actionReason.trim() || 'Ingreso de existencias',
        referenceDocument: actionRefDoc.trim(),
      })
      setFeedback({ type: 'success', message: `Se ingresaron ${qty} ${selectedItem.unit} a ${selectedItem.name}.` })
      setIsEntryModalOpen(false)
      setActionQuantity('1')
      setActionReason('')
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Error registrando entrada.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecordConsumption = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return
    const qty = parseInt(actionQuantity, 10)
    if (isNaN(qty) || qty <= 0) {
      alert('La cantidad debe ser mayor a 0.')
      return
    }
    if (qty > selectedItem.currentStock) {
      alert(`Stock insuficiente (${selectedItem.currentStock} ${selectedItem.unit}) para consumir ${qty}.`)
      return
    }

    try {
      setIsSubmitting(true)
      await recordConsumableConsumption({
        id: selectedItem.id,
        quantity: qty,
        reason: actionReason.trim() || 'Consumo operativo en turno de ventanilla',
      })
      setFeedback({ type: 'success', message: `Salida de ${qty} ${selectedItem.unit} registrada correctamente.` })
      setIsConsumptionModalOpen(false)
      setActionQuantity('1')
      setActionReason('')
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Error registrando consumo.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return
    const newStk = parseInt(actionQuantity, 10)
    if (isNaN(newStk) || newStk < 0) {
      alert('El nuevo stock debe ser un entero no negativo.')
      return
    }
    if (!actionReason.trim() || actionReason.trim().length < 5) {
      alert('Se requiere una justificación de mínimo 5 caracteres.')
      return
    }

    try {
      setIsSubmitting(true)
      await recordConsumableAdjustment({
        id: selectedItem.id,
        newStock: newStk,
        reason: actionReason.trim(),
      })
      setFeedback({ type: 'success', message: `Stock ajustado a ${newStk} ${selectedItem.unit}.` })
      setIsAdjustmentModalOpen(false)
      setActionQuantity('0')
      setActionReason('')
      await loadData()
    } catch (err: any) {
      alert(err.message || 'Error al ajustar inventario.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Encabezado y Filtros */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="w-6 h-6 text-[#064e3b]" />
            <h2 className="text-xl font-black text-slate-800">Inventario de Consumibles e Insumos</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Control de rollos térmicos, precintos, cinta, cajas y sobres para la operación diaria de ventanilla.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de Sucursal */}
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 outline-none"
          >
            <option value="all">Todas las Sucursales</option>
            {INITIAL_BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition border ${
              showHistory
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{showHistory ? 'Ver Catálogo' : 'Movimientos'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl text-xs font-bold shadow transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo Insumo</span>
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
            <CheckCircle className="w-4 h-4" />
            <span>{feedback.message}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tarjetas KPI */}
      <div data-tutorial-target="consumables-grid" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-slate-500">Insumos Registrados</p>
          <p className="text-xl font-black text-slate-800 mt-1">{totalItemsCount}</p>
          <span className="text-[10px] text-slate-400">Tipos de consumibles</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-slate-500">Existencias Totales</p>
          <p className="text-xl font-black text-[#064e3b] mt-1">{totalStockCount}</p>
          <span className="text-[10px] text-slate-400">Unidades en stock</span>
        </div>
        <div
          className={`p-4 rounded-xl border shadow-sm ${
            lowStockCount > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-white border-slate-200'
          }`}
        >
          <p className={`text-[11px] font-bold uppercase ${lowStockCount > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
            Stock Crítico / Bajo
          </p>
          <p className={`text-xl font-black mt-1 ${lowStockCount > 0 ? 'text-rose-700' : 'text-slate-800'}`}>
            {lowStockCount}
          </p>
          <span className={`text-[10px] ${lowStockCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
            {lowStockCount > 0 ? 'Requiere reabastecimiento' : 'Stock en niveles óptimos'}
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-bold uppercase text-slate-500">Valorización Estimada</p>
          <p className="text-xl font-black text-slate-800 mt-1">Bs. {totalValuationBob.toFixed(2)}</p>
          <span className="text-[10px] text-slate-400">Costo de reposición</span>
        </div>
      </div>

      {showHistory ? (
        /* VISTA DE MOVIMIENTOS RECIENTES */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <History className="w-4 h-4 text-slate-600" />
              <span>Historial de Movimientos de Insumos</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">{movements.length} movimientos</span>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2.5">Fecha</th>
                  <th className="p-2.5">Insumo</th>
                  <th className="p-2.5">Tipo</th>
                  <th className="p-2.5">Cantidad</th>
                  <th className="p-2.5">Stock Anterior ➔ Nuevo</th>
                  <th className="p-2.5">Operador</th>
                  <th className="p-2.5">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => {
                  const isEntry = m.type === 'entry'
                  const isConsumption = m.type === 'consumption'

                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="p-2.5 text-slate-500 whitespace-nowrap">
                        {m.timestampIso ? new Date(m.timestampIso).toLocaleString() : '-'}
                      </td>
                      <td className="p-2.5 font-bold text-slate-800">
                        <span className="font-mono text-emerald-800">[{m.consumableCode}]</span> {m.consumableName}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                            isEntry
                              ? 'bg-emerald-100 text-emerald-800'
                              : isConsumption
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isEntry ? 'Entrada' : isConsumption ? 'Consumo' : 'Ajuste'}
                        </span>
                      </td>
                      <td className="p-2.5 font-bold font-mono">
                        {isEntry ? `+${m.quantity}` : isConsumption ? `-${m.quantity}` : m.quantity}
                      </td>
                      <td className="p-2.5 text-slate-600 font-mono text-[11px]">
                        {m.previousStock} ➔ <strong>{m.newStock}</strong>
                      </td>
                      <td className="p-2.5 text-slate-700">{m.performedByName}</td>
                      <td className="p-2.5 text-slate-500 max-w-xs truncate">{m.reason}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* VISTA DE CATÁLOGO Y STOCK */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por código, nombre o categoría..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
            <div className="text-xs text-slate-500">
              Mostrando <strong>{filteredItems.length}</strong> de {items.length} insumos
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2.5">Código</th>
                  <th className="p-2.5">Insumo / Descripción</th>
                  <th className="p-2.5">Categoría</th>
                  <th className="p-2.5">Sucursal</th>
                  <th className="p-2.5 text-center">Stock Actual</th>
                  <th className="p-2.5 text-center">Alerta Mín.</th>
                  <th className="p-2.5">Costo Unit.</th>
                  <th className="p-2.5 text-right">Acciones de Operación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      No se encontraron consumibles en esta sucursal.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((it) => {
                    const isLow = it.isLowStock || (it.currentStock || 0) <= it.minStockAlert
                    const branchObj = INITIAL_BRANCHES.find((b) => b.id === it.branchId)

                    return (
                      <tr key={it.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold font-mono text-[#064e3b]">{it.code}</td>
                        <td className="p-2.5 font-bold text-slate-800">
                          {it.name}
                          {isLow && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Bajo
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-slate-600 text-[11px]">{CATEGORY_LABELS[it.category] || it.category}</td>
                        <td className="p-2.5 text-slate-500 text-[11px]">{branchObj ? branchObj.name : it.branchId}</td>
                        <td className="p-2.5 text-center font-black font-mono text-sm">
                          <span
                            className={`px-2 py-0.5 rounded-full ${
                              isLow ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {it.currentStock} {it.unit}
                          </span>
                        </td>
                        <td className="p-2.5 text-center font-mono text-slate-500">
                          {it.minStockAlert} {it.unit}
                        </td>
                        <td className="p-2.5 font-mono text-slate-700">
                          Bs. {(it.costPerUnitBob || (it.costPerUnitCents ? it.costPerUnitCents / 100 : 0)).toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right space-x-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedItem(it)
                              setActionQuantity('1')
                              setIsEntryModalOpen(true)
                            }}
                            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded font-bold text-[10px] transition"
                            title="Ingreso de existencias"
                          >
                            + Entrada
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedItem(it)
                              setActionQuantity('1')
                              setIsConsumptionModalOpen(true)
                            }}
                            disabled={it.currentStock <= 0}
                            className="px-2 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 text-blue-800 rounded font-bold text-[10px] transition"
                            title="Salida por consumo en ventanilla"
                          >
                            - Consumo
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedItem(it)
                              setActionQuantity(it.currentStock.toString())
                              setIsAdjustmentModalOpen(true)
                            }}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold text-[10px] transition"
                            title="Ajuste por recuento físico"
                          >
                            Ajuste
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Crear Insumo */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-black text-slate-800">Nuevo Insumo en Catálogo</h3>
              <button type="button" onClick={() => setIsCreateModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleCreateItem} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Código Único</label>
                  <input
                    type="text"
                    placeholder="Ej. ROL-80MM"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Categoría</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([catKey, label]) => (
                      <option key={catKey} value={catKey}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Descripción / Nombre del Insumo</label>
                <input
                  type="text"
                  placeholder="Ej. Rollo de Papel Térmico 80mm x 55m"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Unidad</label>
                  <input
                    type="text"
                    placeholder="rollos, cajas..."
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Stock Inicial</label>
                  <input
                    type="number"
                    min="0"
                    value={newInitialStock}
                    onChange={(e) => setNewInitialStock(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Alerta Mín.</label>
                  <input
                    type="number"
                    min="1"
                    value={newMinStock}
                    onChange={(e) => setNewMinStock(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Costo Unitario de Reposición (Bs.)</label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={newCostBob}
                  onChange={(e) => setNewCostBob(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl font-bold shadow"
                >
                  {isSubmitting ? 'Guardando...' : 'Crear Insumo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Registrar Entrada */}
      {isEntryModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-xs font-black text-slate-800">Ingreso de Existencias (+ Entrada)</h3>
              <button type="button" onClick={() => setIsEntryModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleRecordEntry} className="p-4 space-y-3 text-xs">
              <p className="font-bold text-slate-700">
                {selectedItem.name} <span className="text-slate-400 font-mono">[{selectedItem.code}]</span>
              </p>
              <p className="text-slate-500 text-[11px]">
                Stock actual: <strong>{selectedItem.currentStock} {selectedItem.unit}</strong>
              </p>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Cantidad a ingresar ({selectedItem.unit})</label>
                <input
                  type="number"
                  min="1"
                  value={actionQuantity}
                  onChange={(e) => setActionQuantity(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Motivo / Proveedor</label>
                <input
                  type="text"
                  placeholder="Ej. Compra por mayor librería Central..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Nro Factura / Recibo (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej. FAC-10492"
                  value={actionRefDoc}
                  onChange={(e) => setActionRefDoc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEntryModalOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold shadow"
                >
                  {isSubmitting ? 'Guardando...' : 'Confirmar Entrada'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Registrar Consumo */}
      {isConsumptionModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-xs font-black text-slate-800">Consumo de Ventanilla (- Salida)</h3>
              <button type="button" onClick={() => setIsConsumptionModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleRecordConsumption} className="p-4 space-y-3 text-xs">
              <p className="font-bold text-slate-700">
                {selectedItem.name} <span className="text-slate-400 font-mono">[{selectedItem.code}]</span>
              </p>
              <p className="text-slate-500 text-[11px]">
                Stock disponible: <strong>{selectedItem.currentStock} {selectedItem.unit}</strong>
              </p>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Cantidad consumida ({selectedItem.unit})</label>
                <input
                  type="number"
                  min="1"
                  max={selectedItem.currentStock}
                  value={actionQuantity}
                  onChange={(e) => setActionQuantity(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold text-blue-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Destino / Observación</label>
                <input
                  type="text"
                  placeholder="Ej. Uso en impresora de ventanilla 1..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConsumptionModalOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow"
                >
                  {isSubmitting ? 'Guardando...' : 'Registrar Salida'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ajuste Físico */}
      {isAdjustmentModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-xs font-black text-slate-800">Ajuste Físico de Inventario</h3>
              <button type="button" onClick={() => setIsAdjustmentModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleRecordAdjustment} className="p-4 space-y-3 text-xs">
              <p className="font-bold text-slate-700">
                {selectedItem.name} <span className="text-slate-400 font-mono">[{selectedItem.code}]</span>
              </p>
              <p className="text-slate-500 text-[11px]">
                Stock en sistema: <strong>{selectedItem.currentStock} {selectedItem.unit}</strong>
              </p>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Nuevo Stock Físico Real ({selectedItem.unit})
                </label>
                <input
                  type="number"
                  min="0"
                  value={actionQuantity}
                  onChange={(e) => setActionQuantity(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold text-amber-800"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Justificación Obligatoria</label>
                <textarea
                  rows={2}
                  placeholder="Ej. Recuento físico de fin de mes, regularización..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdjustmentModalOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-xl font-bold shadow"
                >
                  {isSubmitting ? 'Guardando...' : 'Aplicar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
