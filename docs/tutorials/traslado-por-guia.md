# Traslado por guía — integración en revisión

En Encomiendas, la sucursal de origen selecciona vehículo y conductor y confirma la salida. La aplicación registra un viaje de una sola guía. El conductor asignado acepta la custodia en Encomiendas asignadas. En destino se busca la guía, se cuentan los bultos y se registra su condición. Si hay diferencias, se exige una observación y la guía queda en el estado de incidencia correspondiente. Una recepción conforme habilita el cobro y la entrega existentes.

El control de caja, la firma, los roles, la aceptación de custodia y las reglas de idempotencia de cobro se mantienen. Los registros avanzados conservan su ruta de recepción. La operación simplificada exige autorización sobre la sucursal incluso para administradores. La auditoría guarda operador, sucursal, fecha y estados anterior y nuevo.

## Orden de publicación

1. Completar el recorrido de navegador, la simulación local de salida y recepción y el material de capacitación. Probar el recorrido autenticado con el emulador.
2. Obtener autorización específica y publicar confirmShipmentDeparture, confirmShipmentReception, receiveDispatchManifest y deliverShipment en el proyecto aprobado. La recepción avanzada debe reconocer los traslados por guía y la entrega debe impedir el retiro por conductor antes de la recepción.
3. Validar los endpoints publicados y activar VITE_SIMPLE_SHIPMENT_TRANSFER en un entorno de validación.
4. Separar comisiones y operaciones históricas del acceso comercial a Despachos antes de ocultarlo. Validar los cinco perfiles y los objetivos del tutorial.
5. Promover el cambio completo a main y comprobar Vercel Production.

La bandera está apagada por defecto. El avance no oculta Despachos ni cambia sus tutoriales.
