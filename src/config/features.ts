/**
 * Funcionalidades opcionales del producto.
 * Las fotografías se conservan implementadas, pero la versión básica las mantiene ocultas.
 * Para una prueba local controlada puede habilitarse con VITE_STORAGE_PHOTOS_ENABLED=true.
 */
export const storagePhotosEnabled = import.meta.env.VITE_STORAGE_PHOTOS_ENABLED === 'true'
