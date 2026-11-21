# Roadmap de estabilización, soporte e impresoras

| Fase | Verificadas | Pendientes | Avance |
|---|---:|---:|---:|
| 1 | 1 | 11 | 8.3% |
| 2 | 0 | 4 | 0% |
| 3 | 0 | 6 | 0% |


## Registro de ejecución de Fase 1

Base remota verificada mediante fetch: `04c5b89`. La rama `codex/phase-1-stabilization` conserva el commit `15a9300`.

| Módulo o acción | Secretaría | Afiliado | Afiliado administrador | Soporte PACHAX |
|---|---|---|---|---|
| Encomiendas, pasajes, almacén | Operar en agencias autorizadas, incluido historial | Consulta con datos sensibles protegidos | Operación y administración | Solo diagnóstico autorizado |
| Caja | Cobro y turno integrados a operaciones autorizadas | Consulta autorizada | Administración | Sin acceso implícito |
| Reportes | Día de agencia autorizada | Consulta autorizada | Generales y auditoría autorizada | Solo diagnóstico autorizado |
| Comisiones, afiliados, aportes, multas, deportes, préstamos, personal, gastos e inventario | Sin menú ni mutaciones administrativas | Consulta autorizada | Administración | Sin acceso implícito |
| Usuarios y configuración de empresa | Sin acceso | Sin acceso | Administración protegida | Permisos técnicos explícitos |
| Centro de Soporte | Sin acceso | Sin acceso | Sin acceso automático | Acceso técnico auditado en fase 2 |

Esta tabla es la matriz objetivo. El modelo actual reconoce el perfil técnico y conserva los siete roles operativos y heredados en `src/types/index.ts`, con autorizaciones distintas en `src/app/App.tsx`, `functions/index.js`, `firestore.rules`, `storage.rules` y tutoriales. `afiliado_admin` ya existe y tiene poderes distintos de `directiva_admin`. Promover por coincidencia de nombre daría acceso financiero a cuentas que hoy tienen un alcance limitado. Primero se necesita un inventario autorizado de UID y funciones, incluida la verificación de Nelson. La implementación local y las pruebas de los cuatro perfiles siguen pendientes. En custodia y uso de pasajes debe conservarse el conductor asignado como persona y registrarse como actor el operador autenticado que verifica el evento. No se ha migrado ninguna cuenta.

| Tarea | Diagnóstico y progreso | Evidencia o dependencia |
|---|---|---|
| EP-02 | Mi cuenta muestra un mensaje comprensible ante errores inesperados y registra el código. La causa del fallo original sigue sin verificar. | Hace falta código, hora y caso autorizado de producción para confirmar la causa. |
| EP-03 | Las dos colecciones consultadas por Comisiones caían en denegación por defecto. Se añadió lectura al administrador activo actual, sin escritura directa, y un índice para historial por conductor y fecha. | Pruebas positivas y negativas en evidence/phase1-rules.log. Publicar reglas e índice es una operación separada. |
| EP-05 | La comisión fija usa el monto oficial y puede registrar base nula. La comisión porcentual conserva el flete existente y rechaza explícitamente las guías sin base autorizada. | evidence/phase1-security.log cubre precio cero, reintentos concurrentes y un único movimiento y auditoría. Falta decisión comercial para manual porcentual. |
| EP-07 | La consulta de ventanilla filtra agencia y la de conductor filtra UID, con índices ya declarados. Migrar la validación sin un inicio de sesión del conductor sigue pendiente. | evidence/phase1-rules.log prueba alcance entre sucursales y conductor asignado con roles vigentes. |
| EP-09 | El enlace del login apuntaba a una ruta que Vercel reescribía al mismo SPA. Se retiró el enlace, se declaró redirección de /demo y el modo de simulación queda para desarrollo con emuladores. | Verificación de la redirección en el entorno publicado pendiente de autorización. |
| EP-11 | La regla leía los datos de un candado inexistente. El operador de caja activo puede consultar solo su candado ausente en Punata o Cochabamba según su perfil. | evidence/phase1-rules.log prueba ausencia normal, rechazo de otro operador o agencia y denegación de escritura. Una nueva agencia requerirá ampliar este diseño. |
| EP-10 | El recorrido integral pasó de registro a reportes con perfiles vigentes y comisión fija sintética. | evidence/phase1-journey.log. Pendiente repetir con la nueva matriz, fallos de red y más variantes. |
| EP-12 | Se eliminó un any en el manejo de errores de Mi cuenta. | evidence/phase1-lint.json contiene el inventario de 273 errores y 14 avisos. |

## Continuación de la Fase 1 · Reporte diario, histórico y acceso técnico

