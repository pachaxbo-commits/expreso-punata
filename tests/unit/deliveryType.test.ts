import assert from 'node:assert/strict'
import test from 'node:test'
import { getDeliveryTypeLabel } from '../../src/domain/deliveryType.ts'

test('muestra la modalidad de conductor en ruta en el resumen', () => {
  assert.equal(getDeliveryTypeLabel('direct_driver'), 'Conductor en Ruta')
})

test('mantiene las etiquetas de agencia y domicilio', () => {
  assert.equal(getDeliveryTypeLabel('agency'), 'En Agencia')
  assert.equal(getDeliveryTypeLabel('home'), 'A Domicilio')
})
