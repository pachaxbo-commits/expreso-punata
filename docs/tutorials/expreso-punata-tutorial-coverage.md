# Expreso Punata — cobertura del tutorial interactivo

**Actualizado:** 21 de noviembre de 2026. Esta matriz describe el código y las comprobaciones realizadas en `feature/sidebar-manual-tariffs`. La presencia de un recorrido explica el flujo disponible; por sí sola no prueba que todas las operaciones del módulo estén listas en producción.

## Estado implementado

El tutorial actual tiene **24 secciones y 69 pasos**. La lista de secciones se filtra por `UserRole`; sus anclas se prueban contra el código fuente y los pasos que necesitan formularios solicitan al orquestador abrirlos en modo educativo. Los formularios que abre el tutorial se cierran al pausar, finalizar o salir. El tutorial no pulsa botones de envío, cobro, verificación, impresión o cierre.

### Cobertura por rol

| Rol | Secciones y alcance que muestra el tutorial |
|---|---|
| `secretaria` | Encomiendas y precio manual, Caja, almacén, despachos y comisiones, reportes, navegación, venta QR de pasajes, consulta de afiliados/cuotas/préstamos/multas/deudas y multas deportivas. La aprobación de exenciones deportivas no se enseña como acción permitida. |
| `encargado_agencia` | Encomiendas, Caja, almacén, despacho, comisiones, personal/gastos, inventario, reportes, navegación y venta QR de pasajes. |
| `directiva_admin` | Operación, Caja, almacén, afiliados, préstamos/multas/deportes/deudas, Directiva anual, personal, activos/consumibles, reportes, impresoras y configuración. La directiva institucional no crea cuentas ni permisos. |
| `tesoreria` | Caja, afiliados/cuotas, préstamos/multas/deportes/deudas, Directiva anual, personal, activos/consumibles, reportes y consulta de pasajes. El tutorial no le muestra venta, verificación o liquidación de pasajes porque esos controles no están visibles para este rol en la interfaz actual. |
| `conductor` | Manifiestos/despachos según la configuración, comisiones, reportes, perfil, navegación y validación de sus propios pasajes. No muestra Caja ni venta de pasajes. La validación de pasajes se hace escribiendo el código; no hay lector de cámara en esta pantalla. |
| `afiliado` | Navegación y consulta de su propia cuenta: datos, saldos, cuotas, préstamos y multas. |
| `afiliado_admin` | Sin secciones en el tutorial actual. La aplicación no expone una pestaña principal para este rol; no se inventan rutas ni accesos para completar el tutorial. |

### Flujos explicados

- **Encomiendas:** el tutorial acompaña el asistente real por ruta, personas, carga y cobro. El importe se ingresa manualmente; las referencias tarifarias de configuración se explican como datos conservados y no como cálculo automático. Al avanzar, se cambia el paso interno del asistente sin guardar el envío.
- **Pasajes de oficina:** ruta/fecha/chofer, cantidad e importe manual, QR pendiente, verificación contra el abono real, historial, dos comprobantes, reimpresión marcada como duplicado y saldo pendiente del chofer.
- **Chofer:** consulta el código desde la pantalla de validación y explica los rechazos de pagos no verificados, operaciones ajenas, anuladas o sin usos disponibles.
- **Caja y QR:** el ingreso se clasifica como QR y no aumenta el efectivo físico. En la interfaz actual, la acción `Entregar efectivo` se inicia en Pasajes con un turno de Caja abierto; esa entrega descuenta efectivo y registra el movimiento en Caja. El tutorial comunica este recorrido observado, no afirma que el botón esté dentro de Caja.
- **Administración social:** padrón, cuotas, préstamos, multas, deportes, deudas y Directiva anual usan las subpestañas existentes. El tutorial distingue designaciones institucionales y cuentas informáticas.
- **Reembolsos:** se mantiene el bloqueo de anulación de pagos QR verificados. Una devolución excepcional necesita procedimiento y autorizaciones aprobados por Administración antes de habilitarse.

## Interacción y seguridad didáctica

`useTutorial.ts` sincroniza pestañas, subpestañas, el paso del asistente de encomienda, el formulario vacío de pasajes y el drawer móvil. Los formularios abiertos por el tutorial se cierran al pausar, salir o terminar la sección. El progreso local continúa aislado por UID y rol.

El indicador global distingue los roles que tienen la suscripción de Encomiendas: para ellos informa conexión a Firestore; para Chofer y otros roles sin esa suscripción indica `Sesión activa` y no deduce que Firestore esté conectado a partir de una lectura que no realiza.

La prueba unitaria comprueba IDs únicos/orden, campos pedagógicos, anclas declaradas, pestañas/subpestañas conocidas, roles y contextos de formulario permitidos. La prueba E2E comprueba cada ancla real y la coincidencia geométrica entre su rectángulo y el foco amarillo, incluyendo la transición de apertura del menú móvil; también verifica avanzar/retroceder/pausar/reanudar/finalizar, persistencia y que no cambien encomiendas, operaciones de pasajes ni movimientos financieros.

## Impresión de pasajes

El generador produce dos comprobantes vinculados al mismo número. El de oficina incluye operación, fecha, ruta, chofer, vehículo, cantidad, importe, estado QR, fecha de verificación, sucursal y entrega pendiente/realizada. El del chofer incluye esos datos y el código QR verificable. Una reimpresión marca ambas copias `DUPLICADO · REIMPRESIÓN`. El HTML define `@page` para rollos de 58 mm y 80 mm. La validación en navegador no reemplaza una prueba en impresora física.

