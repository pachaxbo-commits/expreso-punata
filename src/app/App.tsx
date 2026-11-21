import { isOperationalAdmin } from '../modules/auth/operationalRoles'
import { AffiliatePassengerTicketsView } from '../modules/tickets/AffiliatePassengerTicketsView'
import { BranchCommissionView } from '../modules/dispatch/BranchCommissionView'
import { AffiliateShipmentsView } from '../modules/shipments/AffiliateShipmentsView'
import { DailyOperationsView } from '../modules/reports/DailyOperationsView'
import { isPublicDemo } from '../firebase/config'
import React, { lazy, Suspense, useState, useEffect } from 'react'
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
  BookOpen,
  UserCircle,
  AlertTriangle,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Ticket,
} from 'lucide-react'
import {
  useTutorial,
  TutorialCenterModal,
  TutorialOverlayCard,
  TutorialTransitionToast,
  TutorialCompletionModal,
  type TutorialSection,
} from '../modules/tutorial'
import { AuthProvider, useAuth } from '../modules/auth/AuthContext'
import { LoginView } from '../modules/auth/LoginView'
import { DemoView } from '../modules/demo/DemoView'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY, INITIAL_BRANCHES } from '../domain/expresoPunataConfig'
import { FixedAssetsView } from '../modules/assets/FixedAssetsView'
import { WorkersAndExpensesView } from '../modules/workers/WorkersAndExpensesView'
import { UnionMembersView } from '../modules/union/UnionMembersView.tsx'
import { AffiliateAccountView } from '../modules/union/AffiliateAccountView.tsx'
import { subscribeShipmentsByBranch } from '../services/shipmentService'
import { isEmulatedEnvironment } from '../firebase/config'
import { ShipmentCustody } from '../modules/shipments/ShipmentCustody'
import { ShipmentsManagementView } from '../modules/shipments/ShipmentsManagementView'
import { NewShipmentWizardModal } from '../modules/shipments/NewShipmentWizardModal'
import { ShipmentDeliveryModal } from '../modules/shipments/ShipmentDeliveryModal'
import { CashManagementView, CounterCashShift } from '../modules/cash/CashManagementView'
import { DispatchManifestView } from '../modules/dispatch/DispatchManifestView'
import { StorageManagementView } from '../modules/storage/StorageManagementView'
import { UserManagementView } from '../modules/users/UserManagementView'
import { UserProfileModal } from '../modules/users/UserProfileModal'
import { PrinterSettingsView } from '../modules/admin/printers/PrinterSettingsView'
import { DriverCommissionsView } from '../modules/dispatch/DriverCommissionsView'
import { PassengerTicketsView } from '../modules/tickets/PassengerTicketsView'
import { ConsumablesManagementView } from '../modules/assets/ConsumablesManagementView'
import { PhysicalInventoryDocumentsView } from '../modules/assets/PhysicalInventoryDocumentsView'
import { SystemConfigView } from '../modules/admin/SystemConfigView'
import type { Shipment } from '../types'

const ReportsManagementView = lazy(() => import('../modules/reports/ReportsManagementView.tsx').then((module) => ({ default: module.ReportsManagementView })))

interface MainDashboardProps {
  userProfile: NonNullable<ReturnType<typeof useAuth>['userProfile']>
}

