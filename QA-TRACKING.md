# Seguimiento QA comercial

| Módulo | Operación | Resultado | Defecto / causa | Corrección | Regresión | Evidencia navegador | Pendiente |
|---|---|---|---|---|---|---|---|
| Autenticación | Perfil sin `fullName` | Corregida y verificada | Pantalla blanca en `MainDashboard` | `e36be60`, normalización y fail-closed RBAC | 85 unitarias frontend | Login local validado; captura previa del blanco conservada | Repetir tras entorno B limpio |
| Caja | Apertura en Punata | Operativa | — | — | Functions de caja pasan en parte de la suite | Chrome: `TUR-PUN-2026-0001` | Repetir en recorrido limpio |
| Encomiendas | Registro y cobro pagado en origen | Operativa | — | — | Functions de creación/cobro pasan | Chrome: `PUN202600001`, Bs 15 | Persistencia en entorno B |
| Impresión | Guía PDF | Ejecutada; descarga no observable | El botón abrió vista PDF, sin evento download | No confirmado como defecto | Tests de plantillas pasan | PDF visible en Chrome | Probar impresión física/diálogo |
| Despacho | Manifiesto y asignación | Parcial | Fixture inicial usó UID distinto al usuario Auth | Fixture corregido para usar UID Auth real | Tests de despacho pasan | `MAN-PUN-2026-0001` visible | Repetir con entorno B limpio |
| Recepción/almacén/entrega | Flujo intersucursal | Bloqueada | Emulator/Auth/Storage inestables y sesión persistida | Separación A/B en progreso | Tests backend individuales disponibles | Recepción mostró 0 manifiestos por fixture | Completar desde Chrome |
| Functions | Suite completa | 163/191 en última ejecución | Caídas de Auth/Storage; 28 fallos | Configuración A/B creada | Repetir con puertos aislados | No aplica | Ejecutar Entorno A limpio |

## Entornos

- A automatizado: Auth `17099`, Firestore `17080`, Storage `17199`, Functions `17001`.
- B simulación: Auth `18099`, Firestore `18080`, Storage `18199`, Functions `18001`.
- Cada entorno usa `TEMP`, `FIREBASE_CLI_HOME`, caché y hub separados.
