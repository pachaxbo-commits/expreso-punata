import { viteEnv } from './viteEnv.ts'

/**
 * Funcionalidades opcionales del producto.
 * Las fotografías se conservan implementadas, pero la versión básica las mantiene ocultas.
 * Para una prueba local controlada puede habilitarse con VITE_STORAGE_PHOTOS_ENABLED=true.
 */
export const storagePhotosEnabled = viteEnv.VITE_STORAGE_PHOTOS_ENABLED === 'true'

/** El precio automático permanece en el código, pero requiere activación de build explícita. */
export const automaticParcelPricingEnabled = viteEnv.VITE_AUTOMATIC_PARCEL_PRICING_ENABLED === 'true'
