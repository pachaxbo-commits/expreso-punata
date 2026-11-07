export interface StorageLocationSummary {
  warehouseName?: string
  warehouseId?: string
  shelfName?: string
  shelfId?: string
  moduleNumber?: number
  moduleId?: string
  rowNumber?: number
  floorNumber?: number
  spaceNumber?: number
}

export interface StorageShipmentLike {
  destinationBranchId: string
  status: string
  storageLocation?: StorageLocationSummary
}

export const isStorageBranchShipment = (shipment: StorageShipmentLike, branchId: string) =>
  shipment.destinationBranchId === branchId && ['received_at_dest', 'stored', 'uncollected'].includes(shipment.status)

export const needsStorageLocation = (shipment: StorageShipmentLike) =>
  ['received_at_dest', 'uncollected'].includes(shipment.status) && !shipment.storageLocation

export const isStoredInPhysicalLocation = (shipment: StorageShipmentLike) =>
  ['stored', 'uncollected'].includes(shipment.status) && Boolean(shipment.storageLocation)

export const formatStorageLocation = (location: StorageLocationSummary) => [
  location.warehouseName || location.warehouseId || 'Almacén 1',
  location.shelfName || location.shelfId || `Módulo ${location.moduleNumber || location.moduleId || 1}`,
  `Fila ${location.rowNumber || 1}`,
  `Piso ${location.floorNumber || 1}`,
  `Espacio ${location.spaceNumber || 1}`,
].join(' → ')
