import { observedHttpsCallable as httpsCallable } from '../../firebase/observedCallable.ts'
import { functions } from '../../firebase/config.ts'
import { normalizeShipmentTicketTemplate, type ShipmentTicketTemplate } from './ticketTemplates.ts'

export interface TicketTemplateHistoryEntry {
  version: number
  action: 'save' | 'restore'
  timestampIso: string
  uid: string
  restoredFrom?: number | null
}

export interface ShipmentTicketTemplateResponse {
  template: ShipmentTicketTemplate | null
  version: number
  history: TicketTemplateHistoryEntry[]
  canEdit: boolean
}

export async function loadShipmentTicketTemplate(): Promise<ShipmentTicketTemplateResponse> {
  const call = httpsCallable<void, ShipmentTicketTemplateResponse>(functions, 'getShipmentTicketTemplate')
  const result = await call()
  return {
    ...result.data,
    template: result.data.template ? normalizeShipmentTicketTemplate(result.data.template) : null,
    history: result.data.history || [],
  }
}

export async function saveShipmentTicketTemplate(input: {
  template?: ShipmentTicketTemplate
  expectedVersion: number
  action?: 'save' | 'restore'
  restoreVersion?: number
}): Promise<{ success: boolean; version: number; template: ShipmentTicketTemplate }> {
  const call = httpsCallable<typeof input, { success: boolean; version: number; template: ShipmentTicketTemplate }>(functions, 'saveShipmentTicketTemplate')
  const result = await call(input)
  return { ...result.data, template: normalizeShipmentTicketTemplate(result.data.template) }
}
