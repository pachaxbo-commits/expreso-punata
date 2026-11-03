import React, { useState } from 'react'
import {
  ShieldCheck,
  Lock,
  Mail,
  Truck,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  LogOut,
  Eye,
  EyeOff,
  HelpCircle,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react'
import { useAuth } from './AuthContext'
import { isEmulatedEnvironment } from '../../firebase/config'
import { EXPRESO_PUNATA_LOGO_PATH, EXPRESO_PUNATA_COMPANY } from '../../domain/expresoPunataConfig'
import type { UserRole } from '../../types'

export const LoginView: React.FC = () => {
  const isLocalhost = Boolean(
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.local'))
  )
  const { currentUser, userProfile, authError, signIn, signOut, resetPassword, devSwitchRole } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Estado para modal / flujo de restablecimiento de contraseña
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetEmailInput, setResetEmailInput] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const formatAuthError = (err: unknown): string => {
    if (!(err instanceof Error)) return 'No se pudo iniciar sesión. Verifique sus credenciales.'
    const msg = err.message
    if (
      msg.includes('auth/invalid-credential') ||
      msg.includes('auth/wrong-password') ||
      msg.includes('auth/user-not-found') ||
      msg.includes('auth/invalid-login-credentials')
    ) {
      return 'Credenciales inválidas. Por favor verifique su correo electrónico y contraseña.'
    }
    if (msg.includes('auth/too-many-requests')) {
      return 'Acceso temporalmente restringido por demasiados intentos fallidos. Intente nuevamente en unos minutos o solicite un restablecimiento de contraseña.'
    }
    if (msg.includes('auth/user-disabled')) {
      return 'Esta cuenta de usuario ha sido suspendida. Comuníquese con la administración de Expreso Punata.'
    }
    if (msg.includes('auth/network-request-failed')) {
      return 'Error de red o conexión al servidor. Compruebe su conexión a internet.'
    }
    return msg
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err: unknown) {
      setError(formatAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError(null)
    setResetLoading(true)
    try {
      await resetPassword(resetEmailInput || email)
      setResetSuccess(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al solicitar el enlace'
      setResetError(msg)
    } finally {
      setResetLoading(false)
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
            Servicio Interprovincial Punata - Cochabamba
          </p>
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/70 border border-emerald-700/60 rounded-full text-[11px] text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 text-[#facc15]" />
              <span>Sistema Seguro de Encomiendas & Ventanilla</span>
            </div>
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-amber-400 text-amber-950 shadow-xs">
              Entorno Oficial de Demostración
            </span>
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
                  Correo Electrónico
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="operador@expresopunata.com"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                    required
                    autoComplete="email"
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
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(prev => !prev)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none"
                    title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setResetEmailInput(email)
                    setResetSuccess(false)
                    setResetError(null)
                    setShowResetModal(true)
                  }}
                  className="text-xs font-medium text-emerald-800 hover:text-emerald-950 hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#064e3b] hover:bg-[#065f46] text-white font-bold rounded-lg text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Iniciando sesión...</span>
                  </>
                ) : (
                  <>
                    <span>Iniciar Sesión</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Modal accesible de restablecimiento de contraseña */}
          {showResetModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
                <div className="bg-[#064e3b] px-4 py-3 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-[#facc15]" />
                    <span className="font-bold text-xs uppercase tracking-wide">Recuperar Contraseña</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="text-emerald-200 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4">
                  {resetSuccess ? (
                    <div className="text-center py-2 space-y-3">
                      <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                      <p className="text-xs text-slate-700 font-medium">
                        Si la cuenta se encuentra registrada, Firebase ha despachado las instrucciones de restablecimiento al correo:
                      </p>
                      <p className="text-xs font-mono bg-slate-100 p-2 rounded text-slate-800 break-all font-semibold">
                        {resetEmailInput}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Revise su bandeja de entrada o carpeta de spam y siga el enlace oficial para establecer su nueva contraseña.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowResetModal(false)}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs"
                      >
                        Cerrar y volver al inicio
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleResetSubmit} className="space-y-3">
                      <p className="text-xs text-slate-600">
                        Ingrese su correo electrónico registrado. Le enviaremos un enlace oficial de Firebase para restablecer su contraseña de forma segura.
                      </p>
                      {resetError && (
                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
                          {resetError}
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Correo Electrónico</label>
                        <input
                          type="email"
                          value={resetEmailInput}
                          onChange={(e) => setResetEmailInput(e.target.value)}
                          placeholder="usuario@expresopunata.com"
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                          required
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowResetModal(false)}
                          className="flex-1 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-xs"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={resetLoading}
                          className="flex-1 py-2 bg-[#064e3b] hover:bg-[#065f46] text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {resetLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          <span>Enviar Enlace</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Accesos rápidos de desarrollo — EXCLUSIVO DE EMULADORES LOCALES EN LOCALHOST */}
          {isEmulatedEnvironment && isLocalhost && (
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
                  <span className="font-bold block text-slate-900">Secretaria Punata</span>
                  <span className="text-[10px] text-slate-500">Agencia Punata</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('secretaria', 'cochabamba')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-slate-900">Secretaria Cbba</span>
                  <span className="text-[10px] text-slate-500">Agencia Cochabamba</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('conductor', 'punata')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-slate-900 flex items-center gap-1">
                    <Truck className="w-3 h-3 text-emerald-600" />
                    Chofer Móvil 14
                  </span>
                  <span className="text-[10px] text-slate-500">Ruta Interprovincial</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin('directiva_admin', 'punata')}
                  className="p-2 text-xs font-medium rounded border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 text-left transition-all"
                >
                  <span className="font-bold block text-slate-900">Directiva / Admin</span>
                  <span className="text-[10px] text-slate-500">Acceso Total</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
