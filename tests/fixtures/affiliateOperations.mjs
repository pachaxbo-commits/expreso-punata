export const prefix = 'phase1-fiscalizacion'
export const sample = [
  ['encomiendas', 'shipments', { originBranchId: 'cochabamba', destinationBranchId: 'punata', trackingCode: 'GUIA-SEGURA' }],
  ['pasajes', 'passenger_ticket_operations', { operationNumber: 'PASAJE-SEGURO' }],
  ['almacen', 'branches/punata/shelves', { name: 'ESTANTE-SEGURO' }],
  ['caja', 'cash_shifts', { shiftNumber: 'TURNO-SEGURO' }],
  ['comisiones', 'driver_commission_records', { originBranchId: 'punata', trackingCode: 'GUIA-COMISION' }],
  ['afiliados', 'union_members', { memberNumber: 'AFILIADO-SEGURO' }],
  ['aportes', 'union_dues', { amountCents: 4300 }],
  ['prestamos', 'union_loans', { memberId: prefix, loanNumber: 'PRESTAMO-SEGURO' }],
  ['multas', 'union_fines', { amountCents: 4700 }],
  ['deportes', 'union_sports_events', { activityName: 'JORNADA-SEGURA' }],
  ['inventario', 'fixed_assets', { assetCode: 'ACTIVO-SEGURO' }],
  ['personal', 'union_workers', { workerCode: 'TRABAJADOR-SEGURO' }],
  ['gastos', 'union_expenses', { voucherNumber: 'EGRESO-SEGURO' }],
  ['reportes', 'financial_movements', { category: 'MOVIMIENTO-SEGURO' }],
  ['historial', 'shipment_incidents', { trackingCode: 'INCIDENCIA-SEGURA' }],
]
