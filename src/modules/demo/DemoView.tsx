import React, { useState } from 'react'
import {
  Package,
  Truck,
  Coins,
  Boxes,
  Users,
  Building2,
  Settings,
  RotateCcw,
  Sparkles,
  BookOpen,
  MapPin,
  Briefcase,
} from 'lucide-react'
import { DemoTransfer } from './DemoTransfer'
import { useDemoState } from './useDemoState'
import { DemoRoleSwitcherModal } from './DemoRoleSwitcherModal'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY, INITIAL_BRANCHES } from '../../domain/expresoPunataConfig'
import { ShipmentsManagementView } from '../shipments/ShipmentsManagementView'
import { NewShipmentWizardModal } from '../shipments/NewShipmentWizardModal'
import { ShipmentDeliveryModal } from '../shipments/ShipmentDeliveryModal'
import { CashManagementView } from '../cash/CashManagementView'
import { DispatchManifestView } from '../dispatch/DispatchManifestView'
import { DriverCommissionsView } from '../dispatch/DriverCommissionsView'
import { StorageManagementView } from '../storage/StorageManagementView'
import { UnionMembersView } from '../union/UnionMembersView'
import { WorkersAndExpensesView } from '../workers/WorkersAndExpensesView'
import { FixedAssetsView } from '../assets/FixedAssetsView'
import { ConsumablesManagementView } from '../assets/ConsumablesManagementView'
import { ReportsManagementView } from '../reports/ReportsManagementView'
import { SystemConfigView } from '../admin/SystemConfigView'
import { UserManagementView } from '../users/UserManagementView'
import { PrinterSettingsView } from '../admin/printers/PrinterSettingsView'
import {
  useTutorial,
  TutorialCenterModal,
  TutorialOverlayCard,
  TutorialTransitionToast,
  TutorialCompletionModal,
} from '../tutorial'
import type { Shipment, Branch } from '../../types'
import type { TutorialSection } from '../tutorial/types'