export const MainDashboard: React.FC<MainDashboardProps> = ({ userProfile }) => {
  const { signOut, currentBranchId, switchBranch, hasRole } = useAuth()
  const simpleTransferEnabled = import.meta.env.VITE_SIMPLE_SHIPMENT_TRANSFER === 'true'
  const advancedContingency = import.meta.env.VITE_ADVANCED_DISPATCH === 'true'
  const advancedDispatchVisible = !simpleTransferEnabled || (advancedContingency && isOperationalAdmin(userProfile))
  const [counterDispatchOpen, setCounterDispatchOpen] = useState(false)
  const [requestedTab, setActiveTab] = useState(() => (userProfile.role === 'conductor' ? (simpleTransferEnabled ? 'shipment-custody' : 'manifests') : 'shipments'))
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('expreso-sidebar-collapsed') === 'true' } catch { return false }
  })
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [configSubTab, setConfigSubTab] = useState<'users' | 'general' | 'tariffs' | 'printers'>('users')
  const [manifestSubTab, setManifestSubTab] = useState<'manifests' | 'commisiones'>('manifests')
  const [assetSubTab, setAssetSubTab] = useState<'fixed' | 'documents' | 'consumables'>('fixed')
  const [unionTutorialSubTab, setUnionTutorialSubTab] = useState('members')
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [shipmentTutorialStep, setShipmentTutorialStep] = useState<number | null>(null)
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false)
  const [deliveryTargetShipment, setDeliveryTargetShipment] = useState<Shipment | null>(null)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [ticketTutorialContextOpen, setTicketTutorialContextOpen] = useState(false)
  const [realShipments, setRealShipments] = useState<Shipment[]>([])
  const [backendConnected, setBackendConnected] = useState(true)
  const canReadShipments = hasRole(['secretaria', 'encargado_agencia', 'directiva_admin'])

  // Orquestador de Capacitación y Tutoriales Interactivos
  const tutorial = useTutorial({
    scope: {
      role: userProfile.role,
      uid: userProfile.uid,
      primaryBranchId: userProfile.primaryBranchId,
    },
    simplifiedTransfer: !advancedDispatchVisible,
    onNavigateToTab: (tabId) => { if (tabs.some(tab => tab.id === tabId)) setActiveTab(tabId) },
    onSetSubTab: (module, subTabId) => {
      if (module === 'manifests') setManifestSubTab(subTabId as any)
      if (module === 'assets') setAssetSubTab(subTabId as any)
      if (module === 'config') setConfigSubTab(subTabId as any)
      if (module === 'dues') setUnionTutorialSubTab(subTabId)
    },
    onOpenModalContext: (modalId, wizardStep) => {
      if (modalId === 'shipment-new') {
        setActiveTab('shipments')
        setIsWizardOpen(true)
        setShipmentTutorialStep(wizardStep ?? null)
      }
      if (modalId === 'ticket-new') {
        setActiveTab('tickets')
        setTicketTutorialContextOpen(true)
      }
    },
    onCloseModalContext: (modalId) => {
      if (modalId === 'shipment-new') {
        setIsWizardOpen(false)
        setShipmentTutorialStep(null)
      }
      if (modalId === 'ticket-new') setTicketTutorialContextOpen(false)
    },
    onSetNavigationContext: (open) => setIsMobileNavOpen(open && window.innerWidth < 768),
  })

  // Suscripción reactiva a encomiendas en Firestore Emulator por sucursal
  useEffect(() => {
    if (!canReadShipments) {
      setRealShipments([])
      setBackendConnected(true)
      return
    }
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
  }, [canReadShipments, currentBranchId])







  const currentBranch = INITIAL_BRANCHES.find(b => b.id === currentBranchId) || INITIAL_BRANCHES[0]

  const selectableBranches = INITIAL_BRANCHES.filter(b => {
    if (isOperationalAdmin(userProfile)) return true
    if (Array.isArray(userProfile?.allowedBranchIds) && userProfile.allowedBranchIds.includes(b.id)) return true
    return b.id === userProfile?.primaryBranchId
  })

  // Pestañas filtradas por rol del usuario (RBAC en interfaz)
  const tabs = [
    { id: 'shipment-custody', label: 'Encomiendas asignadas', icon: Package, visible: simpleTransferEnabled && userProfile.role === 'conductor' },
    { id: 'tickets', label: userProfile.role === 'conductor' ? 'Validar pasajes' : 'Pasajes', icon: Ticket, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin', 'tesoreria', 'conductor']) },
    { id: 'shipments', label: 'Encomiendas', icon: Package, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'storage', label: 'Módulos de Almacén', icon: Boxes, visible: hasRole(['secretaria', 'encargado_agencia', 'directiva_admin']) },
    { id: 'manifests', label: 'Despachos y Ruta', icon: Truck, visible: advancedDispatchVisible && hasRole(['secretaria', 'encargado_agencia', 'directiva_admin', 'conductor']) },
    { id: 'branch-commissions', label: 'Devengos de la agencia', icon: Coins, visible: userProfile.role === 'afiliado_admin' && !isOperationalAdmin(userProfile) && userProfile.commissionAdministrationApproved === true },
    { id: 'commissions', label: 'Comisiones de conductores', icon: Coins, visible: simpleTransferEnabled && hasRole(['directiva_admin']) },
    { id: 'cash', label: 'Caja del Turno', icon: Wallet, visible: hasRole(['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin']) },
    { id: 'dues', label: 'Afiliados & Aportes', icon: Users, visible: hasRole(['secretaria', 'tesoreria', 'directiva_admin']) },
    { id: 'sports-fines', label: 'Multas', icon: AlertTriangle, visible: hasRole(['secretaria']) },
    { id: 'affiliate-tickets', label: 'Consulta de pasajes', icon: Ticket, visible: userProfile.role === 'afiliado' },
    { id: 'affiliate-shipments', label: 'Consulta de encomiendas', icon: Package, visible: userProfile.role === 'afiliado' },
    { id: 'my-account', label: 'Mi cuenta', icon: UserCircle, visible: hasRole(['afiliado']) },
    { id: 'workers', label: 'Personal & Gastos', icon: Briefcase, visible: hasRole(['directiva_admin', 'tesoreria', 'encargado_agencia']) },
    { id: 'assets', label: 'Inventario / Bienes Fijos', icon: Building2, visible: hasRole(['encargado_agencia', 'directiva_admin', 'tesoreria']) },
    { id: 'reports', label: userProfile.role === 'secretaria' ? 'Reporte del día' : 'Reportes & Estadísticas', icon: BarChart3, visible: hasRole(['secretaria', 'encargado_agencia', 'tesoreria', 'directiva_admin', 'conductor']) },
    { id: 'config', label: 'Configuración', icon: Settings, visible: hasRole(['directiva_admin']) },
  ].filter(t => t.visible && (userProfile.role !== 'secretaria' ||
    ['shipments', 'tickets', 'storage', 'reports'].includes(t.id)))

  const activeTab = tabs.some(tab => tab.id === requestedTab) ? requestedTab : tabs[0]?.id

  useEffect(() => {
    try { window.localStorage.setItem('expreso-sidebar-collapsed', String(isSidebarCollapsed)) } catch { /* La navegación sigue disponible si el almacenamiento está bloqueado. */ }
  }, [isSidebarCollapsed])

  // Encomiendas a listar (prioriza registros de Firestore Emulator)
  // En entorno Cloud o cuando el backend está conectado, mostramos exclusivamente datos reales de Firestore (0 si está vacío).
  // Los fixtures DEV_SHIPMENTS solo se usan si estamos en emulador local aislado y sin conexión.
  // Encomiendas oficiales en tiempo real desde Firestore
  const displayedShipments = realShipments



  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 flex flex-col text-slate-800">
      {/* Top Bar Institucional de Expreso Punata */}
      <header className="bg-[#064e3b] text-white shadow-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Logo y Nombre */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              data-tutorial-target="nav-mobile-toggle"
              aria-label="Abrir menú de navegación"
              aria-expanded={isMobileNavOpen}
              className="md:hidden min-h-11 min-w-11 rounded-lg border border-emerald-700 text-emerald-50 hover:bg-emerald-800 flex items-center justify-center"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <div data-tutorial-target="header-brand" className="flex items-center gap-3 min-w-0">
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
                </div>
                <p className="text-[11px] text-emerald-200 hidden sm:block">
                  'Servicio Interprovincial Punata - Cochabamba'
                </p>
              </div>
            </div>
          </div>

          {/* Sucursal, Rol, Tutorial y Usuario */}
          <div className="flex items-center gap-2 sm:gap-3 text-xs">
            {/* Indicador / Selector de Sucursal según rol (RBAC visual estricto) */}
            {userProfile?.role === 'conductor' ? (
              <div data-tutorial-target="header-branch-badge" className="flex items-center gap-1.5 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800 text-white font-medium">
                <Truck className="w-3.5 h-3.5 text-[#facc15]" />
                <span>Móvil {userProfile.assignedMobileNumber || '14'} (Ruta Interprovincial)</span>
              </div>
            ) : userProfile?.role === 'secretaria' ? (
              <div data-tutorial-target="header-branch-badge" className="flex items-center gap-1.5 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800 text-white font-medium">
                <MapPin className="w-3.5 h-3.5 text-[#facc15]" />
                <span>{currentBranch.name}</span>
              </div>
            ) : selectableBranches.length > 1 ? (
              <div data-tutorial-target="header-branch-badge" className="flex items-center gap-1.5 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800">
                <MapPin className="w-3.5 h-3.5 text-[#facc15]" />
                <select
                  value={currentBranchId}
                  onChange={e => switchBranch(e.target.value)}
                  className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
                >
                  {selectableBranches.map(b => (
                    <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div data-tutorial-target="header-branch-badge" className="flex items-center gap-1.5 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800 text-white font-medium">
                <MapPin className="w-3.5 h-3.5 text-[#facc15]" />
                <span>{currentBranch.name}</span>
              </div>
            )}

            {/* Botón Centro de Tutoriales */}
            <button
              type="button"
              onClick={tutorial.openTutorialCenter}
              data-tutorial-target="header-tutorial-btn"
              className="flex items-center gap-1.5 bg-[#facc15] hover:bg-yellow-400 text-[#064e3b] font-extrabold px-2.5 sm:px-3 py-1.5 rounded-lg shadow-sm transition text-xs cursor-pointer"
              title="Abrir Centro de Tutoriales y Capacitación"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#064e3b]" />
              <span className="hidden sm:inline">Tutorial</span>
            </button>

            {/* Botón Mi Perfil */}
            <button
              type="button"
              onClick={() => setIsProfileModalOpen(true)}
              data-tutorial-target="header-profile-btn"
              className="flex items-center gap-1.5 bg-emerald-950/70 hover:bg-emerald-900 px-2.5 py-1.5 rounded-lg border border-emerald-700 transition cursor-pointer"
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
            <span data-tutorial-target="header-user-badge" className="px-2.5 py-1 rounded-full font-bold uppercase text-[10px] tracking-wider bg-[#facc15] text-[#064e3b]">
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

      </header>

      {isMobileNavOpen && <button type="button" aria-label="Cerrar menú de navegación" onClick={() => setIsMobileNavOpen(false)} className="fixed inset-0 z-40 bg-slate-950/50 md:hidden" />}
      <div className="flex flex-1 min-w-0">
        <aside
          data-tutorial-target="nav-tabs-bar"
          aria-label="Navegación principal"
          className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-emerald-900 bg-[#064e3b] text-white shadow-xl transition-transform duration-150 md:sticky md:top-0 md:z-20 md:h-screen md:translate-x-0 md:shrink-0 md:shadow-none md:transition-none ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'} ${isSidebarCollapsed ? 'md:w-20' : 'md:w-64'}`}
        >
          <div data-tutorial-target="nav-menu-controls" className={`flex min-h-16 items-center border-b border-emerald-800 px-3 ${isSidebarCollapsed ? 'md:justify-center' : 'justify-between'}`}>
            {!isSidebarCollapsed && <span className="font-bold text-sm text-emerald-100 md:hidden">Navegación</span>}
            <span className={`hidden text-sm font-bold text-emerald-100 ${isSidebarCollapsed ? 'md:sr-only' : 'md:inline'}`}>Secciones</span>
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(value => !value)}
              data-tutorial-target="nav-desktop-toggle"
              aria-label={isSidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'}
              title={isSidebarCollapsed ? 'Expandir menú' : 'Contraer menú'}
              className="hidden min-h-11 min-w-11 items-center justify-center rounded-lg text-emerald-100 hover:bg-emerald-800 md:flex"
            >
              {isSidebarCollapsed ? <ChevronRight className="h-5 w-5" aria-hidden="true" /> : <ChevronLeft className="h-5 w-5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(false)}
              aria-label="Cerrar menú de navegación"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-emerald-100 hover:bg-emerald-800 md:hidden"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Secciones del sistema">
            {tabs.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveTab(tab.id); setIsMobileNavOpen(false) }}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                data-tutorial-target={isActive ? 'nav-current-item' : undefined}
                title={isSidebarCollapsed ? tab.label : undefined}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold ${isActive ? 'bg-[#facc15] text-[#064e3b] shadow-sm' : 'text-emerald-50 hover:bg-emerald-800'} ${isSidebarCollapsed ? 'md:justify-center md:px-2' : ''}`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className={isSidebarCollapsed ? 'md:sr-only' : ''}>{tab.label}</span>
              </button>
            })}
          </nav>
        </aside>

      {/* Contenido Principal */}
      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5">
        {/* Banner de Estado Operativo */}
        <div className="mb-5 bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">
                {currentBranch.name} ({currentBranch.code})
              </h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${backendConnected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {!canReadShipments ? 'Sesión activa' : backendConnected ? 'Operativa en tiempo real' : 'Backend desconectado — sin datos demo'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Operador activo: <span className="font-semibold text-slate-700">{userProfile.fullName}</span> — {canReadShipments
                ? backendConnected ? 'Conectado a Firestore' : 'Sin conexión a Firestore'
                : 'El menú muestra las funciones disponibles para tu perfil.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              {new Date().toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>

        {userProfile.role === 'secretaria' && ['shipments', 'tickets'].includes(activeTab) && (
          <CounterCashShift key={userProfile.uid + ':' + currentBranch.id} currentUser={userProfile} currentBranch={currentBranch} />
        )}

        {activeTab === 'shipments' && userProfile.role === 'secretaria' && !simpleTransferEnabled && (
          <section className="mb-4 rounded-xl border bg-white p-3">
            <button type="button" aria-expanded={counterDispatchOpen} onClick={() => setCounterDispatchOpen(open => !open)}
              className="rounded-lg border px-3 py-2 text-sm font-semibold text-emerald-900">
              {counterDispatchOpen ? 'Ocultar despacho por manifiesto' : 'Despacho por manifiesto'}
            </button>
            {counterDispatchOpen && <DispatchManifestView
              currentUser={userProfile} currentBranch={currentBranch} shipments={displayedShipments} />}
          </section>
        )}

        {/* PESTAÑA 1: ENCOMIENDAS (VENTANILLA DEFINITIVA REDISEÑADA) */}
        {activeTab === 'shipments' && (
          <ShipmentsManagementView
            simpleTransferEnabled={simpleTransferEnabled}
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
              tutorialStep={shipmentTutorialStep}
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
        {activeTab === 'shipment-custody' && simpleTransferEnabled && userProfile.role === 'conductor' && (
          <ShipmentCustody uid={userProfile.uid} includeLegacy={advancedContingency} />
        )}

        {activeTab === 'tickets' && (
          <PassengerTicketsView currentUser={userProfile} currentBranch={currentBranch} tutorialFormContextOpen={ticketTutorialContextOpen} />
        )}

        {activeTab === 'branch-commissions' && <BranchCommissionView key={currentBranch.id} branchId={currentBranch.id} />}
        {activeTab === 'commissions' && tabs.some(tab => tab.id === 'commissions') && (
          <DriverCommissionsView currentUser={userProfile} currentBranch={currentBranch} />
        )}
        {activeTab === 'manifests' && advancedDispatchVisible && (
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
            tutorialSubTab={unionTutorialSubTab}
          />
        )}

        {activeTab === 'sports-fines' && (
          <UnionMembersView
            currentUser={userProfile}
            currentBranch={currentBranch}
            sportsFineCollectionOnly
          />
        )}

        {activeTab === 'affiliate-tickets' && <AffiliatePassengerTicketsView key={currentBranch.id} branchId={currentBranch.id} />}
        {activeTab === 'affiliate-shipments' && <AffiliateShipmentsView key={currentBranch.id} branchId={currentBranch.id} />}
        {activeTab === 'my-account' && <AffiliateAccountView currentUser={userProfile} />}

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
                onClick={() => setAssetSubTab('documents')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-bold transition ${assetSubTab === 'documents' ? 'bg-[#064e3b] text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                <BookOpen className="w-4 h-4" />
                <span>Documentos físicos</span>
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
            ) : assetSubTab === 'documents' ? (
              <PhysicalInventoryDocumentsView userProfile={userProfile} />
            ) : (
              <ConsumablesManagementView
                currentUser={userProfile}
                currentBranch={currentBranch}
              />
            )}
          </div>
        )}

        {/* PESTAÑA: REPORTES Y ESTADÍSTICAS */}
        {activeTab === 'reports' && (userProfile.role === 'secretaria' ? (
          <DailyOperationsView key={currentBranch.id} branchId={currentBranch.id} branchName={currentBranch.name} />
        ) : (
          <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Cargando reportes…</div>}>
            <ReportsManagementView
              currentUser={userProfile}
              currentBranch={currentBranch}
            />
          </Suspense>
        ))}

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
      </div>

      {/* Modal Mi Perfil */}
      {isProfileModalOpen && (
        <UserProfileModal onClose={() => setIsProfileModalOpen(false)} />
      )}

      {/* Sistema de Tutoriales Guiados e Interactivos */}
      <TutorialCenterModal
        isOpen={tutorial.isCenterOpen}
        onClose={tutorial.closeTutorialCenter}
        sections={tutorial.roleSections}
        state={tutorial.state}
        userRole={userProfile.role}
        onStartContinuous={() => tutorial.startContinuous()}
        onStartSection={(secId, stepIdx) => tutorial.startSection(secId, stepIdx)}
        onResume={() => tutorial.resumeTutorial()}
        onReset={() => tutorial.resetTutorial()}
      />

      {tutorial.isTourActive && tutorial.activeSection && tutorial.currentStep && (
        <TutorialOverlayCard
          key={`${tutorial.activeSection.id}:${tutorial.currentStep.id}`}
          section={tutorial.activeSection}
          step={tutorial.currentStep}
          stepIndex={tutorial.currentStepIndex}
          totalSteps={tutorial.activeSection.steps.length}
          isContinuous={tutorial.state.isContinuousActive}
          onNext={tutorial.nextStep}
          onPrev={tutorial.prevStep}
          onPause={tutorial.pauseTutorial}
          onExit={tutorial.exitTutorial}
        />
      )}

      {tutorial.transitionState && (
        <TutorialTransitionToast
          transition={tutorial.transitionState}
          onContinueNow={tutorial.continueTransitionNow}
          onPause={tutorial.pauseTutorial}
        />
      )}

      <TutorialCompletionModal
        isOpen={tutorial.isCompletionModalOpen}
        onClose={() => tutorial.setIsCompletionModalOpen(false)}
        onRestart={() => {
          tutorial.setIsCompletionModalOpen(false)
          tutorial.startContinuous()
        }}
        completedSections={tutorial.roleSections.filter((s: TutorialSection) =>
          tutorial.state.completedSectionIds.includes(s.id)
        )}
        userRole={userProfile.role}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        <p>
          © 2026 {EXPRESO_PUNATA_COMPANY.name} — Sistema Independiente Desarrollado por PACHAX
        </p>
      </footer>
    </div>
  )
}

const AuthenticatedAppContent: React.FC = () => {
  const { userProfile, isInitializing, signOut } = useAuth()

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-white text-sm font-medium">Cargando sistema...</p>
      </div>
    )
  }

  if (!userProfile || userProfile.isActive === false) {
    return <LoginView />
  }

  if (userProfile.role === 'soporte_pachax') {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-bold">Soporte PACHAX</h1>
        <p>Sesión técnica activa. Las herramientas de soporte aún no están habilitadas.</p>
        <button type="button" onClick={() => void signOut()}>Cerrar sesión</button>
      </main>
    )
  }

  return <MainDashboard userProfile={userProfile} />
}

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
export default App

export const AppContent: React.FC = () => isPublicDemo ? <DemoView /> : <AuthenticatedAppContent />
