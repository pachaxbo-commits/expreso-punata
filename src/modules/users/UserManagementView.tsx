import React, { useState, useEffect } from 'react'
import {
  Users,
  UserPlus,
  Shield,
  Key,
  Clock,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  MapPin,
  Phone,
  FileText,
  Lock,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react'
import {
  subscribeUsers,
  provisionUserThroughBackend,
  requestPasswordResetLink,
  sendUserPasswordResetEmail,
  fetchUserAuditLogs,
  type ProvisionUserInput,
} from '../../services/userService'
import type { UserProfile, UserRole, UserAuditLog } from '../../types'
import { INITIAL_BRANCHES } from '../../domain/expresoPunataConfig'

const ROLE_LABELS: Record<UserRole, { label: string; bg: string; text: string }> = {
  directiva_admin: { label: 'Administrador General (Directiva)', bg: 'bg-purple-100', text: 'text-purple-800' },
  encargado_agencia: { label: 'Encargado de Agencia', bg: 'bg-blue-100', text: 'text-blue-800' },
  secretaria: { label: 'Secretaria / Ventanilla', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  tesoreria: { label: 'Tesorería Sindical', bg: 'bg-amber-100', text: 'text-amber-800' },
  conductor: { label: 'Chofer / Conductor', bg: 'bg-indigo-100', text: 'text-indigo-800' },
}

export const UserManagementView: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Modales
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)
  const [roleChangeUser, setRoleChangeUser] = useState<UserProfile | null>(null)
  const [newSelectedRole, setNewSelectedRole] = useState<UserRole>('secretaria')
  const [auditUser, setAuditUser] = useState<UserProfile | null>(null)
  const [auditLogs, setAuditLogs] = useState<UserAuditLog[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [passwordResetData, setPasswordResetData] = useState<{ email: string; link?: string; sentEmail?: boolean } | null>(null)

  // Estados de acción en progreso
  const [actionLoading, setActionLoading] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Suscripción reactiva a usuarios
  useEffect(() => {
    setLoading(true)
    const unsubscribe = subscribeUsers(
      (list) => {
        setUsers(list)
        setLoading(false)
        setError(null)
      },
      (err) => {
        console.error('Error al cargar usuarios:', err)
        setError('No se pudo conectar a la base de datos de usuarios. Verifique sus permisos de Directiva.')
        setLoading(false)
      }
    )
    return () => unsubscribe()
  }, [])

  // Carga de logs de auditoría cuando se abre el modal
  useEffect(() => {
    if (auditUser) {
      setLoadingAudit(true)
      fetchUserAuditLogs(auditUser.uid)
        .then((logs) => setAuditLogs(logs))
        .catch((err) => console.error('Error al cargar logs:', err))
        .finally(() => setLoadingAudit(false))
    } else {
      setAuditLogs([])
    }
  }, [auditUser])

  // Filtrado de usuarios
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (branchFilter !== 'all' && u.primaryBranchId !== branchFilter) return false
    if (statusFilter !== 'all') {
      const wantActive = statusFilter === 'active'
      if (u.isActive !== wantActive) return false
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      const matchName = u.fullName.toLowerCase().includes(q)
      const matchEmail = (u.email || '').toLowerCase().includes(q)
      const matchPhone = (u.phone || '').includes(q)
      const matchCi = (u.ci || '').toLowerCase().includes(q)
      if (!matchName && !matchEmail && !matchPhone && !matchCi) return false
    }
    return true
  })

  // Estadísticas rápidas
  const totalUsers = users.length
  const activeCount = users.filter((u) => u.isActive).length
  const suspendedCount = users.filter((u) => !u.isActive).length
  const punataCount = users.filter((u) => u.primaryBranchId === 'punata').length
  const cochaCount = users.filter((u) => u.primaryBranchId === 'cochabamba').length

  // Acción: Activar / Suspender usuario
  const handleToggleActive = async (user: UserProfile) => {
    const nextState = !user.isActive
    const actionLabel = nextState ? 'activar' : 'suspender'
    const confirmMessage = nextState
      ? `¿Desea reactivar el acceso de "${user.fullName}" al sistema de Expreso Punata?`
      : `¿Confirma suspender la cuenta de "${user.fullName}"?\n\nAl suspender, sus sesiones activas serán revocadas inmediatamente y no podrá acceder a emitir encomiendas ni manejar caja.`

    if (!window.confirm(confirmMessage)) return

    try {
      setActionLoading(true)
      await provisionUserThroughBackend({
        targetUid: user.uid,
        fullName: user.fullName,
        ci: user.ci,
        phone: user.phone,
        role: user.role,
        primaryBranchId: user.primaryBranchId,
        allowedBranchIds: user.allowedBranchIds,
        assignedVehiclePlate: user.assignedVehiclePlate,
        assignedMobileNumber: user.assignedMobileNumber,
        isActive: nextState,
      })
      alert(`Usuario ${actionLabel === 'activar' ? 'reactivado' : 'suspendido'} exitosamente.`)
    } catch (err: any) {
      alert(`Error al cambiar estado del usuario: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  // Acción: Confirmar cambio de rol
  const handleConfirmRoleChange = async () => {
    if (!roleChangeUser) return
    try {
      setActionLoading(true)
      await provisionUserThroughBackend({
        targetUid: roleChangeUser.uid,
        fullName: roleChangeUser.fullName,
        ci: roleChangeUser.ci,
        phone: roleChangeUser.phone,
        role: newSelectedRole,
        primaryBranchId: roleChangeUser.primaryBranchId,
        allowedBranchIds: roleChangeUser.allowedBranchIds,
        assignedVehiclePlate: roleChangeUser.assignedVehiclePlate,
        assignedMobileNumber: roleChangeUser.assignedMobileNumber,
        isActive: roleChangeUser.isActive,
      })
      alert(`Rol actualizado a "${ROLE_LABELS[newSelectedRole]?.label || newSelectedRole}" exitosamente.`)
      setRoleChangeUser(null)
    } catch (err: any) {
      alert(`Error al actualizar rol: ${err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  // Acción: Generar / Enviar restablecimiento de contraseña
  const handleRequestPasswordReset = async (user: UserProfile) => {
    const targetEmail = user.email
    if (!targetEmail) {
      alert('El usuario no tiene un correo electrónico registrado en Firebase Auth.')
      return
    }

    try {
      setActionLoading(true)
      // Generar link mediante backend seguro
      const res = await requestPasswordResetLink(targetEmail, user.uid)
      setPasswordResetData({
        email: targetEmail,
        link: res.passwordResetLink,
      })
    } catch (err: any) {
      // Fallback a cliente
      try {
        await sendUserPasswordResetEmail(targetEmail)
        setPasswordResetData({
          email: targetEmail,
          sentEmail: true,
        })
      } catch (clientErr: any) {
        alert(`Error al procesar restablecimiento: ${err.message || clientErr.message}`)
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleCopyLink = () => {
    if (passwordResetData?.link) {
      navigator.clipboard.writeText(passwordResetData.link)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2500)
    }
  }

  return (
    <div className="space-y-6">
      {/* Encabezado del Módulo */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 text-[#064e3b] rounded-lg">
              <Users className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-extrabold text-slate-800 tracking-tight">
              Configuración de Usuarios y Permisos
            </h2>
            <span className="text-[11px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full border border-purple-200">
              Directiva Admin
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Administración centralizada de operadores de Expreso Punata: secretarias, choferes, encargados y directiva.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsNewUserModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow transition"
        >
          <UserPlus className="w-4 h-4" />
          <span>Registrar Nuevo Operador</span>
        </button>
      </div>

      {/* Tarjetas de Métricas de Operadores */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-slate-500 block">Total Operadores</span>
          <span className="text-xl font-extrabold text-slate-800">{totalUsers}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-emerald-700 block font-medium">Activos</span>
          <span className="text-xl font-extrabold text-emerald-700">{activeCount}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-rose-700 block font-medium">Suspendidos</span>
          <span className="text-xl font-extrabold text-rose-700">{suspendedCount}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] text-slate-500 block">Sucursal Punata</span>
          <span className="text-xl font-extrabold text-slate-700">{punataCount}</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
          <span className="text-[11px] text-slate-500 block">Sucursal Cochabamba</span>
          <span className="text-xl font-extrabold text-slate-700">{cochaCount}</span>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {/* Input de búsqueda */}
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, correo, teléfono o CI..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
            />
          </div>

          {/* Filtro por Sucursal */}
          <div>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white text-slate-700"
            >
              <option value="all">Todas las sucursales</option>
              {INITIAL_BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Rol */}
          <div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white text-slate-700"
            >
              <option value="all">Todos los roles</option>
              <option value="directiva_admin">Administrador General</option>
              <option value="encargado_agencia">Encargado de Agencia</option>
              <option value="secretaria">Secretaria / Ventanilla</option>
              <option value="conductor">Chofer / Conductor</option>
              <option value="tesoreria">Tesorería Sindical</option>
            </select>
          </div>
        </div>

        {/* Filtro de estado */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-500 font-medium flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Estado:
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
              statusFilter === 'all'
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
              statusFilter === 'active'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Activos ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('suspended')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold ${
              statusFilter === 'suspended'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Suspendidos ({suspendedCount})
          </button>
        </div>
      </div>

      {/* Alerta de Error */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Listado de Usuarios */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-[#064e3b] mb-2" />
            Cargando operadores y sincronizaciones de Firebase Cloud...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            No se encontraron operadores registrados con los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Operador</th>
                  <th className="py-3 px-4">Teléfono & CI</th>
                  <th className="py-3 px-4">Rol Asignado</th>
                  <th className="py-3 px-4">Sucursales</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredUsers.map((u) => {
                  const roleConfig = ROLE_LABELS[u.role] || {
                    label: u.role,
                    bg: 'bg-slate-100',
                    text: 'text-slate-800',
                  }
                  const branchInfo = INITIAL_BRANCHES.find((b) => b.id === u.primaryBranchId)

                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/70 transition-colors">
                      {/* Nombre y correo */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#064e3b]/10 text-[#064e3b] font-extrabold flex items-center justify-center shrink-0 uppercase text-xs">
                            {u.fullName.slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-bold text-slate-800 flex items-center gap-1.5">
                              <span>{u.fullName}</span>
                              {u.syncStatus === 'synced' && (
                                <span title="Claims sincronizados con Firebase Auth" className="text-emerald-600">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500 block">{u.email || 'Sin correo asociado'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Teléfono y CI */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 font-mono text-[11px]">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{u.phone || 'No registrado'}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {u.ci ? (
                              <span className="font-mono text-slate-700">CI: {u.ci}</span>
                            ) : (
                              <span className="text-slate-400 italic">CI: No registrado</span>
                            )}
                          </div>
                          {u.role === 'conductor' && (u.assignedVehiclePlate || u.assignedMobileNumber) && (
                            <div className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 inline-block font-mono">
                              Móvil {u.assignedMobileNumber || '-'} ({u.assignedVehiclePlate || '-'})
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Rol */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${roleConfig.bg} ${roleConfig.text}`}
                        >
                          {roleConfig.label}
                        </span>
                      </td>

                      {/* Sucursal */}
                      <td className="py-3.5 px-4">
                        <div>
                          <span className="font-semibold text-slate-800 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-emerald-600" />
                            {branchInfo?.name || u.primaryBranchId}
                          </span>
                          {u.allowedBranchIds && u.allowedBranchIds.length > 1 && (
                            <span className="text-[10px] text-slate-500 block mt-0.5">
                              Permitidas: {u.allowedBranchIds.join(', ')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Estado */}
                      <td className="py-3.5 px-4">
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                            Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                            Suspendido
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Editar */}
                          <button
                            type="button"
                            onClick={() => setEditingUser(u)}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                            title="Editar datos de usuario"
                          >
                            <FileText className="w-4 h-4" />
                          </button>

                          {/* Cambiar Rol */}
                          <button
                            type="button"
                            onClick={() => {
                              setRoleChangeUser(u)
                              setNewSelectedRole(u.role)
                            }}
                            className="p-1.5 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition"
                            title="Cambiar rol de usuario"
                          >
                            <Shield className="w-4 h-4" />
                          </button>

                          {/* Restablecer Contraseña */}
                          <button
                            type="button"
                            onClick={() => handleRequestPasswordReset(u)}
                            className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition"
                            title="Restablecer contraseña"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          {/* Activar / Suspender */}
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            disabled={actionLoading}
                            className={`p-1.5 rounded-lg transition ${
                              u.isActive
                                ? 'text-rose-600 hover:text-rose-800 hover:bg-rose-50'
                                : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
                            }`}
                            title={u.isActive ? 'Suspender cuenta' : 'Reactivar cuenta'}
                          >
                            {u.isActive ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                          </button>

                          {/* Historial de Auditoría */}
                          <button
                            type="button"
                            onClick={() => setAuditUser(u)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                            title="Ver historial de auditoría"
                          >
                            <Clock className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: REGISTRAR NUEVO OPERADOR */}
      {isNewUserModalOpen && (
        <NewUserModal
          onClose={() => setIsNewUserModalOpen(false)}
          onSuccess={(result) => {
            setIsNewUserModalOpen(false)
            if (result.passwordResetLink) {
              setPasswordResetData({
                email: result.profile.email || '',
                link: result.passwordResetLink,
              })
            } else {
              alert(`Operador ${result.profile.fullName} registrado exitosamente.`)
            }
          }}
        />
      )}

      {/* MODAL 2: EDITAR OPERADOR */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null)
            alert('Datos del operador actualizados exitosamente.')
          }}
        />
      )}

      {/* MODAL 3: CONFIRMAR CAMBIO DE ROL */}
      {roleChangeUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center gap-2 text-purple-700">
              <Shield className="w-5 h-5" />
              <h3 className="font-extrabold text-sm sm:text-base text-slate-800">
                Confirmar Cambio de Rol y Privilegios
              </h3>
            </div>

            <p className="text-xs text-slate-600">
              Está a punto de modificar los privilegios en Cloud Firestore y Firebase Auth para el operador:
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div className="font-bold text-slate-800">{roleChangeUser.fullName}</div>
              <div className="text-slate-500 font-mono text-[11px]">{roleChangeUser.email}</div>
              <div className="mt-1 text-slate-600">
                Rol actual: <strong>{ROLE_LABELS[roleChangeUser.role]?.label || roleChangeUser.role}</strong>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Seleccionar nuevo rol:</label>
              <select
                value={newSelectedRole}
                onChange={(e) => setNewSelectedRole(e.target.value as UserRole)}
                className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600"
              >
                <option value="secretaria">Secretaria / Ventanilla (Emisión de guías, cobros en caja)</option>
                <option value="encargado_agencia">Encargado de Agencia (Almacén, inventario, caja)</option>
                <option value="conductor">Chofer / Conductor (Manifiestos y entregas en ruta)</option>
                <option value="tesoreria">Tesorería Sindical (Socios, mensualidades, reportes)</option>
                <option value="directiva_admin">Administrador General (Control total de Expreso Punata)</option>
              </select>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Esta operación sincroniza de forma inmediata los Custom Claims de Firebase Auth y actualiza la regla de seguridad del sistema.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRoleChangeUser(null)}
                className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmRoleChange}
                className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs rounded-lg shadow transition"
              >
                {actionLoading ? 'Actualizando...' : 'Confirmar Cambio de Rol'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: RESULTADO DE ENLACE DE RESTABLECIMIENTO */}
      {passwordResetData && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center gap-2 text-[#064e3b]">
              <Key className="w-5 h-5" />
              <h3 className="font-extrabold text-sm sm:text-base text-slate-800">
                Enlace Oficial de Restablecimiento de Contraseña
              </h3>
            </div>

            <p className="text-xs text-slate-600">
              Expreso Punata y Firebase Auth han generado el siguiente procedimiento seguro para{' '}
              <strong className="text-slate-800">{passwordResetData.email}</strong>.
            </p>

            {passwordResetData.link ? (
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-700 block">
                  Enlace seguro de un solo uso generado por Firebase Admin:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={passwordResetData.link}
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono text-slate-700 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className={`px-3 py-2.5 text-xs font-bold rounded-lg flex items-center gap-1 shrink-0 ${
                      copiedLink ? 'bg-emerald-600 text-white' : 'bg-[#064e3b] text-white hover:bg-emerald-800'
                    }`}
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedLink ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Puede enviar este enlace directamente al operador para que ingrese y configure su contraseña personal. Las contraseñas jamás se transmiten ni guardan en texto claro.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                Se ha enviado el correo electrónico oficial de restablecimiento a la bandeja de entrada del usuario.
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPasswordResetData(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: HISTORIAL DE AUDITORÍA */}
      {auditUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#064e3b]" />
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-slate-800">
                    Historial de Auditoría Inmutable
                  </h3>
                  <p className="text-xs text-slate-500">
                    Operador: <strong className="text-slate-700">{auditUser.fullName}</strong> ({auditUser.email})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuditUser(null)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
              {loadingAudit ? (
                <div className="p-8 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#064e3b] mb-2" />
                  Consultando registros inmutables de audit_logs...
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No hay eventos registrados en la bitácora de auditoría para este usuario.
                </div>
              ) : (
                auditLogs.map((log, i) => (
                  <div key={log.id || i} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 font-mono text-[11px] bg-slate-200/80 px-2 py-0.5 rounded">
                        {log.action}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {log.timestampIso ? new Date(log.timestampIso).toLocaleString('es-BO') : 'Fecha no registrada'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Realizado por: <strong className="text-slate-700">{log.performedByEmail || log.performedBy || 'Sistema'}</strong>
                    </div>
                    {log.details && Object.keys(log.details).length > 0 && (
                      <pre className="text-[10px] bg-white p-2 rounded border border-slate-200 font-mono text-slate-600 overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAuditUser(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition"
              >
                Cerrar Bitácora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// SUBCOMPONENTE: MODAL PARA ALTA DE NUEVO USUARIO
// =============================================================================
interface NewUserModalProps {
  onClose: () => void
  onSuccess: (result: { profile: UserProfile; passwordResetLink?: string }) => void
}

const NewUserModal: React.FC<NewUserModalProps> = ({ onClose, onSuccess }) => {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [ci, setCi] = useState('')
  const [role, setRole] = useState<UserRole>('secretaria')
  const [primaryBranchId, setPrimaryBranchId] = useState('punata')
  const [allowedBranches, setAllowedBranches] = useState<string[]>(['punata'])
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleBranchCheckbox = (branchId: string) => {
    if (branchId === primaryBranchId) return // la primaria no se desmarca
    setAllowedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((b) => b !== branchId) : [...prev, branchId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!fullName.trim()) {
      setFormError('El nombre completo es obligatorio.')
      return
    }
    if (!email.trim() || !email.includes('@')) {
      setFormError('Ingrese un correo electrónico válido para el nuevo usuario.')
      return
    }
    if (!phone.trim()) {
      setFormError('El número de teléfono es obligatorio.')
      return
    }

    try {
      setLoading(true)
      const input: ProvisionUserInput = {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        ci: ci.trim() ? ci.trim() : null, // Opcional, guarda null si no se ingresa
        role,
        primaryBranchId,
        allowedBranchIds: allowedBranches.includes(primaryBranchId)
          ? allowedBranches
          : [primaryBranchId, ...allowedBranches],
        assignedVehiclePlate: role === 'conductor' ? vehiclePlate.trim() : undefined,
        assignedMobileNumber: role === 'conductor' ? mobileNumber.trim() : undefined,
        isActive: true,
      }

      const res = await provisionUserThroughBackend(input)
      onSuccess({
        profile: res.profile,
        passwordResetLink: res.passwordResetLink,
      })
    } catch (err: any) {
      setFormError(err.message || 'Error al aprovisionar usuario.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 text-[#064e3b] rounded-lg">
              <UserPlus className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-800">
                Registrar Nuevo Operador
              </h3>
              <p className="text-xs text-slate-500">Expreso Punata — Aprovisionamiento Oficial</p>
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

        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Nombre y Correo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Nombre Completo *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej. María Flores Rocha"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Correo Electrónico *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@expresopunata.com"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
          </div>

          {/* Teléfono y CI */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Teléfono / WhatsApp *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej. 75999279"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">C.I. (Cédula de Identidad)</label>
                <span className="text-[10px] text-slate-400 italic">Opcional</span>
              </div>
              <input
                type="text"
                value={ci}
                onChange={(e) => setCi(e.target.value)}
                placeholder="Dejar en blanco si no fue proporcionado"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
          </div>

          {/* Rol y Sucursal Primaria */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Rol Operativo *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white font-medium"
              >
                <option value="secretaria">Secretaria / Ventanilla</option>
                <option value="encargado_agencia">Encargado de Agencia</option>
                <option value="conductor">Chofer / Conductor</option>
                <option value="tesoreria">Tesorería Sindical</option>
                <option value="directiva_admin">Administrador General (Directiva)</option>
              </select>
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Sucursal Principal *</label>
              <select
                value={primaryBranchId}
                onChange={(e) => {
                  const bId = e.target.value
                  setPrimaryBranchId(bId)
                  if (!allowedBranches.includes(bId)) {
                    setAllowedBranches((prev) => [...prev, bId])
                  }
                }}
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white font-medium"
              >
                {INITIAL_BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Sucursales autorizadas */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="font-bold text-slate-700 block mb-2">Sucursales con acceso permitido:</span>
            <div className="flex items-center gap-4">
              {INITIAL_BRANCHES.map((b) => (
                <label key={b.id} className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={allowedBranches.includes(b.id)}
                    disabled={b.id === primaryBranchId}
                    onChange={() => handleBranchCheckbox(b.id)}
                    className="rounded text-[#064e3b] focus:ring-[#064e3b]"
                  />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Campos adicionales para conductor */}
          {role === 'conductor' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
              <span className="font-bold text-blue-900 block">Datos del Vehículo / Móvil Asignado</span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-blue-800 block mb-1">Número de Móvil</label>
                  <input
                    type="text"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="Ej. 14"
                    className="w-full p-2 border border-blue-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-blue-800 block mb-1">Placa de Vehículo</label>
                  <input
                    type="text"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                    placeholder="Ej. 1234-XYZ"
                    className="w-full p-2 border border-blue-300 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Nota de Seguridad */}
          <div className="p-3 bg-slate-100 rounded-xl text-[11px] text-slate-600 flex items-start gap-2">
            <Lock className="w-4 h-4 shrink-0 mt-0.5 text-[#064e3b]" />
            <span>
              <strong>Seguridad estricta:</strong> La cuenta se creará en Firebase Authentication con sincronización atómica. No se solicitan contraseñas en texto plano: el sistema generará un enlace seguro oficial de Firebase Auth para que el usuario configure su clave.
            </span>
          </div>

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow transition"
            >
              {loading ? 'Aprovisionando...' : 'Crear Operador'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// =============================================================================
// SUBCOMPONENTE: MODAL PARA EDITAR OPERADOR EXISTENTE
// =============================================================================
interface EditUserModalProps {
  user: UserProfile
  onClose: () => void
  onSuccess: () => void
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, onClose, onSuccess }) => {
  const [fullName, setFullName] = useState(user.fullName)
  const [phone, setPhone] = useState(user.phone)
  const [ci, setCi] = useState(user.ci || '')
  const [primaryBranchId, setPrimaryBranchId] = useState(user.primaryBranchId)
  const [allowedBranches, setAllowedBranches] = useState<string[]>(user.allowedBranchIds || [user.primaryBranchId])
  const [vehiclePlate, setVehiclePlate] = useState(user.assignedVehiclePlate || '')
  const [mobileNumber, setMobileNumber] = useState(user.assignedMobileNumber || '')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const handleBranchCheckbox = (branchId: string) => {
    if (branchId === primaryBranchId) return
    setAllowedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((b) => b !== branchId) : [...prev, branchId]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!fullName.trim()) {
      setFormError('El nombre completo es obligatorio.')
      return
    }

    try {
      setLoading(true)
      const input: ProvisionUserInput = {
        targetUid: user.uid,
        fullName: fullName.trim(),
        phone: phone.trim(),
        ci: ci.trim() ? ci.trim() : null, // Opcional, guarda null si no se ingresa
        role: user.role, // El rol se cambia en el modal dedicado para confirmación
        primaryBranchId,
        allowedBranchIds: allowedBranches.includes(primaryBranchId)
          ? allowedBranches
          : [primaryBranchId, ...allowedBranches],
        assignedVehiclePlate: user.role === 'conductor' ? vehiclePlate.trim() : undefined,
        assignedMobileNumber: user.role === 'conductor' ? mobileNumber.trim() : undefined,
        isActive: user.isActive,
      }

      await provisionUserThroughBackend(input)
      onSuccess()
    } catch (err: any) {
      setFormError(err.message || 'Error al actualizar usuario.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-slate-100 text-[#064e3b] rounded-lg">
              <FileText className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-800">
                Editar Datos del Operador
              </h3>
              <p className="text-xs text-slate-500 font-mono">{user.email || user.uid}</p>
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

        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-bold text-slate-700 block mb-1">Nombre Completo *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Teléfono / WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700">C.I. (Cédula de Identidad)</label>
                <span className="text-[10px] text-slate-400 italic">Opcional</span>
              </div>
              <input
                type="text"
                value={ci}
                onChange={(e) => setCi(e.target.value)}
                placeholder="Sin registrar"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b]"
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">Sucursal Principal *</label>
            <select
              value={primaryBranchId}
              onChange={(e) => {
                const bId = e.target.value
                setPrimaryBranchId(bId)
                if (!allowedBranches.includes(bId)) {
                  setAllowedBranches((prev) => [...prev, bId])
                }
              }}
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#064e3b] bg-white font-medium"
            >
              {INITIAL_BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="font-bold text-slate-700 block mb-2">Sucursales con acceso permitido:</span>
            <div className="flex items-center gap-4">
              {INITIAL_BRANCHES.map((b) => (
                <label key={b.id} className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={allowedBranches.includes(b.id)}
                    disabled={b.id === primaryBranchId}
                    onChange={() => handleBranchCheckbox(b.id)}
                    className="rounded text-[#064e3b] focus:ring-[#064e3b]"
                  />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          </div>

          {user.role === 'conductor' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
              <span className="font-bold text-blue-900 block">Datos del Chofer / Móvil</span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-blue-800 block mb-1">Número de Móvil</label>
                  <input
                    type="text"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    className="w-full p-2 border border-blue-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-blue-800 block mb-1">Placa de Vehículo</label>
                  <input
                    type="text"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                    className="w-full p-2 border border-blue-300 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[#064e3b] hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow transition"
            >
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
