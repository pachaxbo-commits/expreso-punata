import React, { createContext, useContext, useState, useEffect } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  User as FirebaseUser,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, functions, isEmulatedEnvironment } from '../../firebase/config'
import type { UserProfile, UserRole } from '../../types'

export interface AuthContextType {
  currentUser: FirebaseUser | null
  userProfile: UserProfile | null
  authError: string | null
  currentBranchId: string
  setCurrentBranchId: (branchId: string) => void
  switchBranch: (branchId: string) => boolean
  isInitializing: boolean
  isLoggingIn: boolean
  isLoading: boolean // Aliased to isInitializing for backwards compatibility
  signIn: (email: string, pass: string) => Promise<UserProfile>
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
  const [isInitializing, setIsInitializing] = useState(true)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

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

  // Listener pasivo para bootstrap inicial y cambios de sesión externos (F5, token revoke, etc.)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user)

      if (user) {
        // Si el perfil ya coincide con el usuario autenticado (por ejemplo, cargado por signIn), no recargar
        if (userProfile && userProfile.uid === user.uid) {
          _setCurrentBranchId(userProfile.primaryBranchId || 'punata')
          setIsInitializing(false)
          return
        }

        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid))
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile

            if (data.isActive === false) {
              setAuthError('Su cuenta de usuario se encuentra inactiva. Comuníquese con la administración de Expreso Punata.')
              await fbSignOut(auth).catch(() => {})
              setUserProfile(null)
              _setCurrentBranchId('punata')
              saveProfile(null)
            } else {
              setUserProfile(data)
              const assignedBranch = data.primaryBranchId || 'punata'
              _setCurrentBranchId(assignedBranch)
              setAuthError(null)

              if (isEmulatedEnvironment) {
                saveProfile(data)
              }
            }
          } else {
            if (isEmulatedEnvironment) {
              const ensureProfile = httpsCallable(functions, 'ensureLocalUserProfile')
              await ensureProfile()
              const createdDoc = await getDoc(doc(db, 'users', user.uid))
              if (!createdDoc.exists()) throw new Error('El perfil local no pudo persistirse en Firestore Emulator.')
              const createdProfile = createdDoc.data() as UserProfile
              setUserProfile(createdProfile)
              _setCurrentBranchId(createdProfile.primaryBranchId || 'punata')
              saveProfile(createdProfile)
            } else {
              console.warn('[Auth Seguridad] Usuario autenticado sin perfil en Firestore:', user.uid)
              setAuthError('Su cuenta no tiene un perfil operativo asignado en Expreso Punata. Contacte a la administración para habilitar su sucursal y rol.')
              await fbSignOut(auth).catch(() => {})
              setUserProfile(null)
              _setCurrentBranchId('punata')
              saveProfile(null)
            }
          }
        } catch (e) {
          console.error('[Auth Error] Error al verificar perfil en Firestore:', e)
          setAuthError('Error de verificación de perfil en Firestore. Verifique su conexión al sistema.')
          setUserProfile(null)
          _setCurrentBranchId('punata')
          saveProfile(null)
        }
      } else {
        // Usuario no autenticado
        setUserProfile(null)
        _setCurrentBranchId('punata')
        saveProfile(null)
      }

      // El bootstrap inicial de Firebase concluye aquí
      setIsInitializing(false)
    })

    return () => unsubscribe()
  }, [userProfile])

  /**
   * Inicio de sesión determinístico y seguro:
   * 1. Autentica contra Firebase Auth.
   * 2. Recupera inmediatamente el perfil en Firestore.
   * 3. Valida isActive y asignación de agencia ANTES de resolver.
   * 4. En caso de error, limpia la sesión en Auth y propaga la excepción exacta
   *    sin provocar el desmontaje del formulario de login.
   */
  const signIn = async (email: string, pass: string): Promise<UserProfile> => {
    setIsLoggingIn(true)
    setAuthError(null)

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), pass)
      const user = userCredential.user

      const userDoc = await getDoc(doc(db, 'users', user.uid))
      if (!userDoc.exists()) {
        await fbSignOut(auth).catch(() => {})
        const missingErr = 'Su cuenta no tiene un perfil operativo asignado en Expreso Punata. Contacte a la administración para habilitar su acceso.'
        setAuthError(missingErr)
        throw new Error(missingErr)
      }

      const profileData = userDoc.data() as UserProfile

      if (profileData.isActive === false) {
        await fbSignOut(auth).catch(() => {})
        const inactiveErr = 'Su cuenta de usuario se encuentra inactiva. Comuníquese con la administración de Expreso Punata.'
        setAuthError(inactiveErr)
        throw new Error(inactiveErr)
      }

      setCurrentUser(user)
      setUserProfile(profileData)
      const assignedBranch = profileData.primaryBranchId || 'punata'
      _setCurrentBranchId(assignedBranch)

      if (isEmulatedEnvironment) {
        saveProfile(profileData)
      }

      return profileData
    } catch (err: unknown) {
      setUserProfile(null)
      saveProfile(null)
      throw err
    } finally {
      setIsLoggingIn(false)
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
            ? [branchId]
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
        isInitializing,
        isLoggingIn,
        isLoading: isInitializing, // Compatibilidad garantizada
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
