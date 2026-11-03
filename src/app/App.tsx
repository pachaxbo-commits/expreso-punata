import React, { useState, useEffect } from 'react'
import {
  Package,
  Truck,
  Coins,
  Boxes,
  Wallet,
  Users,
  Building2,
  Settings,
  LogOut,
  MapPin,
  Printer,
  Briefcase,
  BarChart3,
} from 'lucide-react'
import { AuthProvider, useAuth } from '../modules/auth/AuthContext'
import { LoginView } from '../modules/auth/LoginView'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY, INITIAL_BRANCHES } from '../domain/expresoPunataConfig'
import { DEV_SHIPMENTS } from '../fixtures/devFixtures'
import { FixedAssetsView } from '../modules/assets/FixedAssetsView'
import { ReportsManagementView } from '../modules/reports/ReportsManagementView.tsx'
import { WorkersAndExpensesView } from '../modules/workers/WorkersAndExpensesView'
import { UnionMembersView } from '../modules/union/UnionMembersView.tsx'
import { subscribeShipmentsByBranch } from '../services/shipmentService'
import { isEmulatedEnvironment } from '../firebase/config'
import { ShipmentsManagementView } from '../modules/shipments/ShipmentsManagementView'
import { NewShipmentWizardModal } from '../modules/shipments/NewShipmentWizardModal'
import { ShipmentDeliveryModal } from '../modules/shipments/ShipmentDeliveryModal'
import { CashManagementView } from '../modules/cash/CashManagementView'
import { DispatchManifestView } from '../modules/dispatch/DispatchManifestView'
import { StorageManagementView } from '../modules/storage/StorageManagementView'
import { UserManagementView } from '../modules/users/UserManagementView'
import { UserProfileModal } from '../modules/users/UserProfileModal'
import { PrinterSettingsView } from '../modules/admin/printers/PrinterSettingsView'
import { DriverCommissionsView } from '../modules/dispatch/DriverCommissionsView'
import { ConsumablesManagementView } from '../modules/assets/ConsumablesManagementView'
import { SystemConfigView } from '../modules/admin/SystemConfigView'
import type { Shipment } from '../types'

