export function formatShipmentCreationError(error: unknown): string {
  const errorObj = error as { code?: string; message?: string }
  const rawCode = errorObj?.code || 'unknown'
  const code = rawCode.replace(/^functions\//, '')
  const detail = errorObj?.message || 'El servidor no proporcionó detalles.'
  const suffix = ` (Referencia técnica: ${code})`

  if (code === 'permission-denied') {
    return `Tu usuario o la sucursal de origen no tiene permiso para registrar esta encomienda. Verifica tu perfil activo y la sucursal seleccionada. Detalle: ${detail}${suffix}`
  }
  if (code === 'unauthenticated') {
    return `La sesión expiró o no está autenticada. Inicia sesión nuevamente y vuelve a abrir el formulario. Detalle: ${detail}${suffix}`
  }
  if (code === 'invalid-argument') {
    return `Revisa los datos de la encomienda: ${detail}${suffix}`
  }
  if (code === 'failed-precondition') {
    const lowerDetail = detail.toLowerCase()
    if (lowerDetail.includes('turno de caja') || lowerDetail.includes('caja')) {
      return `${detail} Abre Caja del Turno en la misma sucursal y con tu usuario, o selecciona “Por pagar” si corresponde cobrar en destino.${suffix}`
    }
    if (lowerDetail.includes('configuración') || lowerDetail.includes('tarifa')) {
      return `La configuración necesaria para emitir la guía está pendiente. Solicita a Administración que revise las tarifas oficiales. Detalle: ${detail}${suffix}`
    }
    return `La operación no cumple una condición previa del sistema. ${detail}${suffix}`
  }
  if (code === 'aborted' || code === 'already-exists' || code === 'resource-exhausted') {
    return `La operación tuvo un conflicto de concurrencia. Conserva el formulario y reintenta una vez; la clave de solicitud evita duplicar la guía. Detalle: ${detail}${suffix}`
  }
  if (['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code)) {
    return `No se recibió confirmación del servidor por un problema de conexión. La guía podría haberse guardado; conserva este formulario y reintenta sin cambiar sus datos para consultar el mismo resultado de forma segura. Detalle: ${detail}${suffix}`
  }

  return `No se pudo confirmar el registro de la encomienda. Conserva este formulario y sus datos; si la respuesta se perdió, reintenta sin modificarlos para evitar una guía duplicada. Detalle: ${detail}${suffix}`
}
