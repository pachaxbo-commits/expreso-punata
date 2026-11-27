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
