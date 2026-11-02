import React, { useState } from 'react'
import {
  ShieldCheck,
  Building2,
  Lock,
  Mail,
  Truck,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY, INITIAL_BRANCHES } from '../../domain/expresoPunataConfig'
import type { UserRole } from '../../types'

export const LoginView: React.FC = () => {
  const { signIn, devSwitchRole, setCurrentBranchId, currentBranchId } = useAuth()
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
      // Login o switch automático en desarrollo
      await devSwitchRole(role, branch)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de acceso en emulador'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

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
          <h1 className="text-xl font-bold tracking-tight text-[#facc15] uppercase">
            {EXPRESO_PUNATA_COMPANY.name}
          </h1>
          <p className="text-xs text-emerald-200 mt-1 font-medium">
            {EXPRESO_PUNATA_COMPANY.slogan}
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-950/60 rounded-full text-xs text-emerald-300 border border-emerald-700/50">
            <ShieldCheck className="w-3.5 h-3.5 text-[#facc15]" />
            Sistema Web en la Nube — 2 Sucursales
          </div>
        </div>

        {/* Formulario */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Sucursal de Ingreso
              </label>
              <div className="grid grid-cols-2 gap-2">
                {INITIAL_BRANCHES.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setCurrentBranchId(b.id)}
                    className={`p-2.5 text-xs font-medium rounded-lg border text-left flex items-center gap-2 transition-all ${
                      currentBranchId === b.id
                        ? 'border-[#064e3b] bg-emerald-50 text-[#064e3b] font-bold ring-1 ring-[#064e3b]'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Building2 className="w-4 h-4 shrink-0 text-[#064e3b]" />
                    <span className="truncate">{b.name}</span>
                  </button>
                ))}
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

          {/* Accesos rápidos de desarrollo / prueba de roles */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Simulación de Roles (Entorno de Desarrollo)</span>
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
                <span className="font-bold block text-amber-800">Tesorería Sindical</span>
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
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-100 text-center">
          <p className="text-[11px] text-slate-500">
            PACHAX Platform — Aplicación Operativa Expreso Punata
          </p>
        </div>
      </div>
    </div>
  )
}
