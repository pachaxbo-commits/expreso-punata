import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

/**
 * Control de conexión a Emuladores:
 * 1. Si VITE_USE_FIREBASE_EMULATORS está definido explícitamente, manda su valor ('true' o 'false').
 * 2. Si no está definido, se conecta a emuladores solo en localhost/desarrollo local (modo offline seguro).
 */
const isLocalhost = Boolean(
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local'))
)

const shouldConnectEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
  (import.meta.env.VITE_USE_FIREBASE_EMULATORS === undefined && (import.meta.env.DEV || isLocalhost))

export const isEmulatedEnvironment = shouldConnectEmulators

// Lista de variables de entorno obligatorias para conectar a Firebase Cloud
const REQUIRED_CLOUD_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

let firebaseConfig: {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

if (shouldConnectEmulators) {
  // En entorno de emuladores locales, usamos las variables del entorno si existen,
  // o valores sintéticos 'demo-*' de aislamiento total para garantizar que ningún dato toque la nube.
  firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key-expreso-punata',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-expreso-punata',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-expreso-punata.appspot.com',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789012',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789012:web:demo-local',
  }
} else {
  // En entornos de nube desplegados (Vercel Preview, Vercel Production, o pruebas en la nube):
  // FAIL-CONTROLLED: Comprobar que NINGUNA variable requerida falte.
  // Prohibido utilizar valores de respaldo hardcodeados que oculten desconfiguraciones.
  const missingVars = REQUIRED_CLOUD_VARS.filter((varName) => {
    const val = import.meta.env[varName]
    return !val || typeof val !== 'string' || val.trim() === ''
  })

  if (missingVars.length > 0) {
    const errorMsg = `[Expreso Punata] ERROR CRÍTICO DE CONFIGURACIÓN: Faltan variables de entorno requeridas para conectar a Firebase Cloud: ${missingVars.join(', ')}. Configure estas variables en el panel de Vercel (o en .env.local) y vuelva a desplegar.`
    console.error(errorMsg)

    // Renderizar pantalla de diagnóstico inmediata si estamos en el navegador
    if (typeof document !== 'undefined') {
      const renderErrorBanner = () => {
        const root = document.getElementById('root') || document.body
        root.innerHTML = `
          <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;padding:24px;font-family:system-ui,-apple-system,sans-serif;">
            <div style="max-width:540px;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);border:1px solid #ef4444;">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <div style="width:40px;height:40px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;color:#b91c1c;font-weight:bold;font-size:20px;">!</div>
                <div>
                  <h1 style="font-size:18px;font-weight:800;color:#0f172a;margin:0;">EXPRESO PUNATA</h1>
                  <p style="font-size:12px;color:#ef4444;font-weight:600;margin:2px 0 0 0;">Error de Configuración de Entorno</p>
                </div>
              </div>
              <p style="font-size:13px;color:#334155;line-height:1.6;margin-bottom:16px;">
                La aplicación no pudo inicializarse porque las siguientes variables de Firebase Cloud no están configuradas en este entorno:
              </p>
              <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:12px;font-family:monospace;font-size:11px;color:#b91c1c;margin-bottom:20px;">
                ${missingVars.map((v) => `<div>• ${v}</div>`).join('')}
              </div>
              <p style="font-size:12px;color:#64748b;margin:0;">
                Consulte con el administrador de Vercel / PACHAX para configurar las variables requeridas.
              </p>
            </div>
          </div>
        `
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderErrorBanner)
      } else {
        renderErrorBanner()
      }
    }

    throw new Error(errorMsg)
  }

  firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  }
}

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'us-central1')

if (shouldConnectEmulators) {
  const emulatorHost = '127.0.0.1'
  const emulatorPorts = {
    auth: Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099),
    firestore: Number(import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080),
    storage: Number(import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9199),
    functions: Number(import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001),
  }
  try {
    // Solo conectar si no han sido conectados previamente
    // @ts-expect-error internal flag
    if (!auth._emulator) {
      connectAuthEmulator(auth, `http://${emulatorHost}:${emulatorPorts.auth}`, { disableWarnings: true })
    }
    // @ts-expect-error internal flag
    if (!db._settingsFrozen) {
      connectFirestoreEmulator(db, emulatorHost, emulatorPorts.firestore)
    }
    // @ts-expect-error internal flag
    if (!storage._emulator) {
      connectStorageEmulator(storage, emulatorHost, emulatorPorts.storage)
    }
    // @ts-expect-error internal flag
    if (!functions.emulatorOrigin) {
      connectFunctionsEmulator(functions, emulatorHost, emulatorPorts.functions)
    }
    console.log('[Expreso Punata] Conectado a Emuladores Locales de Firebase (Auth: 9099, Firestore: 8080, Storage: 9199, Functions: 5001)')
  } catch (err) {
    console.warn('[Expreso Punata] Advertencia al conectar emuladores:', err)
  }
} else {
  console.log(`[Expreso Punata] Conectado a Firebase Cloud: ${firebaseConfig.projectId}`)
}