export const AppContent: React.FC = () => {
  const { userProfile, signOut, currentBranchId, setCurrentBranchId, hasRole } = useAuth()
  const [activeTab, setActiveTab] = useState('shipments')
  const [configSubTab, setConfigSubTab] = useState<'users' | 'general' | 'tariffs' | 'printers'>('users')
  const [manifestSubTab, setManifestSubTab] = useState<'manifests' | 'commisiones'>('manifests')
  const [assetSubTab, setAssetSubTab] = useState<'fixed' | 'consumables'>('fixed')
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false)
  const [deliveryTargetShipment, setDeliveryTargetShipment] = useState<Shipment | null>(null)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [realShipments, setRealShipments] = useState<Shipment[]>([])
  const [backendConnected, setBackendConnected] = useState(true)

  // Suscripción reactiva a encomiendas en Firestore Emulator por sucursal
  useEffect(() => {
    const unsubscribe = subscribeShipmentsByBranch(
      currentBranchId,
      (list) => {
        setRealShipments(list)
        setBackendConnected(true)
      },
      (err) => {
        console.warn('[App] Error al conectar con Firestore:', err)
        setBackendConnected(false)
      }
    )
    return () => unsubscribe()
  }, [currentBranchId])





  if (!userProfile || userProfile.isActive === false) {
    return <LoginView />
  }

  const currentBranch = INITIAL_BRANCHES.find(b => b.id === currentBranchId) || INITIAL_BRANCHES[0]

  // Pestañas filtradas por rol del usuario (RBAC en interfaz)
  const tabs = [
    { id: 'shipments', label: 'Encomiendas', icon: Package, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'storage', label: 'Módulos de Almacén', icon: Boxes, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'manifests', label: 'Despachos y Ruta', icon: Truck, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin', 'conductor']) },
    { id: 'cash', label: 'Caja del Turno', icon: Wallet, visible: hasRole(['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin']) },
    { id: 'dues', label: 'Socios & Aportes', icon: Users, visible: hasRole(['tesoreria', 'directiva_admin']) },
    { id: 'workers', label: 'Personal & Gastos', icon: Briefcase, visible: hasRole(['directiva_admin', 'tesoreria', 'encargado_agencia']) },
    { id: 'assets', label: 'Inventario / Bienes Fijos', icon: Building2, visible: hasRole(['encargado_agencia', 'directiva_admin', 'tesoreria']) },
    { id: 'reports', label: 'Reportes & Estadísticas', icon: BarChart3, visible: hasRole(['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin', 'conductor']) },
    { id: 'config', label: 'Configuración', icon: Settings, visible: hasRole(['directiva_admin']) },
  ].filter(t => t.visible)

  // Encomiendas a listar (prioriza registros de Firestore Emulator)
  // En entorno Cloud o cuando el backend está conectado, mostramos exclusivamente datos reales de Firestore (0 si está vacío).
  // Los fixtures DEV_SHIPMENTS solo se usan si estamos en emulador local aislado y sin conexión.
  const displayedShipments = backendConnected || !isEmulatedEnvironment ? realShipments : DEV_SHIPMENTS



  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-800">
      {/* Top Bar Institucional de Expreso Punata */}
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
                  {isEmulatedEnvironment ? 'EMULADOR LOCAL' : 'CLOUD DEV (expreso-punata-dev)'}
                </span>
              </div>
              <p className="text-[11px] text-emerald-200 hidden sm:block">
                'Servicio Interprovincial Punata - Cochabamba'
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

            {/* Botón Mi Perfil */}
            <button
              type="button"
              onClick={() => setIsProfileModalOpen(true)}
              className="flex items-center gap-1.5 bg-emerald-950/70 hover:bg-emerald-900 px-2.5 py-1.5 rounded-lg border border-emerald-700 transition"
              title="Ver mi perfil y opciones de seguridad"
            >
              <div className="w-5 h-5 rounded-full bg-[#facc15] text-[#064e3b] font-extrabold flex items-center justify-center text-[10px]">
                {userProfile.fullName ? userProfile.fullName.charAt(0).toUpperCase() : 'U'}
              </div>
              <span className="font-semibold text-white truncate max-w-[110px] hidden sm:inline">
                {userProfile.fullName.split(' ')[0]}
              </span>
            </button>

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
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${backendConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {backendConnected ? 'Operativa en tiempo real' : 'Modo local'}
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

        {/* PESTAÑA 1: ENCOMIENDAS (VENTANILLA DEFINITIVA REDISEÑADA) */}
        {activeTab === 'shipments' && (
          <ShipmentsManagementView
            shipments={displayedShipments}
            currentUser={userProfile}
            currentBranch={currentBranch}
            onOpenNewWizard={() => setIsWizardOpen(true)}
            onOpenDeliveryModal={(target) => {
              setDeliveryTargetShipment(target || null)
              setIsDeliveryModalOpen(true)
            }}
            onShipmentUpdated={(updated) => {
              setRealShipments(prev => prev.map(s => s.id === updated.id ? updated : s))
            }}
            backendConnected={backendConnected}
            isCloudEnvironment={!isEmulatedEnvironment}
          />
        )}

            {/* Modal de Asistente de Nueva Encomienda */}
            <NewShipmentWizardModal
              isOpen={isWizardOpen}
              onClose={() => setIsWizardOpen(false)}
              onSuccess={() => {
                // La lista se actualiza automáticamente gracias a onSnapshot
              }}
              existingShipments={displayedShipments}
            />

            {/* Modal de Entrega de Encomienda */}
            <ShipmentDeliveryModal
              isOpen={isDeliveryModalOpen}
              onClose={() => {
                setIsDeliveryModalOpen(false)
                setDeliveryTargetShipment(null)
              }}
              onSuccess={(updated) => {
                setRealShipments(prev => prev.map(s => s.id === updated.id ? updated : s))
              }}
              currentUser={userProfile}
              currentBranch={currentBranch}
              initialShipment={deliveryTargetShipment}
              availableShipments={displayedShipments}
            />

        {/* PESTAÑA 2: MÓDULOS DE ALMACÉN */}
        {activeTab === 'storage' && (
          <StorageManagementView
            currentUser={userProfile}
            currentBranch={currentBranch}
            shipments={displayedShipments}
          />
        )}

        {/* PESTAÑA 3: DESPACHOS Y RUTA */}
        {activeTab === 'manifests' && (
          <div className="space-y-4">
            <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => setManifestSubTab('manifests')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  manifestSubTab === 'manifests'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Truck className="w-4 h-4" />
                <span>Manifiestos y Despacho</span>
              </button>
              <button
                type="button"
                onClick={() => setManifestSubTab('commisiones')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  manifestSubTab === 'commisiones'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Coins className="w-4 h-4" />
                <span>Comisiones de Choferes</span>
              </button>
            </div>

            {manifestSubTab === 'manifests' ? (
              <DispatchManifestView
                currentUser={userProfile}
                currentBranch={currentBranch}
                shipments={displayedShipments}
              />
            ) : (
              <DriverCommissionsView
                currentUser={userProfile}
                currentBranch={currentBranch}
              />
            )}
          </div>
        )}

        {/* PESTAÑA 4: CAJA DEL TURNO */}
        {activeTab === 'cash' && (
          <CashManagementView
            currentUser={userProfile}
            currentBranch={currentBranch}
            onNavigateToShipments={() => setActiveTab('shipments')}
          />
        )}

        {/* PESTAÑA 5: MENSUALIDADES Y SOCIOS (PADRÓN REAL Y COBROS) */}
        {activeTab === 'dues' && (
          <UnionMembersView
            currentUser={userProfile}
            currentBranch={currentBranch}
          />
        )}

        {/* PESTAÑA: PERSONAL & GASTOS OPERATIVOS */}
        {activeTab === 'workers' && (
          <WorkersAndExpensesView
            currentBranchId={currentBranchId}
            userProfile={userProfile}
          />
        )}

        {/* PESTAÑA: BIENES FIJOS (INVENTARIO REAL) */}
        {activeTab === 'assets' && (
          <div className="space-y-4">
            <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => setAssetSubTab('fixed')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  assetSubTab === 'fixed'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Bienes Fijos (Activos)</span>
              </button>
              <button
                type="button"
                onClick={() => setAssetSubTab('consumables')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  assetSubTab === 'consumables'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Boxes className="w-4 h-4" />
                <span>Consumibles e Insumos</span>
              </button>
            </div>

            {assetSubTab === 'fixed' ? (
              <FixedAssetsView
                currentBranchId={currentBranchId}
                userProfile={userProfile}
              />
            ) : (
              <ConsumablesManagementView
                currentUser={userProfile}
                currentBranch={currentBranch}
              />
            )}
          </div>
        )}

        {/* PESTAÑA: REPORTES Y ESTADÍSTICAS */}
        {activeTab === 'reports' && (
          <ReportsManagementView
            currentUser={userProfile}
            currentBranch={currentBranch}
          />
        )}

        {/* PESTAÑA 7: CONFIGURACIÓN Y ADMINISTRACIÓN */}
        {activeTab === 'config' && (
          <div className="space-y-4">
            {/* Sub-navegación de Configuración */}
            <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => setConfigSubTab('users')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  configSubTab === 'users'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Usuarios y Permisos</span>
              </button>

              <button
                type="button"
                onClick={() => setConfigSubTab('general')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  configSubTab === 'general'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>General</span>
              </button>

              <button
                type="button"
                onClick={() => setConfigSubTab('tariffs')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  configSubTab === 'tariffs'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Wallet className="w-4 h-4" />
                <span>Tarifas</span>
              </button>

              <button
                type="button"
                onClick={() => setConfigSubTab('printers')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${
                  configSubTab === 'printers'
                    ? 'bg-[#064e3b] text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Printer className="w-4 h-4" />
                <span>Impresoras y Tickets</span>
              </button>
            </div>

            {/* Contenido de cada subpestaña */}
            {configSubTab === 'users' && <UserManagementView />}

            {(configSubTab === 'general' || configSubTab === 'tariffs') && (
              <SystemConfigView currentUser={userProfile} />
            )}

            {configSubTab === 'printers' && (
              <PrinterSettingsView
                currentBranchId={currentBranchId}
                operatorName={userProfile.fullName || 'Operador'}
              />
            )}
          </div>
        )}
      </main>

      {/* Modal Mi Perfil */}
      {isProfileModalOpen && (
        <UserProfileModal onClose={() => setIsProfileModalOpen(false)} />
      )}

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
