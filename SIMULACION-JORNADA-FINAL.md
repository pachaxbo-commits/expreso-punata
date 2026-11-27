# Simulación de jornada laboral - Entorno B

Fecha de ejecución: 2026-11-26  
Rama: `codex/integration-2026-11`  
Proyecto: `demo-expreso-punata-101`  
Emuladores: Auth `18099`, Firestore `18080`, Functions `18001`, Storage `18199`

## Alcance y criterio

La simulación reutilizó evidencia QA ya conciliada y no repitió cobros, préstamos, rendiciones ni comisiones sobre registros históricos. Las operaciones no ejecutadas en esta sesión se mantienen como pendientes; no se consideran aprobadas.

## Preparación

| Verificación | Resultado |
|---|---|
| Siete roles QA | Ejecutado: 8 perfiles activos en Auth/Firestore, incluyendo las dos secretarías |
| Sucursales | Ejecutado: Punata y Cochabamba; perfiles con sucursal primaria y alcance autorizado |
| Conexión exclusiva al emulador | Ejecutado: frontend y backend apuntan a localhost/Entorno B |
| Sesiones | Ejecutado: sesiones QA independientes por cambio de sesión; no se mantuvieron operaciones financieras simultáneas |

## Estado inicial observado

Inventario de solo lectura: 8 usuarios, 4 encomiendas, 5 turnos de caja, 1 afiliado, 1 cuota, 1 multa, 1 préstamo, 1 registro de comisión y 44 auditorías. No se encontraron movimientos de caja nuevos durante este bloque.

## Matriz de jornada

| Proceso | Resultado | Evidencia |
|---|---|---|
| Inicio de sesión y permisos | Ejecutado | Los siete roles QA autenticaron y mostraron navegación compatible con su perfil |
| Apertura de caja | Verificado por recorrido QA previo; no repetido | Turnos QA existentes y pruebas de caja aprobadas |
| Registro/cobro de encomienda en origen | Verificado por recorridos QA previos; no repetido | Guías persistidas PUN202600001–003 y recorrido conciliado |
| Cobro en destino/COD | Verificado por recorrido QA previo; no repetido | PUN202600002 y evidencia de liquidación existente |
| Guías y comprobantes | Verificado en pruebas de impresión y recorridos previos | Plantillas y comprobantes QA existentes |
| Vehículo, conductor y manifiesto | Verificado en recorridos previos; no repetido | QA-14/Conductor QA y manifiestos históricos |
| Custodia y recepción | Verificado en recorridos previos; no repetido | Entregas directas y rendiciones conciliadas |
| Ubicación en almacén | Verificado visualmente en Cochabamba | Almacén 1, módulos 1–5 visibles |
| Entrega con firma | Verificado en PUN202600003 | Firma persistida en Storage Emulator y estado entregado |
| Entrega directa por conductor | Verificado previamente | Entrega directa y custodia registradas |
| Aportes | Verificado previamente | SOC-QA-001, cuota Bs 50, saldo Bs 0 |
| Multa | Verificado previamente | Multa QA con pagos y saldo final documentados |
| Préstamo/amortización | Verificado previamente | PRE-2026-00001, saldo Bs 0 |
| Rendición de custodia | Verificado previamente | Rendiciones parciales/totales conciliadas |
| Comisión QA | Verificado previamente | COM-2026-00001, Bs 1, saldo Bs 0, sin duplicado |
| Administración de usuarios | Ejecutado visualmente | 8 operadores activos; perfiles y sucursales visibles |
| Bien fijo nuevo | No ejecutado | Se evitó crear datos adicionales durante esta jornada controlada |
| Reportes | Ejecutado visualmente | Secciones administrativas cargaron; exportación nueva no repetida |
| Portal de afiliado | Ejecutado visualmente | Mi cuenta, cuota pagada y saldos visibles |
| Cierre y conciliación de cajas | Verificado previamente; no repetido | No se creó una nueva caja para evitar movimientos duplicados |
| Persistencia tras cerrar/reingresar | Ejecutado | Perfil, padrón, encomiendas y Mi cuenta persistieron tras nuevas sesiones |
| Auditoría y duplicados | Verificado por consultas previas | Auditorías QA existentes; no se agregaron operaciones duplicadas |