Commit de implementación: c94d8d6. Se verificaron 27 pruebas de reglas y el recorrido Playwright de Secretaría, Administración vigente y Soporte. El reporte se comprobó por llamada directa y desde el navegador.

| Tarea | Estado | Cambios y evidencia |
|---|---|---|
| EP-02 · Mi cuenta | En curso | La consulta tolera una lista de agencias heredada no válida usando la agencia primaria. Se comprueban perfil vinculado, vínculo ausente y agencia incorrecta con datos sintéticos. El incidente real requiere hora, código de la llamada y UID autorizado, sin copiar credenciales ni datos personales. |
| EP-04 · Matriz | En curso | Soporte inicia sesión en una pantalla técnica sin menús operativos. Las reglas excluyen ese perfil de datos operativos y conservan la lectura del perfil propio. El aprovisionamiento del cliente rechaza asignar el rol o modificar la cuenta técnica. Se cerraron las llamadas a catálogo de almacén y directorio de conductores para el perfil técnico. Pendiente auditar las demás Functions y completar los perfiles operativos. |
| EP-06 · Encomiendas | En curso | La búsqueda por teléfono y guía consulta agencia de origen y destino en Firestore sin corte por fecha. La prueba de reglas verifica un documento de 2025 y rechaza la consulta sin agencia. Pendientes filtro por rango y entrega completa de una guía antigua en navegador. |
| EP-08 · Reporte diario | En curso | Secretaría dispone de totales imprimibles y acotados al día de Bolivia. El backend rechaza reportes generales, filtra la agencia, deduplica cobros y no acepta fechas del cliente. Los pendientes mostrados corresponden a guías registradas hoy. Evidencia en evidence/roles-daily-security.log y evidence/roles-daily-browser.log. Pendiente integrar caja mínima y revisar los demás módulos de esta tarea. |
| EP-10 · Recorridos | En curso | Se amplió la prueba Playwright con el reporte de Secretaría y la sesión de Soporte. Los demás recorridos deben repetirse tras la migración. |
| EP-12 · Calidad | En curso | TypeScript, build y 73 unitarias pasaron. Inventario de 272 errores y 14 avisos en evidence/roles-daily-lint.json. |

### Transición para futura publicación

1. Inventariar perfiles por UID, estado, agencia, claims y responsabilidades operativas. Comparar Auth con Firestore. Exportar un respaldo con acceso restringido.
2. Conservar Secretaría cuando coincidan función y agencia. Revisar manualmente a cada Afiliado administrador existente antes de otorgar administración general. Verificar UID y función de Nelson con el propietario. Evaluar individualmente Directiva, Tesorería y Encargados según su función prevista.
3. Conservar los conductores como entidades operativas y sus identificadores históricos. Verificar los flujos de custodia, validación de pasajes, entrega y comisiones con un operador identificado y evidencia del acto. Retirar el acceso de cada cuenta de conductor solo al resolver sus dependencias.
4. Preparar el perfil técnico con una identidad individual verificada, aprovisionamiento mediante un operador autorizado de Firebase y auditoría. Requerir autenticación reforzada antes de conceder capacidades técnicas. Los administradores del cliente no aprovisionan estas cuentas.
5. Validar la matriz en emuladores y en un entorno de revisión. Preparar índices y esperar a que estén listos. Coordinar Functions, reglas y frontend compatibles antes de migrar UID autorizados. No publicar un cambio de rol de forma aislada.
6. Verificar por perfil y agencia autenticación, operaciones, denegaciones por llamada directa y trazabilidad. Comparar con el inventario y el respaldo.
7. Si falla la transición, detener la migración, revertir frontend, Functions y reglas a sus revisiones compatibles y restaurar únicamente perfiles y claims modificados desde el inventario. Revocar sesiones cuando se hayan cambiado privilegios y comprobar que sigue habiendo administración activa.
## Matriz objetivo y migración
Actualmente el sistema contiene más roles de los necesarios.

La estructura definitiva será:

1. `secretaria`
2. `afiliado`
3. `afiliado_admin`
4. `soporte_pachax`

Los nombres técnicos podrán adaptarse si existe una razón de compatibilidad, pero los roles funcionales deben ser exactamente estos cuatro.

No queremos mantener roles separados de conductor, tesorería, encargado de agencia o directiva_admin.

Las capacidades de esos roles deben redistribuirse correctamente.

No basta con ocultar botones: los permisos del backend y las reglas Firestore también deben reflejar esta estructura.

## ROL 1 — SECRETARÍA

Las secretarias tendrán una interfaz sencilla.

**Solo deben aparecer estos módulos:**

### A. Encomiendas

Acceso operativo completo a encomiendas, dentro de las agencias autorizadas.

Deben poder:

- Crear nuevas encomiendas.
- Registrar remitente y destinatario.
- Registrar productos y bultos.
- Establecer el precio manual.
- Cobrar según el flujo autorizado.
- Imprimir guías y comprobantes.
- Buscar por número de guía, nombre, teléfono y demás filtros disponibles.
- Buscar encomiendas por cualquier fecha, incluidas las antiguas.
- Filtrar por estado y sucursal.
- Revisar detalles.
- Consultar historial.
- Corregir errores mediante acciones autorizadas y auditadas.
- Registrar traslado y custodia según el nuevo flujo.
- Registrar recepción.
- Entregar encomiendas antiguas o recientes.
- Registrar evidencias de entrega.
- Reimprimir comprobantes.
- Ejecutar las demás operaciones propias del flujo de encomiendas.

**IMPORTANTE:** la limitación diaria de reportes NO debe impedir buscar, consultar o entregar encomiendas de fechas anteriores.

La sección Encomiendas debe tener filtros cómodos: hoy, ayer, últimos 7 días, rango personalizado, pendientes y búsqueda general.

La interfaz debe facilitar la entrega de una guía antigua.

### B. Pasajes

Pueden realizar las operaciones de venta y atención autorizadas:

- Registrar pasajes.
- Consultar operaciones.
- Verificar estados de pago.
- Imprimir comprobantes.
- Buscar y atender operaciones antiguas.
- Realizar correcciones permitidas.
- Consultar historial operativo.

Las acciones reservadas a administración deben seguir protegidas.

### C. Módulos de almacén

Acceso a:

- Recepción.
- Almacenamiento.
- Ubicación física.
- Búsqueda.
- Consulta de existencias bajo custodia.
- Entregas.
- Historial operativo.
- Incidencias relacionadas con almacén.

### D. Reportes diarios

Crear una sección pequeña, clara y útil de **Reporte del día**.

Debe mostrar únicamente los movimientos del día correspondiente a la agencia autorizada, por ejemplo:

- Encomiendas registradas.
- Encomiendas entregadas.
- Pendientes.
- Cobros.
- Pasajes.
- Operaciones relevantes.
- Resumen operativo.
- Impresión de reporte diario.

No incluir reportes históricos financieros generales, administración de comisiones, gestión de usuarios ni configuración.

Las secretarias pueden consultar guías antiguas desde Encomiendas, pero su sección de reportes queda limitada al día.

**No mostrar otros módulos en el menú de Secretaría.**

Si caja es indispensable para cobrar encomiendas o pasajes, integra esas operaciones dentro de los módulos autorizados, sin abrir innecesariamente el panel administrativo completo de Caja.

## ROL 2 — AFILIADO

El afiliado debe poder consultar la información operativa que actualmente está disponible para administración, pero **sin modificar absolutamente nada**.

Debe tener acceso de solo lectura a las vistas correspondientes de:

- Encomiendas.
- Pasajes.
- Almacén.
- Reportes.
- Comisiones.
- Afiliados y aportes.
- Multas.
- Deportes.
- Préstamos.
- Personal.
- Gastos.
- Inventario.
- Caja y movimientos visibles.
- Historial.
- Otros módulos operativos existentes.

No debe poder:

- Crear.
- Editar.
- Eliminar.
- Anular.
- Aprobar.
- Confirmar cobros.
- Liquidar comisiones.
- Cambiar configuraciones.
- Administrar usuarios.
- Ejecutar operaciones que alteren datos.

No debe ver:

- **Usuarios.**
- **Configuración.**
- **Centro de Soporte PACHAX.**

En los módulos de solo lectura, los botones de modificación deben ocultarse o quedar deshabilitados, y el backend debe rechazar igualmente cualquier operación no autorizada.

No confundas ocultar un botón con proteger una acción.

La consulta general deberá respetar las restricciones legales y de confidencialidad sobre información personal especialmente sensible, aunque el rol tenga visibilidad operativa amplia.

## ROL 3 — AFILIADO ADMINISTRADOR

Este rol reemplaza las funciones del administrador actual.

Debe tener acceso a todos los módulos operativos, financieros y administrativos de Expreso Punata.

Incluye:

- Encomiendas.
- Pasajes.
- Almacén.
- Caja.
- Comisiones.
- Afiliados.
- Aportes.
- Multas.
- Préstamos.
- Deportes.
- Inventario.
- Personal.
- Gastos.
- Reportes generales.
- Configuración de la empresa.
- Configuración de sucursales.
- Gestión de usuarios.
- Administración de operaciones.
- Historial y auditoría autorizada.

Debe tener las capacidades actuales de `directiva_admin`, adaptadas a la nueva estructura.

El administrador debe poder gestionar las cuentas permitidas, respetando los controles especiales de seguridad.

