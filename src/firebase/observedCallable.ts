import { httpsCallable as firebaseHttpsCallable, type Functions, type HttpsCallableOptions, type HttpsCallableResult } from 'firebase/functions'

type DiagnosticPayload = { module: string; operation: string; code: string; category: string; correlationId: string; frontendVersion: string }
type DiagnosticContext = { module: string; operation: string }
const reportedErrors = new WeakSet<object>()

function correlationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '')
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  }
  return `inc${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
}

function classify(error: unknown): { category: string; code: string } {
  const raw = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unexpected'
  const candidate = raw.split('/').at(-1)?.toLowerCase() || 'unknown'
  const allowedCodes = new Set(['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'out-of-range', 'unavailable', 'deadline-exceeded', 'network-request-failed', 'internal', 'resource-exhausted', 'not-found', 'already-exists', 'aborted', 'cancelled', 'unknown', 'user-disabled', 'user-not-found', 'wrong-password', 'invalid-credential', 'too-many-requests', 'email-already-in-use', 'print_failed'])
  const code = allowedCodes.has(candidate) ? candidate : 'unknown'
  if (/auth\//i.test(raw) || /unauthenticated/i.test(raw)) return { category: 'authentication', code }
  if (/permission-denied|unauthorized/i.test(raw)) return { category: 'permission', code }
  if (/invalid-argument|failed-precondition|out-of-range/i.test(raw)) return { category: 'validation', code }
  if (/unavailable|deadline-exceeded|network|timeout/i.test(raw)) return { category: 'network', code }
  if (/firestore\//i.test(raw)) return { category: 'query', code }
  if (/functions\//i.test(raw) || /internal|resource-exhausted|not-found|already-exists|aborted/i.test(raw)) return { category: 'cloud_function', code }
  return { category: 'unexpected', code }
}

export async function reportObservedError(error: unknown, context: DiagnosticContext): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (error && typeof error === 'object') {
    if (reportedErrors.has(error)) return null
    reportedErrors.add(error)
  }
  const classified = classify(error)
  const category = context.module === 'printing' ? 'printing' : classified.category
  const { code } = classified
  const id = correlationId()
  try {
    const { functions } = await import('./config.ts')
    const diagnosticCall = firebaseHttpsCallable<DiagnosticPayload, { success: boolean; correlationId: string }>(functions, 'reportClientDiagnostic')
    const result = await diagnosticCall({ module: context.module, operation: context.operation, code, category, correlationId: id, frontendVersion: import.meta.env.VITE_APP_VERSION || '1.0.0' })
    return result.data.correlationId
  } catch {
    return null
  }
}

export function observedHttpsCallable<Request = unknown, Response = unknown>(
  firebaseFunctions: Functions,
  name: string,
  options?: HttpsCallableOptions,
) {
  const callable = firebaseHttpsCallable<Request, Response>(firebaseFunctions, name, options)
  const lowerName = name.toLowerCase()
  const module = name.startsWith('admin') || lowerName.includes('user') || lowerName.includes('worker') ? 'users'
    : lowerName.includes('cash') || lowerName.includes('expense') ? 'cash'
      : lowerName.includes('shipment') || lowerName.includes('manifest') ? 'shipments'
        : lowerName.includes('ticket') || lowerName.includes('passenger') ? 'tickets'
          : lowerName.includes('config') || lowerName.includes('commission') ? 'configuration'
            : lowerName.includes('print') ? 'printing' : 'other'
  return async (data?: Request): Promise<HttpsCallableResult<Response>> => {
    try {
      return await callable(data)
    } catch (error) {
      const id = await reportObservedError(error, { module, operation: name })
      if (id && error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
        try { Object.defineProperty(error, 'message', { configurable: true, value: `${error.message} (Incidencia: ${id})` }) } catch {}
      }
      throw error
    }
  }
}
