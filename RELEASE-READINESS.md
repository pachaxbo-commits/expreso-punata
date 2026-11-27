# RELEASE READINESS — Expreso Punata

Fecha: 2026-11-27

## Aprobado

- Functions: 37 archivos / 204 pruebas, dos ejecuciones consecutivas, código 0.
- Firestore Rules: 34/34 en la suite actual.
- Unitarias: 96/96.
- Typecheck y build: aprobados previamente sobre la rama consolidada.
- Caso 99: atribución nueva a sucursal de origen, con sucursal de cobro/liquidación separada y lectura de comisiones por backend.
- Bien fijo QA: creado, editado y persistido desde Chrome.

## Pendiente antes de merge a main

- Ejecutar Storage Rules con el fixture corregido y el entorno aislado.
- Ejecutar integración con Node 22.17.0.
- Resolver el bloqueo visual de Reportes que permanece en “Cargando reportes…” en Chrome antes de aprobar exportaciones comerciales.
- Abrir y cerrar un turno nuevo únicamente cuando no exista un turno QA activo.
- Storage Rules: aislar y corregir el fixture/bucket que produce `storage/unauthorized` sin cambiar las reglas.

La rama `codex/integration-2026-11` queda preparada para revisión, pero estos pendientes impiden declarar readiness comercial completa o hacer merge a main.
- Reportes: bloqueo resuelto operacionalmente; causa confirmada en caché Vite (`Outdated Optimize Dep`), exportación XLSX verificada desde Chrome.