export const DemoView: React.FC = () => {
  const {
    currentRoleId,
    currentProfile,
    demoUserProfile,
    currentBranchId,
    shipments,
    cashShift,
    switchRole,
    switchBranch,
    addShipment,
    updateShipment,
    deliverShipment,
    resetDemo,
  } = useDemoState()

  const [activeTab, setActiveTab] = useState<string>('shipments')
  const [configSubTab, setConfigSubTab] = useState<'users' | 'general' | 'tariffs' | 'printers'>('users')
  const [manifestSubTab, setManifestSubTab] = useState<'manifests' | 'commisiones'>('manifests')
  const [assetSubTab, setAssetSubTab] = useState<'fixed' | 'consumables'>('fixed')

  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState<Shipment | undefined>(undefined)
  const [notificationToast, setNotificationToast] = useState<string | null>(null)

  // Tutorial orquestado sobre el usuario demo
  const tutorial = useTutorial({
    scope: {
      role: demoUserProfile.role,
      uid: demoUserProfile.uid,
      primaryBranchId: currentBranchId,
    },
    onNavigateToTab: (tabId) => { if (tabId === 'shipment-custody' && demoUserProfile.role === 'conductor') setActiveTab('shipments'); else if (canAccess(tabId)) setActiveTab(tabId) },
    simplifiedTransfer: true,
    onSetSubTab: (module, subTabId) => {
      if (module === 'manifests') setManifestSubTab(subTabId as any)
      if (module === 'assets') setAssetSubTab(subTabId as any)
      if (module === 'config') setConfigSubTab(subTabId as any)
    },
  })

  const currentBranch: Branch = INITIAL_BRANCHES.find(b => b.id === currentBranchId) || INITIAL_BRANCHES[0]

  const showToast = (msg: string) => {
    setNotificationToast(msg)
    window.setTimeout(() => setNotificationToast(null), 3500)
  }

  // Comprobar permisos del rol en demo
  const canAccess = (tab: string) => {
    if (tab === 'manifests') return false
    if (demoUserProfile.role === 'directiva_admin') return true
    if (demoUserProfile.role === 'encargado_agencia') return tab !== 'config'
    if (demoUserProfile.role === 'secretaria') return ['shipments', 'cash', 'storage', 'printers'].includes(tab)
    if (demoUserProfile.role === 'conductor') return ['shipments', 'commissions'].includes(tab)
    return false
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* 1. BANNER DESTACADO DE MODO DEMOSTRACIÓN */}
      <div className="bg-amber-100 text-amber-950 px-4 py-1.5 border-b border-amber-200 flex items-center justify-between gap-2 z-50 text-xs">
        <span className="font-semibold whitespace-nowrap">
          <span className="sm:hidden">Demo</span>
          <span className="hidden sm:inline">Modo demostración · datos simulados</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsRoleModalOpen(true)}
            title={`Cambiar perfil simulado (${currentProfile.title})`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white hover:bg-amber-50 text-amber-950 border border-amber-300 rounded-lg text-xs font-bold transition cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Perfil:</span>
            <span className="max-w-[110px] truncate">{currentProfile.title}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (window.confirm('¿Deseas restaurar el conjunto inicial de datos demostrativos?')) {
                resetDemo()
                showToast('Demostración reiniciada a su estado inicial.')
              }
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold transition cursor-pointer"
            title="Restablecer datos demo"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reiniciar Demo</span>
          </button>
        </div>
      </div>

      {/* 2. CABECERA INSTITUCIONAL */}
      <header className="bg-[#064e3b] text-white border-b-4 border-[#facc15] sticky top-0 z-40 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            {/* Logo e Identidad */}
            <div data-tutorial-target="header-brand" className="flex items-center gap-3">
              <img
                src={EXPRESO_PUNATA_LOGO_PATH}
                alt="Logo Expreso Punata"
                className="w-11 h-11 object-contain rounded-full bg-white p-1 shadow"
              />
              <div>
                <h1 className="font-black text-lg leading-tight tracking-wide text-white">
                  {EXPRESO_PUNATA_COMPANY.name}
                </h1>
                <p className="text-[11px] text-emerald-200 hidden sm:block">
                  'Servicio Interprovincial Punata - Cochabamba'
                </p>
              </div>
            </div>

            {/* Acciones de Cabecera */}
            <div className="flex items-center gap-2 sm:gap-3 text-xs">
              {/* Selector de Sucursal para Administrador */}
              {demoUserProfile.role === 'directiva_admin' ? (
                <div data-tutorial-target="header-branch-select" className="flex items-center gap-1.5 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800">
                  <MapPin className="w-3.5 h-3.5 text-[#facc15]" />
                  <select
                    value={currentBranchId}
                    onChange={(e) => switchBranch(e.target.value)}
                    className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
                  >
                    {INITIAL_BRANCHES.map(b => (
                      <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                        {b.name} ({b.code})
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
                data-tutorial-target="header-btn-tutorial"
                onClick={tutorial.openTutorialCenter}
                className="flex items-center gap-1.5 bg-[#facc15] hover:bg-yellow-400 text-[#064e3b] font-extrabold px-2.5 py-1.5 rounded-lg shadow-sm transition text-xs cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tutorial</span>
              </button>

            </div>
          </div>
        {/* Barra de Navegación por Módulos */}
        <nav data-tutorial-target="header-nav-tabs" className="bg-[#053d2e] border-t border-emerald-800/60">
          <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto scroll-smooth gap-1 py-1">
            {canAccess('shipments') && (
              <button
                data-tutorial-target="nav-tab-shipments"
                onClick={() => setActiveTab('shipments')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'shipments'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Package className="w-4 h-4" />
                <span>Encomiendas (Ventanilla)</span>
              </button>
            )}

            {canAccess('cash') && (
              <button
                data-tutorial-target="nav-tab-cash"
                onClick={() => setActiveTab('cash')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'cash'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Coins className="w-4 h-4" />
                <span>Caja y Turnos</span>
              </button>
            )}

            {canAccess('manifests') && (
              <button
                data-tutorial-target="nav-tab-manifests"
                onClick={() => setActiveTab('manifests')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'manifests'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Truck className="w-4 h-4" />
                <span>Despacho y Planillas</span>
              </button>
            )}

            {canAccess('commissions') && (
              <button
                type="button"
                data-tutorial-target="nav-tab-commissions"
                onClick={() => setActiveTab('commissions')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'commissions'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Coins className="w-4 h-4" />
                <span>Comisiones de conductores</span>
              </button>
            )}
            {canAccess('storage') && (
              <button
                data-tutorial-target="nav-tab-storage"
                onClick={() => setActiveTab('storage')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'storage'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Boxes className="w-4 h-4" />
                <span>Almacén de Paquetes</span>
              </button>
            )}

            {canAccess('union') && (
              <button
                data-tutorial-target="nav-tab-union"
                onClick={() => setActiveTab('union')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'union'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Socios y Cuotas</span>
              </button>
            )}

            {canAccess('workers') && (
              <button
                onClick={() => setActiveTab('workers')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'workers'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                <span>Personal</span>
              </button>
            )}

            {canAccess('assets') && (
              <button
                onClick={() => setActiveTab('assets')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'assets'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Boxes className="w-4 h-4" />
                <span>Bienes Fijos</span>
              </button>
            )}

            {canAccess('reports') && (
              <button
                data-tutorial-target="nav-tab-reports"
                onClick={() => setActiveTab('reports')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'reports'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Reportes</span>
              </button>
            )}

            {canAccess('config') && (
              <button
                data-tutorial-target="nav-tab-config"
                onClick={() => setActiveTab('config')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  activeTab === 'config'
                    ? 'bg-[#facc15] text-[#064e3b] shadow font-bold'
                    : 'text-emerald-100 hover:bg-emerald-900/60 hover:text-white'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Configuración</span>
              </button>
            )}
          </div>
        </nav>
      </header>

      {/* TOAST DE FEEDBACK SIMULADO */}
      {notificationToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-emerald-500 flex items-center gap-2 animate-in slide-in-from-bottom duration-200">
          <Sparkles className="w-4 h-4 text-[#facc15]" />
          <span className="text-xs font-bold">{notificationToast}</span>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA */}
      <main className="max-w-7xl mx-auto px-4 py-5 flex-1 w-full">
        <div className="mb-5 bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-800">{currentBranch.name} ({currentBranch.code})</h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-900">
                Entorno de demostración · datos locales
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Perfil simulado: <span className="font-semibold text-slate-700">{demoUserProfile.fullName}</span>
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
            {new Date().toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        {activeTab === 'shipments' && demoUserProfile.role === 'conductor' && (
          <DemoTransfer
            key={currentRoleId + currentBranchId}
            shipments={shipments}
            user={demoUserProfile}
            branch={currentBranchId}
            onUpdate={updateShipment}
            onDeliver={shipment => { setDeliveryTarget(shipment); setIsDeliveryModalOpen(true) }}
          />
        )}
        {activeTab === 'shipments' && demoUserProfile.role !== 'conductor' && (
          <ShipmentsManagementView
            shipments={shipments}
            currentUser={demoUserProfile}
            currentBranch={currentBranch}
            onOpenNewWizard={() => setIsWizardOpen(true)}
            onOpenDeliveryModal={(target) => {
              setDeliveryTarget(target)
              setIsDeliveryModalOpen(true)
            }}
            onShipmentUpdated={(updated) => {
              showToast(`Encomienda ${updated.trackingCode} actualizada en demo.`)
            }}
            demoTransfer={{
              onUpdate: updateShipment,
              onDeliver: (shipment: Shipment) => { setDeliveryTarget(shipment); setIsDeliveryModalOpen(true) },
            }}
            backendConnected={true}
            isCloudEnvironment={false}
          />
        )}

        {activeTab === 'commissions' && canAccess('commissions') && (
          <section className="rounded-xl border bg-white p-4">
            <h2 className="font-bold">Comisiones de conductores</h2>
            <p>La demo de traslado usa guías simuladas y no liquida comisiones.</p>
          </section>
        )}
        {activeTab === 'cash' && (
          <CashManagementView
            currentUser={demoUserProfile}
            currentBranch={currentBranch}
            onNavigateToShipments={() => setActiveTab('shipments')}
          />
        )}

        {activeTab === 'manifests' && canAccess('manifests') && (
          <div className="space-y-4">
            <div className="flex gap-2 border-b border-slate-200 pb-2">
              <button
                onClick={() => setManifestSubTab('manifests')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  manifestSubTab === 'manifests' ? 'bg-[#064e3b] text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Planillas de Despacho
              </button>
              <button
                onClick={() => setManifestSubTab('commisiones')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  manifestSubTab === 'commisiones' ? 'bg-[#064e3b] text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Comisiones de Conductores
              </button>
            </div>

            {manifestSubTab === 'manifests' ? (
              <DispatchManifestView
                currentUser={demoUserProfile}
                currentBranch={currentBranch}
                shipments={shipments}
              />
            ) : (
              <DriverCommissionsView
                currentUser={demoUserProfile}
                currentBranch={currentBranch}
              />
            )}
          </div>
        )}

        {activeTab === 'storage' && (
          <StorageManagementView
            currentUser={demoUserProfile}
            currentBranch={currentBranch}
            shipments={shipments}
          />
        )}

        {activeTab === 'union' && (
          <UnionMembersView
            currentUser={demoUserProfile}
            currentBranch={currentBranch}
            activeShift={cashShift}
          />
        )}

        {activeTab === 'workers' && (
          <WorkersAndExpensesView
            currentBranchId={currentBranchId}
            userProfile={demoUserProfile}
          />
        )}

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
                userProfile={demoUserProfile}
              />
            ) : (
              <ConsumablesManagementView
                currentUser={demoUserProfile}
                currentBranch={currentBranch}
              />
            )}
          </div>
        )}

        {activeTab === 'reports' && (
          <ReportsManagementView
            currentUser={demoUserProfile}
            currentBranch={currentBranch}
          />
        )}

        {activeTab === 'config' && (
          <div className="space-y-4">
            <div className="flex gap-2 border-b border-slate-200 pb-2">
              <button
                onClick={() => setConfigSubTab('users')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  configSubTab === 'users' ? 'bg-[#064e3b] text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Usuarios y Roles
              </button>
              <button
                onClick={() => setConfigSubTab('general')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  configSubTab === 'general' ? 'bg-[#064e3b] text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Datos Comerciales
              </button>
              <button
                onClick={() => setConfigSubTab('tariffs')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  configSubTab === 'tariffs' ? 'bg-[#064e3b] text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Tarifas Oficiales
              </button>
              <button
                onClick={() => setConfigSubTab('printers')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  configSubTab === 'printers' ? 'bg-[#064e3b] text-white' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Impresoras Térmicas
              </button>
            </div>

            {configSubTab === 'users' && <UserManagementView />}
            {(configSubTab === 'general' || configSubTab === 'tariffs') && <SystemConfigView currentUser={demoUserProfile} />}
            {configSubTab === 'printers' && (
              <PrinterSettingsView currentBranchId={currentBranchId} operatorName={demoUserProfile.fullName} />
            )}
          </div>
        )}
      </main>

      {/* MODAL SIMULADO DE NUEVA ENCOMIENDA WIZARD */}
      {isWizardOpen && (
        <NewShipmentWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onSuccess={(created: Shipment) => {
            setIsWizardOpen(false)
            showToast(`¡Guía ${created.trackingCode} generada con éxito en modo DEMO!`)
          }}
          existingShipments={shipments}
          demo={{ branchId: currentBranchId, operator: demoUserProfile.fullName, register: addShipment }}
        />
      )}

      {/* MODAL SIMULADO DE ENTREGA CON FIRMA */}
      {isDeliveryModalOpen && (
        <ShipmentDeliveryModal
          isOpen={isDeliveryModalOpen}
          onClose={() => {
            setIsDeliveryModalOpen(false)
            setDeliveryTarget(undefined)
          }}
          onSuccess={() => {}}
          onDemoDelivery={(id, record) => {
            deliverShipment(id, record)
            setIsDeliveryModalOpen(false)
            setDeliveryTarget(undefined)
            showToast('Entrega registrada en modo DEMO.')
          }}
          currentUser={demoUserProfile}
          currentBranch={currentBranch}
          initialShipment={deliveryTarget || null}
          availableShipments={shipments}
        />
      )}

      {/* MODAL SELECTOR DE ROLES DEMO */}
      <DemoRoleSwitcherModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        currentRoleId={currentRoleId}
        onSelectRole={(newRoleId) => {
          switchRole(newRoleId)
          setActiveTab('shipments')
          showToast(`Cambiado a rol: ${newRoleId}`)
        }}
      />

      {/* SISTEMA DE TUTORIALES SOBRE DEMO */}
      <TutorialCenterModal
        isOpen={tutorial.isCenterOpen}
        onClose={tutorial.closeTutorialCenter}
        sections={tutorial.roleSections}
        state={tutorial.state}
        userRole={demoUserProfile.role}
        onStartContinuous={() => tutorial.startContinuous()}
        onStartSection={(secId, stepIdx) => tutorial.startSection(secId, stepIdx)}
        onResume={() => tutorial.resumeTutorial()}
        onReset={() => tutorial.resetTutorial()}
      />

      {tutorial.isTourActive && tutorial.activeSection && tutorial.currentStep && (
        <TutorialOverlayCard
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
        userRole={demoUserProfile.role}
      />

      {/* Footer Demo */}
      <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500">
        <p>
          © 2026 {EXPRESO_PUNATA_COMPANY.name} — Entorno de Demostración y Capacitación Pública • Desarrollado por PACHAX
        </p>
      </footer>
    </div>
  )
}
export default DemoView
