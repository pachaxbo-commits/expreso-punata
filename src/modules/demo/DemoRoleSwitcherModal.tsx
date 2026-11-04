import React from 'react'
import {
  Users,
  X,
  Shield,
  Truck,
  Building2,
  CheckCircle,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { DEMO_PROFILES, type DemoRoleId } from './demoTypes'

interface DemoRoleSwitcherModalProps {
  isOpen: boolean
  onClose: () => void
  currentRoleId: DemoRoleId
  onSelectRole: (roleId: DemoRoleId) => void
}

export const DemoRoleSwitcherModal: React.FC<DemoRoleSwitcherModalProps> = ({
  isOpen,
  onClose,
  currentRoleId,
  onSelectRole,
}) => {
  if (!isOpen) return null

  const roleEntries = Object.values(DEMO_PROFILES)

  const getRoleIcon = (id: DemoRoleId) => {
    switch (id) {
      case 'admin':
        return <Shield className="w-5 h-5 text-purple-700" />
      case 'secretaria_punata':
      case 'secretaria_cochabamba':
        return <Building2 className="w-5 h-5 text-emerald-700" />
      case 'encargado':
        return <Users className="w-5 h-5 text-amber-700" />
      case 'conductor':
        return <Truck className="w-5 h-5 text-yellow-700" />
      default:
        return <Users className="w-5 h-5" />
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabecera */}
        <div className="bg-[#064e3b] text-white p-4 sm:p-5 flex items-center justify-between border-b border-emerald-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#facc15] text-[#064e3b] flex items-center justify-center font-black shadow-md shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider text-[#facc15]">
                Simulador de Perfiles
              </span>
              <h2 className="text-base sm:text-lg font-black text-white leading-tight">
                Selecciona un Usuario de Demostración
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-emerald-800 text-emerald-200 hover:text-white rounded-lg transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Descripción informativa */}
        <div className="bg-slate-50 border-b border-slate-200 p-4 text-xs text-slate-600 leading-relaxed">
          <p>
            Explora el sistema desde el punto de vista de cada trabajador. Cada rol cuenta con sus permisos específicos, sucursales asignadas y vistas operativas restringidas. <strong>Todas las operaciones son 100% simuladas y no afectan la base de datos real.</strong>
          </p>
        </div>

        {/* Lista de Roles */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
          {roleEntries.map((profile) => {
            const isSelected = profile.id === currentRoleId

            return (
              <div
                key={profile.id}
                onClick={() => {
                  onSelectRole(profile.id)
                  onClose()
                }}
                className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-50/80 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                    {getRoleIcon(profile.id)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-sm text-slate-900">
                        {profile.title}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${profile.badgeColor}`}>
                        {profile.fullName}
                      </span>
                      {isSelected && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          Activo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-snug">
                      {profile.description}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 font-medium">
                      Agencia: <strong className="text-slate-700">{profile.branchName}</strong>
                      {profile.assignedVehicle && ` • Vehículo: ${profile.assignedVehicle}`}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                    }`}
                  >
                    <span>{isSelected ? 'Seleccionado' : 'Simular este rol'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Pie */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-between text-xs text-slate-500">
          <span>Puedes cambiar de rol en cualquier momento desde la barra superior de la demostración.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
