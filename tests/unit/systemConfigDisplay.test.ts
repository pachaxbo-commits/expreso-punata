import assert from 'node:assert/strict'
import test from 'node:test'
import { commissionDisplayValue } from '../../src/domain/commissionConfig.ts'

test('conserva una comisión persistida de 0 y no la sustituye por el valor predeterminado', () => {
  assert.equal(commissionDisplayValue(0), 0)
  assert.equal(commissionDisplayValue(undefined), 0)
  assert.equal(commissionDisplayValue(null), 0)
  assert.equal(commissionDisplayValue(10), 10)
})
