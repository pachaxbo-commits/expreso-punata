import React, { useState } from 'react'
import {
  CheckCircle,
  AlertTriangle,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { updateMyPassword, sendUserPasswordResetEmail } from '../../services/userService'
import { INITIAL_BRANCHES } from '../../domain/expresoPunataConfig'
import type { UserRole } from '../../types'

const ROLE_LABELS: Record<UserRole, string> = {
  directiva_admin: 'Administrador General (Directiva)',
  encargado_agencia: 'Encargado de Agencia',
  secretaria: 'Secretaria / Ventanilla',
  afiliado_admin: 'Administrador de Afiliados',
  tesoreria: 'Tesorería',
  conductor: 'Chofer / Conductor',
}

interface UserProfileModalProps {
  onClose: () => void
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ onClose }) => {
  const { userProfile, currentUser, signOut } = useAuth()

  const [activeTab, setActiveTab] = useState<'info' | 'password'>('info')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (!userProfile) return null

  const branchInfo = INITIAL_BRANCHES.find((b) => b.id === userProfile.primaryBranchId)
  const roleName = ROLE_LABELS[userProfile.role] || userProfile.role

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatusMessage(null)

    if (newPassword.length < 6) {
      setStatusMessage({ type: 'error', text: 'La nueva contraseña debe tener al menos 6 caracteres.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'Las contraseñas ingresadas no coinciden.' })
      return
    }

    try {
      setLoading(true)
      await updateMyPassword(newPassword)
      setStatusMessage({ type: 'success', text: 'Contraseña actualizada correctamente.' })
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      if (err.code === 'auth/requires-recent-login') {
        setStatusMessage({
          type: 'error',
          text: 'Por seguridad, esta acción requiere un inicio de sesión reciente. Cierre sesión e ingrese nuevamente para cambiar la contraseña, o utilice la opción de envío de enlace por correo.',
        })
      } else {
        setStatusMessage({ type: 'error', text: err.message || 'Error al actualizar contraseña.' })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSendResetEmail = async () => {
    setStatusMessage(null)
    const email = currentUser?.email || userProfile.email
    if (!email) {
      setStatusMessage({ type: 'error', text: 'No hay un correo electrónico asociado a la cuenta.' })
      return
    }

    try {
      setLoading(true)
      await sendUserPasswordResetEmail(email)
      setStatusMessage({
        type: 'success',
        text: `Se ha enviado el enlace oficial de restablecimiento a: ${email}. Revise su bandeja de entrada.`,
      })
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error al enviar correo de restablecimiento.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 border border-slate-200">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-[#064e3b]/10 text-[#064e3b] font-extrabold flex items-center justify-center text-sm uppercase">
              {userProfile.fullName.slice(0, 2)}
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-800">
                Mi Perfil de Operador
              </h3>
              <p className="text-xs text-slate-500">Expreso Punata</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Pestañas internas */}
        <div className="flex border-b border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('info')
              setStatusMessage(null)
            }}
            className={`pb-2 px-3 border-b-2 transition ${
              activeTab === 'info'
                ? 'border-[#064e3b] text-[#064e3b]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Datos Personales
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('password')
              setStatusMessage(null)
            }}
            className={`pb-2 px-3 border-b-2 transition ${
              activeTab === 'password'
                ? 'border-[#064e3b] text-[#064e3b]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Cambiar Contraseña
          </button>
        </div>

        {/* Mensaje de estado */}
        {statusMessage && (
          <div
            className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* TAB 1: DATOS */}
        {activeTab === 'info' && (
          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Nombre Completo:</span>
                <span className="font-bold text-slate-800">{userProfile.fullName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Correo Electrónico:</span>
                <span className="font-mono text-slate-700">{userProfile.email || currentUser?.email || '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Teléfono / WhatsApp:</span>
                <span className="font-mono text-slate-800">{userProfile.phone || 'No registrado'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Cédula de Identidad (CI):</span>
                <span className="font-mono text-slate-800">
                  {userProfile.ci ? userProfile.ci : <em className="text-slate-400 not-italic">No registrado</em>}
                </span>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Rol Asignado:</span>
                <span className="font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded text-[11px]">
                  {roleName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Sucursal Primaria:</span>
                <span className="font-bold text-[#064e3b]">
                  {branchInfo?.name || userProfile.primaryBranchId}
                </span>
              </div>
              {userProfile.allowedBranchIds && userProfile.allowedBranchIds.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Sucursales Permitidas:</span>
                  <span className="text-slate-700">{userProfile.allowedBranchIds.join(', ')}</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={async () => {
                  onClose()
                  await signOut()
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-700 hover:bg-rose-50 font-bold rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar Sesión</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg transition"
              >
                Listo
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: CAMBIAR CONTRASEÑA */}
        {activeTab === 'password' && (
          <div className="space-y-4 text-xs">
            <form onSubmit={handleUpdatePassword} className="space-y-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nueva Contraseña</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Confirmar Nueva Contraseña</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita la nueva contraseña"
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white font-bold rounded-xl shadow transition"
              >
                {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>
            </form>

            <div className="relative py-2 text-center text-slate-400">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <span className="relative bg-white px-2 text-[11px] uppercase">O alternativa</span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="text-[11px] text-slate-600 block">
                ¿Prefiere recibir un enlace directo en su correo electrónico oficial de Firebase Auth?
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={handleSendResetEmail}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg border border-slate-300 transition text-[11px]"
              >
                Enviar enlace de restablecimiento a mi correo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
