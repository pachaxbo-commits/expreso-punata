import React, { useState, useEffect } from 'react'
import {
  Building2,
  Save,
  RefreshCw,
  Coins,
  Receipt,
  Printer,
  CheckCircle,
  AlertCircle,
  MapPin,
  Sparkles,
} from 'lucide-react'
import type { UserProfile, SystemConfig } from '../../types/index.ts'
import { fetchSystemConfig, updateSystemConfig, BLANK_UNCONFIGURED_TEMPLATE } from '../../services/configService.ts'

interface SystemConfigViewProps {
  currentUser: UserProfile
}

export const SystemConfigView: React.FC<SystemConfigViewProps> = ({ currentUser: _currentUser }) => {
  const [config, setConfig] = useState<SystemConfig>(BLANK_UNCONFIGURED_TEMPLATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Sub-sección activa dentro de Configuración Oficial
  const [activeSection, setActiveSection] = useState<'company' | 'branches' | 'tariffs' | 'commissions' | 'dues' | 'printing'>('company')

  const [configStatus, setConfigStatus] = useState<'configured' | 'unconfigured' | 'error'>('configured')

  const loadConfig = async () => {
    try {
      setLoading(true)
      const data = await fetchSystemConfig()
      if (data.status === 'error') {
        setConfigStatus('error')
        setFeedback({
          type: 'error',
          message: data.error || 'Error de conexión o permisos al consultar la configuración oficial en Cloud Firestore.',
        })
      } else if (data.status === 'unconfigured' || !data.config) {
        setConfig(BLANK_UNCONFIGURED_TEMPLATE)
        setConfigStatus('unconfigured')
        setFeedback({
          type: 'error',
          message: 'Configuración pendiente de aprobación: El sistema aún no cuenta con datos oficiales registrados. Por favor ingrese los datos corporativos, tarifas y comisiones confirmadas.',
        })
      } else {
        setConfig(data.config)
        setConfigStatus('configured')
        setFeedback(null)
      }
    } catch (err: any) {
      console.error('Error cargando configuración:', err)
      setConfigStatus('error')
      setFeedback({ type: 'error', message: err.message || 'Error al cargar la configuración oficial.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) return

    // Validación preventiva de parámetros requeridos
    const baseFee = Number(config.tariffs?.baseFeeBob)
    const extraKg = Number(config.tariffs?.extraKgRateBob)
    if (isNaN(baseFee) || baseFee <= 0) {
      setFeedback({
        type: 'error',
        message: 'La Tarifa Base (Bs) es obligatoria y debe ser mayor a 0 para admitir encomiendas.',
      })
      setActiveSection('tariffs')
      return
    }
    if (isNaN(extraKg) || extraKg < 0) {
      setFeedback({
        type: 'error',
        message: 'La Tarifa por Kg Adicional (Bs) no puede ser negativa.',
      })
      setActiveSection('tariffs')
      return
    }

    try {
      setSaving(true)
      const res = await updateSystemConfig(config)
      setConfig(res.config)
      setConfigStatus('configured')
      setFeedback({ type: 'success', message: '¡Configuración oficial guardada exitosamente en Cloud Firestore!' })
    } catch (err: any) {
      console.error('Error guardando configuración:', err)
      setFeedback({ type: 'error', message: err.message || 'Error al guardar la configuración.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
        Cargando configuración oficial de Expreso Punata...
      </div>
    )
  }

  if (configStatus === 'error' && (!config || config.isOfficial === false)) {
    return (
      <div className="bg-white rounded-2xl border border-rose-200 p-12 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto font-bold text-xl">
          !
        </div>
        <div className="text-rose-700 font-black text-base">Error al cargar la configuración oficial</div>
        <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
          {feedback?.message || 'No se pudo conectar con Cloud Firestore para consultar los parámetros del sistema. Compruebe su conexión o permisos.'}
        </p>
        <button
          type="button"
          onClick={loadConfig}
          className="px-5 py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-2 mx-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reintentar conexión</span>
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-[#064e3b]" />
            <h2 className="text-xl font-black text-slate-800">Configuración Oficial del Sistema</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Parámetros oficiales persistentes: tarifas sugeridas, comisiones, agencias, aportes de socios e impresión.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadConfig}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Recargar</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl text-xs font-bold shadow transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Guardando...' : 'Guardar Cambios'}</span>
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
            ×
          </button>
        </div>
      )}

      {/* Navegación por Secciones */}
      <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-1 text-xs">
        {[
          { id: 'company', label: 'Empresa / Identidad', icon: Building2 },
          { id: 'branches', label: 'Sucursales / Agencias', icon: MapPin },
          { id: 'tariffs', label: 'Tarifario Sugerido', icon: Receipt },
          { id: 'commissions', label: 'Comisiones Conductor', icon: Coins },
          { id: 'dues', label: 'Aportes de Socios', icon: Sparkles },
          { id: 'printing', label: 'Impresión y Tickets', icon: Printer },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeSection === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                isActive ? 'bg-[#064e3b] text-white shadow' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Formulario de Configuración */}
      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
        {/* 1. SECCIÓN: EMPRESA */}
        {activeSection === 'company' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 border-b pb-2">Identidad Oficial de la Empresa</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nombre Comercial</label>
                <input
                  type="text"
                  value={config.company.tradeName || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      company: { ...config.company, tradeName: e.target.value, name: e.target.value },
                    })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Razón Social Legal</label>
                <input
                  type="text"
                  value={config.company.legalName || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      company: { ...config.company, legalName: e.target.value },
                    })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Acrónimo</label>
                <input
                  type="text"
                  value={config.company.acronym || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      company: { ...config.company, acronym: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Leyenda Legal de Boletas</label>
                <input
                  type="text"
                  value={config.company.legalNotice || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      company: { ...config.company, legalNotice: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-slate-600"
                />
              </div>
            </div>
          </div>
        )}

        {/* 2. SECCIÓN: SUCURSALES */}
        {activeSection === 'branches' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 border-b pb-2">Agencias y Sucursales Oficiales</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              {['punata', 'cochabamba'].map((bKey) => {
                const br = config.branches?.[bKey] || {
                  name: bKey === 'punata' ? 'Agencia Central Punata' : 'Agencia Cochabamba',
                  code: bKey === 'punata' ? 'PUN' : 'CBB',
                  city: bKey === 'punata' ? 'Punata' : 'Cochabamba',
                  department: 'Cochabamba',
                  address: '',
                  phone: '',
                  isActive: true,
                }

                return (
                  <div key={bKey} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <p className="font-black text-sm text-[#064e3b] uppercase">
                      {br.name} ({br.code})
                    </p>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Nombre Oficial</label>
                      <input
                        type="text"
                        value={br.name}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            branches: {
                              ...config.branches,
                              [bKey]: { ...br, name: e.target.value },
                            },
                          })
                        }
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Dirección Oficial</label>
                      <input
                        type="text"
                        value={br.address}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            branches: {
                              ...config.branches,
                              [bKey]: { ...br, address: e.target.value },
                            },
                          })
                        }
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Teléfonos de Contacto</label>
                      <input
                        type="text"
                        value={br.phone}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            branches: {
                              ...config.branches,
                              [bKey]: { ...br, phone: e.target.value },
                            },
                          })
                        }
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 3. SECCIÓN: TARIFAS SUGERIDAS */}
        {activeSection === 'tariffs' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 border-b pb-2">
              Tarifario Sugerido de Ventanilla (Referencial Oficial)
            </h3>
            <p className="text-xs text-slate-500">
              Estos valores se cargan como predeterminados en el asistente de encomienda, pero la operadora puede
              ajustar el precio real acordado en ventanilla.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Tarifa Base Sugerida (Bs.)</label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={config.tariffs?.baseFeeBob || 15}
                  onChange={(e) => {
                    const bob = parseFloat(e.target.value) || 0
                    setConfig({
                      ...config,
                      tariffs: {
                        ...config.tariffs,
                        baseFeeBob: bob,
                        baseFeeCents: Math.round(bob * 100),
                      },
                    })
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold text-emerald-800"
                />
                <span className="text-[10px] text-slate-400">Hasta peso libre</span>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Peso Libre Incluido (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={config.tariffs?.freeWeightKg || 3}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      tariffs: {
                        ...config.tariffs,
                        freeWeightKg: parseFloat(e.target.value) || 3,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Tarifa por kg Extra (Bs./kg)</label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={config.tariffs?.extraKgRateBob || 2}
                  onChange={(e) => {
                    const bob = parseFloat(e.target.value) || 0
                    setConfig({
                      ...config,
                      tariffs: {
                        ...config.tariffs,
                        extraKgRateBob: bob,
                        extraKgRateCents: Math.round(bob * 100),
                      },
                    })
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Entrega a Domicilio (Bs.)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={config.tariffs?.homeDeliveryFeeBob || 12}
                  onChange={(e) => {
                    const bob = parseFloat(e.target.value) || 0
                    setConfig({
                      ...config,
                      tariffs: {
                        ...config.tariffs,
                        homeDeliveryFeeBob: bob,
                        homeDeliveryFeeCents: Math.round(bob * 100),
                      },
                    })
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* 4. SECCIÓN: COMISIONES DE CONDUCTOR */}
        {activeSection === 'commissions' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 border-b pb-2">
              Regla Oficial de Comisión para Conductores
            </h3>
            <p className="text-xs text-slate-500">
              Regla aplicada por defecto al despachar manifiestos y devengar comisiones ganadas por el chofer.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Modalidad de Cálculo</label>
                <select
                  value={config.commissions?.defaultType || 'percentage'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      commissions: {
                        ...config.commissions,
                        defaultType: e.target.value as any,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-bold"
                >
                  <option value="percentage">Porcentaje sobre el flete del envío (%)</option>
                  <option value="fixed_per_shipment">Monto fijo en bolivianos por guía (Bs.)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {config.commissions?.defaultType === 'percentage'
                    ? 'Porcentaje por Encomienda (%)'
                    : 'Importe Fijo por Encomienda (Bs.)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={config.commissions?.defaultValue || 10}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      commissions: {
                        ...config.commissions,
                        defaultValue: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold text-amber-800"
                />
              </div>
            </div>
          </div>
        )}

        {/* 5. SECCIÓN: APORTES DE SOCIOS */}
        {activeSection === 'dues' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 border-b pb-2">
              Parámetros de Mensualidades Sindicales
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Cuota Mensual Oficial (Bs./mes)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={config.dues?.monthlyDueBob || 50}
                  onChange={(e) => {
                    const bob = parseFloat(e.target.value) || 0
                    setConfig({
                      ...config,
                      dues: {
                        ...config.dues,
                        monthlyDueBob: bob,
                        monthlyDueCents: Math.round(bob * 100),
                      },
                    })
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-sm font-bold text-[#064e3b]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Recargo por Mora (%)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={config.dues?.lateFeePercentage || 10}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      dues: {
                        ...config.dues,
                        lateFeePercentage: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Días de Gracia sin Recargo</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={config.dues?.gracePeriodDays || 10}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      dues: {
                        ...config.dues,
                        gracePeriodDays: parseInt(e.target.value, 10) || 0,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* 6. SECCIÓN: IMPRESIÓN Y TICKETS */}
        {activeSection === 'printing' && (
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 border-b pb-2">
              Opciones de Impresión Térmica ESC/POS
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.printing?.cutPaper ?? true}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      printing: { ...config.printing, cutPaper: e.target.checked },
                    })
                  }
                  className="w-4 h-4 rounded text-[#064e3b]"
                />
                <div>
                  <p className="font-bold text-slate-800">Corte Automático de Papel (GS V 66 0)</p>
                  <p className="text-[11px] text-slate-500">Comando ESC/POS enviado al final de cada boleta térmica.</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.printing?.openDrawer ?? true}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      printing: { ...config.printing, openDrawer: e.target.checked },
                    })
                  }
                  className="w-4 h-4 rounded text-[#064e3b]"
                />
                <div>
                  <p className="font-bold text-slate-800">Apertura de Gaveta de Dinero (ESC p 0)</p>
                  <p className="text-[11px] text-slate-500">Pulso automático para gavetas RJ11/RJ12 conectadas a la impresora.</p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Botón de Guardado Inferior */}
        <div className="pt-4 border-t flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-white rounded-xl text-xs font-bold shadow"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Guardando...' : 'Guardar Configuración Oficial'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
