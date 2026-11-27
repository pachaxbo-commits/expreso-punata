# Estado actual de Expreso Punata

Fecha: 2026-11-27  
Rama: `codex/integration-2026-11`  
Commit de referencia: `a528575`

## Base y cambios recientes del equipo

Entre `ef1a49ed` y `fbefb189` se incorporaron tres bloques:

### Correcciones operativas

- Reconciliación de candados y turnos de caja, incluyendo prevención de reutilización de números huérfanos.
- Correlación y exposición de rechazos de `createShipment` en el navegador.
- Persistencia aislada de configuraciones y navegación anclada al pie de página.

### Impresión y documentos

- Impresión secuencial de guía del cliente y copia de agencia.
- Plantillas de guía con QR desactivado por defecto.
- Adaptador de diálogo de impresión, renderizado térmico y plantillas actualizadas.
- Omisión segura de campos opcionales ausentes en guías.

## Inventario actual de módulos

| Módulo | Funciones principales | Estado actual |
|---|---|---|
| Encomiendas | Registro, precio manual/oficial, cobros, búsqueda, entrega y anulación | Completamente operativa; persistencia y controles financieros cubiertos |
| Almacén | Almacenes, módulos, estantes, ubicaciones, asignación y traslado | Completamente operativa según pruebas de Functions y recorrido QA |
| Despachos y ruta | Manifiestos, móvil, conductor, custodia, despacho y recepción | Completamente operativa; pendiente ampliar validación visual por rol |
| Entrega directa | Mis viajes, firma, COD y custodia del conductor | Operativa con observaciones: depende de modalidad, custodia y firma válidas |
| Caja | Apertura, ingresos, egresos, arqueo, cierre y diferencias | Completamente operativa en pruebas aisladas e integración |
| Custodia | Consulta, rendiciones parciales/totales y conciliación | Completamente operativa; política multisucursal del caso 99 pendiente |
| Comisiones | Devengo, cálculo oficial, liquidación, comprobante e idempotencia | Operativa con observaciones: porcentaje definitivo y atribución multisucursal pendientes |
| Afiliados y aportes | Padrón, cuotas, cobros, historial y portal | Completamente operativa en pruebas de Functions e integración |
| Multas | Creación, deuda, cobro, comprobante y auditoría | Completamente operativa en pruebas aisladas e integración |
| Préstamos | Solicitud/registro, aprobación, desembolso, plan y amortización | Completamente operativa en pruebas aisladas e integración |
| Personal y gastos | Trabajadores, nómina, anticipos y gastos por agencia | Operativa con observaciones; requiere recorrido visual completo |
| Directiva anual | Selección, historial, edición y revisiones | Operativa con observaciones; validada principalmente por Functions |
| Bienes fijos | Activos, QR, transferencias, bajas y documentos físicos | Operativa con observaciones; pantalla visual revisada sin datos cargados |
| Reportes | Tablero, logística, caja, custodia, socios, personal, patrimonio y comisiones | Operativa con observaciones: reporte visual quedó en carga durante la sesión QA |
| Configuración institucional | Empresa, agencias, tarifas, comisiones, impresión y usuarios | Completamente operativa para Directiva QA; persistencia cubierta |
| Usuarios y permisos | Alta, edición, vínculo afiliado, suspensión, baja, auditoría y sesiones | Completamente operativa en Functions; revisión visual de Directiva confirmada |
| Pasajes | Emisión, QR, pago, validación y entrega al conductor | Operativa con observaciones; Functions e integración aprobadas |
| Inventario de consumibles | Catálogo, entradas, consumos y alertas | Operativa con observaciones; pruebas técnicas aprobadas |
| Incidencias | Incidencias, daños, devoluciones, auditoría e indemnización | Operativa con observaciones; pruebas técnicas aprobadas |
| Soporte y diagnóstico | MFA, diagnósticos, límites, limpieza protegida y auditoría | Operativa con observaciones; requiere política y operación técnica controlada |

## Roles

| Rol | Navegación autorizada observada o cubierta | Estado |
|---|---|---|
| Directiva | Encomiendas, almacén, despachos, comisiones, caja, afiliados, personal, activos, reportes y configuración visibles en Chrome | Completamente operativa; revisión visual realizada |
| Tesorería | Caja, reportes, afiliados, personal y activos según permisos | Operativa con observaciones; evidencia principal automatizada |
| Encargado de agencia | Operación de agencia, logística, caja, personal y activos de alcance autorizado | Operativa con observaciones; evidencia principal automatizada |
| Secretaría | Encomiendas, pasajes, caja, multas y reporte diario de su sucursal | Operativa con observaciones; evidencia principal automatizada |
| Conductor | Mis viajes, custodia propia, entrega directa y reporte propio | Operativa con observaciones; entrega directa verificada anteriormente |
| Administrador de afiliados | Administración de afiliados y operaciones expresamente aprobadas | Operativa con observaciones; Functions/RBAC aprobados |
| Afiliado | Mi cuenta, aportes, deudas, multas, préstamos e historial propio | Operativa con observaciones; portal verificado previamente |

La navegación visual de los seis roles distintos de Directiva no se repitió en esta sesión porque no se proporcionaron credenciales de acceso adicionales. No se declara esa parte como validación visual completa.

## Evidencia técnica actual

- Unitarias: 94/94.
- Functions consolidadas: 203/203.
- Firestore/Storage Rules: 37/37.
- Integración: 1/1, incluyendo afiliados, caja, préstamos, multas, logística, custodia, comisiones, patrimonio y reportes.
- Typecheck y build: aprobados.
- Chrome QA: Directiva QA autenticada, conexión a Firestore Emulator y navegación a Personal, Bienes Fijos, Reportes y Configuración confirmadas.