No debe tener acceso automático a las herramientas internas exclusivas de SOPORTE PACHAX.

La cuenta real de **Nelson**, una vez verificada, deberá conservar el rol de Afiliado administrador.

## ROL 4 — SOPORTE PACHAX

Este será un rol técnico exclusivo de PACHAX.

No debe ser una variante visible del administrador del cliente.

El rol tendrá herramientas de soporte, configuración avanzada y mantenimiento autorizado.

Sus capacidades se desarrollarán principalmente en la Fase 2.

Debe contar con autenticación robusta, permisos explícitos, reautenticación para operaciones delicadas y auditoría.

No debe obtener automáticamente acceso ilimitado a datos personales o financieros.

Su panel tendrá, entre otras herramientas:

- Configuración avanzada.
- Usuarios.
- Diagnósticos.
- Errores del sistema.
- Permisos.
- Impresoras.
- Tickets.
- Plantillas.
- Sucursales.
- Tarifas.
- Opciones de operaciones.
- Respaldos y exportaciones autorizadas.
- Limpieza de datos de prueba.
- Historial de intervenciones.

---

# ELIMINACIÓN DE ROLES ANTIGUOS

Audita todos los usos de:

- `conductor`
- `tesoreria`
- `encargado_agencia`
- `directiva_admin`
- Cualquier otro rol heredado.

Revisa:

- Frontend.
- Firebase Functions.
- Firestore Rules.
- Servicios.
- Tipos TypeScript.
- Reportes.
- Tutoriales.
- Pruebas automatizadas.
- Configuraciones.
- Documentación.

No dejes permisos antiguos que permitan saltarse las restricciones nuevas.

Realiza una migración compatible y verificable.

**IMPORTANTE SOBRE CONDUCTORES:**

El conductor deja de ser un rol de acceso independiente.

Sin embargo, deben conservarse sus registros como personas vinculadas a vehículos, viajes, manifiestos y comisiones.

Revisa las operaciones que actualmente requieren iniciar sesión como conductor y rediseña la confirmación mediante Secretaría o Afiliado administrador, utilizando evidencias o validaciones adecuadas.

No atribuyas falsamente al conductor una acción realizada por una secretaria.

Conserva quién ejecutó realmente cada operación y qué conductor estuvo asignado.

Si alguna validación no puede reemplazarse de manera segura, documenta el bloqueo específico.

No reasignes automáticamente a usuarios reales con roles heredados sin identificar primero sus funciones actuales.

---

## Fase 1

### EP-01 · AUDITORÍA GENERAL

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Recorre todas las secciones del sistema.

No basta con verificar que aparezcan.

Debes abrirlas, consultar información y ejecutar sus operaciones permitidas.

Prueba cada módulo con los nuevos perfiles.

El objetivo es detectar y corregir errores, no solamente generar un informe.

### EP-02 · CORREGIR `INTERNAL 0`

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Se ha reportado este error en **Mi cuenta** y posiblemente otras secciones.

Investiga:

- Cloud Functions.
- Consultas Firestore.
- Excepciones.
- Parámetros.
- Permisos.
- Perfiles incompletos.
- Datos antiguos.
- Dependencias entre colecciones.

Reproduce cada fallo y corrige su causa.

Muestra mensajes comprensibles al usuario.

Conserva detalles técnicos suficientes para diagnóstico sin exponer secretos.

### EP-03 · CORREGIR `MISSING OR INSUFFICIENT PERMISSIONS`

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Se ha reportado en:

- Comisiones de conductores.
- Pasajes.
- Otras secciones.
- Incluso al utilizar cuentas administrativas.

Revisa las consultas y reglas reales.

Corrige consultas incompatibles, filtros incorrectos y verificaciones de roles heredados.

No amplíes permisos indiscriminadamente.

Prepara pruebas que comprueben tanto los accesos permitidos como los rechazados.

### EP-04 · IMPLEMENTAR LA NUEVA MATRIZ DE PERMISOS

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

La primera prioridad técnica es que los cuatro roles funcionen correctamente.

Construye una matriz verificable:

**Rol × Módulo × Acción × Sucursal.**

Comprueba permisos en:

- Interfaz.
- Backend.
- Cloud Functions.
- Firestore Rules.
- Reportes.
- Consultas.
- Acciones especiales.

Las secretarias solo deben tener sus cuatro áreas.

Los afiliados deben ver módulos en modo consulta.

Los afiliados administradores deben tener todas las funciones administrativas del cliente.

SOPORTE PACHAX debe ser independiente.

Evita dejar funciones administrativas antiguas accesibles por rutas directas.

### EP-05 · CORREGIR COMISIONES CON PRECIO MANUAL

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Existe un bloqueo técnico confirmado.

