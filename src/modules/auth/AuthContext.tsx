import React, { createContext, useContext, useState, useEffect } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from '../../firebase/config'
import type { UserProfile, UserRole } from '../../types'

interface AuthContextType {
  currentUser: FirebaseUser | null
  userProfile: UserProfile | null
  currentBranchId: string
  setCurrentBranchId: (branchId: string) => void
  isLoading: boolean
  signIn: (email: string, pass: string) => Promise<void>
  signOut: () => Promise<void>
  devSwitchRole: (role: UserRole, branchId?: string) => Promise<void>
  hasRole: (roles: UserRole[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [currentBranchId, setCurrentBranchId] = useState<string>('punata')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      setCurrentUser(user)
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid))
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile
            setUserProfile(data)
            if (data.primaryBranchId) {
              setCurrentBranchId(data.primaryBranchId)
            }
          } else {
            // Perfil por defecto si no existe en desarrollo
            const defaultProfile: UserProfile = {
              uid: user.uid,
              fullName: user.displayName || user.email?.split('@')[0] || 'Operador Punata',
              ci: '1234567-CB',
              phone: '71798765',
              role: 'secretaria',
              primaryBranchId: 'punata',
              allowedBranchIds: ['punata', 'cochabamba'],
              isActive: true,
              createdAt: new Date().toISOString(),
            }
            await setDoc(doc(db, 'users', user.uid), defaultProfile)
            setUserProfile(defaultProfile)
          }
        } catch (e) {
          console.error('Error al cargar perfil:', e)
        }
      } else {
        setUserProfile(null)
      }
      setIsLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const signIn = async (email: string, pass: string) => {
    setIsLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, pass)
    } finally {
      setIsLoading(false)
    }
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUserProfile(null)
  }

  // Permite simular rápidamente los 5 roles en entorno de desarrollo
  const devSwitchRole = async (role: UserRole, branchId = 'punata') => {
    if (!currentUser) return
    const updated: UserProfile = {
      uid: currentUser.uid,
      fullName: `Usuario ${role.toUpperCase()}`,
      ci: '7654321-CB',
      phone: '70011223',
      role,
      primaryBranchId: branchId,
      allowedBranchIds: role === 'directiva_admin' || role === 'tesoreria' ? ['punata', 'cochabamba'] : [branchId],
      assignedVehiclePlate: role === 'conductor' ? '2345-TGB' : undefined,
      assignedMobileNumber: role === 'conductor' ? 'M-14' : undefined,
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    await setDoc(doc(db, 'users', currentUser.uid), updated)
    setUserProfile(updated)
    setCurrentBranchId(branchId)
  }

  const hasRole = (roles: UserRole[]) => {
    if (!userProfile) return false
    return roles.includes(userProfile.role) || userProfile.role === 'directiva_admin'
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        currentBranchId,
        setCurrentBranchId,
        isLoading,
        signIn,
        signOut,
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
