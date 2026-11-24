import { reportObservedError } from './observedCallable.ts'

let installed = false
export function installGlobalDiagnosticHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('unhandledrejection', event => {
    void reportObservedError(event.reason, { module: 'other', operation: 'unhandledRejection' })
  })
  window.addEventListener('error', event => {
    if (event.error) void reportObservedError(event.error, { module: 'other', operation: 'windowError' })
  })
}
