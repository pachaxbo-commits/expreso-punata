export function parseShipmentDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const timestamp = value as { toDate?: () => Date }
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate()
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
    }
  }
  const date = new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

export function elapsedFullDays(value: unknown, now = new Date()): number | null {
  const date = parseShipmentDate(value)
  if (!date || date.getTime() > now.getTime()) return null
  return Math.floor((now.getTime() - date.getTime()) / 86400000)
}

export function receptionDate(shipment: { receivedAtIso?: unknown; arrivedAt?: unknown }): Date | null {
  return parseShipmentDate(shipment.receivedAtIso) || parseShipmentDate(shipment.arrivedAt)
}
