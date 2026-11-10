import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config.ts'
import type { ShipmentNotification } from '../types/index.ts'

export async function fetchShipmentNotifications(branchId: string): Promise<ShipmentNotification[]> {
  const callable = httpsCallable<{ branchId: string }, { notifications: ShipmentNotification[] }>(functions, 'listShipmentNotifications')
  const response = await callable({ branchId })
  return response.data.notifications
}

export async function markShipmentNotificationRead(input: { notificationId: string; branchId: string }): Promise<void> {
  const callable = httpsCallable<typeof input, { success: boolean; isRead: boolean }>(functions, 'markShipmentNotificationRead')
  await callable(input)
}
