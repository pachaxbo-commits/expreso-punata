import React, { createContext, useContext, useState, useEffect } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, isEmulatedEnvironment } from '../../firebase/config'
import type { UserProfile, UserRole } from '../../types'

interface AuthContextType {
  currentUser: FirebaseUser | null
  userProfile: UserProfile | null
  authError: string | null
  currentBranchId: string
  setCurrentBranchId: (branchId: string) => void
  switchBranch: (branchId: string) => boolean
  isLoading: boolean
  signIn: (email: string, pass: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  devSwitchRole: (role: UserRole, branchId?: string) => Promise<void>
  hasRole: (roles: UserRole[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  // En entorno Cloud o Producción, nunca se restauran perfiles simulados de localStorage
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
    if (!isEmulatedEnvironment) return null
    try {
      const saved = localStorage.getItem('expreso_punata_user_profile')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  const [currentBranchId, _setCurrentBranchId] = useState<string>('punata')
  const [isLoading, setIsLoading] = useState(true)

  const saveProfile = (p: UserProfile | null) => {
    setUserProfile(p)
    if (isEmulatedEnvironment) {
      if (p) {
        try {
          localStorage.setItem('expreso_punata_user_profile', JSON.stringify(p))
        } catch {}
      } else {
        localStorage.removeItem('expreso_punata_user_profile')
      }
    } else {
      localStorage.removeItem('expreso_punata_user_profile')
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user)
      setAuthError(null)

      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid))
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile

            // 1. Verificación de cuenta inactiva
            if (data.isActive === false) {
              setAuthError('Su cuenta de usuario se encuentra inactiva. Comuníquese con la administración de Expreso Punata.')
              setUserProfile(null)
              _setCurrentBranchId('punata')
              saveProfile(null)
            } else {
              // 2. Usuario activo con perfil legítimo en Firestore
              setUserProfile(data)
              // Asignación automática autoritativa de la sucursal asignada en Firestore
              const assignedBranch = data.primaryBranchId || 'punata'
              _setCurrentBranchId(assignedBranch)

              if (isEmulatedEnvironment) {
                saveProfile(data)
              }
            }
          } else {
            // 3. Usuario autenticado sin perfil registrado en Firestore
            if (isEmulatedEnvironment) {
              const defaultProfile: UserProfile = {
                uid: user.uid,
                fullName: user.displayName || user.email?.split('@')[0] || 'Operador Local Emulador',
                ci: '1234567-CB',
                phone: '71798765',
                role: 'secretaria',
                primaryBranchId: 'punata',
                allowedBranchIds: ['punata'],
                isActive: true,
                createdAt: new Date().toISOString(),
              }
              try {
                await setDoc(doc(db, 'users', user.uid), defaultProfile)
              } catch {}
              setUserProfile(defaultProfile)
              _setCurrentBranchId('punata')
              saveProfile(defaultProfile)
            } else {
              console.warn('[Auth Seguridad] Usuario autenticado sin perfil en Firestore:', user.uid)
              setAuthError('Su cuenta no tiene un perfil operativo asignado en Expreso Punata. Contacte a la administración para habilitar su sucursal y rol.')
              setUserProfile(null)
              _setCurrentBranchId('punata')
              saveProfile(null)
            }
          }
        } catch (e) {
          console.error('[Auth Error] Error al verificar perfil en Firestore:', e)
          setAuthError('Error de verificación de perfil. Verifique su conexión al sistema.')
          setUserProfile(null)
          _setCurrentBranchId('punata')
          saveProfile(null)
        }
      } else {
        // Usuario no autenticado: limpiar todo estado sensible y reiniciar sucursal
        setUserProfile(null)
        _setCurrentBranchId('punata')
        saveProfile(null)
      }
      setIsLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const signIn = async (email: string, pass: string) => {
    setIsLoading(true)
    setAuthError(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass)
    } finally {
      setIsLoading(false)
    }
  }

  const signOut = async () => {
    try {
      await fbSignOut(auth)
    } catch {}
    setAuthError(null)
    setUserProfile(null)
    _setCurrentBranchId('punata')
    saveProfile(null)
    localStorage.removeItem('expreso_punata_user_profile')
  }

  const resetPassword = async (emailToReset: string) => {
    if (!emailToReset || !emailToReset.includes('@')) {
      throw new Error('Debe ingresar un correo electrónico válido para solicitar el restablecimiento.')
    }
    await sendPasswordResetEmail(auth, emailToReset.trim())
  }

  // Cambio seguro y controlado de sucursal con validación estricta de RBAC
  const switchBranch = (branchId: string): boolean => {
    if (!userProfile || !userProfile.isActive) return false

    // Las secretarias tienen una sola agencia fija inmutable
    if (userProfile.role === 'secretaria') {
      console.warn('[RBAC Seguridad] Las secretarias no tienen autorización para alternar entre agencias.')
      return false
    }

    // Directiva / Admin General tiene acceso irrestricto a ambas sucursales
    if (userProfile.role === 'directiva_admin') {
      _setCurrentBranchId(branchId)
      return true
    }

    // Encargados y Tesorería: únicamente entre sus sucursales autorizadas
    const allowed = Array.isArray(userProfile.allowedBranchIds) && userProfile.allowedBranchIds.length > 0
      ? userProfile.allowedBranchIds
      : [userProfile.primaryBranchId]

    if (allowed.includes(branchId)) {
      _setCurrentBranchId(branchId)
      return true
    }

    console.warn(`[RBAC Seguridad] Acceso denegado a sucursal '${branchId}' para usuario '${userProfile.email}'.`)
    return false
  }

  // Wrapper seguro para compatibilidad
  const setCurrentBranchId = (branchId: string) => {
    switchBranch(branchId)
  }

  // Simulación de roles ÚNICAMENTE en emuladores locales en localhost
  const devSwitchRole = async (role: UserRole, branchId = 'punata') => {
    if (!isEmulatedEnvironment) {
      const securityErr = 'Simulación de roles rechazada: esta función está estrictamente deshabilitada en entornos Cloud y producción.'
      console.error(`[Seguridad] ${securityErr}`)
      setAuthError(securityErr)
      throw new Error(securityErr)
    }

    const devUid = currentUser ? currentUser.uid : `dev-${role}-${branchId}`
    const updated: UserProfile = {
      uid: devUid,
      fullName:
        role === 'secretaria'
          ? branchId === 'punata'
            ? 'María Secretaria (Punata)'
            : 'Elena Secretaria (Cochabamba)'
          : `Usuario ${role.toUpperCase().replace('_', ' ')}`,
      ci: '7654321-CB',
      phone: '70011223',
      role,
      primaryBranchId: branchId,
      allowedBranchIds:
        role === 'directiva_admin' || role === 'tesoreria'
          ? ['punata', 'cochabamba']
          : role === 'secretaria'
            ? [branchId] // Secretaria strictly 1 branch
            : [branchId],
      assignedVehiclePlate: role === 'conductor' ? '2345-TGB' : undefined,
      assignedMobileNumber: role === 'conductor' ? 'M-14' : undefined,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    if (currentUser) {
      try {
        await setDoc(doc(db, 'users', currentUser.uid), updated)
      } catch (err) {
        console.warn('Advertencia al sincronizar usuario con Firestore local:', err)
      }
    }

    saveProfile(updated)
    _setCurrentBranchId(branchId)
  }

  const hasRole = (roles: UserRole[]) => {
    if (!userProfile || userProfile.isActive === false) return false
    return roles.includes(userProfile.role) || userProfile.role === 'directiva_admin'
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        authError,
        currentBranchId,
        setCurrentBranchId,
        switchBranch,
        isLoading,
        signIn,
        signOut,
        resetPassword,
        devSwitchRole,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider')
  return context
}
