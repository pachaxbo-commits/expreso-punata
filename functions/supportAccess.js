import { HttpsError } from 'firebase-functions/v2/https'

export const inFirebaseEmulators = (env = process.env) => env.FUNCTIONS_EMULATOR === 'true'
  && Boolean(env.FIRESTORE_EMULATOR_HOST)
  && (env.GCLOUD_PROJECT || '').startsWith('demo-')

export async function verifySupportSession(authAdmin, request, recent = false, env = process.env) {
  const now = Date.now() / 1000
  const authTime = request.auth?.token?.auth_time
  if (recent && (!Number.isFinite(authTime) || now - authTime > 300 || authTime > now + 30)) {
    throw new HttpsError('failed-precondition', 'Vuelva a autenticarse para continuar.')
  }
  if (inFirebaseEmulators(env)) return
  if (!request.auth?.token?.firebase?.sign_in_second_factor) throw new HttpsError('permission-denied', 'Se requiere autenticación multifactor.')
  const bearer = request.rawRequest?.headers?.authorization?.match(/^Bearer (.+)$/i)?.[1]
  if (!authAdmin || !bearer) throw new HttpsError('unauthenticated', 'No se pudo verificar la sesión técnica.')
  try {
    const decoded = await authAdmin.verifyIdToken(bearer, true)
    if (decoded.uid !== request.auth.uid || !decoded.firebase?.sign_in_second_factor) throw new HttpsError('permission-denied', 'El token no acredita el segundo factor requerido.')
    if ((await authAdmin.getUser(request.auth.uid)).disabled) throw new HttpsError('permission-denied', 'La identidad técnica está deshabilitada.')
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('unauthenticated', 'La sesión técnica fue revocada o no es válida.')
  }
}