Las encomiendas de precio manual pueden guardar:

`shippingFeeCents: null`

La función `accrueDriverCommission` exige un entero para calcular la comisión.

Corrige la incompatibilidad.

### Comisión fija

Debe calcularse a partir del monto fijo oficial aprobado, sin depender de una tarifa automática.

### Comisión porcentual

Debe utilizar una base monetaria autorizada.

Evalúa el precio final acordado como base para la modalidad manual, pero no inventes reglas comerciales del cliente.

Si la definición no está aprobada, deja la decisión pendiente y explica el efecto.

Conserva:

- Idempotencia.
- Historial.
- Auditoría.
- Comisiones anteriores.
- Saldos.
- Liquidaciones.
- Protección contra duplicados.

Prueba casos normales, precios cero, reintentos y concurrencia.

### EP-06 · REVISIÓN DE ENCOMIENDAS

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Verifica:

- Registro.
- Precio manual.
- Cobros.
- Impresión.
- Búsqueda histórica.
- Filtros por fecha.
- Edición autorizada.
- Anulación.
- Traslado.
- Custodia.
- Recepción.
- Almacén.
- Entrega.
- Reportes.
- Historial.

Comprueba especialmente que Secretaría pueda encontrar y entregar una encomienda antigua.

### EP-07 · REVISIÓN DE PASAJES

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Prueba registro, cobro, comprobante, búsqueda, verificación, historial, anulación autorizada, reportes y permisos.

Corrige las consultas Firestore que provoquen errores.

### EP-08 · REVISIÓN DE LOS DEMÁS MÓDULOS

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Audita:

- Caja.
- Comisiones.
- Mi cuenta.
- Afiliados.
- Aportes.
- Multas.
- Deportes.
- Préstamos.
- Personal.
- Gastos.
- Inventario.
- Reportes.
- Configuración.
- Usuarios.
- Tutoriales.
- Impresoras existentes.

Verifica que cada módulo conserve su funcionalidad bajo los nuevos roles.

### EP-09 · RETIRAR LA DEPENDENCIA DE LA DEMO PÚBLICA

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Actualmente el propietario pulsa DEMO y permanece en el login.

Reproduce el problema.

Inspecciona `App.tsx`, `DemoView.tsx`, rutas, redirecciones y configuración.

**NUEVA DECISIÓN:**

No queremos seguir manteniendo una aplicación demo pública separada de la aplicación real.

La experiencia de usuario debe ser una sola.

Las pruebas de operaciones se harán en la propia aplicación bajo controles adecuados, y los registros identificados como de prueba podrán retirarse desde SOPORTE PACHAX.

No construyas otra aplicación de demostración ni un backend permanente adicional solamente para este objetivo.

Retira el botón o la ruta pública de demo cuando hayas comprobado que ya no quedan dependencias necesarias, y redirige de forma comprensible al acceso normal.

No dejes un enlace roto.

Conserva los tutoriales útiles de la aplicación.

Las pruebas automatizadas que crean registros o simulan dinero deben seguir usando **Firebase Emulator Suite local**, sin mezclarse con los datos reales. Esto no requiere crear otra aplicación ni un nuevo servicio permanente.

### EP-10 · COMPLETAR PRUEBAS END-TO-END

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Recupera el trabajo anterior de Playwright.

Ejecuta el recorrido:

Registro → Cobro → Salida → Custodia → Recepción → Entrega → Comisión → Reportes.

Valida:

- Pagado en origen.
- Por pagar.
- Precio manual.
- Reintentos.
- Errores de red.
- Duplicados.
- Permisos.
- Historial.
- Comprobantes.

Prueba las variantes que correspondan a la nueva estructura de usuarios.

### EP-11 · CORREGIR EL AVISO DE CAJA

- [x] Completado y verificado
- Prioridad: Alta.
- Diagnóstico: la regla previa requería leer un documento inexistente.
- Archivos afectados: firestore.rules y tests/rules/firestoreRules.test.mjs.
- Solución: autorizar get del candado propio ausente en una agencia autorizada.
- Pruebas, resultado y evidencias: 25 pruebas de reglas aprobadas en evidence/phase1-rules.log.
- Commit: e454e68.
- Dependencias: publicación autorizada de reglas para que el cambio opere en Firebase real.
### EP-12 · ESLINT

- [ ] Pendiente
- Prioridad: Alta.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Ya existe una Flat Config.

Quedan aproximadamente 274 errores y 14 avisos.

No rehagas la configuración.

Prioriza errores de Hooks, ejecución, estados, permisos, seguridad y lógica.

No realices refactors masivos innecesarios.

Documenta la deuda heredada y las correcciones verificadas.

---

## Fase 2

