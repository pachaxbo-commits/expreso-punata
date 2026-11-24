/**
 * Vite reemplaza `import.meta.env` en los builds de la aplicación. Los tests
 * que ejecutan módulos TypeScript directamente con Node no tienen ese objeto.
 * Mantener un fallback vacío deja intacta la configuración de producción y
 * permite importar servicios sin inicializar el transformador de Vite.
 */
export interface ViteEnvironment extends Record<string, string | boolean | undefined> {
  DEV?: boolean
  PROD?: boolean
  SSR?: boolean
}

export const viteEnv = (import.meta.env ?? {}) as unknown as ViteEnvironment
