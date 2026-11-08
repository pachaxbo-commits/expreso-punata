import test from 'node:test'
import assert from 'node:assert/strict'
import { formatShipmentCreationError } from '../../src/services/shipmentErrors.ts'

test('createShipment: explica cómo resolver caja cerrada sin convertir el cobro en pendiente', () => {
  const message = formatShipmentCreationError({
    code: 'functions/failed-precondition',
    message: "No tiene un turno de caja abierto en la sucursal de origen 'punata'.",
  })

  assert.match(message, /Abre Caja del Turno/)
  assert.match(message, /Por pagar/)
  assert.match(message, /failed-precondition/)
})

test('createShipment: distingue sesión expirada y usuario o sucursal sin permiso', () => {
  assert.match(
    formatShipmentCreationError({ code: 'functions/unauthenticated', message: 'expired' }),
    /Inicia sesión nuevamente/,
  )
  assert.match(
    formatShipmentCreationError({ code: 'functions/permission-denied', message: 'branch mismatch' }),
    /perfil activo y la sucursal seleccionada/,
  )
})

test('createShipment: conflictos y respuesta incierta preservan el formulario e idempotencia', () => {
  const conflict = formatShipmentCreationError({ code: 'functions/aborted', message: 'transaction retry' })
  const uncertain = formatShipmentCreationError({ code: 'functions/unavailable', message: 'connection lost' })

  assert.match(conflict, /clave de solicitud evita duplicar la guía/)
  assert.match(uncertain, /La guía podría haberse guardado/)
  assert.match(uncertain, /reintenta sin cambiar sus datos/)
})

test('createShipment: valida datos y configuración con instrucciones operativas', () => {
  assert.match(
    formatShipmentCreationError({ code: 'functions/invalid-argument', message: 'invalid phone' }),
    /Revisa los datos de la encomienda/,
  )
  assert.match(
    formatShipmentCreationError({ code: 'functions/failed-precondition', message: 'Falta la configuración tarifaria oficial.' }),
    /revise las tarifas oficiales/,
  )
})
