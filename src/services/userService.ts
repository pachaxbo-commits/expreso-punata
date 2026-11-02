import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore'
import {
  sendPasswordResetEmail,
  updatePassword,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { db, auth, functions } from '../firebase/config'
import type { UserProfile, UserRole, UserAuditLog } from '../types'

export interface ProvisionUserInput {
  targetUid?: string
  email?: string
  fullName: string
  ci?: string | null
  phone: string
  role: UserRole
  primaryBranchId: string
  allowedBranchIds: string[]
  assignedVehiclePlate?: string
  assignedMobileNumber?: string
  isActive?: boolean
}

export interface ProvisionUserResult {
  success: boolean
  message: string
  profile: UserProfile
}

export interface PasswordResetResult {
  success: boolean
  email: string
  message: string
}

/**
 * Suscripción reactiva al listado de usuarios de Expreso Punata.
 * Solo puede ser consultado por Directiva y Encargados autorizados según Firestore Rules.
 */
export function subscribeUsers(
  onUpdate: (users: UserProfile[]) => void,
  onError?: (err: Error) => void
): () => void {
  const usersRef = collection(db, 'users')
  const q = query(usersRef, orderBy('fullName'))

  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data()
        return {
          uid: d.id,
          fullName: data.fullName || '',
          email: data.email || '',
          ci: data.ci ?? null,
          phone: data.phone || '',
          role: data.role || 'secretaria',
          primaryBranchId: data.primaryBranchId || 'punata',
          allowedBranchIds: data.allowedBranchIds || [data.primaryBranchId || 'punata'],
          assignedVehiclePlate: data.assignedVehiclePlate,
          assignedMobileNumber: data.assignedMobileNumber,
          isActive: data.isActive !== false,
          createdAt: data.createdAt || data.createdAtIso || '',
          createdAtIso: data.createdAtIso,
          updatedAtIso: data.updatedAtIso,
          syncStatus: data.syncStatus,
        } as UserProfile
      })
      onUpdate(list)
    },
    (err) => {
      console.error('[userService] Error al suscribirse a usuarios:', err)
      if (onError) onError(err)
    }
  )
}

/**
 * Obtiene el listado completo de usuarios una sola vez.
 */
export async function fetchUsers(): Promise<UserProfile[]> {
  const usersRef = collection(db, 'users')
  const q = query(usersRef, orderBy('fullName'))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data()
    return {
      uid: d.id,
      fullName: data.fullName || '',
      email: data.email || '',
      ci: data.ci ?? null,
      phone: data.phone || '',
      role: data.role || 'secretaria',
      primaryBranchId: data.primaryBranchId || 'punata',
      allowedBranchIds: data.allowedBranchIds || [data.primaryBranchId || 'punata'],
      assignedVehiclePlate: data.assignedVehiclePlate,
      assignedMobileNumber: data.assignedMobileNumber,
      isActive: data.isActive !== false,
      createdAt: data.createdAt || data.createdAtIso || '',
      createdAtIso: data.createdAtIso,
      updatedAtIso: data.updatedAtIso,
      syncStatus: data.syncStatus,
    } as UserProfile
  })
}

/**
 * Invoca la Cloud Function `adminProvisionUser` para alta o modificación de usuarios.
 * Garantiza sincronización atómica entre Firebase Auth y Cloud Firestore con asignación de Custom Claims.
 */
export async function provisionUserThroughBackend(
  input: ProvisionUserInput
): Promise<ProvisionUserResult> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para administrar usuarios.')
  }

  const callable = httpsCallable<ProvisionUserInput, ProvisionUserResult>(
    functions,
    'adminProvisionUser'
  )

  const res = await callable(input)
  return res.data
}

/**
 * Autoriza y registra la solicitud de restablecimiento de contraseña en auditoría.
 * Jamás expone enlaces sensibles al cliente.
 */
export async function requestPasswordResetLink(
  email: string,
  targetUid?: string
): Promise<PasswordResetResult> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para solicitar restablecimiento.')
  }

  const callable = httpsCallable<{ email: string; targetUid?: string }, PasswordResetResult>(
    functions,
    'adminSendPasswordReset'
  )

  const res = await callable({ email, targetUid })
  return res.data
}

/**
 * Dispara el envío de correo de restablecimiento de contraseña usando el flujo oficial de Firebase Auth.
 * Envía el enlace directamente a la bandeja del trabajador sin intermediarios ni exposición a terceros.
 */
export async function sendUserPasswordResetEmail(email: string): Promise<void> {
  if (!email || !email.includes('@')) {
    throw new Error('Correo electrónico inválido.')
  }
  await sendPasswordResetEmail(auth, email.trim().toLowerCase())
}

/**
 * Permite a cualquier trabajador autenticado cambiar su contraseña directamente.
 */
export async function updateMyPassword(newPassword: string): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Debe iniciar sesión para cambiar su contraseña.')
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.')
  }
  await updatePassword(auth.currentUser, newPassword)
}

/**
 * Obtiene el historial de auditoría inmutable de un usuario desde `audit_logs`.
 */
export async function fetchUserAuditLogs(targetUid: string): Promise<UserAuditLog[]> {
  try {
    const auditRef = collection(db, 'audit_logs')
    const q = query(
      auditRef,
      where('entityId', '==', targetUid),
      orderBy('timestamp', 'desc'),
      limit(50)
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        entityType: data.entityType || '',
        entityId: data.entityId || '',
        action: data.action || '',
        performedBy: data.performedBy || data.performedByEmail || data.performedByUid || 'Sistema',
        performedByUid: data.performedByUid,
        performedByEmail: data.performedByEmail,
        details: data.details || {},
        timestamp: data.timestamp,
        timestampIso: data.timestampIso || '',
      } as UserAuditLog
    })
  } catch (err) {
    console.warn('[userService] Error al consultar audit_logs:', err)
    return []
  }
}
