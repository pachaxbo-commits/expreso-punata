import test from 'node:test'
import assert from 'node:assert/strict'
import { elapsedFullDays, receptionDate } from '../../src/utils/shipmentTiming.ts'

test('shipmentTiming acepta Timestamp fiel de Firestore y fechas ausentes', () => {
  const received = new Date('2026-11-01T12:00:00.000Z')
  const timestamp = {
    toDate() {
      return received
    },
  }
  const shipment = { receivedAtIso: undefined, arrivedAt: timestamp }
  const now = new Date('2026-11-06T12:00:00.000Z')

  assert.equal(receptionDate(shipment)?.toISOString(), received.toISOString())
  assert.equal(elapsedFullDays(receptionDate(shipment), now), 5)
  assert.equal(elapsedFullDays(receptionDate({}), now), null)
})
