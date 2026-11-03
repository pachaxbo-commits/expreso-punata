import fs from 'node:fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
const match = envContent.match(/E2E_TEST_PASSWORD=["']?([^"'\r\n]+)["']?/)
const password = match ? match[1] : null

if (!password) {
  console.error('No se encontró contraseña en .env.local')
  process.exit(1)
}

const apiKey = 'AIzaSyAWSWtpZXjhDgq7IPS-Mvo4dp2cJsEqawg'
const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@expresopunata.com',
    password: password,
    returnSecureToken: true
  })
})

const json = await res.json()
if (json.idToken) {
  console.log('====================================================================')
  console.log('AUTENTICACIÓN VERIFICADA EXITOSAMENTE EN FIREBASE AUTH')
  console.log('====================================================================')
  console.log(`- Cuenta:       ${json.email}`)
  console.log(`- UID:          ${json.localId}`)
  console.log(`- Token emitido: Válido (Expira en ${json.expiresIn}s)`)
  console.log(`- Estado:       Aceptado 100% por Firebase Auth sin errores`)
  console.log('====================================================================')
} else {
  console.error('Error al autenticar:', json.error)
  process.exit(1)
}
