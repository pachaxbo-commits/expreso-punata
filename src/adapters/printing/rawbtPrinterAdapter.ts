import {
  type UnifiedDocumentPayload,
  type PaperFormat,
  type PrintResult,
  resolvePaymentConditionLabel,
} from '../../types/printing.ts'

/**
 * Constructor de comandos ESC/POS para impresoras térmicas (58mm y 80mm).
 * Configurado con CodePage 1252 (WPC1252) para soporte nativo de español (tildes y eñes).
 */
export class EscPosBuilder {
  private buffer: number[] = []

  constructor() {
    this.init()
  }

  init(): this {
    // ESC @: Inicializar impresora
    this.buffer.push(0x1b, 0x40)
    // ESC t 16: Seleccionar Code Page 1252 (WPC1252 / Latin-1)
    this.buffer.push(0x1b, 0x74, 16)
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

  /**
   * Codifica texto en Code Page 1252 para impresión de caracteres en español.
   */
  text(str: string): this {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code < 128) {
        this.buffer.push(code)
      } else {
        const char = str[i]
        // Tabla de mapeo a CP1252 (Western European)
        const map: Record<string, number> = {
          á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ú: 0xfa,
          Á: 0xc1, É: 0xc9, Í: 0xcd, Ó: 0xd3, Ú: 0xda,
          ñ: 0xf1, Ñ: 0xd1,
          ü: 0xfc, Ü: 0xdc,
          '¡': 0xa1, '¿': 0xbf, 'º': 0xba, 'ª': 0xaa,
        }
        this.buffer.push(map[char] ?? 0x20)
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
    // GS V 66 0: Corte parcial con avance de papel
    this.buffer.push(0x1d, 0x56, 0x42, 0x00)
    return this
  }

  kickDrawer(): this {
    // ESC p 0 25 250: Pulso para abrir gaveta en pin 2
    this.buffer.push(0x1b, 0x70, 0x00, 0x19, 0xfa)
    return this
  }

  /**
   * Imprime un código QR nativo ESC/POS (Model 2).
   */
  qrCode(content: string): this {
    const dataBytes: number[] = []
    for (let i = 0; i < content.length; i++) {
      dataBytes.push(content.charCodeAt(i) & 0xff)
    }
    const len = dataBytes.length + 3
    const pL = len % 256
    const pH = Math.floor(len / 256)

    // 1. Establecer modelo QR (Modelo 2)
    this.buffer.push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
    // 2. Establecer tamaño del módulo (4 puntos)
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04)
    // 3. Establecer nivel de corrección de error (Nivel M = 49)
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31)
    // 4. Almacenar datos en el buffer del símbolo
    this.buffer.push(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...dataBytes)
    // 5. Imprimir el símbolo QR
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30)
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
 * Respeta la identidad oficial EXPRESO PUNATA y datos reales de sucursal.
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
  const colWidth = is58mm ? 32 : 44
  const builder = new EscPosBuilder()

  if (options.kickDrawer) {
    builder.kickDrawer()
  }

  // Encabezado Oficial
  builder.align('center')
  builder.doubleSize(true).bold(true).line('EXPRESO PUNATA').doubleSize(false).bold(false)
  builder.line(`Agencia: ${doc.branchName || doc.branchId}`)
  if (doc.branchAddress) builder.line(doc.branchAddress)
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

  // Condición real de cobro
  const paymentCondition = resolvePaymentConditionLabel(doc.financials)
  builder.bold(true).line(`Condicion: ${paymentCondition}`).bold(false)

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

  // Código QR nativo
  const qrContent = doc.qrContent || (doc.trackingCode ? `EXPRESO-PUNATA:${doc.trackingCode}` : null)
  if (qrContent) {
    builder.feed(1).align('center')
    builder.qrCode(qrContent)
    builder.feed(1)
  }

  // Pie de página oficial
  builder.align('center')
  builder.feed(1)
  builder.line('DOCUMENTO OPERATIVO INTERNO')
  builder.line('NO CONSTITUYE FACTURA FISCAL')
  builder.line('Expreso Punata — Cochabamba y Punata')

  if (options.cutPaper !== false) {
    builder.feed(3)
    builder.cut()
  } else {
    builder.feed(2)
  }

  return builder
}

/**
 * Envía el documento a la aplicación Android RawBT mediante el esquema oficial ru.a402d.rawbtprinter.
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
        status: 'dispatched_to_driver',
        message: 'Contexto de prueba sin navegador detectado.',
        bytesSent: builder.toBytes().length,
        dispatchedAtIso: nowIso,
      }
    }

    // Esquema de Intent estándar para ru.a402d.rawbtprinter en Android
    const intentUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`

    // En navegadores Android modernos, asignar window.location.href o simular clic en enlace
    // funciona de manera más confiable que un iframe oculto para lanzar la app RawBT
    try {
      const link = document.createElement('a')
      link.href = intentUrl
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      setTimeout(() => {
        try {
          if (link.parentNode) document.body.removeChild(link)
        } catch {}
      }, 2000)
    } catch {
      window.location.href = intentUrl
    }

    return {
      success: true,
      jobId,
      connectionType: 'rawbt_intent',
      status: 'dispatched_to_driver',
      message: 'Documento enviado a la aplicación RawBT. Verifique la emisión física en su impresora.',
      bytesSent: builder.toBytes().length,
      dispatchedAtIso: nowIso,
    }
  } catch (err: any) {
    return {
      success: false,
      jobId,
      connectionType: 'rawbt_intent',
      status: 'failed',
      message: 'Fallo al comunicarse con la aplicación RawBT.',
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
