import React, { useState } from 'react'
import {
  Package,
  Truck,
  Boxes,
  Wallet,
  Users,
  Building2,
  Settings,
  LogOut,
  Search,
  Plus,
  Printer,
  MapPin,
} from 'lucide-react'
import { AuthProvider, useAuth } from '../modules/auth/AuthContext'
import { LoginView } from '../modules/auth/LoginView'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY, INITIAL_BRANCHES } from '../domain/expresoPunataConfig'
import { DEV_SHIPMENTS, DEV_ASSETS, DEV_MEMBERS } from '../fixtures/devFixtures'
import { formatCurrencyBob } from '../domain/parcelEngine'

export const AppContent: React.FC = () => {
  const { userProfile, signOut, currentBranchId, setCurrentBranchId, hasRole } = useAuth()
  const [activeTab, setActiveTab] = useState('shipments')
  const [searchTerm, setSearchTerm] = useState('')

  if (!userProfile) {
    return <LoginView />
  }

  const currentBranch = INITIAL_BRANCHES.find(b => b.id === currentBranchId) || INITIAL_BRANCHES[0]

  // Pestañas filtradas por rol del usuario (RBAC en interfaz)
  const tabs = [
    { id: 'shipments', label: 'Encomiendas', icon: Package, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'storage', label: 'Módulos de Almacén', icon: Boxes, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'manifests', label: 'Despachos y Ruta', icon: Truck, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin', 'conductor']) },
    { id: 'cash', label: 'Caja del Turno', icon: Wallet, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'dues', label: 'Mensualidades & Socios', icon: Users, visible: hasRole(['tesoreria', 'directiva_admin']) },
    { id: 'assets', label: 'Inventario / Bienes Fijos', icon: Building2, visible: hasRole(['encargado_agencia', 'directiva_admin', 'tesoreria']) },
    { id: 'config', label: 'Configuración', icon: Settings, visible: hasRole(['directiva_admin']) },
  ].filter(t => t.visible)

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-800">
      {/* Top Bar Institucional de S.M.T. Expreso Punata */}
      <header className="bg-[#064e3b] text-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Logo y Nombre */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-white rounded-full p-1 shadow flex items-center justify-center shrink-0">
              <img
                src={EXPRESO_PUNATA_LOGO_PATH}
                alt="Logo Expreso Punata"
                className="w-full h-full object-contain rounded-full"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base tracking-tight text-[#facc15] uppercase">
                  {EXPRESO_PUNATA_COMPANY.name}
                </span>
                <span className="text-[10px] bg-emerald-950/80 text-emerald-300 px-2 py-0.5 rounded border border-emerald-700/60 font-mono">
                  CLOUD PROD-READY
                </span>
              </div>
              <p className="text-[11px] text-emerald-200 hidden sm:block">
                {EXPRESO_PUNATA_COMPANY.slogan}
              </p>
            </div>
          </div>

          {/* Sucursal, Rol y Usuario */}
          <div className="flex items-center gap-2 sm:gap-3 text-xs">
            {/* Selector de Sucursal */}
            <div className="flex items-center gap-1.5 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800">
              <MapPin className="w-3.5 h-3.5 text-[#facc15]" />
              <select
                value={currentBranchId}
                onChange={e => setCurrentBranchId(e.target.value)}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
                disabled={!hasRole(['directiva_admin', 'tesoreria'])}
              >
                {INITIAL_BRANCHES.map(b => (
                  <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Badge de Rol */}
            <span className="px-2.5 py-1 rounded-full font-bold uppercase text-[10px] tracking-wider bg-[#facc15] text-[#064e3b]">
              {userProfile.role.replace('_', ' ')}
            </span>

            {/* Cerrar Sesión */}
            <button
              onClick={() => signOut()}
              title="Cerrar Sesión"
              className="p-1.5 hover:bg-emerald-800 rounded-lg text-emerald-200 hover:text-white transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de navegación de pestañas con scroll táctil horizontal */}
        <div className="bg-[#053d2e] border-t border-emerald-800/60">
          <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto scroll-smooth gap-1 py-1">
            {tabs.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                    isActive
                      ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                      : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="max-w-7xl mx-auto px-4 py-5 flex-1 w-full">
        {/* Banner de Estado Operativo */}
        <div className="mb-5 bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">
                {currentBranch.name} ({currentBranch.code})
              </h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
                Operativa en tiempo real
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Operador activo: <span className="font-semibold text-slate-700">{userProfile.fullName}</span> — Conectado a Backend Firebase
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              {new Date().toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* PESTAÑA 1: ENCOMIENDAS */}
        {activeTab === 'shipments' && (
          <div className="space-y-4">
            {/* Acciones Rápidas */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Buscar por guía (PUN-2026-...), remitente, destinatario o teléfono..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>
              <button
                type="button"
                className="px-4 py-2 bg-[#064e3b] hover:bg-[#065f46] text-white text-xs font-bold rounded-lg shadow flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Nueva Encomienda (Paso a Paso)</span>
              </button>
            </div>

            {/* Listado de Encomiendas de Muestra */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Envíos Registrados ({DEV_SHIPMENTS.length})
                </span>
                <span className="text-[11px] text-slate-500">
                  Mostrando datos de desarrollo
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {DEV_SHIPMENTS.map(s => (
                  <div key={s.id} className="p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[#064e3b]">
                          {s.trackingCode}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600">
                          {s.originCity} → {s.destinationCity}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800">
                          {s.status}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">De:</span> {s.sender.name} ({s.sender.phone})
                        <span className="mx-2 text-slate-300">|</span>
                        <span className="font-semibold text-slate-800">Para:</span> {s.recipient.name} ({s.recipient.phone})
                      </div>

                      {s.storageLocation && (
                        <div className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                          <Boxes className="w-3 h-3 text-[#064e3b]" />
                          Ubicación física: {s.storageLocation.shelfId} / {s.storageLocation.moduleId}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                      <div className="text-right">
                        <div className="font-bold text-sm text-[#064e3b]">
                          {formatCurrencyBob(s.finalAmountBob)}
                        </div>
                        <div className="text-[10px] uppercase font-semibold text-slate-500">
                          {s.paymentTiming === 'origin_paid' ? 'Pagado en Origen' : 'Contraentrega'}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="p-2 border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600"
                        title="Imprimir Comprobante"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA 2: MÓDULOS DE ALMACÉN */}
        {activeTab === 'storage' && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 mb-1">
                Almacenamiento Físico en Destino — {currentBranch.name}
              </h3>
              <p className="text-xs text-slate-500">
                Estructura por estantes y módulos para localización inmediata de encomiendas llegadas.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {['ESTANTE-A', 'ESTANTE-B', 'ESTANTE-C'].map(shelf => (
                <div key={shelf} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
                    <span className="font-bold text-xs text-[#064e3b] uppercase tracking-wide">
                      {shelf}
                    </span>
                    <span className="text-[10px] text-slate-500">5 Módulos</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map(num => (
                      <div
                        key={num}
                        className="p-2.5 rounded-lg border border-slate-200 text-center bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 transition-colors cursor-pointer"
                      >
                        <span className="block text-[10px] text-slate-500 font-mono">M-{num}</span>
                        <span className="block text-xs font-bold text-slate-700">0</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PESTAÑA 6: BIENES FIJOS */}
        {activeTab === 'assets' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Inventario de Bienes Fijos del Sindicato
                </h3>
                <p className="text-xs text-slate-500">
                  Control de muebles, computadoras, impresoras y herramientas.
                </p>
              </div>
              <button
                type="button"
                className="px-3.5 py-2 bg-[#064e3b] text-white text-xs font-bold rounded-lg shadow flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar Bien</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DEV_ASSETS.map(a => (
                <div key={a.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[#064e3b]">
                      {a.assetCode}
                    </span>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      {a.status.replace('_', ' ')}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-800">{a.name}</h4>
                  <p className="text-[11px] text-slate-500">{a.description}</p>
                  <div className="text-[11px] text-slate-600 border-t border-slate-100 pt-2 flex items-center justify-between">
                    <span>Ubicación: <strong className="text-slate-700">{a.physicalLocation}</strong></span>
                    <span>Resp: <strong className="text-slate-700">{a.responsiblePersonName}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PESTAÑA 5: MENSUALIDADES Y SOCIOS */}
        {activeTab === 'dues' && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800">
                Padrón de Socios y Mensualidades Sindicales
              </h3>
              <p className="text-xs text-slate-500">
                Administración de cuotas de socios propietarios y choferes afiliados.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
              {DEV_MEMBERS.map(m => (
                <div key={m.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#064e3b] bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {m.memberNumber}
                      </span>
                      <span className="text-xs font-bold text-slate-800">{m.fullName}</span>
                      {m.assignedMobileNumber && (
                        <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded">
                          {m.assignedMobileNumber} ({m.vehiclePlate})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      CI: {m.ci} — Tel: {m.phone}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-bold text-[#064e3b] block">
                      {formatCurrencyBob(m.monthlyFeeBob)} / mes
                    </span>
                    <button
                      type="button"
                      className="text-[11px] text-emerald-700 font-bold hover:underline"
                    >
                      Ver Estado de Cuenta
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        <p>
          © 2026 {EXPRESO_PUNATA_COMPANY.name} — Sistema Independiente Desarrollado por PACHAX
        </p>
      </footer>
    </div>
  )
}

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
export default App
