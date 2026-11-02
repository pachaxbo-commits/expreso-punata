import type {
  UnifiedDocumentPayload,
  PrinterProfile,
  PrintResult,
  PaperFormat,
} from '../../types/printing.ts'
import { getDefaultPrinter, loadPrinterProfiles } from './printerProfiles.ts'
import { printViaBrowserDialog, buildDocumentHtml } from '../../adapters/printing/browserDialogPrinterAdapter.ts'
import { printViaRawBt, isAndroidDevice } from '../../adapters/printing/rawbtPrinterAdapter.ts'
import { INITIAL_BRANCHES } from '../../domain/expresoPunataConfig.ts'

export class PrintEngineService {
  private static instance: PrintEngineService

  public static getInstance(): PrintEngineService {
    if (!PrintEngineService.instance) {
      PrintEngineService.instance = new PrintEngineService()
    }
    return PrintEngineService.instance
  }

  /**
   * Imprime un documento unificado usando la impresora predeterminada o especificada.
   */
  public async printDocument(
    doc: UnifiedDocumentPayload,
    printerOverride?: PrinterProfile
  ): Promise<PrintResult> {
    const branch = INITIAL_BRANCHES.find((b) => b.id === doc.branchId) || INITIAL_BRANCHES[0]
    const effectivePrinter = printerOverride || getDefaultPrinter(doc.branchId)

    // Completar datos de sucursal si faltan
    if (!doc.branchName) doc.branchName = branch.name
    if (!doc.branchAddress) doc.branchAddress = branch.address
    if (!doc.branchPhone) doc.branchPhone = branch.phone

    const paperFormat: PaperFormat = effectivePrinter.paperFormat || '80mm'
    const options = {
      fontSize: effectivePrinter.capabilities.fontSize,
      marginsMm: effectivePrinter.capabilities.marginsMm,
      includeQr: effectivePrinter.capabilities.supportsQrCode,
      includeLogo: effectivePrinter.capabilities.supportsLogo,
      cutPaper: effectivePrinter.cutPaperOnFinish,
      kickDrawer: effectivePrinter.kickDrawerOnReceipt,
    }

    if (effectivePrinter.connectionType === 'rawbt_intent') {
      return await printViaRawBt(doc, paperFormat, options)
    }

    // Por defecto y para Windows USB: Diálogo estándar de navegador
    return await printViaBrowserDialog(doc, paperFormat, options)
  }

  /**
   * Genera el código HTML del documento para vista previa en pantalla o modal.
   */
  public async generatePreviewHtml(
    doc: UnifiedDocumentPayload,
    paperFormat: PaperFormat = '80mm'
  ): Promise<string> {
    return await buildDocumentHtml(doc, paperFormat)
  }

  /**
   * Genera e imprime un ticket de prueba y diagnóstico de estación de trabajo.
   */
  public async printTestTicket(
    branchId: string = 'punata',
    operatorName: string = 'Administrador',
    printerOverride?: PrinterProfile
  ): Promise<PrintResult> {
    const branch = INITIAL_BRANCHES.find((b) => b.id === branchId) || INITIAL_BRANCHES[0]
    const nowIso = new Date().toISOString()
    const printer = printerOverride || getDefaultPrinter(branchId)

    const testDoc: UnifiedDocumentPayload = {
      documentType: 'test_page',
      title: 'PÁGINA DE PRUEBA Y DIAGNÓSTICO',
      subtitle: 'PACHAX Printing Core — Expreso Punata',
      branchId,
      branchName: branch.name,
      branchAddress: branch.address,
      branchPhone: branch.phone,
      documentNumber: `TEST-${Date.now().toString().slice(-6)}`,
      timestampIso: nowIso,
      operatorName,
      operatorRole: 'Operador / Administrador',
      qrContent: `EXPRESO-PUNATA:TEST-PRINT:${branchId}:${printer.id}:${nowIso}`,
      items: [
        { description: 'Verificación de fuentes y márgenes', quantity: 1, unitPriceBob: 0, totalBob: 0 },
        { description: 'Alineación de columnas térmicas', quantity: 1, unitPriceBob: 0, totalBob: 0 },
        { description: 'Contraste de líneas y separadores', quantity: 1, unitPriceBob: 0, totalBob: 0 },
      ],
      financials: {
        subtotalBob: 0,
        totalBob: 0,
        amountCents: 0,
      },
      footerNotes: [
        `Impresora: ${printer.name}`,
        `Conexión: ${printer.connectionType.toUpperCase()}`,
        `Formato: ${printer.paperFormat} | Margen: ${printer.capabilities.marginsMm}mm`,
        `Plataforma: ${isAndroidDevice() ? 'Android (RawBT Ready)' : 'Windows / Web (Browser Dialog Ready)'}`,
        'Si lee este mensaje con claridad, su estación está lista para operar.',
      ],
    }

    return await this.printDocument(testDoc, printer)
  }

  /**
   * Ejecuta un autodiagnóstico de capacidades del dispositivo actual.
   */
  public runDiagnostics(branchId: string = 'punata') {
    const isAndroid = isAndroidDevice()
    const profiles = loadPrinterProfiles(branchId)
    const hasLocalStorage = typeof localStorage !== 'undefined'
    const defaultPrinter = profiles.find((p) => p.isDefault) || profiles[0]

    return {
      platform: isAndroid ? 'Android' : 'Windows / Escritorio',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
      storageAvailable: hasLocalStorage,
      activeProfilesCount: profiles.length,
      defaultPrinterName: defaultPrinter?.name || 'Ninguna configurada',
      defaultFormat: defaultPrinter?.paperFormat || '80mm',
      defaultConnection: defaultPrinter?.connectionType || 'browser_dialog',
      rawBtSupported: isAndroid,
      browserDialogSupported: typeof window !== 'undefined',
      readyForProduction: profiles.length > 0 && hasLocalStorage,
    }
  }
}

export const printEngine = PrintEngineService.getInstance()
