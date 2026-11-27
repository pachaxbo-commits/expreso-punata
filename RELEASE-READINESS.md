# RELEASE READINESS — Expreso Punata

Fecha: 2026-11-27

## Validación final QA

- Node portátil: `v22.17.0`.
- Unitarias: `97/97`, fallos `0`, omitidas `0`.
- Typecheck y build: aprobados.
- Functions: `37/37` archivos, `204/204` pruebas, código `0` en dos ejecuciones consecutivas.
- Firestore/Storage Rules: `37/37` pruebas combinadas aprobadas en el entorno aislado, sin debilitar reglas.
- Integración: `1/1` aprobada, incluyendo reportes y exportaciones.
- Caja: `TUR-CBB-2026-0002` cerrado, diferencia final `Bs 0`, comprobante y auditoría presentes, sin movimientos duplicados.
- `TUR-PUN-2026-0004` permanece intacto y abierto, con cinco movimientos existentes.
- Reportes: bloqueo de caché Vite resuelto; exportación XLSX verificada desde Chrome.
- Caso 99: custodia y comisiones atribuidas a la sucursal de origen; sucursal de cobro/liquidación separada.

## Estado de integración

La rama `codex/integration-2026-11` está publicada y lista para revisión y Pull Request hacia `main`.

- `origin/main` integrado hasta `becf623`.
- Se conservaron las funcionalidades del equipo y las correcciones QA.
- No se hizo merge a `main` ni despliegue.
- El cierre definitivo se ejecutó exclusivamente contra Firebase Emulator.

## Evidencia de caja

- `TUR-CBB-2026-0002`: `closed`, esperado Bs 90, contado Bs 90, diferencia Bs 0.
- Movimiento autorizado: `REC-QA-CBB-0001`, egreso Bs 10.
- Persistencia, comprobante, auditoría y ausencia de duplicados verificadas.
- `TUR-PUN-2026-0004`: sin modificaciones; permanece `open` con cinco movimientos.

## Pendientes antes de merge

- Revisión humana del Pull Request.
- Decisión de merge a `main`.

No hay un pendiente técnico de Storage Rules, integración, caja, unitarias, typecheck o build que impida preparar el Pull Request en este entorno QA.
