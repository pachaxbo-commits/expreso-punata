# Traslado por guía

## Guion de capacitación

1. En origen, registra remitente, destinatario, ruta y bultos. Explica cuándo elegir Pagado en origen o Por pagar.
2. Abre la ficha de la guía. Selecciona vehículo y conductor y pulsa Confirmar salida.
3. Como conductor, abre Encomiendas asignadas. Comprueba la guía y confirma la custodia.
4. En destino, busca la guía y cuenta los bultos. Selecciona su condición física y anota cualquier daño o diferencia. Una incidencia mantiene bloqueados el cobro y la entrega normales.
5. Con recepción conforme, cobra en la caja de destino si figura Por pagar. La entrega en ventanilla permite cobrar y guardar la firma en una operación.
6. Comprueba la identidad de quien retira, recoge la firma y consulta el historial. Si se pierde la conexión, vuelve a buscar la guía y revisa su estado antes de reintentar.

En /demo se sigue la misma guía al cambiar de perfil. La asignación usa un vehículo y un conductor ficticios. El estado y la firma se guardan en el navegador y pueden borrarse con Reiniciar Demo. El JSON adjunto contiene los objetivos DOM y las líneas de narración.

## Publicación coordinada

1. Revisar la PR y completar las comprobaciones. Integrar hacia develop con ambas banderas apagadas.
2. Confirmar el proyecto y la región de las cuatro Functions y revisar, de solo lectura, los manifiestos en curso. Si quedan viajes avanzados activos, mantener temporalmente VITE_ADVANCED_DISPATCH=true hasta cerrar esos viajes. Las comisiones conservan su pantalla y sus registros.
3. Con autorización específica, publicar confirmShipmentDeparture, confirmShipmentReception, receiveDispatchManifest y deliverShipment con SIMPLE_SHIPMENT_TRANSFER apagado. Las dos existentes deben estar activas con las guardas nuevas antes de aceptar traslados por guía. driverConfirmCustody y collectShipmentPayment se reutilizan tal como están.
4. Tras verificar las cuatro revisiones, habilitar SIMPLE_SHIPMENT_TRANSFER=true únicamente en las dos callables nuevas. Validar configuración y disponibilidad antes de activar el frontend.
5. Configurar VITE_SIMPLE_SHIPMENT_TRANSFER=true para el release de frontend autorizado. Mantener el acceso avanzado temporal solo si el paso 2 lo requiere. Verificar Vercel Production READY en el SHA aprobado.
6. Ante un problema, restaurar primero la navegación avanzada o el frontend anterior y luego apagar la habilitación de las callables nuevas. El flujo avanzado puede recibir traslados iniciados y conserva las validaciones de discrepancias de la nueva versión.

Las pruebas HTTP usan Firebase Emulator Suite, tokens de Auth Emulator y un proyecto demo. El material de narración está escrito y pendiente de grabación.