### EP-13 · CENTRO DE SOPORTE PACHAX

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Crear un panel profesional, separado de la administración del cliente.

Debe permitir resolver las solicitudes habituales de configuración y mantenimiento sin editar código para cada cambio.

Incluir:

- Datos de la empresa.
- Sucursales.
- Tarifas.
- Parámetros de encomiendas.
- Pasajes.
- Comisiones.
- Afiliados.
- Préstamos.
- Multas.
- Deportes.
- Inventario.
- Personal.
- Reportes.
- Alertas.
- Configuración de impresión.
- Plantillas.
- Diagnósticos técnicos.
- Estado de servicios.
- Historial de errores.
- Auditoría de intervenciones.
- Herramientas de mantenimiento.

Las opciones configurables deben almacenarse de forma persistente y con validaciones.

Las operaciones sensibles deben requerir permisos específicos.

### EP-14 · GESTIÓN COMPLETA DE USUARIOS

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Agregar:

- Crear cuentas.
- Editar.
- Cambiar rol.
- Suspender.
- Reactivar.
- Restablecer acceso.
- Revocar sesiones.
- Dar de baja.
- Eliminar cuentas cuando sea procedente.
- Ver historial de modificaciones.

Los roles disponibles para nuevas cuentas serán solamente los cuatro definidos.

SOPORTE PACHAX debe quedar reservado a personal autorizado de PACHAX.

### Protección de administradores

Nunca permitir:

- Dejar cero afiliados administradores activos.
- Eliminar el último administrador.
- Suspender el último administrador.
- Cambiar su rol si eso deja el sistema sin administración.
- Evadir el control mediante operaciones simultáneas.

Para eliminar o dar de baja un administrador:

1. Exigir reautenticación reciente del administrador que ejecuta la acción, usando Firebase.
2. Verificar los permisos en backend.
3. Confirmar que seguirá existiendo otro administrador activo.
4. Solicitar confirmación explícita.
5. Registrar el motivo y la identidad de quien ejecuta.
6. Registrar la operación en auditoría.

No almacenar contraseñas ni solicitar contraseñas de otras personas.

### Historial de eliminación

Registrar:

- Usuario afectado.
- Usuario que eliminó o suspendió.
- Fecha y hora.
- Motivo.
- Acción.
- Resultado.
- Datos relevantes anteriores y posteriores, cuando corresponda.

No perder el historial de operaciones realizadas por cuentas dadas de baja.

### EP-15 · LIMPIEZA DE CUENTAS ANTIGUAS

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

El propietario quiere retirar cuentas de prueba antiguas y conservar las cuentas operativas reales.

La cuenta de Nelson debe seguir siendo Afiliado administrador, después de verificar su identidad y UID.

Antes de eliminar cuentas:

- Inventariar.
- Identificar cuentas de prueba.
- Comprobar operaciones vinculadas.
- Identificar usuarios reales.
- Preparar respaldo.
- Presentar candidatos para aprobación.

No eliminar automáticamente cuentas reales.

La limpieza de cuentas se hará desde Gestión de usuarios, no desde la herramienta general de limpieza de datos.

### EP-16 · HERRAMIENTA DE LIMPIEZA SELECTIVA DE DATOS DE PRUEBA

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

**ESTA ES UNA FUNCIONALIDAD NUEVA Y OBLIGATORIA DE SOPORTE.**

Crear una pantalla denominada:

**Limpieza de datos de prueba**

Debe permitir seleccionar los tipos de registros que se desean limpiar.

Por ejemplo:

- Encomiendas de prueba.
- Ítems de encomiendas.
- Manifiestos de prueba.
- Custodia.
- Recepciones.
- Entregas.
- Movimientos de caja de prueba.
- Comprobantes de prueba.
- Pasajes de prueba.
- Comisiones de prueba.
- Multas de prueba.
- Préstamos de prueba.
- Aportes de prueba.
- Datos sintéticos de inventario.
- Registros de almacén de prueba.
- Otros registros de prueba identificables.

**Nunca incluir Usuarios como categoría borrable.**

Tampoco permitir borrar los registros obligatorios de auditoría, seguridad ni evidencia legal.

### Selección inteligente de dependencias

Implementar un sistema de dependencias entre entidades.

Ejemplo:

Si se selecciona eliminar una encomienda de prueba que tiene una entrega vinculada, el sistema debe mostrar esa relación y seleccionar o proponer automáticamente los registros dependientes necesarios.

Lo mismo para:

- Encomiendas y manifiestos.
- Encomiendas y custodia.
- Encomiendas y entregas.
- Encomiendas y movimientos financieros.
- Comisiones y liquidaciones.
- Pasajes y pagos.
- Préstamos y cuotas.
- Multas y pagos.
- Inventario y movimientos.

