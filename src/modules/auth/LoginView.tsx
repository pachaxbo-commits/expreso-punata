import React, { useState } from 'react'
import {
  ShieldCheck,
  Building2,
  Lock,
  Mail,
  Truck,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  LogOut,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { isEmulatedEnvironment } from '../../firebase/config'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY, INITIAL_BRANCHES } from '../../domain/expresoPunataConfig'
import type { UserRole } from '../../types'

export const LoginView: React.FC = () => {
  const { currentUser, userProfile, authError, signIn, signOut, devSwitchRole, setCurrentBranchId, currentBranchId } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesión'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleDevLogin = async (role: UserRole, branch = 'punata') => {
    setError(null)
    setLoading(true)
    try {
      await devSwitchRole(role, branch)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de acceso en emulador'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const displayError = authError || error

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
        {/* Cabecera institucional con colores oficiales */}
        <div className="bg-[#064e3b] p-6 text-center text-white relative">
          <div className="flex justify-center mb-3">
            <div className="w-20 h-20 bg-white rounded-full p-1.5 shadow-lg flex items-center justify-center">
              <img
                src={EXPRESO_PUNATA_LOGO_PATH}
                alt="Logo Expreso Punata"
                className="w-full h-full object-contain rounded-full"
              />
            </div>
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-[#facc15] uppercase">
            {EXPRESO_PUNATA_COMPANY.name}
          </h1>
          <p className="text-xs text-emerald-200 mt-1 font-medium">
            {EXPRESO_PUNATA_COMPANY.slogan}
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/70 border border-emerald-700/60 rounded-full text-[11px] text-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5 text-[#facc15]" />
            <span>Sistema Seguro de Encomiendas & Ventanilla</span>
          </div>
        </div>

        {/* Formulario y Contenido */}
        <div className="p-6">
          {displayError && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">Atención</span>
                <span>{displayError}</span>
              </div>
            </div>
          )}

          {/* Caso usuario autenticado en Firebase Auth pero sin perfil habilitado en Firestore */}
          {currentUser && (!userProfile || userProfile.isActive === false) ? (
            <div className="text-center py-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mb-4 text-left">
                <p className="font-semibold mb-1">Sesión detectada:</p>
                <p className="font-mono text-slate-700">{currentUser.email || currentUser.uid}</p>
                <p className="mt-2 text-slate-600">
                  Para ingresar, un administrador debe registrar su perfil con su rol y sucursal autorizada.
                </p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs shadow flex items-center justify-center gap-2 transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sucursal de Ingreso
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <select
                    value={currentBranchId}
                    onChange={e => setCurrentBranchId(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white text-slate-800 font-medium"
                  >
                    {INITIAL_BRANCHES.map(branch => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name} — {branch.city}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="usuario@expreso-punata.bo"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#064e3b] hover:bg-[#065f46] text-white font-bold rounded-lg text-sm shadow transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <span>{loading ? 'Accediendo...' : 'Iniciar Sesión'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* Accesos rápidos de desarrollo — EXCLUSIVO DE EMULADORES LOCALES */}
          {isEmulatedEnvironment && (
            <div className="mt-6 pt-5 border-t border-slate-200">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Simulación de Roles (Emuladores Locales)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleDevLogin('secretaria', 'punata')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-emerald-800">Secretaria Punata</span>
                  <span className="text-[10px] text-slate-500">Ventanilla & Caja</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('secretaria', 'cochabamba')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-emerald-800">Secretaria Cochabamba</span>
                  <span className="text-[10px] text-slate-500">Recepción & Entregas</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('tesoreria', 'punata')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-amber-800">Tesorería & Aportes</span>
                  <span className="text-[10px] text-slate-500">Cuotas & Finanzas</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('directiva_admin', 'punata')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-purple-50 hover:border-purple-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-purple-800">Directiva / Admin</span>
                  <span className="text-[10px] text-slate-500">Acceso Global</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('conductor', 'punata')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 text-slate-700 text-left col-span-2 transition-all flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold block text-blue-800">Conductor Móvil 14</span>
                    <span className="text-[10px] text-slate-500">Ruta & Entregas Directas</span>
                  </div>
                  <Truck className="w-4 h-4 text-blue-600" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 text-center">
          <p className="text-[11px] text-slate-500 font-medium">
            EXPRESO PUNATA — Sistema Web de Encomiendas & Administración
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Desarrollado por PACHAX
          </p>
        </div>
      </div>
    </div>
  )
}