## Limitaciones conocidas

- La liquidación del efectivo se inicia hoy desde **Pasajes** y se registra contra Caja. El requisito del Prompt 3 menciona “desde Caja”; no se cambió la ruta comercial para evitar duplicar el punto de liquidación sin definición del propietario del proceso.
- No hay regla aprobada para devolver un pago QR verificado; continúa bloqueado.
- No hay lector de cámara de pasajes en el formulario del chofer; se enseña el ingreso manual del código.
- El rol `afiliado_admin` carece de módulo principal en el panel actual y por eso no tiene una ruta de tutorial.
- No hay impresora física disponible en esta prueba; quedan pendientes alimentación, corte, márgenes y legibilidad del QR en los equipos usados por la agencia.
- Los tutoriales de perfiles que requieren datos de negocio (p. ej. detalle de pasajes, entrega de encomienda, reportes poblados) explican el flujo y señalan el contenedor real; no crean fixtures dentro de los datos usados por una sesión de usuario.
- El historial paginado de Caja ahora incluye el UID del operador en la consulta de Secretaría, de acuerdo con la regla de lectura ya existente. No se cambiaron reglas ni permisos.
- El recorrido `runDeliveryAndCodLifecycle.mjs` comprobó que la entrega en ruta crea Bs 30.00 bajo custodia y que rendir Bs 10.00 deja Bs 20.00. La expectativa anterior de Bs 5.00 y la segunda rendición de Bs 5.00 eran datos de prueba obsoletos; se corrigieron únicamente esas expectativas y el recorrido completo pasó. La lógica de custodia, las comisiones y Caja no se modificaron.

## Evidencia automática de esta ejecución

| Comprobación | Resultado |
|---|---|
| Typecheck (`npm run typecheck`) | Aprobado en la compilación final con TypeScript. |
| Build (`npm run build`) | Aprobado. Vite advierte que los bundles principales/config superan 500 KB y que una importación dinámica de `configService.ts` no produce un chunk separado. |
| Unitarias | 73/73 aprobadas. Incluyen 7 verificaciones del orquestador tutorial y comprobantes de pasajes. |
| Firebase Functions / Pasajes | 1/1 suite aprobada en Firestore/Auth Emulator: precios, permiso de creación, QR, efectivo físico, validaciones, duplicación, entrega, auditoría y reporte. |
| Firebase Functions / precio manual de encomienda | 1/1 aprobada en Firestore/Auth Emulator: importe manual obligatorio, no consulta tarifas y rechaza activar cálculo automático desde la llamada. |
| Firestore Rules Emulator | 23/23 aprobadas en proyecto demo aislado. |
| E2E tutorial | Aprobado en Auth/Firestore/Functions Emulator para Secretaría, Tesorería, Directiva, Chofer y Afiliado. Cubrió navegación, formularios educativos, pausa/reanudación, progreso después de recarga, visibilidad y alineación geométrica del foco con cada target (incluida la animación del drawer móvil), ausencia de escrituras de encomienda/pasajes/Caja y errores de navegador. |
| E2E Pasajes | Aprobado: venta, QR, validación de chofer, liquidación y comprobantes. Evidencias en `tmp/passenger-tickets/`. |
| E2E menú y precio manual | Aprobado: menú de escritorio/móvil, acceso por rol e importe manual de Bs 12.34 verificado en documentos y movimiento. Evidencias en `tmp/navigation-manual-pricing/`. |
| E2E ciclo de Caja | Aprobado después de corregir la expectativa de prueba: Bs 15 efectivo + Bs 20 QR = Bs 35 total; el efectivo esperado sigue en Bs 105 tras un egreso de Bs 10. |
| E2E logística | Aprobado: encomienda, manifiesto, custodia, recepción y ubicación de almacén. |
| E2E entrega/COD/custodia | Aprobado en Emulator aislado: COD en ruta Bs 30, rendición parcial Bs 10, saldo restante Bs 20 y rendición final Bs 20; Caja termina con el efectivo esperado. Se corrigió solo la expectativa obsoleta del E2E. |
| Anchuras 390, 768, 1440 y 1920 px | Aprobadas en Playwright Chromium usando ventanas responsivas. Capturas reales en `tmp/tutorial-final/`. No equivale a probar un teléfono físico. |
| Impresión física | Pendiente: requiere las impresoras locales de la agencia. |

Capturas tutorial generadas: `01-menu-lateral-1440.png`, `02-encomiendas-formulario.png`, `02b-precio-manual.png`, `03-pasajes-venta-manual.png`, `04-caja-movimientos-qr.png`, `05-chofer-validar-pasaje.png`, `06-tutorial-movil-menu-390.png`, `06-tutorial-movil-chofer-390.png`, `07-tutorial-768.png` y `08-tutorial-1920.png`.

Las pruebas usaron Node.js 24.21.0 porque Node.js 22 no está instalado. Firebase Emulator inició correctamente con un aviso de diferencia de runtime. Los avisos de metadatos de Google por DNS/timeout no bloquearon los emuladores ni los flujos autenticados.

Los archivos de `tmp/`, `dist/` y registros locales de Emulator son evidencia/salida temporal y no deben añadirse a una integración futura. El código fuente, Rules/índices que correspondan a las funciones modificadas, pruebas y esta documentación sí deben revisarse para versionar. La impresión térmica física continúa pendiente.