Si seleccionar una categoría exige incluir otra para mantener integridad, márcala automáticamente y explica por qué.

Permite desmarcar una categoría dependiente solamente cuando el sistema pueda mantener una estructura consistente.

No permitas dejar referencias rotas.

### Previsualización antes de borrar

La pantalla debe mostrar:

- Categorías seleccionadas.
- Número de registros afectados.
- Dependencias.
- Agencias afectadas.
- Fechas.
- Monto económico involucrado.
- Registros excluidos.
- Riesgos y advertencias.
- Resultado esperado.

Implementa un modo **Simular limpieza** que no borre nada.

Los registros actuales que no tengan una marca verificable de prueba deben identificarse con criterios confiables y revisión explícita; no deben considerarse descartables solamente por su antigüedad.

Para futuros registros de prueba, incorpora una identificación verificable que facilite limpiarlos.

### Seguridad

Antes de ejecutar una limpieza real:

1. Requerir acceso SOPORTE PACHAX.
2. Exigir reautenticación.
3. Mostrar resumen completo.
4. Crear respaldo recuperable de los registros seleccionados.
5. Solicitar confirmación explícita.
6. Ejecutar operaciones consistentes y recuperables ante fallos.
7. Registrar una auditoría detallada.
8. Mostrar informe final.

No permitir borrar registros reales mediante esta herramienta.

No utilizarla para encubrir operaciones ni eliminar pruebas de transacciones auténticas.

No ejecutar ninguna limpieza de datos de producción sin autorización expresa del propietario sobre el conjunto de registros seleccionado.

**El objetivo es poder retirar datos de prueba de manera cómoda sin destruir registros reales ni depender de editar Firestore manualmente.**

---

## Fase 3

### EP-17 · AUDITAR LO QUE YA EXISTE

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Actualmente hay componentes de impresión, como:

- `PrinterSettingsView.tsx`
- `printEngineService.ts`
- Perfiles de impresora.
- Vista previa.
- Configuración de papel.
- Opciones de corte.
- Impresión mediante navegador.

No reconstruyas innecesariamente lo que ya funciona.

Comprueba qué opciones son reales y cuáles solamente aparecen en la interfaz.

### EP-18 · IMPRESORAS USB EN WINDOWS

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

El cliente utilizará impresoras térmicas conectadas por USB a las computadoras.

Necesitamos:

- Configuración por estación.
- Selección de impresora.
- Perfiles.
- Papel 58 mm u 80 mm.
- Márgenes.
- Tamaño de texto.
- Pruebas de impresión.
- Diagnóstico de conexión.
- Reimpresión.
- Configuración de impresora predeterminada.
- Manejo de errores.
- Opciones de autocorte cuando sean compatibles.

Estudia impresión mediante controlador de Windows y, si hace falta, un servicio local de impresión.

No prometas impresión silenciosa o control ESC/POS directo si el navegador y el modelo no lo permiten.

### EP-19 · EDITOR VISUAL DE TICKETS

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

El Centro de Soporte tendrá un editor completo con dos paneles:

**IZQUIERDA: OPCIONES DE EDICIÓN**

**DERECHA: SIMULACIÓN DEL TICKET EN TIEMPO REAL**

Quiero poder modificar:

- Encabezado.
- Nombre de empresa.
- Logo.
- Agencia.
- Oficina.
- Contactos.
- Número de guía.
- Fecha.
- Remitente.
- Destinatario.
- Bultos.
- Descripción.
- Peso.
- Importe.
- Estado de pago.
- Operador.
- Conductor.
- QR.
- Firma.
- Textos personalizados.
- Avisos.
- Títulos.
- Orden de campos.
- Tamaño de letra.
- Negritas.
- Alineación.
- Separadores.
- Márgenes.
- Espacios.
- Pie de página.
- Campos opcionales permitidos.

La vista previa debe actualizarse inmediatamente.

Permitir guardar, duplicar y restaurar versiones de plantillas.

Mantener los datos y textos necesarios para identificación, trazabilidad y cumplimiento legal.

### EP-20 · DOS COPIAS POR ENCOMIENDA

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Configurar:

**Ticket 1: CLIENTE**

**Ticket 2: AGENCIA**

Pueden tener distinto contenido.

Deben conservar el mismo número de guía.

El sistema debe permitir:

- Una copia.
- Dos copias.
- Plantillas separadas.
- Corte entre copias.
- Corte final.
- Reimpresión autorizada.

Imprimir dos comprobantes nunca debe registrar dos guías ni generar dos cobros.

### EP-21 · AUTOCORTE

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Cuando la impresora sea compatible:

1. Imprimir copia del cliente.
2. Avanzar papel.
3. Cortar.
4. Imprimir copia de la agencia.
5. Cortar.

