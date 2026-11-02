import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

/**
 * Configuración de Firebase para S.M.T. Expreso Punata.
 * En entorno de desarrollo o local, se conecta automáticamente a los emuladores
 * para garantizar cero costos, aislamiento total y pruebas seguras sin tocar producción.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-expreso-punata-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'expreso-punata-dev.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-expreso-punata-dev',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-expreso-punata-dev.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1234567890',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1234567890:web:abcdef',
}

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

// Conexión automática a Emuladores en desarrollo local
const isLocalhost = Boolean(
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local'))
)

if (import.meta.env.DEV || isLocalhost) {
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
    console.log('[Expreso Punata] Conectado a Emuladores Locales de Firebase (Auth: 9099, Firestore: 8080, Storage: 9199)')
  } catch (err) {
    console.warn('[Expreso Punata] Advertencia al conectar emuladores:', err)
  }
}
