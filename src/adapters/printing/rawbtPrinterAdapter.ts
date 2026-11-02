import type { UnifiedDocumentPayload, PaperFormat, PrintResult } from '../../types/printing'

/**
 * Constructor de comandos ESC/POS para impresoras térmicas (58mm y 80mm).
 */
export class EscPosBuilder {
  private buffer: number[] = []

  constructor() {
    this.init()
  }

  init(): this {
    // ESC @: Inicializar impresora
    this.buffer.push(0x1b, 0x40)
    return this
  }

  align(alignment: 'left' | 'center' | 'right'): this {
    // ESC a n: 0=izq, 1=centro, 2=der
    const n = alignment === 'center' ? 1 : alignment === 'right' ? 2 : 0
    this.buffer.push(0x1b, 0x61, n)
    return this
  }

  bold(enable: boolean): this {
    // ESC E n: 1=activar, 0=desactivar
    this.buffer.push(0x1b, 0x45, enable ? 1 : 0)
    return this
  }

  doubleSize(enable: boolean): this {
    // GS ! n: 0x11 para 2x ancho y 2x alto, 0x00 normal
    this.buffer.push(0x1d, 0x21, enable ? 0x11 : 0x00)
    return this
  }

  text(str: string): this {
    // Codificación básica compatible ISO-8859-1 / ASCII para caracteres bolivianos comunes
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code < 128) {
        this.buffer.push(code)
      } else {
        // Reemplazos de acentos y caracteres especiales si la codepage no coincide
        const char = str[i]
        const map: Record<string, number> = {
          á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
          Á: 0x41, É: 0x45, Í: 0x49, Ó: 0x4f, Ú: 0x55,
          ñ: 0xa4, Ñ: 0xa5, '¿': 0xa8, '¡': 0xad
        }
        this.buffer.push(map[char] || 0x20)
      }
    }
    return this
  }

  line(str: string = ''): this {
    if (str) this.text(str)
    this.buffer.push(0x0a) // LF
    return this
  }

  separator(char: string = '-', width: number = 42): this {
    this.line(char.repeat(width))
    return this
  }

  feed(lines: number = 2): this {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0a)
    }
    return this
  }

  cut(): this {
    // GS V 66 0: Corte parcial con avance
    this.buffer.push(0x1d, 0x56, 0x42, 0x00)
    return this
  }

  kickDrawer(): this {
    // ESC p 0 25 250: Pulso para abrir gaveta en pin 2
    this.buffer.push(0x1b, 0x70, 0x00, 0x19, 0xfa)
    return this
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.buffer)
  }

  toBase64(): string {
    const bytes = this.toBytes()
    let binary = ''
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
}

/**
 * Construye el payload ESC/POS para un documento unificado de Expreso Punata.
 */
