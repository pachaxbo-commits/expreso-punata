export type DeliveryType = 'agency' | 'home' | 'direct_driver'

export function getDeliveryTypeLabel(deliveryType: DeliveryType): string {
  if (deliveryType === 'home') return 'A Domicilio'
  if (deliveryType === 'direct_driver') return 'Conductor en Ruta'
  return 'En Agencia'
}
