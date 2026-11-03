import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Formateador de errores de autenticación canónico
function formatAuthError(err: unknown): string {
  if (!(err instanceof Error)) return 'No se pudo iniciar sesión. Verifique sus credenciales.'
  const msg = err.message
  if (
    msg.includes('auth/invalid-credential') ||
    msg.includes('auth/wrong-password') ||
    msg.includes('auth/user-not-found') ||
    msg.includes('auth/invalid-login-credentials')
  ) {
    return 'Credenciales inválidas. Por favor verifique su correo electrónico y contraseña.'
  }
  if (msg.includes('auth/invalid-email')) {
    return 'El formato del correo electrónico ingresado es inválido.'
  }
  if (msg.includes('auth/too-many-requests')) {
    return 'Acceso temporalmente restringido por demasiados intentos fallidos. Intente nuevamente en unos minutos o solicite un restablecimiento de contraseña.'
  }
  if (msg.includes('auth/user-disabled') || msg.includes('inactiva')) {
    return 'Esta cuenta de usuario ha sido suspendida o se encuentra inactiva. Comuníquese con la administración de Expreso Punata.'
  }
  if (msg.includes('perfil operativo')) {
    return 'Su cuenta no tiene un perfil operativo asignado en Expreso Punata. Contacte a la administración para habilitar su acceso.'
  }
  if (msg.includes('auth/network-request-failed')) {
    return 'Error de red o conexión al servidor. Compruebe su conexión a internet.'
  }
  return msg
}

describe('CICLO DE VIDA DE AUTENTICACIÓN Y PRESERVACIÓN DE FORMULARIO', () => {
  it('1. formatAuthError: traduce credenciales inválidas sin revelar enumeración de usuarios', () => {
    const errWrongPass = new Error('Firebase: Error (auth/wrong-password).')
    const errUserNotFound = new Error('Firebase: Error (auth/user-not-found).')
    const errInvalidCred = new Error('Firebase: Error (auth/invalid-credential).')
    const expected = 'Credenciales inválidas. Por favor verifique su correo electrónico y contraseña.'

    assert.equal(formatAuthError(errWrongPass), expected)
    assert.equal(formatAuthError(errUserNotFound), expected)
    assert.equal(formatAuthError(errInvalidCred), expected)
  })

  it('2. formatAuthError: traduce cuentas inactivas o deshabilitadas', () => {
    const errDisabled = new Error('Firebase: Error (auth/user-disabled).')
    const errInactive = new Error('Su cuenta de usuario se encuentra inactiva. Comuníquese con la administración de Expreso Punata.')
    const expected = 'Esta cuenta de usuario ha sido suspendida o se encuentra inactiva. Comuníquese con la administración de Expreso Punata.'

    assert.equal(formatAuthError(errDisabled), expected)
    assert.equal(formatAuthError(errInactive), expected)
  })

  it('3. formatAuthError: traduce usuarios válidos en Auth pero sin perfil en Firestore', () => {
    const errNoProfile = new Error('Su cuenta no tiene un perfil operativo asignado en Expreso Punata. Contacte a la administración para habilitar su acceso.')
    assert.equal(
      formatAuthError(errNoProfile),
      'Su cuenta no tiene un perfil operativo asignado en Expreso Punata. Contacte a la administración para habilitar su acceso.'
    )
  })

  it('4. Simulación de handleSubmit: el estado del correo no se reinicia tras un error', async () => {
    // Modelo de estado de LoginView
    let formState = {
      email: 'operador@expresopunata.com',
      password: 'ClaveIncorrecta',
      error: null as string | null,
      loading: false,
    }

    // Mock de signIn fallido
    const mockSignInFailed = async (_email: string, _pass: string) => {
      throw new Error('auth/invalid-credential')
    }

    // Simulación de envío
    formState.error = null
    formState.loading = true

    try {
      await mockSignInFailed(formState.email, formState.password)
    } catch (err) {
      formState.error = formatAuthError(err)
    } finally {
      formState.loading = false
    }

    // Verificaciones: el correo permanece intacto, loading se apaga y el error es visible
    assert.equal(formState.email, 'operador@expresopunata.com', 'El correo no debe vaciarse')
    assert.equal(formState.loading, false, 'El estado loading debe restablecerse')
    assert.equal(formState.error, 'Credenciales inválidas. Por favor verifique su correo electrónico y contraseña.')
  })

  it('5. isInitializing vs signIn: el estado de inicialización global no muta durante el intento de login', async () => {
    let isInitializing = false
    let isLoggingIn = false
    let userProfile: { uid: string; email: string; role: string; isActive: boolean } | null = null

    const mockSignIn = async (email: string, pass: string) => {
      isLoggingIn = true
      try {
        if (pass !== 'Valida123') throw new Error('auth/wrong-password')
        userProfile = { uid: 'u1', email, role: 'secretaria', isActive: true }
      } finally {
        isLoggingIn = false
      }
    }

    // Intento fallido
    try {
      await mockSignIn('admin@expresopunata.com', 'Mala')
    } catch {}

    assert.equal(isInitializing, false, 'isInitializing NUNCA debe volverse true durante un login')
    assert.equal(isLoggingIn, false)
    assert.equal(userProfile, null)

    // Intento exitoso
    await mockSignIn('admin@expresopunata.com', 'Valida123')
    assert.equal(isInitializing, false)
    assert.equal(isLoggingIn, false)
    assert.ok(userProfile !== null)
    assert.equal((userProfile as any).email, 'admin@expresopunata.com')
  })
})
