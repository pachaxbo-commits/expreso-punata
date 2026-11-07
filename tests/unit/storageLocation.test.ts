import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStorageLocation, isStorageBranchShipment, isStoredInPhysicalLocation, needsStorageLocation } from '../../src/utils/storageLocation.ts'

const location = { warehouseName: 'Almacén 1', shelfName: 'Módulo 1', moduleNumber: 1, rowNumber: 1, floorNumber: 1, spaceNumber: 1 }

test('uncollected permanece elegible para almacén y pendiente sin ubicación', () => {
  const shipment = { destinationBranchId: 'cochabamba', status: 'uncollected' }
  assert.equal(isStorageBranchShipment(shipment, 'cochabamba'), true)
  assert.equal(needsStorageLocation(shipment), true)
  assert.equal(isStoredInPhysicalLocation(shipment), false)
})

test('ubicación de uncollected conserva ocupación y datos financieros/históricos', () => {
  const shipment = { destinationBranchId: 'cochabamba', status: 'uncollected', paymentStatus: 'pending', currentIncidentType: 'uncollected', incidentHistory: [{ incidentNumber: 'INC-2026-00001' }], storageLocation: location }
  assert.equal(isStoredInPhysicalLocation(shipment), true)
  assert.equal(needsStorageLocation(shipment), false)
  assert.equal(shipment.paymentStatus, 'pending')
  assert.equal(shipment.currentIncidentType, 'uncollected')
  assert.equal(shipment.incidentHistory.length, 1)
})

test('contador de módulo cuenta una ubicación uncollected real', () => {
  const shipments = [{ destinationBranchId: 'cochabamba', status: 'uncollected', storageLocation: location }, { destinationBranchId: 'cochabamba', status: 'stored', storageLocation: { ...location, spaceNumber: 2 } }, { destinationBranchId: 'cochabamba', status: 'uncollected' }]
  const count = shipments.filter((shipment) => isStoredInPhysicalLocation(shipment) && shipment.storageLocation?.moduleNumber === 1).length
  assert.equal(count, 2)
})

test('detalle muestra almacén, módulo, fila, piso y espacio', () => {
  assert.equal(formatStorageLocation(location), 'Almacén 1 → Módulo 1 → Fila 1 → Piso 1 → Espacio 1')
})
