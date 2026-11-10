/**
 * Normaliza un único número telefónico a dígitos E.164 para el enlace oficial wa.me.
 * Los números locales sin prefijo se interpretan como bolivianos solo si tienen
 * 7 u 8 dígitos. Para otros países se requiere +, 00 o un código internacional explícito.
 */
export function normalizeWhatsAppNumber(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null
  const value = phone.trim()
  if (!value || /[/,;]|\b(?:ext|anexo)\b/i.test(value) || !/^[+\d\s().-]+$/.test(value)) return null

  const hasPlus = value.startsWith('+')
  const hasInternationalPrefix = value.startsWith('00')
  if (value.includes('+') && !hasPlus) return null
  let digits = value.replace(/\D/g, '')
  if (hasInternationalPrefix) digits = digits.slice(2)
  else if (hasPlus) digits = digits
  else if (digits.length === 7 || digits.length === 8) digits = `591${digits}`

  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null
  return digits
}

export function buildWhatsAppChatUrl(phone: string | null | undefined): string | null {
  const digits = normalizeWhatsAppNumber(phone)
  return digits ? `https://wa.me/${digits}` : null
}