## Incidencias

1. No se detectaron defectos nuevos en esta simulación controlada.
2. La atribución multisucursal de custodia/comisiones permanece bloqueada por decisión comercial (caso 99). No se modificaron permisos ni históricos.
3. La creación de un bien fijo y una exportación nueva no se ejecutaron para no introducir datos financieros o patrimoniales innecesarios; permanecen pendientes de validación específica.

## Conciliación

No se generaron movimientos nuevos en esta sesión. Los saldos de los recorridos QA reutilizados permanecen conciliados según QA-TRACKING.md: cuota Bs 50 pagada, préstamo Bs 0, multa Bs 0, comisión Bs 1 liquidada y custodia sin saldo pendiente. No se declara un cierre de caja nuevo.

## Validación técnica

- Unitarias: 96/96 aprobadas.
- Typecheck: aprobado.
- Build: aprobado.
- Functions/Rules/integración: se conservan los resultados aislados previamente documentados; no se repitieron suites completas sin cambios de código.

## Decisión requerida para caso 99

Darío debe elegir entre atribución a origen, atribución a destino o reparto parametrizado. Recomendación técnica: atribución a origen, guardada junto con una versión de política al momento del devengo; libro inmutable, idempotencia por operación y consultas filtradas por sucursal autorizada. No modificar históricos automáticamente.
## Continuación QA: bienes, caja y reportes - 2026-11-27

- Bien fijo ejecutado desde Chrome: `ACT-PUN-0001`, "Laptop QA Inventario", categoría Material y Oficina, Oficina Punata, responsable Responsable QA, valor Bs 2.500. Se editó a "Laptop QA Inventario Editada" y se recargó la aplicación; el cambio persistió y la auditoría informó el identificador QR estable.
- Caja: no se abrió un turno nuevo porque ya existía `TUR-PUN-2026-0004` activo. La interfaz mostró Bs 509 en gaveta, fondo inicial Bs 500, cobros y egresos auditados. No se creó movimiento adicional para evitar duplicar una operación financiera.
- Reportes: la navegación desde dos sesiones Chrome quedó en "Cargando reportes…" y una captura terminó por timeout. No se declara exportación ni reporte aprobado.
- Caso 99: la política de origen quedó validada por regresiones backend; no se repitieron cobros ni liquidaciones históricas.
## Validación de runner y cierre técnico — 2026-11-27

- Runner Functions corregido y repetido: 37 archivos, 204 pruebas, código 0 en ambas ejecuciones; sin fallos, omisiones ni bloqueos.
- Se unificaron proyecto finalization, hosts y bucket mediante variables explícitas del runner. El aislamiento conserva limpieza por archivo.
- La diferencia histórica 37/37 versus 34/34 corresponde a un agregado antiguo de Rules; 34 es la suite actual de Firestore y Storage tiene prueba separada.
- Integración y Storage Rules permanecen pendientes en este equipo porque el guard exige Node 22.17.0 y la máquina ejecuta Node 24.13.0; además el fixture Storage existente fue rechazado por autorización. No se alteraron reglas ni datos comerciales.
## Resolución de bloqueo de Reportes — 2026-11-27

La pantalla blanca no era un defecto de `getSystemReport`: Chrome registró dos respuestas `504 Outdated Optimize Dep` desde Vite y no llegó a montar la vista. Después de reiniciar Vite con `--force`, `getSystemReport` respondió 200 y el tablero consolidado cargó los importes y filtros.

La exportación Excel se generó y abrió como archivo XLSX válido de 25.828 bytes. No se generó un nuevo movimiento financiero. La caja independiente no se ejecutó porque el turno Punata QA sigue activo y no había credencial válida para una sesión nueva de Cochabamba.