Evaluar comandos ESC/POS o capacidades del controlador.

La opción de autocorte debe estar condicionada por las capacidades reales del hardware.

### EP-22 · PRUEBAS

- [ ] Pendiente
- Prioridad: Programada.
- Diagnóstico: pendiente de verificación.
- Archivos afectados: por determinar.
- Solución realizada: pendiente.
- Pruebas, resultado y evidencias: pendientes.
- Commit: pendiente.
- Dependencias y bloqueos: revisar al iniciar.

Validar:

- Papel 58 mm.
- Papel 80 mm.
- Guías.
- Recibos.
- Pasajes.
- Comprobantes de caja.
- Comisiones.
- QR.
- Dos copias.
- Reimpresiones.
- Cortes.
- Impresora desconectada.
- Errores de impresión.
- Recuperación sin duplicar operaciones.

El editor visual se puede desarrollar sin la impresora física.

La conexión USB y el autocorte solo se marcarán como verificados después de probar hardware real compatible.

---

# REGLAS DE TRABAJO

1. No perder los commits locales.
2. No modificar directamente `main`.
3. No desactivar controles de seguridad.
4. No inventar tarifas ni comisiones.
5. No eliminar registros reales como si fueran de prueba.
6. No borrar cuentas sin autorización.
7. No crear otra aplicación de demo.
8. No crear otro backend permanente de prueba.
9. Utilizar emuladores locales para pruebas automatizadas con datos sintéticos.
10. Los diagnósticos de producción deben ser de solo lectura y autorizados cuando involucren información real.
11. No publicar modificaciones de backend sin aprobación.
12. Mantener pruebas y auditorías.
13. Actualizar el roadmap durante cada fase.
14. Conservar respaldos y mecanismos de reversión.
15. No agregar funciones innecesarias ni duplicar módulos existentes.

# EJECUCIÓN INMEDIATA — FASE 1

Debes ejecutar en este orden:

1. Inspeccionar el repositorio y conservar el commit `15a9300`.
2. Crear el roadmap de las tres fases.
3. Auditar todos los roles actuales.
4. Preparar e implementar la nueva estructura de cuatro roles.
5. Diseñar y verificar la matriz de permisos.
6. Corregir `internal 0`.
7. Corregir permisos en Comisiones.
8. Corregir permisos en Pasajes.
9. Verificar Administración.
10. Revisar Encomiendas y la búsqueda histórica de Secretaría.
11. Implementar los reportes diarios limitados de Secretaría.
12. Garantizar las vistas de solo lectura para Afiliados.
13. Verificar las capacidades de Afiliado administrador.
14. Resolver la incompatibilidad técnica de comisiones con precio manual, dejando documentadas las definiciones comerciales pendientes.
15. Investigar y corregir el acceso fallido a DEMO.
16. Preparar la retirada de la demo pública sin romper los tutoriales.
17. Revisar sección por sección utilizando los perfiles correctos.
18. Completar las pruebas E2E.
19. Corregir errores críticos de ESLint.
20. Actualizar el roadmap.
21. Guardar las correcciones en commits locales.
22. Entregar un informe detallado.

No te detengas después del diagnóstico.

Corrige los problemas que puedas demostrar y resolver.

Si una tarea depende de una autorización o una definición que todavía no existe, márcala como bloqueada y continúa con las demás.

## INFORME FINAL OBLIGATORIO

Al terminar quiero conocer:

- Rama actual.
- Commits locales.
- Cambios realizados.
- Matriz de los cuatro roles.
- Módulos accesibles por cada rol.
- Errores encontrados y corregidos.
- Estado de `internal 0`.
- Estado de Comisiones.
- Estado de Pasajes.
- Estado de Mi cuenta.
- Estado de Encomiendas.
- Estado de reportes diarios.
- Estado del acceso DEMO.
- Estado de pruebas E2E.
- Errores de lint pendientes.
- Resultado de TypeScript y build.
- Pruebas de seguridad.
- Archivos modificados.
- Bloqueos que necesitan decisiones comerciales.
- Estado del roadmap.
- Qué tareas faltan de Fase 1.
- Qué requerirá publicación en Firebase o Vercel.

**OBJETIVO FINAL DE ESTA ETAPA:**

Expreso Punata debe tener una estructura simple de cuatro roles, permisos correctos, secciones funcionales y errores críticos corregidos.

Cuando la Fase 1 esté verificada, continuaremos con el Centro de Soporte PACHAX y la limpieza selectiva de datos en la Fase 2.

Posteriormente terminaremos las impresoras USB y el editor profesional de tickets en la Fase 3.

**COMIENZA CON LA FASE 1 Y MANTÉN EL ROADMAP ACTUALIZADO.**