## Observaciones y pendientes reales

1. El reporte administrativo mostró inicialmente `Cargando reportes…` y después sus secciones, pero no se validó la generación visual de PDF/Excel en esta sesión.
2. La pantalla de Bienes Fijos cargó correctamente, pero el entorno visible no tenía activos registrados para probar edición, transferencia o baja desde la UI.
3. La política comercial de atribución multisucursal de custodia y comisiones (caso 99) continúa pendiente; no se amplían permisos para resolverla.
4. Debe completarse una ronda visual con credenciales explícitas de Tesorería, Encargado, Secretaría, Conductor, Administrador de afiliados y Afiliado.
5. El PR contra `main` queda pendiente de autenticación de GitHub; la rama consolidada sí está publicada.

No se confirmaron defectos de producto nuevos durante esta revisión que justificaran modificar código. Se conservaron los cambios del equipo y de QA; no se tocó producción ni el worktree original.
## Revisión visual de roles - 2026-11-26

- Directiva QA: sesión autenticada y conectada a Firestore Emulator. Se verificó visualmente Configuración, Personal & Gastos, Bienes Fijos y Reportes. Configuración mostró 8 operadores activos, incluyendo las cuentas QA de los seis roles pendientes. Reportes cargó sus secciones después del estado inicial de carga.
- No se obtuvo una captura de DevTools para declarar una auditoría de consola completa; no se afirma ausencia de errores de consola.
- Tesorería, Encargado de agencia, Secretaría, Conductor, Administrador de afiliados y Afiliado: no ejecutados visualmente en esta ronda. No existen credenciales en el worktree ni sesiones autenticadas reutilizables para esos usuarios; las pruebas automáticas y recorridos previos no sustituyen esta validación.

### Propuesta para Darío - caso 99

Se necesita decidir quién atribuye la custodia y la comisión cuando una operación cruza sucursales: (A) sucursal de origen, (B) sucursal receptora/destino o (C) reparto institucional parametrizado. Recomendación técnica: política explícita y versionada; por simplicidad operativa, origen es la opción más trazable. El backend debe guardar la política y la sucursal de atribución al devengar, mantener un libro inmutable y filtrar lecturas por sucursal autorizada. No se deben recalcular históricos ni ampliar permisos globales.

## Revisión funcional de seis roles - 2026-11-26

| Rol | Resultado observado en Chrome QA | Estado |
|---|---|---|
| Tesorería | Sesión válida; Pasajes, Caja del Turno, Afiliados & Aportes, Personal & Gastos, Bienes Fijos y Reportes visibles. El padrón mostró 1 afiliado, cuota Bs 50 cobrada y saldo Bs 0. | Operativa con observaciones |
| Encargado de agencia | Sesión válida en Cochabamba; Encomiendas, Almacén, Despachos y Ruta, Caja, Personal, Bienes Fijos y Reportes visibles. Almacén cargó módulos 1–5 y controles de configuración. | Operativa con observaciones |
| Secretaría | Sesión válida en Cochabamba; turno de ventanilla, Encomiendas, Almacén, Despachos, Caja, Afiliados, Multas y Reporte del día visibles. Se visualizaron 4 encomiendas persistidas y estados/ pagos. | Operativa con observaciones |
| Conductor | Sesión válida; Móvil 14, Encomiendas asignadas, Validar pasajes, Despachos y Ruta y Reportes visibles. No había guías pendientes de aceptar. | Operativa con observaciones |
| Administrador de afiliados | Inicialmente navegación vacía: defecto confirmado. Corregido para mostrar Afiliados & Aportes; después se visualizaron SOC-QA-001, cuota Bs 50 pagada y saldo Bs 0. | Corregida y verificada |
| Afiliado | Sesión válida; Consultas y Mi cuenta visibles. Mi cuenta mostró SOC-QA-001, cuota 2026-11 Bs 50 paid, préstamo Bs 0 pendiente y multa Bs 0 pendiente. | Operativa con observaciones |

### Corrección aplicada

- `src/app/App.tsx` ahora expone Afiliados & Aportes a `afiliado_admin`, coherente con las autorizaciones de `UnionMembersView` y Functions.
- `src/app/navigation.ts` centraliza la decisión de navegación y `tests/unit/roleNavigation.test.ts` cubre roles permitidos y rechazados.
- `UnionMembersView` vuelve a crear sus suscripciones cuando cambia el UID autenticado o el período, evitando arrastrar listeners entre sesiones.
- Validación: 96/96 unitarias, typecheck y build aprobados. No se modificaron reglas, permisos financieros, históricos ni datos de producción.

### Consola

Tras la corrección no aparecieron nuevos errores de `UnionMembersView` en la carga del padrón. Los mensajes posteriores de `A listener indicated an asynchronous response...` provienen de la extensión de Chrome y no de una ruta de negocio; quedan como ruido de automatización, no como defecto confirmado del producto.
### Caso 99: decisión implementada

Se aplicó `origin-branch-v1`: la encomienda validada por backend determina `financialBranchId`; la sucursal donde se cobra o liquida se registra por separado. No se aceptan atributos financieros de sucursal enviados por el cliente ni repartos porcentuales.

La lectura de comisiones usa `getDriverCommissionOverview`, con filtros por sucursales autorizadas para Tesorería y acceso operacional para Directiva. Los históricos sin atribución no se reasignan y permanecen disponibles para roles financieros autorizados.

Validación: comisiones 7/7, Firestore Rules 34/34, unitarias 96/96, typecheck y build aprobados. La verificación comercial completa de nuevos recorridos bidireccionales desde Chrome queda pendiente; no se declara aprobada por estas regresiones.
