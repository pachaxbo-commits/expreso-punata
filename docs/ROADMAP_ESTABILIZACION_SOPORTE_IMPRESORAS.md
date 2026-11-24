# Roadmap de estabilización, soporte e impresoras

## Publicación autorizada · avance y puerta operativa

- PR [#63](https://github.com/pachaxbo-commits/expreso-punata/pull/63) creada; pendiente de integración. La integración automática de `main` puede publicar el frontend en Vercel y debe esperar al backend compatible.
- Respaldo Firestore finalizado en el bucket privado `pachax-expreso-phase1-backup-00f7eeda9c`, prefijo `firestore-pre-phase1`; se verificó la operación y su metadato. Inventario separado de cuatro perfiles, cuatro cuentas y sus claims, configuración, índices, reglas y 38 Functions guardado en el mismo bucket; SHA-256 `3e84fc72da2f5f1eec9ff9e0d8099054fe746a3c290c639addab5719e91b88d3`. No contiene hashes de contraseñas y no permite recuperar contraseñas después de una eliminación física de Auth. Los respaldos contienen datos privados y no deben añadirse a Git.
- Ensayo aislado en emuladores: restauración y comparación de cuatro perfiles y claims de cuatro cuentas aprobada; no se restauró la exportación completa de Firestore en otro proyecto. Las 38 fuentes actuales de Functions, con sus generaciones, eran accesibles al comprobarlas. El bucket de respaldo exige prevención de acceso público y acceso uniforme.
- Índices: los diez existentes se conservaron, se agregaron once y los 21 están `READY`. Functions de producción: 38 activas; la rama declara 72 invocables, por lo que la diferencia de versiones debe considerarse al desplegar y revertir. Rules, Functions y frontend todavía no fueron publicados.
- Puerta pendiente: confirmar pausa de operaciones en ambas agencias y disponibilidad de inicio de sesión de Nelson antes de activar backend, reglas y frontend coordinadamente. No se ha migrado a Nelson ni desactivado o eliminado las otras cuentas. La eliminación física de Auth no debe ejecutarse antes de verificar continuidad y dependencias históricas.
- Comisión oficial sin configurar: `percentage` y valor cero; los nuevos devengos quedan bloqueados hasta definición comercial. La comprobación previa de `/demo` en producción devolvió HTTP 200 sin redirección; la corrección sigue pendiente de publicación y verificación. Fases 2 y 3 conservan su alcance.

## Preparación de publicación · verificación del 21 de noviembre de 2026

Este registro actualiza las afirmaciones históricas anteriores sobre falta de acceso e inventario; no altera el alcance de las Fases 2 y 3. El desarrollo de Fase 1 está completado para revisión y la regresión local está aprobada: 159 Functions, 28 Rules, 73 unitarias, TypeScript, build y recorridos E2E. La publicación, los accesos reales posteriores y la definición comercial siguen pendientes. El error `internal 0` y la redirección `/demo` en producción siguen sin verificar. Lint mantiene 267 errores heredados y 14 avisos, sin refactor de esta etapa.

### Identidad, usuarios y bloqueos

- El dominio de producción `expreso-punata.vercel.app` sirve un frontend cuya configuración pública coincide con el proyecto Firebase `expreso-punata-dev`, número `405140168085` y aplicación web `1:405140168085:web:a94720c5be75f910996a9c`. El alias local apunta al mismo proyecto. Firestore `(default)` en `nam5`, Auth predeterminado, Functions y metadatos del bucket `expreso-punata-dev.firebasestorage.app` respondieron a consultas de lectura; las Functions declaran ese mismo bucket. Falta contrastar la configuración completa del bucket compilada en el frontend. Reglas activas observadas: Firestore `158ddce6-ca3b-457d-b679-9c0a84f0f707`, Storage `e317bd22-ddc6-4f66-9382-9cc8c372f3fe`. No se supone que el nombre dev indique el uso del entorno.
- Vercel registra como despliegue de producción listo `dpl_GpY5Zjbnsqh9WUx4cGCkbqL19Z1A`, commit `04c5b89a41cb7f40aa5bdb26d37fa2fd34db6b09`; el anterior candidato de reversión es `dpl_6yHJnnsTFHCBtjk44Dhkm7mttFV2`. Confirmar el alias activo y candidato inmediatamente antes de la ventana. Se consultaron 38 Functions; registrar las generaciones de sus fuentes y revisiones efectivas antes de cambiar nada. En la configuración actual de Vercel Production, `VITE_SIMPLE_SHIPMENT_TRANSFER=true`, `VITE_ADVANCED_DISPATCH=true` y `VITE_USE_FIREBASE_EMULATORS=false`; verificar también los valores compilados en el candidato. `SIMPLE_SHIPMENT_TRANSFER=true` aparece en dos Functions y está ausente en las otras 36; comprobar que esas dos sean las pertinentes. Verificar `VITE_STORAGE_PHOTOS_ENABLED`/`STORAGE_PHOTOS_ENABLED`, `ENABLE_AUTOMATIC_PARCEL_PRICING`, `STORAGE_BUCKET_NAME` y la configuración efectiva, sin revelar secretos.
- La sesión Firebase CLI existente permitió leer Auth y perfiles de Firestore: cuatro cuentas en cada uno, con estados y claims de rol coincidentes; dos secretarías, un conductor y una directiva administrativa. Ninguna tiene actualmente el rol `afiliado_admin`; por tanto la continuidad institucional objetivo aún no está garantizada. La identidad denominada Nelson es una coincidencia única entre Auth y Firestore, pendiente de confirmación personal y autorización del propietario. Los UID y datos personales se conservan fuera del repositorio y deben reconfirmarse justo antes de actuar. No se ha validado que las cuatro cuentas correspondan a personas reales ni descartado que alguna sea técnica o de prueba.
- Propuesta sin ejecución: mantener las dos secretarías en sus agencias; revisar individualmente la cuenta de conductor y conservar sus relaciones históricas; convertir la directiva verificada a `afiliado_admin` con ambas agencias solo con aprobación expresa; `afiliado` y `soporte_pachax` requieren identidades y atribuciones aprobadas. Ninguna cuenta debe convertirse por nombre ni dar por existente un suplente. El administrador heredado puede servir de puente solo si se verifica su acceso efectivo en la combinación exacta de versiones; no equivale al administrador institucional objetivo.
- `system_config/expreso_punata.commissions` declara `percentage` y valor `0`. El nuevo devengo exige una regla oficial positiva y, para porcentaje, base de flete autorizada; por tanto rechaza la configuración observada, incluso antes de evaluar guías manuales. Se necesita decisión comercial explícita sobre modalidad, valor y tratamiento de ausencia de base; cero podría ser intencional y no debe corregirse por inferencia. No se ha cambiado la configuración.

### Secuencia con puertas de avance y recuperación

La secuencia anterior de esta sección histórica queda subordinada a estas puertas. Ninguna orden de despliegue, exportación o cambio de cuentas está autorizada todavía. Probar las combinaciones de versiones con copia despersonalizada en entorno aislado; si no se demuestra compatibilidad, preparar un puente compatible y revisarlo antes de la ventana. Pausar caja y modificaciones de cuentas durante la activación coordinada.

| Etapa | Continuar y prueba mínima | Error, parada y reversión |
|---|---|---|
| 1. Identidad y permisos | Confirmar propietario, proyecto, tenant, dominio, permisos, SHA y banderas; leer configuración sin exponer secretos. | Cualquier discrepancia: detener sin cambios. |
| 2. Respaldo | Aprobar bucket, costo, retención, región y permisos; completar exportación de Firestore, verificar operación y practicar restauración en proyecto aislado. Guardar con acceso restringido perfiles y claims completos de UID afectados, configuración, reglas e índices efectivos, y fuentes/revisiones de Functions y Vercel con hashes. | Exportación incompleta o restauración no probada: detener. No importar sobre producción. |
| 3. Continuidad | Confirmar identidad de Nelson y acceso heredado; antes de imponer restricciones, demostrar que al menos un `afiliado_admin` activo, con ambas agencias, conserva acceso. La transición de ese primer administrador y el puente deben ensayarse como una unidad; no hay suplente verificado. | Si no puede garantizarse continuidad en cada paso, no activar; detener y restaurar solo el perfil y claims afectados desde copia autorizada. No crear cuentas ni elevar privilegios sin autorización. |
| 4. Índices | Comparar índices desplegados y archivo, evitar eliminación; desplegar adiciones aprobadas y esperar estado listo, probar consultas aisladas. | Error o índice en construcción: detener; conservar índices existentes y añadidos mientras no exista plan seguro de retirada. |
| 5. Functions | Comprobar versiones antiguas y nuevas con perfiles heredados y nuevo administrador, flags y fuente recuperable. Desplegar en ventana aprobada; probar salud y permisos de lectura. | Fallo: detener, restaurar Functions compatibles y comprobar acceso; no asumir que redeploy del SHA de frontend reproduce configuración y fuentes anteriores. |
| 6. Reglas Firestore y Storage | Confirmar compatibilidad de ambas generaciones, capturar reglas efectivas y probar acceso y denegación. | Ante denegación indebida o exceso de acceso, parar y restaurar reglas efectivas anteriores junto al backend compatible. |
| 7. Frontend | Preparar candidato sin asignar dominio, verificar configuración compilada y promover solo con backend compatible. Comprobar login, agencia y `/demo`. | Ante error, detener, revertir alias Vercel a revisión validada; si hay incompatibilidad de perfiles, restaurar el conjunto compatible o puente. |
| 8. Perfiles y claims | Migrar solo UID y agencias aprobados, uno por uno, manteniendo continuidad y copia anterior; verificar perfil, claims completos y sesión renovada. | Congelar migración; restaurar exclusivamente perfil y claims del UID afectado, verificar sesión y administrador; no borrar usuarios ni importar toda la base. |
| 9. Acceso real | Con propietarios y operadores autorizados verificar login, ambas agencias, usuarios, caja, comisiones y configuración; pruebas que escriben solo si se autorizan y acuerdan por separado. | Ante error operativo, suspender operaciones afectadas y ejecutar reversión coordinada; registrar evidencia sin datos sensibles. |
| 10. Retirada heredada | Solo después de conciliación de todos los UID, dependencias de conductor y aprobación adicional. | Si existe dependencia, mantener puente y detener retirada; restaurar exclusivamente privilegios autorizados y comprobar alcance. |

El respaldo Firestore requiere IAM de exportación y acceso de la cuenta de servicio al bucket; la exportación tiene costo y su importación no es una reversión selectiva de un único documento. Para restaurar un perfil o claim se necesita una copia individual, operador autorizado y procedimiento probado. Los claims deben restaurarse completos, no solo el campo `role`; renovar el token después de cambios. Un rollback de código no revierte datos, usuarios ni claims. Como recuperación de acceso, el propietario usa un proveedor habilitado de Firebase Auth o recuperación de contraseña y un operador IAM autorizado verifica/restaura el perfil y claims de la cuenta existente desde respaldo; no se crean cuentas de emergencia ni privilegios sin aprobación. Referencias: [exportación e importación Firestore](https://cloud.google.com/firestore/native/docs/manage-data/export-import), [claims de Firebase](https://firebase.google.com/docs/auth/admin/custom-claims), [configuración de Admin SDK y ADC](https://firebase.google.com/docs/admin/setup).

### Borrador de Pull Request

**Título:** Estabilizar Fase 1 y preparar transición de permisos operativos

**Descripción:** Completa la operación de Secretaría, la consulta de Afiliado, la administración institucional de Afiliado administrador y el aislamiento de Soporte. Corrige alcance por agencia, permisos de Functions y reglas, caja, comisiones, historial y redirección de demo. Actualiza Functions, reglas Firestore y Storage, índices y frontend. Regresión local: 159 Functions, 28 Rules, 73 unitarias, TypeScript, build y recorridos E2E aprobados; lint conserva 267 errores y 14 avisos heredados. Riesgos abiertos: continuidad administrativa, comisión porcentual de valor cero y base de guías manuales, confirmación de identidades y banderas, `internal 0` y `/demo` en producción. La migración requiere inventario aprobado por UID, respaldo restaurable, puente compatible y ventana coordinada; revertir Vercel, Functions y reglas como conjunto compatible y restaurar solo perfiles y claims afectados cuando corresponda. No se han migrado usuarios ni publicado componentes.


| Fase | Verificadas | Pendientes | Avance |
|---|---:|---:|---:|
| 1 | 4 | 8 | 33.3% |
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

## Cierre funcional · Estado de la siguiente iteración

Commits funcionales: 8d994da y 7c71d79. TypeScript, build y 73 unitarias pasaron. Pasaron 27 pruebas Firestore, 6 de Functions en afiliados y pasajes y 8 pruebas dirigidas de comisiones y pasajes con conductor del directorio. La prueba de pasajes concilia dos operaciones, un cobro QR de Bs 25 y el total de caja del día. Regresión completa de Functions: 153 aprobadas y 0 fallos (evidence/phase1-functions-regression.log). Lint conserva 272 errores y 14 avisos.

| Bloque | Estado | Cambio o bloqueo |
|---|---|---|
| 1 · Secretaría | En curso | Cuatro módulos visibles. Encomiendas y Pasajes incluyen un turno de ventanilla con los mismos formularios, arqueo y comprobante de Caja. El panel general queda fuera del menú. Si el traslado simplificado está apagado, el despacho por manifiesto queda dentro de Encomiendas. Las autorizaciones de todas las llamadas financieras heredadas todavía requieren revisión. |
| 1 · Afiliado | En curso | Consulta operativa de encomiendas con proyección mínima en Functions, limitada a la agencia del perfil. Búsqueda por número sin rango de fecha. Los otros módulos de consulta siguen pendientes. |
| 1 · Afiliado administrador | Pendiente | Todavía no se asignaron privilegios generales al rol existente de alcance acotado. Pendientes separar los perfiles actuales candidatos y validar los permisos del nuevo administrador en cada operación. |
| 1 · Soporte | En curso | Se conserva la sesión técnica sin herramientas de producción. Pendiente cerrar el inventario de Functions. |
| 2 · Custodia | En curso | El traslado simplificado admite constancia de entrega asentada por el operador de origen en la misma transacción que la salida. El manifiesto conserva quién registró el acto, quién transporta, vehículo, guías, fecha y constancia. Funciona con un conductor del directorio sin cuenta de acceso en este flujo. Chrome verificó el manifiesto y el actor del registro, con conductor sin cuenta. El devengo fijo admite el directorio. Los flujos heredados y la liquidación requieren revisión adicional. |
| 2 · Pasajes | En curso | Secretaría de origen puede validar un pasaje pagado con su código. El historial distingue operador y conductor asignado. Se mantiene la transacción de consumo por unidad y los reintentos. Se verificó el registro de una operación con conductor del directorio sin cuenta Auth. El acceso heredado de chofer se mantiene durante la transición. |
| 3 · Encomiendas | En curso | Rango de fechas por agencia y día boliviano. Buscar por guía ignora esas fechas para poder encontrar pendientes antiguas. |
| 4 · Matriz definitiva | Pendiente | No se retiraron roles antiguos. Pendiente verificar acciones directas, sucursales y cuerpos manipulados en todos los módulos. |
| 5 · Incidente y comisiones | Bloqueada en parte | La evidencia de producción para el error original de Mi cuenta y la base acordada para comisión porcentual manual siguen pendientes. La comisión fija ya verificada se conserva. |
| 6 · Pruebas | En curso | Validación dirigida de pasajes y extensión Playwright para un conductor sin cuenta, rango de 2025, entrega y reporte diario. Chrome aprobó ambas variantes, incluida la guía de 2025 filtrada por rango, firma, historial, reimpresión PDF y recuperación tras perder la respuesta del cobro. El reporte de Cochabamba mostró dos entregas y Bs 25 de cobro en destino. Ver evidence/phase1-final-verification.log y evidence/phase1-counter-browser-final.log. |
| 7 · Transición | En curso | Se conserva el orden de migración y reversión establecido arriba. El inventario real requiere acceso autorizado y confirmar el UID de Nelson. No se tocaron cuentas reales. |
| 8 · Preparación | En curso | Fase 1 sigue sin aprobación para publicación. Fases 2 y 3 permanecen documentadas. |

## Iteración de permisos · Devengos y consulta de pasajes

Commit 3f1d442. El porcentaje de cierre integral permanece en 8.3% (1 de 12). Los siguientes avances verifican tramos de tareas abiertas.

| Tarea | Estado | Resultado y evidencia |
|---|---|---|
| EP-03 / EP-04 / EP-05 · Comisiones | En curso | Un afiliado administrador aprobado puede consultar hasta 50 devengos y devengar comisiones en la agencia autorizada de origen. Los devengos nuevos guardan agencia. Las filas históricas sin agencia comprobada quedan fuera de la consulta. Pruebas positivas y negativas en evidence/phase1-affiliate-admin-commission.log. Falta liquidación con este rol y migrar el resto de los módulos. |
| EP-04 / EP-07 · Afiliado | En curso | Se añadió consulta de pasajes por número y fecha, sin código de abordaje, datos personales ni referencia de pago. Functions rechaza otra agencia y cualquier validación de embarque de este perfil. Evidencia en evidence/phase1-affiliate-read.log. Pendientes los demás módulos de lectura. |
| EP-10 · Ventanilla | En curso | Playwright verificó ambas entregas, arqueo de Bs 75 con diferencia cero y rechazo del segundo cierre. Evidencia en evidence/phase1-counter-close-retry.log. Falta un recorrido que combine también venta y cobro de pasaje en el mismo turno. |
| EP-12 · Calidad | En curso | Build con TypeScript pasó. Lint sigue en 272 errores y 14 avisos, sin hallazgos en las dos vistas nuevas. |

El permiso temporal de devengo usa el campo autoritativo commissionAdministrationApproved. El aprovisionamiento del cliente siempre lo guarda en false y una edición del perfil revoca ese permiso temporal. Antes de activar algo en producción, identificar el UID y exigir autorización de migración. No se han actualizado perfiles reales. El índice por agencia de origen y fecha se debe publicar y esperar a que esté disponible antes de habilitar esa consulta.
## Fase 1 · Sustitución del administrador operativo

Un perfil activo `afiliado_admin` con agencia primaria válida y Punata y Cochabamba en `allowedBranchIds` recibe la autorización institucional. Un perfil del mismo rol con solo una agencia conserva las operaciones ya habilitadas en esa agencia y queda fuera de las consultas y acciones institucionales. El devengo acotado conserva su aprobación explícita en el perfil y la comprobación del origen. `afiliado` mantiene su vínculo obligatorio para Mi cuenta. El vínculo es opcional para `afiliado_admin` y, si se proporciona, se verifica contra el padrón. Las capacidades técnicas de `soporte_pachax` siguen separadas.

Las autorizaciones se evalúan sobre el perfil de Firestore. En el cliente, `operationalRoles.ts` centraliza las condiciones de menú y los permisos de las vistas. Functions usa `isOperationalAdmin` y `hasOperationalRole`. Firestore y Storage conservan sus restricciones sobre colecciones y archivos. Los datos operativos se modifican a través de sus Functions existentes.

### Matriz de operaciones y evidencias

Las pruebas indicadas están en `functions/test/` salvo Firestore Rules y Playwright. El estado por fila distingue las operaciones ejercitadas y la cobertura pendiente.

| Módulo | Lectura | Escritura | Autorización backend | Seguridad | Prueba | Estado |
|---|---|---|---|---|---|---|
| Encomiendas | Historial, detalle, incidencias y despacho | Emisión, edición, salida, recepción, entrega, cancelación e incidencias | `createShipment`, `updateShipment`, `cancelShipment`, traslado, entrega e incidencias | Transiciones y caja por operación, escritura directa denegada | `deliveryAndLogisticsControls`, `commissionsAndConsumables`, Rules y traslado Playwright | Emisión y salida del administrador en Chrome. Edición y anulación cubiertas por la regresión general, sin recorrido dirigido de administrador en Chrome. |
| Pasajes | Operaciones, validaciones y reporte | Emisión, confirmación de pago, uso, anulación y entrega de efectivo | `createPassengerTicket`, `verifyPassengerTicketPayment`, `validatePassengerTicket`, `cancelPassengerTicketOperation`, `deliverPassengerTicketToDriver` | Agencia, conductor asignado, turno y validación única | `passengerTickets`, Rules | Ciclo en Functions con administrador. Navegación visible en Chrome. |
| Almacén | Estantes, módulos y guías ubicadas | Inicialización, alta y edición de estantes, ubicación y liberación al entregar | `manageShelf`, `assignShipmentStorage`, `deliverShipment` | Agencia válida, ubicación y estado físicos | `deliveryAndLogisticsControls`, `manifestDispatch`, Rules | Catálogo probado con administrador, ubicación y liberación en la regresión general. Navegación visible en Chrome. |
| Caja | Turnos, movimientos y reportes | Apertura, cobros, egresos autorizados y arqueo | `openCashShift`, `closeCashShift`, `createExpenseAuthorization`, Functions de cobro | Candado por operador y agencia, autorización para egresos y control de saldo | `cashShift`, `commissionsAndConsumables`, Rules y traslado Playwright | Apertura y egreso de comisión probados con administrador. Cierre y reintento verificados en ventanilla. |
| Comisiones de conductores | Cuentas, asientos, historial y reporte | Devengo fijo y liquidación con vale y egreso | `accrueDriverCommission`, `settleDriverCommission`, `getSystemReport` | Configuración autoritativa, devengo idempotente, liquidación transaccional, agencia y turno | `commissionsAndConsumables`, `accrueDriverCommissionSecurity`, Rules y traslado Playwright | Ciclo de Bs 2 con conductor de directorio, un movimiento y saldo cero. |
| Afiliados y aportes | Padrón, expediente, cuotas y reporte | Alta y edición de afiliados y dependientes, generación, cobro y cambio de estado | `manageUnionMember`, `generateMonthlyDues`, `collectMemberDue`, `getUnionMembersRoster` | Límite del perfil de agencia, operaciones financieras con cajero autorizado, escritura directa denegada | `unionMembersAndDues`, `affiliateAdminSecurity`, Rules | Operaciones en Functions. Navegación visible en Chrome. |
| Préstamos | Préstamos, cuotas, pagos y reporte | Registro y cobro. El desembolso mantiene su autorización de Tesorería o Secretaría | `createUnionLoan`, `listUnionLoans`, `collectUnionLoanPayment`, `disburseUnionLoan` | Control de afiliado, agencia, turno, saldos e idempotencia | `unionLoans`, `loanDisbursement`, `affiliateAdminSecurity` | Registro y consultas con administrador. Cobro y desembolso también cubiertos con los perfiles autorizados para cada acción. |
| Multas | Listado, categorías, pagos y reporte | Registro y cobro | `createUnionFine`, `listUnionFines`, `collectUnionFinePayment` | Afiliado, turno, agencia y saldo. Secretaría conserva las operaciones ya autorizadas | `unionFines`, `affiliateAdminSecurity` | Registro y consulta con administrador. Cobro probado en ventanilla. |
| Deportes | Eventos y participantes | Crear y cerrar eventos, registrar asistencia y resolver justificaciones | Functions de deportes y `decideUnionSportsJustification` | Decisión institucional y estados del evento | `unionSports`, `reports` | Flujo en Functions con administrador. |
| Personal | Padrón, pagos y reporte de nómina | Alta, edición, cambio de estado y registro de pagos | `manageWorker`, `registerWorkerPayment` | Permisos de nómina, disponibilidad de efectivo e idempotencia | `workersAndAssets`, `reports` | Operaciones en Functions con administrador. Navegación visible en Chrome. |
| Gastos | Historial y reporte | Registrar gasto y emitir autorización cuando corresponda | `registerGeneralExpense`, `registerCashExpense`, `createExpenseAuthorization` | Caja, límites y autorización según operación | `workersAndAssets`, `cashShift`, `reports` | Registro administrativo en Functions y regresión de límites de Secretaría. |
| Inventario | Bienes, consumibles, documentos patrimoniales y reportes | Alta, edición, transferencias, baja y reactivación justificada, movimientos de insumos | `manageFixedAsset`, `manageConsumable`, `managePhysicalInventoryDocument` | Ubicación, agencia, justificación y trazabilidad histórica. Reglas de fotos en Storage | `workersAndAssets`, `patrimonialInventory`, `commissionsAndConsumables`, `reports` | Bienes e insumos en Functions con administrador. Documentos físicos en regresión general. Navegación visible en Chrome. |
| Reportes generales | Encomiendas, conductores, Caja, padrón, personal, inventario y consolidado | Consulta y exportación. Las consultas no mutan operaciones | `getSystemReport`, `getDailyOperationsReport` | Reporte general bloqueado a Secretaría, afiliado, perfil limitado y soporte. Secretaría conserva reporte diario de su agencia | `reports`, `commissionsAndConsumables`, traslado Playwright | Reportes por módulo en Functions y solicitud autenticada en Chrome. |
| Configuración de Expreso Punata | Identidad, agencias, tarifas, comisiones, aportes e impresión existente | Guardar los parámetros oficiales autorizados | `getSystemConfig`, `updateSystemConfig` | Escritura institucional y campos explícitos. La lectura general de configuración conserva su comportamiento previo | `priceAndConfigHardening`, `commissionsAndConsumables`, traslado Playwright | Lectura y guardado en Functions. Pestañas en Chrome. Impresión física se mantiene fuera de esta intervención. |
| Gestión de usuarios | Perfil, permisos y bitácora | Alta, edición, suspensión, reactivación, alcance y autorización de restablecimiento | `adminProvisionUser`, `adminSendPasswordReset` | Bloqueo transaccional de último administrador, técnico no asignable ni editable desde el cliente y escritura Firestore directa denegada | `adminProvisionUser`, `affiliateAdminSecurity`, `affiliateSecurity`, Rules, traslado Playwright | Ciclo y concurrencia en Functions. Alta de Secretaría en Chrome. Borrado definitivo sigue en Fase 2. |

### Verificación local

- [x] EP-04 · El administrador institucional sintético puede usar las autorizaciones operativas de los 15 módulos con el rol `afiliado_admin`. La matriz indica el alcance de la prueba de cada operación.
- [x] EP-04 · Alta de Secretaría, Afiliado y Administrador, cambios de agencia y estado, rechazo de cuentas técnicas y protección concurrente del último administrador en Firestore y Auth.
- [x] EP-03 / EP-05 · Lectura de cuenta y asientos, devengo de Bs 2 con reintento, liquidación concurrente con un único egreso, vale, reporte y saldo final cero en emuladores. Se rechazaron el devengo desde otra agencia, el pago sin turno en la agencia solicitada y el acceso financiero del perfil técnico.
- [x] EP-12 · TypeScript y build aprobados. ESLint registra 268 errores y 14 avisos heredados, frente a 272 y 14 en `evidence/phase1-close-lint.json`. La comparación por archivo, regla y mensaje no detectó hallazgos nuevos.
- [x] EP-10 · Chrome verificó la emisión y salida de una guía bajo administración, las entregas y el arqueo de ventanilla, el alta de Secretaría, las pestañas de configuración, un reporte general y el devengo y la liquidación de Bs 2 para un conductor de directorio.
- [ ] EP-04 y EP-10 · Ampliar las pruebas de navegador a las mutaciones que la matriz acredita únicamente en Functions, comprobar los demás recorridos de la matriz definitiva y completar la revisión de los perfiles de alcance limitado.
- [ ] EP-05 · Obtener la definición comercial de la base porcentual para guías con precio manual.
- [ ] Transición · Confirmar el inventario de UID y agencias, preparar índices y publicación autorizada e iniciar la migración controlada. La Fase 2 queda fuera de este bloque.

El commit de implementación es `17a776a`. La regresión local pasó 73 pruebas unitarias, 157 de Functions y 28 de Firestore Rules. Los resultados se registraron en [la evidencia de emuladores y Chrome](../evidence/phase1-operational-admin.log). El registro previo de cierre funcional consignaba 153 pruebas de Functions y 27 de Rules. Los estados globales de las tareas EP conservan el alcance completo de cada una, incluido lo que queda por comprobar.

### Compatibilidad y retiro del rol heredado

- `directiva_admin` conserva temporalmente las mismas puertas administrativas que enumera la matriz. Se acepta en la edición de cuentas que ya tienen ese rol, incluida la suspensión y reactivación bajo la misma protección transaccional. Los nuevos nombramientos usan `afiliado_admin` y los scripts de alta emiten ese rol. El alta con el rol heredado se rechaza.
- El cambio de rol conserva el UID y registra el rol anterior y el nuevo en la bitácora de provisión. Un cambio que retire la administración institucional por rol, alcance o suspensión comprueba que exista otro administrador activo. La reserva de Firestore se realiza antes de modificar Firebase Auth. La liquidación de comisiones lee turno, saldo y asientos dentro de la misma transacción que escribe el pago.
- Retirar la compatibilidad de los autorizadores, las reglas, la edición de perfiles, los roles de simulación y los tutoriales tras migrar todos los UID aprobados, conciliar perfiles y claims y comprobar en el entorno de revisión que queda administración activa con el nuevo rol. Conservar los valores históricos de auditoría. La retirada de los accesos heredados de Tesorería, Encargado y Conductor requiere verificar sus operaciones específicas.
- Ninguna cuenta real fue modificada. La delimitación de agencias y la base comercial de comisión porcentual cuando hay precio manual siguen sometidas a las decisiones operativas de la Fase 1.

## Fase 1 · Fiscalización de afiliados y transición de cuentas

### Matriz de consultas del afiliado

La pantalla Consultas usa `listAffiliateOperations`. Filtra por agencia desde el perfil autoritativo y permite búsqueda, fechas, paginación, detalle e impresión de la página consultada. Las filas antiguas sin agencia verificable quedan excluidas. Para préstamos históricos, se comprueba la agencia del afiliado vinculado en el padrón. Mi cuenta tiene una proyección separada con el nombre propio y las obligaciones del titular. Firestore y Storage bloquean el acceso del afiliado a los documentos operativos originales.

| Módulo | Acción de consulta en su agencia | Campos protegidos | Prueba |
|---|---|---|---|
| Encomiendas | Guía, destino, estado, bultos e importe | Remitente, destinatario, teléfonos, firmas y fotos | Functions y caso Chrome en el recorrido |
| Pasajes | Operación, fecha, cantidad, importe, pago y entrega | Pasajero, código de abordaje, QR y referencia bancaria | Functions y caso Chrome en el recorrido |
| Almacén | Estantes, códigos y cantidad de módulos | Notas y datos de guías almacenadas | Functions y caso Chrome en el recorrido |
| Caja | Turno, efectivo inicial, esperado, contado y diferencia | Identidades, notas de arqueo y evidencia | Functions y caso Chrome en el recorrido |
| Comisiones | Guía, devengado, liquidado y estado | Identidad y datos del conductor | Functions y caso Chrome en el recorrido |
| Afiliados | Número de afiliado, fecha de ingreso, categoría y estado | Nombre de terceros, CI, teléfonos, domicilio y dependientes | Functions y caso Chrome en el recorrido |
| Aportes | Período, importe, pagado, saldo y estado | Identidad de terceros, referencias y canales privados | Functions y caso Chrome en el recorrido |
| Préstamos | Número, principal, saldo, cuotas y desembolso | Beneficiario, observaciones y medios privados | Functions y caso Chrome en el recorrido |
| Multas | Categoría, fecha, importe, saldo y estado | Persona sancionada, motivo libre, evidencias y datos de menores | Functions y caso Chrome en el recorrido |
| Deportes | Jornada, fecha, total de participantes y estado | Listado de menores, asistencia individual y justificaciones | Functions y caso Chrome en el recorrido |
| Inventario | Código, bien, categoría, valor y estado | Fotos, ubicación personal, responsables y notas | Functions y caso Chrome en el recorrido |
| Personal | Código laboral, cargo, modalidad y estado | Nombre, CI, teléfono y salario individual | Functions y caso Chrome en el recorrido |
| Gastos | Comprobante, categoría, importe, medio y estado | Proveedor, factura privada, observaciones y operador | Functions y caso Chrome en el recorrido |
| Reportes | Libro de movimientos de la agencia, con fecha, categoría, medio e importe | Contrapartes, operadores, cuentas bancarias y referencias privadas | Functions y caso Chrome en el recorrido |
| Historial | Historial de incidencias por guía, tipo y estado | Bitácora interna, actores, notas y evidencias | Functions y caso Chrome en el recorrido |

Para cada consulta de la matriz, la prueba de Functions ejecuta lectura y filtros en Punata y rechazo en Cochabamba con el mismo perfil. Usuarios, configuración y soporte no forman parte del catálogo. Los movimientos, páginas impresas y documentos de Mi cuenta toman sus importes de los asientos existentes.

| Rol | Módulo y acción | Agencia | Resultado esperado y evidencia |
|---|---|---|---|
| Afiliado | Consultas de la tabla, filtros e impresión de página | Autorizada | Respuesta proyectada y sin mutaciones. `affiliateOperations.test.mjs` y recorrido Chrome. |
| Afiliado | Consulta fuera de agencia, acceso a colecciones crudas y mutaciones administrativas | Ajena o cualquiera para mutaciones | Denegación en Functions y Firestore Rules. |
| Secretaría | Encomiendas, Pasajes, Almacén y reporte del día | Agencia asignada | Emisión, cobro, turno y arqueo usan las Functions existentes. |
| Secretaría | Préstamos, multas, cuotas, gastos, nómina, gestión de inventario, comisiones, configuración y usuarios | Cualquiera | Mutaciones denegadas directamente. La aprobación de entrega de pasajes no habilita el egreso administrativo genérico. |
| Afiliado administrador institucional | Desembolso, cobros, inventario, gastos y comisiones | Agencias autorizadas | Permiso institucional con los requisitos de cada operación, incluidos turno, saldo e idempotencia. |
| Soporte PACHAX | Operación financiera, configuración, provisión y auditoría directa | Cualquiera | Sin permiso implícito. El propio perfil sigue siendo legible. |
| Tesorería, Encargado, Conductor y Directiva | Compatibilidad temporal de cuentas existentes | Alcance de la cuenta | Se conservan accesos necesarios de lectura y operación previa que no se reclasificaron como reservados. Las altas de roles heredados se bloquean. |

### Resultado local de verificación

- [x] Fiscalización del afiliado en los 15 módulos. Functions comprobó búsqueda, fechas, campos privados y rechazo fuera de agencia en cada módulo. Chrome comprobó su lista, filtro y detalle.
- [x] Bloqueo de mutaciones administrativas para Secretaría, Afiliado y Soporte con perfil autoritativo. También se verificó el bloqueo de Caja, configuración y documentos operativos originales donde correspondía.
- [x] Chrome con afiliado administrador. Validó suspensión y reactivación en Auth, guardado de configuración institucional, registro de gasto y alta de bien fijo.
- [x] Turno único de Secretaría con encomienda de Bs 25 en efectivo y pasaje de Bs 12 por QR. Arqueo sin diferencia y rechazo del segundo cierre. El Reporte del día concilió el pasaje.
- [x] Chrome con afiliado administrador. Edición de la afiliación.
- [x] Chrome con afiliado administrador. Registro y desembolso de préstamo.
- [x] Chrome con afiliado administrador. Registro de multa.

TypeScript, build, 73 unitarias y 28 pruebas de Firestore Rules aprobados. Functions ejecutó 159 casos. Los dos casos rechazados por aserciones de los perfiles anteriores aprobaron al repetirlos con sus actores y expectativas revisados. ESLint registró 267 errores y 14 avisos heredados, sin hallazgos nuevos.

La evidencia se guardó en [el registro de fiscalización](../evidence/phase1-affiliate-oversight.log).

### Preparación del inventario y publicación

No se consultaron cuentas reales. Falta confirmar el proyecto de producción y una identidad autorizada de solo lectura. Nelson es candidato a `afiliado_admin`, con UID pendiente de confirmación por el propietario.

1. Obtener aprobación del propietario y respaldar los perfiles y claims, con acceso restringido y fecha del respaldo.
2. Exportar de Firestore los campos UID, nombre, rol, estado y agencias. Conciliar estado activo con Auth por UID. El inventario solo añade rol propuesto y clasificación real o prueba. No copiar correos, CI, contraseñas, enlaces de restablecimiento ni tokens.
3. Revisar las correspondencias una a una. Mantener las agencias necesarias y revisar qué accesos debe conservar cada operador. Mantener los identificadores de conductores en documentos históricos y en el directorio operativo.
4. Confirmar con el propietario el UID real de Nelson, su función y sus agencias. Distinguirlo de cuentas homónimas y de prueba.
5. Confirmar un administrador institucional de continuidad con Auth habilitado y perfil activo. Verificar los rechazos de suspensión simultánea en emuladores.
6. Preparar una revisión con frontend, Functions, Firestore Rules, Storage Rules e índices compatibles. Validar en emuladores los cuatro roles.
7. Tras la autorización de publicación, preparar índices y esperar su disponibilidad. Publicar Functions, reglas y frontend en una ventana coordinada. Antes de aplicar las restricciones, asignar la cobertura de desembolsos, cobros y liquidaciones a un administrador institucional confirmado para evitar interrupciones durante el cambio.
8. Migrar por lotes aprobados. Para cada UID, comprobar perfil, claims, agencias, inicio de sesión y bitácora. Revocar sesiones al cambiar privilegios cuando corresponda.
9. Repetir pruebas de acceso positivo y negativo por rol y agencia, y confirmar que siguen disponibles los recorridos críticos en producción autorizada.
10. Ante una incidencia, pausar. Restaurar perfiles y claims del lote afectado desde el respaldo y revertir los componentes coordinados si hace falta. Volver a comprobar al administrador activo antes de continuar.

Retirar la compatibilidad solo después de conciliar las cuentas reales y obtener autorización. El incidente original `internal 0` requiere evidencia de producción. La comisión porcentual con precio manual sigue pendiente de definición comercial. La redirección de la demo retirada requiere verificación después de una publicación autorizada.

## Revisión final de Fase 1 y preparación de publicación

### Resumen propuesto para el PR

**Título** · Fase 1 de Expreso Punata: operación, fiscalización y transición de cuentas.

La administración institucional usa `afiliado_admin` y conserva puertas heredadas durante la transición. Soporte PACHAX queda aislado. Afiliado puede fiscalizar 15 módulos con proyección de campos y alcance por agencia. Secretaría concilia encomiendas y pasajes en el mismo turno. Las mutaciones se autorizan en Functions y las reglas protegen los documentos originales. Se mantiene la liquidación de comisión fija y se retira la demo pública.

La rama acumulada hasta `764678a` contiene 15 commits sobre `origin/main` en `04c5b89a41cb7f40aa5bdb26d37fa2fd34db6b09`, con cero commits detrás y sin conflictos en `git merge-tree --write-tree origin/main HEAD`. Antes de abrir el PR, repetir `git fetch origin --prune`, `git rev-list --left-right --count origin/main...HEAD`, `git merge-tree --write-tree origin/main HEAD` y `git diff --check origin/main...HEAD`. Si main avanzó, resolver coincidencias en una rama de integración separada y repetir regresiones. Mantener intacta la rama original. Excluir `tmp/`, capturas y logs crudos. Adjuntar evidencia sanitizada.

### Inventario autorizado de solo lectura

El checkout identifica `expreso-punata-dev`. No se verificó el proyecto de producción ni se encontró ADC local configurada. No se consultaron cuentas reales. El propietario debe confirmar proyecto, tenant y una identidad de solo lectura de perfiles y usuarios Auth. Para un proyecto compartido, delimitar las cuentas del cliente y el tenant antes del listado. El siguiente comando corresponde a un proyecto dedicado con tenant predeterminado. La salida debe quedar en una carpeta restringida fuera de Git.

```powershell
$env:EP_RELEASE_PROJECT = Read-Host 'ID de Firebase confirmado por el propietario'
$epInventory = Read-Host 'Ruta absoluta de inventario en carpeta restringida'
if (!$env:EP_RELEASE_PROJECT -or $env:EP_RELEASE_PROJECT -like 'demo-*') { throw 'Confirme el proyecto real' }
if ($env:FIRESTORE_EMULATOR_HOST -or $env:FIREBASE_AUTH_EMULATOR_HOST) { throw 'Quite las variables del emulador' }
firebase projects:list
@'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
const app = initializeApp({ credential: applicationDefault(), projectId: process.env.EP_RELEASE_PROJECT })
const snapshot = await getFirestore(app).collection('users')
  .select('fullName', 'role', 'isActive', 'primaryBranchId', 'allowedBranchIds').get()
const profiles = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]))
const accounts = new Map()
let page
do {
  const result = await getAuth(app).listUsers(1000, page)
  for (const { uid, disabled, customClaims } of result.users) {
    accounts.set(uid, { disabled, role: customClaims?.role ?? null })
  }
  page = result.pageToken
} while (page)
for (const uid of new Set([...profiles.keys(), ...accounts.keys()])) {
  const p = profiles.get(uid)
  const a = accounts.get(uid)
  const canonical = ['secretaria', 'afiliado', 'afiliado_admin', 'soporte_pachax'].includes(p?.role)
  console.log(JSON.stringify({
    uid, nombre: p?.fullName ?? null, rolActual: p?.role ?? null,
    perfilActivo: p?.isActive ?? null, authHabilitado: a ? !a.disabled : null,
    agenciaPrincipal: p?.primaryBranchId ?? null, agenciasAutorizadas: p?.allowedBranchIds ?? [],
    rolPropuesto: canonical ? p.role : null, personaRealConfirmada: false,
    requiereRevision: true,
    discrepancia: !p || !a || !canonical || p.role !== a.role || p.isActive !== !a.disabled,
  }))
}
'@ | node --input-type=module | Set-Content -Encoding utf8 -LiteralPath $epInventory
if ($LASTEXITCODE -ne 0) { throw 'No utilice un inventario incompleto' }
Get-FileHash -Algorithm SHA256 -LiteralPath $epInventory
```

Revisar perfiles heredados o sin identidad confirmada, cuentas sin documento o sin Auth, estados o claims discordantes y agencias dudosas. Confirmar el UID de Nelson contra el registro autorizado del propietario y Auth. Mantener ese UID activo y confirmar Punata y Cochabamba antes de asignar alcance institucional. Confirmar también otra cuenta de continuidad, habilitada en Auth, activa en Firestore y probada. No realizar altas para improvisar continuidad ni asignar roles automáticamente.

### Publicación y reversión

Los comandos siguientes se reservan para la ventana autorizada. Definir previamente `$epVercelProject`, `$epVercelTeam`, `$epBackupUri`, `$epCandidateUrl`, `$epPreviousUrl` y `$epProductionUrl` con valores aprobados, sin copiar secretos. Confirmar el enlace Git de Vercel y evitar la promoción automática fuera de la ventana.

| Componente | Archivo o panel | Acción |
|---|---|---|
| Índices | `firestore.indexes.json` | Publicar primero, conservando los índices vigentes. |
| Cloud Functions | `functions/index.js`, `functions/affiliateOperations.js` y dependencias de runtime | Publicar Functions en la ventana. |
| Reglas | `firestore.rules`, `storage.rules` | Publicar tras comprobar Functions. |
| Frontend y redirección | `src/`, `vercel.json` | Preparar compilación sin dominio y promover tras verificar backend. |
| Configuración y perfiles | Variables de Vercel y Functions, Firestore `users`, Firebase Auth | Comprobar banderas y proyecto. Migrar solo UID aprobados. |

1. **Identidad y respaldo.** Verificar `firebase projects:list`, `firebase functions:list --project $env:EP_RELEASE_PROJECT` y `vercel project inspect $epVercelProject --scope $epVercelTeam`. Registrar SHA del código efectivamente desplegado, IDs de reglas e índices, banderas y URL anterior. Confirmar Node 22, `VITE_USE_FIREBASE_EMULATORS=false`, proyecto Firebase correcto y concordancia de `SIMPLE_SHIPMENT_TRANSFER` con `VITE_SIMPLE_SHIPMENT_TRANSFER`. Mantener `VITE_PUBLIC_DEMO` apagada. Ejecutar `gcloud firestore export $epBackupUri --database="(default)" --project=$env:EP_RELEASE_PROJECT`. Verificar operación completada, metadatos y recuperación en proyecto aislado. Guardar aparte copia restringida de campos y claims de los UID aprobados, con fecha y hash, excluyendo credenciales y hashes de contraseña.
2. **Continuidad.** Validar al administrador institucional y al suplente antes de activar restricciones. Acordar quién atiende los desembolsos, gastos y liquidaciones durante el cambio. Preparar un checkout de reversión compatible con ambas generaciones de perfiles. `6098b31` es una referencia del puente, pendiente de verificar con el entorno real. Si la versión previa no acepta los nuevos perfiles y no hay puente comprobado ni restauración autorizada por UID, detenerse.
3. **Índices.** Ejecutar `firebase deploy --project $env:EP_RELEASE_PROJECT --only firestore:indexes`. Detenerse si se propone eliminar un índice vigente. Confirmar los necesarios en estado listo con `gcloud firestore indexes composite list --database="(default)" --project=$env:EP_RELEASE_PROJECT` o consola.
4. **Frontend preparado.** Probar primero en entorno de revisión. Desde el checkout vinculado al proyecto aprobado, ejecutar `vercel deploy --prod --skip-domain --scope $epVercelTeam`. Registrar URL candidata. Verificar proyecto Firebase y banderas del build antes de promover. Las comprobaciones de una URL conectada a producción requieren autorización y son de solo lectura.
5. **Activación técnica.** Pausar operaciones de Caja y cambios de cuentas durante la ventana. Ejecutar `firebase deploy --project $env:EP_RELEASE_PROJECT --only functions` y comprobar salud de las llamadas y continuidad de perfiles existentes. Ejecutar `firebase deploy --project $env:EP_RELEASE_PROJECT --only firestore:rules,storage` y verificar lecturas y denegaciones. Promover con `vercel promote $epCandidateUrl --scope $epVercelTeam`. Verificar acceso, agencia, reportes de lectura y `curl.exe -sS -I "$epProductionUrl/demo"` para respuesta temporal y destino `/`.
6. **Migración controlada.** Abrir Configuración → Usuarios y Permisos, verificar UID, rol, estado y agencias y guardar cada correspondencia aprobada mediante el aprovisionamiento existente. Conciliar claims y perfil, coordinar reautenticación y verificar bitácora. Probar a Nelson con el propietario y a Secretaría en su agencia. Mantener una cuenta de continuidad disponible antes y después de cada UID. Las mutaciones de prueba corresponden al entorno aislado. Retirar permisos heredados en una revisión posterior cuando el inventario confirme que ya no se usan.
7. **Detención y reversión.** Detener ante respaldo incompleto, proyecto incorrecto, índice no listo, pérdida de un administrador, acceso excesivo o fallo de operación crítica. Congelar nuevas migraciones. Si la revisión previa acepta los perfiles actuales, ejecutar `vercel rollback $epPreviousUrl --scope $epVercelTeam` y `vercel rollback status --scope $epVercelTeam`. Desde el SHA de recuperación aprobado ejecutar `firebase deploy --project $env:EP_RELEASE_PROJECT --only functions,firestore:rules,storage`. Usar el puente si hace falta compatibilidad con perfiles nuevos. Conservar índices añadidos. Si hay que revertir un perfil, el operador autorizado restaura solo ese UID desde el respaldo de perfil y claims, con otra cuenta institucional comprobada antes y después. No importar toda la base para revertir la aplicación. Verificar continuidad en Auth y Firestore y obtener autorización para reanudar.

Referencias oficiales para [Firebase CLI](https://firebase.google.com/docs/cli), [respaldo Firestore](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import), [preparación en Vercel](https://vercel.com/docs/cli/deploying-from-cli) y [reversión Vercel](https://vercel.com/docs/cli/rollback).

### Estado de las tareas de Fase 1

| Tarea | Implementación y pruebas locales | Dependencia de cierre |
|---|---|---|
| EP-01 · Auditoría | Matriz revisada y recorrido integrado de los cuatro perfiles | Pendiente de verificación en producción. |
| EP-02 · `internal 0` | Diagnóstico del cliente conservado. Casos sintéticos de vínculo ausente, agencia ajena y formato heredado cubiertos | Pendiente de evidencia del incidente original. Obtener UID autorizado, fecha y hora local, acción, agencia, código e identificador del log. Nunca solicitar contraseñas ni datos de menores. |
| EP-03 · Permisos | Proyecciones, permisos positivos y rechazos verificados en emuladores | Pendiente de publicación coordinada y verificación de consultas e índices en el entorno autorizado. |
| EP-04 · Matriz | Implementación completada localmente para los cuatro perfiles y las excepciones transitorias | Pendiente de autorización para inventariar y migrar perfiles. La retirada de los roles antiguos queda después del cutover. |
| EP-05 · Comisiones | Devengo fijo de Bs 2 y reintentos verificados. El motor rechaza porcentaje sobre una guía manual sin base autorizada con `failed-precondition` y sin crear un asiento | Bloqueada por definición comercial del importe y conceptos que forman la base del porcentaje con precio manual, incluida su vigencia. |
| EP-06 · Encomiendas | Registro, precio manual, cobro, traslado, custodia, recepción, entrega, historial e impresión verificados en recorridos locales | Pendiente de verificación en producción tras publicar. |
| EP-07 · Pasajes | Verificada en emuladores, incluida la conciliación de QR con Caja | Publicación coordinada pendiente. |
| EP-08 · Otros módulos | Consultas de afiliado y operaciones administrativas prioritarias verificadas en Functions y Chrome | Pendiente de verificación tras migrar cuentas y confirmar las agencias reales. |
| EP-09 · Demo | Configuración local `/demo` → `/` con `permanent: false`. La URL directa del build local exige sesión | Pendiente del HTTP 307 en el dominio real tras publicación autorizada. |
| EP-10 · E2E | Registro a reportes, comisión fija, cierre e idempotencia probados en emuladores. El recorrido cubre recuperación tras una respuesta de entrega perdida | Validación posterior a la publicación se gestiona por separado. |
| EP-11 · Aviso de Caja | Verificada la lectura del candado propio ausente y del turno autorizado | Publicación de reglas pendiente. |
| EP-12 · Lint | 267 errores y 14 avisos heredados. Comparación por archivo, regla y mensaje sin hallazgos nuevos | Deuda heredada registrada. Evitar refactor general en esta fase. |

La revisión local de `/demo` comprobó la regla y el comportamiento del build al entrar por esa ruta. El código HTTP de la capa de Vercel corresponde a la verificación posterior a la publicación. [Configuración de redirecciones de Vercel](https://vercel.com/docs/project-configuration/vercel-json).

La evidencia de revisión se guarda en [el registro de regresión](../evidence/phase1-release-review.log). Para reproducir las pruebas, usar Node 22, compilar con `VITE_USE_FIREBASE_EMULATORS=true`, `VITE_FIREBASE_PROJECT_ID=demo-expreso-punata-transfer` y `VITE_SIMPLE_SHIPMENT_TRANSFER=true`, y ejecutar los recorridos de navegador en instancias frescas de emuladores. Usar `SIMPLE_SHIPMENT_TRANSFER=true` para el recorrido simplificado. Los datos de prueba permanecen en proyectos demo y las capturas se guardan en `tmp/`.

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

- [x] Verificado en emuladores.
- Registro, confirmación QR, comprobantes y Reporte del día probados en Chrome dentro del turno conjunto.
- Verificación, historial, anulación y permisos aprobados en Functions y Firestore Rules con los roles vigentes.

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

- [x] Verificado localmente con los perfiles actuales.
- Recorrido Playwright de Secretaría, Afiliado, Afiliado administrador y Soporte, incluidos los rechazos de rol y agencia.
- Cadena de encomienda a reportes, pago en origen y contraentrega, custodia, recepción, impresión, búsqueda histórica, recuperación ante respuesta perdida y concurrencia verificadas en emuladores.
- La verificación del despliegue real queda bajo la ventana autorizada.

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

- [x] Revisado y verificado con el criterio de Fase 1.
- ESLint conserva 267 errores y 14 avisos. Diferencia de 0 hallazgos frente a la revisión anterior por archivo, regla y mensaje.
- Se conserva la Flat Config y la deuda heredada. No se fijó una meta de cero errores para esta entrega.

Ya existe una Flat Config.

Quedan 267 errores y 14 avisos heredados.

No rehagas la configuración.

Prioriza errores de Hooks, ejecución, estados, permisos, seguridad y lógica.

No realices refactors masivos innecesarios.

Documenta la deuda heredada y las correcciones verificadas.

---

## Fase 2

### Bloque A · avance de gestión de usuarios

#### Continuación desde `c8187ba`

- **Responsabilidades por UID.** Baja y eliminación comparten comprobaciones transaccionales de caja, manifiestos y traslados, encomiendas asignadas en tránsito, cobros COD pendientes de rendición, pasajes por embarcar o liquidar, saldo de comisiones y bienes patrimoniales vigentes con responsable explícito. Las recepciones y entregas de ventanilla corresponden a la agencia. Los UID de registro, entrega completada, recepción completada y almacenamiento son trazabilidad. El COD conciliado conserva su referencia histórica. Un nombre libre de responsable no demuestra un vínculo con una identidad de Auth.
- **Asignaciones concurrentes.** La apertura de caja y la entrega leen el perfil vigente dentro de la transacción. Despachos, pasajes y devengos usan la lectura transaccional del conductor y rechazan un perfil en baja, incluso si comparte UID con el directorio. Las escrituras de responsabilidad patrimonial comprueban el perfil dentro de la transacción.
- **Operaciones y recuperación.** Gestión de usuarios consulta por UID las reservas de baja y eliminación guardadas en Firestore. Otra sesión administrativa puede reintentar el mismo identificador con confirmación y autenticación reciente. El backend también admite consulta por identificador y tipo. La bitácora conserva operador inicial, operador que completó, resultado e identificador. Una respuesta tardía de fallo no degrada una operación completada.
- **Eliminación de Auth.** Exige perfil dado de baja, identidad deshabilitada si aún existe, cuenta sintética marcada y proyecto `demo-*` con emuladores. Verifica la ausencia de la identidad antes de marcar la operación completada. Conserva perfil y movimientos. Las cuentas técnicas y los administradores están protegidos. Para evaluar activación real quedan pendientes la reconciliación de referencias no verificables por UID, revisión de triggers y datos heredados y autorización expresa.
- **Verificación final con Node 22.** TypeScript y build aprobados, 73 pruebas unitarias, 175 de Functions y 30 de Firestore Rules. Las pruebas cubrieron bajas simultáneas entre administradores, protección del último administrador, suspensión durante una eliminación, cambio de rol o agencia durante una baja, rechazo de asignaciones nuevas durante una eliminación, fallo parcial, reintento con Auth ya eliminado, cuentas protegidas y acceso sin autorización.
- **Playwright integral aprobado en Chrome y Firebase Emulator Suite.** El recorrido de `tests/e2e/runUserSecurityJourney.mjs` creó, editó, reasignó, suspendió y reactivó una cuenta, revocó sesiones, comprobó el rechazo por caja abierta y completó la baja. Verificó los filtros de usuario, texto, acción, estado y fechas. Tras inducir una discrepancia entre Auth y Firestore, cerró el navegador, inició sesión con otro administrador y reintentó la eliminación con el mismo identificador. Auth respondió `auth/user-not-found` y se conservaron el perfil, la auditoría y el movimiento financiero.
- **Estado.** Bloque A cerrado técnicamente en emuladores. La rama permanece local y la eliminación física en producción sigue bloqueada. Commits de implementación y pruebas: `9ab18c6`, `71e28b5`, `a568f54` y `01e04f8`.

Los siguientes párrafos registran los avances anteriores a esta continuación.

Historial: se retiró el ordenamiento Firestore por timestamp, que excluía eventos nuevos con solo timestampIso; la lectura ahora conserva esos eventos y ordena sus fechas ISO. Se muestran motivo, resultado e identificador disponible y se añadieron filtros de texto y fechas en la bitácora del usuario. Build y TypeScript aprobados; falta comprobar estos cambios en Playwright y ejecutar la regresión integral. El Bloque A permanece abierto.

Prueba adicional: dos solicitudes simultáneas con el mismo UID e identificador de eliminación completan coherentemente y conservan la referencia financiera; cinco pruebas dirigidas y build aprobaron. La tabla de usuarios distingue suspensión, baja pendiente, baja completada y eliminación de Auth. No se ejecutó Playwright integral ni se completaron filtros de historial o la revisión total de obligaciones; Bloque A sigue abierto.

Eliminación física: implementación inicial exclusivamente para una identidad sintética marcada en proyecto demo con Auth y Firestore Emulator. Registra estado y auditoría persistentes, conserva el perfil y admite reintento tras fallo Auth; las cuentas técnicas y administradores están bloqueados. Producción permanece bloqueada porque aún faltan verificaciones de custodia, pasajes y otras responsabilidades y revisar triggers desplegados. Cinco pruebas dirigidas y build aprobaron antes de añadir la consulta de estado; faltan pruebas de concurrencia y de esa consulta. No está listo para publicación.

Continuación de backend: la baja comprueba además turnos de caja abiertos, manifiestos despachados o en tránsito asignados al conductor y saldo pendiente de comisiones. Cuatro pruebas dirigidas pasaron en emuladores, incluyendo bloqueo por manifiesto y comisión y conservación de historial. La revisión de custodia, pasajes y otras responsabilidades aún no es completa; no se implementó eliminación física de Auth ni recuperación independiente del navegador. El backend sigue sin estar listo para publicación.

Continuación: el identificador y motivo de una baja pendiente se guardan en el navegador, separados por administrador y usuario, para reintentar tras cerrar la pantalla en el mismo dispositivo. Una prueba en emulador fuerza un fallo al actualizar Auth y confirma que el mismo identificador completa después la operación. Build y cuatro pruebas dirigidas aprobadas. Sigue pendiente recuperar la operación desde otro dispositivo o tras borrar el almacenamiento, comprobar todas las obligaciones y probar Playwright integral. La eliminación física y el historial con filtros siguen pendientes; este bloque no está cerrado.

Se añadió una baja lógica con autenticación reciente, confirmación, motivo, candado de administración, protección del último administrador, bloqueo ante caja abierta, revocación de acceso, auditoría y reintentos por identificador. Se conserva Auth deshabilitado y el perfil histórico; todavía no existe eliminación física segura ni un inventario completo de custodia y obligaciones. La interfaz permite iniciar la baja y reintentar mientras permanece abierta; la recuperación del identificador tras cerrar la pantalla sigue pendiente. TypeScript y build aprobados; tres pruebas dirigidas de seguridad y 29 pruebas Rules aprobadas. Faltan Playwright del recorrido completo, fallos parciales y concurrencia específica de la baja. No se tocaron usuarios de producción. EP-14 sigue en curso y la baja no está lista para publicación.

### Bloque B · configuraciones operativas y comerciales

- **B1.** Edición institucional y de agencias por campos, con versión, valor previo, motivo, operador y restauración auditada. El comprobante unificado y su vista previa toman los datos oficiales de la agencia, el nombre y el aviso institucional. El diálogo de impresión puede usar el logo HTTPS cuando el perfil de impresora lo admite. Los códigos de agencia siguen siendo los mismos. El formulario legado conserva los campos que ya administra el editor versionado. Los horarios no tienen actualmente un consumidor operativo.
- **B2.** Editor de tarifas por los dos sentidos de la ruta con base, peso incluido, recargo por kilo y entrega a domicilio. Los borradores se guardan sin aplicar. Las publicaciones se seleccionan por vigencia en La Paz y el motor existente conserva importe y versión en cada guía. El interruptor de cálculo automático sigue siendo independiente. Un reintento con la misma clave recupera la guía original incluso después de publicar otra tarifa. Las categorías de bulto se mantienen como clasificación; la fórmula existente no las usa como multiplicadores.
- **B3.** Comisión fija por encomienda o porcentual sobre `shippingFeeCents`. El precio manual no aporta esta base. El devengo versionado conserva el importe histórico e idempotencia. La aprobación y publicación pertenecen a la administración del cliente. Soporte consulta reglas y estado.
- **B4.** Configuraciones versionadas para políticas de aportes, catálogos operativos, campos opcionales de reportes y preferencias de avisos. Las políticas de aportes admiten periodicidad mensual, concepto, importe, vigencia, categoría y sucursales; administración de afiliados puede preparar y aprobar/publicar versiones. La emisión toma la política vigente para nuevos cobros y conserva la versión aplicada; no recalcula ni modifica aportes históricos ni pagos directos. Los valores comerciales oficiales aún requieren aprobación del cliente. Los catálogos renombran o desactivan opciones existentes de cargos, activos fijos e insumos; no admiten claves nuevas ni eliminan opciones o registros históricos. Las opciones desactivadas no se ofrecen para altas nuevas. Se preservan las categorías financieras, de seguridad y de cuentas. Los reportes permiten ordenar y mostrar/ocultar campos opcionales admitidos en la tabla, PDF y XLSX; los campos legales y financieros obligatorios permanecen visibles. Se conserva el período inicial seleccionable y el nombre institucional del PDF. Las preferencias afectan únicamente la visibilidad del aviso informativo de encomienda ya existente y su lista de pendientes con marcado de lectura; no cambian alertas de seguridad, caja o auditoría, ni crean canales nuevos. B4 no añade recurrencias distintas de la mensual ni automatiza otros tipos de cobro.
- **B5–B6.** Formularios por módulo y ruta, historial reciente, confirmación, autenticación reciente, segundo factor para Soporte fuera de emulador y control transaccional por versión. La restauración comercial crea un borrador y su aplicación requiere aprobación explícita. Las versiones se consultan mediante Functions y quedan cerradas a escrituras directas desde Firestore.
- **B7. Verificación final con Node 22.** TypeScript, build, 73 pruebas unitarias, 179 pruebas de Functions y 32 pruebas Firestore Rules aprobadas. Playwright en Chrome aprobó edición y restauración de agencia y configuraciones B4, efecto en comprobantes y reportes, separación de roles, publicación de tarifas y comisiones, historial y período. El recorrido verificó que el campo opcional de afiliado se oculta en el reporte real y que catálogos y avisos usan las preferencias guardadas. Las pruebas Functions cubren publicación solo para altas nuevas, preservación histórica, coincidencia de categoría/sucursal, autenticación reciente, permisos, concurrencia, restauración versionada y bloqueo de opciones desactivadas. También verifican devengo fijo y porcentual, rechazo sin base, vigencia, reintentos, topes de préstamos y multas deportivas. El recorrido de navegador está en `tests/e2e/runBlockBConfiguration.mjs`.
- **Estado.** Bloque B cerrado localmente y verificado en emuladores, sin publicación. La configuración comercial efectiva de tarifas, comisiones y aportes sigue sujeta a aprobación del cliente; las pruebas usan valores sintéticos. Límites de B4: periodicidad mensual; catálogos restringidos a claves existentes; campos opcionales del reporte genérico admitidos; aviso informativo de encomiendas ya existente. Las fórmulas tarifarias y comisiones de producción no cambiaron. Commits anteriores de implementación y pruebas: `4b25de2`, `a797105`, `137c226`, `b98e77f` y `5319d07`. B4: `4cb9f3a` y `9652e07`.

### Avance local · Centro de Soporte

Rama `codex/phase-2-support-center`, creada desde `origin/main` en `c35b620e08e2af32196b900bdaa8c12d55004e8b`. No se ha publicado esta fase. En la comprobación de producción anterior al desarrollo, Vercel estaba READY en ese SHA, las 71 Functions estaban activas y `/demo` respondía 307 a `/`. El inicio de sesión real de Nelson y la creación de usuarios requieren comprobación humana y siguen pendientes.

| Tarea | Estado real | Evidencia y trabajo pendiente |
|---|---|---|
| EP-13 · Soporte | En curso | Panel independiente con resumen y acceso exclusivo al perfil técnico. Backend exige perfil activo y, fuera de emuladores, segundo factor. La configuración institucional y comercial versionada se describe en el Bloque B. Los diagnósticos permiten registrar y consultar identificadores técnicos manuales; falta integrar eventos automáticos de cliente, Functions y dispositivos. La activación de una identidad real requiere titular confirmado, MFA, aprovisionamiento IAM y auditoría; no se ha creado ninguna cuenta. La ampliación de impresoras sigue pendiente. |
| EP-14 · Usuarios | Verificado en emuladores | Gestión, revocación y baja lógica con auditoría, recuperación por backend y protección administrativa. Eliminación de identidad limitada a cuentas sintéticas marcadas en emuladores; perfil y operaciones conservados. La verificación y las condiciones de publicación se registran en el Bloque A. |
| EP-15 · Cuentas antiguas | Pendiente de revisión | Las tres cuentas antiguas fueron deshabilitadas y sus sesiones revocadas. Existen referencias en movimientos, manifiestos y auditoría, así como dos candados históricos de caja; no se han eliminado físicamente perfiles ni registros de negocio. |
| EP-16 · Limpieza | En curso, solo emulador | Simulación de categorías y dependencias bidireccionales en una colección aislada de registros sintéticos marcados. El backend bloquea producción, exige soporte activo, autenticación reciente y confirmación; verifica cambios desde la simulación y guarda respaldo, auditoría e idempotencia en la misma transacción. La restauración del respaldo sintético también es transaccional, idempotente y evita sobrescribir documentos. No procesa colecciones operativas, no identifica automáticamente datos históricos ni está listo para limpieza real. Faltan el grafo de dependencias de los módulos, revisión de conflictos reales, recuperación de fallos de producción y autorización explícita por conjunto. |

**Identidad técnica futura:** el propietario de PACHAX debe identificar al titular y configurar autenticación multifactor en Firebase Auth. Un operador IAM autorizado deberá preparar el perfil técnico y sus permisos mediante un procedimiento revisado y auditado, sin credenciales en Git. El administrador del cliente no puede crear ni modificar el rol de soporte. Esta descripción no habilita una cuenta ni sustituye un procedimiento de aprovisionamiento probado.

**Limitaciones:** las tarjetas de usuarios, mantenimiento e impresoras son indicadores de trabajo pendiente; no representan herramientas terminadas. Los diagnósticos no capturan eventos automáticamente y no hay detección infalible de secretos en identificadores introducidos manualmente. Las opciones configurables y sus pendientes se registran en el Bloque B. El antiguo `internal 0` sigue sin causa confirmada. Se preserva la política comercial: no se propone ninguna tarifa de comisión. El alcance de Fase 3 permanece intacto.

**Pruebas locales con Node 22:** build y TypeScript aprobados; 73 unitarias, 167 Functions en la regresión previa a la restauración sintética y al refuerzo de administradores, y 29 reglas Firestore aprobadas. Después de esos cambios pasaron 23 pruebas dirigidas de administración, soporte y revocación; tras añadir diagnósticos pasaron diez pruebas dirigidas. Playwright en viewport móvil verificó sesión de soporte sintética, edición y restauración de nombre comercial, registro manual de diagnóstico, simulación, dependencias, ejecución y restauración de respaldo en emuladores. No se han completado los recorridos E2E de gestión avanzada de usuarios ni de los demás parámetros de configuración.

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

- [x] Completado y verificado localmente en emuladores.
- Prioridad: Alta.
- Implementación local: pantalla de Gestión de usuarios, Functions de seguridad y protecciones transaccionales de asignación.
- Evidencia: regresión y recorrido de emuladores en el resumen del Bloque A.
- Dependencias de publicación: revisión de referencias heredadas y triggers, verificación con operadores autorizados y autorización explícita. La eliminación física general permanece deshabilitada.

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
