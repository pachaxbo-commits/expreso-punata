import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

/**
 * Configuración de Firebase para Expreso Punata (Desarrollo).
 * Proyecto aislado: expreso-punata-dev
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAWSWtpZXjhDgq7IPS-Mvo4dp2cJsEqawg',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'expreso-punata-dev.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'expreso-punata-dev',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'expreso-punata-dev.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '405140168085',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:405140168085:web:a94720c5be75f910996a9c',
}

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

// Control de conexión a Emuladores:
// 1. Si VITE_USE_FIREBASE_EMULATORS está definido, manda su valor explícito ('true' o 'false').
// 2. Si no está definido, se conecta a emuladores solo en localhost/desarrollo local.
const isLocalhost = Boolean(
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local'))
)

const shouldConnectEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
  (import.meta.env.VITE_USE_FIREBASE_EMULATORS === undefined && (import.meta.env.DEV || isLocalhost))

if (shouldConnectEmulators) {
  const emulatorHost = '127.0.0.1'
  try {
    // Solo conectar si no han sido conectados previamente
    // @ts-expect-error internal flag
    if (!auth._emulator) {
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
    }
    // @ts-expect-error internal flag
    if (!db._settingsFrozen) {
      connectFirestoreEmulator(db, emulatorHost, 8080)
    }
    // @ts-expect-error internal flag
    if (!storage._emulator) {
      connectStorageEmulator(storage, emulatorHost, 9199)
    }
    // @ts-expect-error internal flag
    if (!functions.emulatorOrigin) {
      connectFunctionsEmulator(functions, emulatorHost, 5001)
    }
    console.log('[Expreso Punata] Conectado a Emuladores Locales de Firebase (Auth: 9099, Firestore: 8080, Storage: 9199, Functions: 5001)')
  } catch (err) {
    console.warn('[Expreso Punata] Advertencia al conectar emuladores:', err)
  }
} else {
  console.log('[Expreso Punata] Conectado a Firebase Cloud: expreso-punata-dev')
}
