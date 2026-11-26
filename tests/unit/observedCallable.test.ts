import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { settleDiagnostic } from '../../src/firebase/observedCallable.ts'

describe('diagnóstico de callables no bloquea la operación principal', () => {
  it('conserva el resultado exitoso', async () => {
    assert.equal(await settleDiagnostic(Promise.resolve('ok'), 20), 'ok')
  })

  it('conserva el error original si el diagnóstico falla', async () => {
    const original = new Error('permission-denied')
    await assert.rejects(() => settleDiagnostic(Promise.reject(original), 20), (error) => error === original)
  })

  it('vence un diagnóstico pendiente sin alterar la operación original', async () => {
    await assert.rejects(() => settleDiagnostic(new Promise(() => {}), 5), /diagnostic pending/)
  })
})
