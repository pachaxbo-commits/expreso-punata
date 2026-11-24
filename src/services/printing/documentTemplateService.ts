import { observedHttpsCallable as httpsCallable } from '../../firebase/observedCallable.ts'
import { functions } from '../../firebase/config.ts'
import type { DocumentPrintType } from '../../types/printing.ts'
import { normalizeDocumentTemplate, type DocumentPrintTemplate } from './documentTemplates.ts'
import type { TicketTemplateHistoryEntry } from './ticketTemplateService.ts'

export async function loadDocumentPrintTemplate(documentType: DocumentPrintType): Promise<{ template: DocumentPrintTemplate | null; version: number; history: TicketTemplateHistoryEntry[]; canEdit: boolean }> {
  const call = httpsCallable<{ documentType: DocumentPrintType }, { template: DocumentPrintTemplate | null; version: number; history: TicketTemplateHistoryEntry[]; canEdit: boolean }>(functions, 'getDocumentPrintTemplate')
  const result = await call({ documentType })
  return { ...result.data, template: result.data.template ? normalizeDocumentTemplate(documentType, result.data.template) : null, history: result.data.history || [] }
}

export async function saveDocumentPrintTemplate(input: { documentType: DocumentPrintType; template?: DocumentPrintTemplate; expectedVersion: number; action?: 'save' | 'restore'; restoreVersion?: number }): Promise<{ success: boolean; version: number; template: DocumentPrintTemplate }> {
  const call = httpsCallable<typeof input, { success: boolean; version: number; template: DocumentPrintTemplate }>(functions, 'saveDocumentPrintTemplate')
  const result = await call(input)
  return { ...result.data, template: normalizeDocumentTemplate(input.documentType, result.data.template) }
}