export function buildEscPosDocument(
  doc: UnifiedDocumentPayload,
  paperFormat: PaperFormat = '80mm',
  options: {
    cutPaper?: boolean
    kickDrawer?: boolean
  } = {}
): EscPosBuilder {
  const is58mm = paperFormat === '58mm'
  const colWidth = is58mm ? 32 : 48
  const builder = new EscPosBuilder()

  if (options.kickDrawer) {
    builder.kickDrawer()
  }

  // Encabezado
  builder.align('center')
  builder.doubleSize(true).bold(true).line('EXPRESO PUNATA').doubleSize(false).bold(false)
  builder.line('S.M.T. Transp. Interprovincial')
  builder.line(`Agencia: ${doc.branchName || doc.branchId}`)
  if (doc.branchPhone) builder.line(`Tel: ${doc.branchPhone}`)
  builder.separator('=', colWidth)

  builder.bold(true).line(doc.title.toUpperCase())
  if (doc.subtitle) builder.line(doc.subtitle)
  builder.line(`DOC: ${doc.documentNumber}`)
  if (doc.trackingCode) builder.line(`GUIA: ${doc.trackingCode}`)
  builder.bold(false)
  builder.separator('-', colWidth)

  // Metadatos
  builder.align('left')
  const dateStr = doc.timestampIso ? new Date(doc.timestampIso).toLocaleString('es-BO') : new Date().toLocaleString('es-BO')
  builder.line(`Fecha: ${dateStr}`)
  builder.line(`Operador: ${doc.operatorName}`)

  if (doc.dispatch) {
    builder.separator('-', colWidth)
    builder.line(`Ruta: ${doc.dispatch.originBranchName} -> ${doc.dispatch.destinationBranchName}`)
    if (doc.dispatch.vehiclePlate) builder.line(`Movil: ${doc.dispatch.mobileNumber || ''} (${doc.dispatch.vehiclePlate})`)
    if (doc.dispatch.driverName) builder.line(`Chofer: ${doc.dispatch.driverName}`)
    builder.line(`Bultos: ${doc.dispatch.totalPackages} (${doc.dispatch.totalWeightKg.toFixed(1)} kg)`)
  }

  if (doc.sender) {
    builder.separator('-', colWidth)
    builder.line(`Remitente: ${doc.sender.name}`)
    if (doc.sender.phone) builder.line(`Tel: ${doc.sender.phone}`)
  }

  if (doc.recipient) {
    builder.separator('-', colWidth)
    builder.line(`Consignatario: ${doc.recipient.name}`)
    if (doc.recipient.phone) builder.line(`Tel: ${doc.recipient.phone}`)
    if (doc.recipient.relationship) builder.line(`Parentesco: ${doc.recipient.relationship}`)
  }

  // Ítems
  if (doc.items && doc.items.length > 0) {
    builder.separator('-', colWidth)
    builder.bold(true).line('DETALLE DE CARGA / PAQUETES:').bold(false)
    for (const item of doc.items) {
      builder.line(`${item.quantity}x ${item.description}`)
      if (item.weightKg) builder.line(`   Peso: ${item.weightKg.toFixed(1)} kg`)
      if (item.totalBob !== undefined) builder.line(`   Subtotal: Bs ${item.totalBob.toFixed(2)}`)
    }
  }

  // Finanzas
  if (doc.financials) {
    builder.separator('-', colWidth)
    if (doc.financials.paymentTiming) {
      builder.line(`Condicion: ${doc.financials.paymentTiming === 'destination_cod' ? 'CONTRAENTREGA (COD)' : 'PAGADO EN ORIGEN'}`)
    }
    if (doc.financials.paymentMethod) {
      builder.line(`Metodo: ${doc.financials.paymentMethod.toUpperCase()}`)
    }
    if (doc.financials.driverBalanceBeforeBob !== undefined) {
      builder.line(`Saldo Chofer Antes: Bs ${doc.financials.driverBalanceBeforeBob.toFixed(2)}`)
      builder.line(`Rendido a Caja:     Bs ${(doc.financials.driverRemittanceBob || 0).toFixed(2)}`)
      builder.line(`Saldo Remanente:    Bs ${(doc.financials.driverBalanceRemainingBob || 0).toFixed(2)}`)
    }
    builder.separator('=', colWidth)
    builder.align('right')
    const totalBob = doc.financials.totalBob || (doc.financials.amountCents / 100) || 0
    builder.bold(true).doubleSize(true).line(`TOTAL: Bs ${totalBob.toFixed(2)}`).doubleSize(false).bold(false)
  }

  // Pie de página
  builder.align('center')
  builder.feed(1)
  builder.line('DOCUMENTO OPERATIVO INTERNO')
  builder.line('NO VALIDO PARA CREDITO FISCAL')
  builder.line('Expreso Punata - Seguridad y Confianza')

  if (options.cutPaper !== false) {
    builder.feed(3)
    builder.cut()
  } else {
    builder.feed(2)
  }

  return builder
}

/**
 * Envía el documento directamente a la aplicación Android RawBT vía Intent o Scheme URL.
 */
export async function printViaRawBt(
  doc: UnifiedDocumentPayload,
  paperFormat: PaperFormat = '80mm',
  options: {
    cutPaper?: boolean
    kickDrawer?: boolean
  } = {}
): Promise<PrintResult> {
  const jobId = `rawbt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const nowIso = new Date().toISOString()

  try {
    const builder = buildEscPosDocument(doc, paperFormat, options)
    const base64Data = builder.toBase64()

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        success: true,
        jobId,
        connectionType: 'rawbt_intent',
        dispatchedAtIso: nowIso,
      }
    }

    // Esquema de Intent estándar para ru.a402d.rawbtprinter en Android
    const intentUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`

    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = intentUrl
    document.body.appendChild(iframe)

    setTimeout(() => {
      try {
        if (iframe.parentNode) document.body.removeChild(iframe)
      } catch {}
    }, 2500)

    return {
      success: true,
      jobId,
      connectionType: 'rawbt_intent',
      bytesSent: builder.toBytes().length,
      dispatchedAtIso: nowIso,
    }
  } catch (err: any) {
    return {
      success: false,
      jobId,
      connectionType: 'rawbt_intent',
      errorMessage: err?.message || 'Error al comunicarse con la aplicación RawBT.',
      errorClassification: 'safeToRetry',
      dispatchedAtIso: nowIso,
    }
  }
}

/**
 * Detecta si el cliente actual está ejecutándose en un dispositivo Android.
 */
export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}
