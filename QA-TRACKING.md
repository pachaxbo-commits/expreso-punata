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
## Avance 2026-11-26 (continuación)

- Entorno A aislado: los fallos de Auth/Storage observados previamente no se reprodujeron con puertos, TEMP y caché separados; no hubo evidencia de OOM.
- Reproducción aislada `b4Settings.test.mjs`: 2/2 aprobadas. MFA continúa exigido fuera de emuladores; no se desactivó ni se debilitó ningún permiso.
- Reproducción aislada `supportCenter.test.mjs`: 16/16 aprobadas, incluidos MFA, token revocado, usuario deshabilitado y `auth_time` reciente.
- `blockBConfiguration.test.mjs`: el primer caso pasa en aislamiento; el segundo falló en una ejecución contaminada por un turno de caja abierto de una ejecución anterior. Clasificación: fixture/estado compartido de la ejecución, no defecto confirmado del producto. Debe repetirse con limpieza del Entorno A antes de cerrar el grupo.
- Entorno B: usuarios sintéticos completos creados en Auth Emulator y perfiles válidos en Firestore, con conductor enlazado por UID real. Vite continúa apuntando exclusivamente a `127.0.0.1:18080/18099/18199/18001`.
- Navegador: login real de Secretaría Punata, apertura `TUR-PUN-2026-0001`, registro y cobro de `PUN202600001` por Bs 15, estado `RECIBIDO/PAGADO`, persistencia visible tras respuesta del backend. Acciones de impresión PDF/térmica visibles; descarga física aún no certificada.
- Recorrido logístico B completado desde interfaz para `PUN202600001`: manifiesto `MAN-PUN-2026-0001`, vehículo `QA-14`, conductor QA, custodia aceptada, despacho, recepción formal Cbba sin discrepancias, ubicación `MODULO-1 / M-1 / Fila 1 / Piso 1 / Espacio 1`, entrega conforme con firma y cierre de caja exacto.
- Defecto confirmado durante almacén: la configuración visual de `MODULO-1` en Cochabamba no creó el estante persistente; el flujo de ubicación respondió 404. Se dejó el estante sintético válido para completar la prueba y se conserva como defecto pendiente de corrección del flujo de configuración.
- Defecto confirmado en comprobante de cierre: `CashTicket80mm` y el comprobante PDF pasaban centavos a `formatCurrencyBob` sin `isCents=true`, mostrando Bs 10.000/Bs 1.500 en lugar de Bs 100/Bs 15. Corregidos ambos call-sites; typecheck, unitarias (85/85) y build pasan.
- Repetición limpia Entorno A del grupo B4/Support: 20/20 subpruebas aprobadas, incluyendo configuración institucional, tarifas/comisiones, MFA y Support/B4. La ejecución terminó sin fallos de aserción; el proceso de Node mantiene handles abiertos y no emite resumen TAP final, por lo que se conserva la evidencia por subprueba y no se extrapola a la suite completa.
- Revisión de almacenes: la supuesta no persistencia de Cochabamba fue causada por ejecutar el guardado con el modal de ubicación todavía abierto; la operación real no había sido enviada. Repetición correcta desde Chrome: `MODULO-1` editado a 2 pisos, 4 filas y 2 espacios; persistió tras recarga, cierre de sesión y nuevo inicio de sesión. No se confirmó defecto de producto ni se creó commit de código.
- Regresión `deliveryAndLogisticsControls`: 9/10 aprobadas. La única falla es el fixture de firma ausente (`getShipmentSignatureUrl`, `not-found` en archivo sintético), clasificada como fixture incompleto; no se debilitó la aserción.
- Nuevo recorrido B iniciado desde Chrome: `PUN202600002`, flete por cobrar/COD Bs 20, estado visible `RECIBIDO / COD`, guía emitida. Transporte, recepción, cobro en destino y liquidación aún pendientes; no se declara operativo.

## Avance 2026-11-26 — COD y regresión de firmas

- `PUN202600002`: manifiesto `MAN-PUN-2026-0002` creado desde la interfaz, vehículo `QA-14`, conductor QA y custodia aceptada desde sesión real de Conductor. La encomienda quedó visible como `En Ruta (Custodia Aceptada)` y `COD Bs. 20,00`.
- Recepción en Cochabamba: bloqueada en la confirmación formal. La interfaz mostró `Debe iniciar sesión para recibir manifiestos [401]` y `Backend desconectado`; no se alteraron datos ni se declaró completado el recorrido. Requiere recuperar la sesión/autenticación del Entorno B y repetir desde Chrome.
- Confirmación de importe: la pantalla de Conductor identifica `Total a Cobrar (COD) Bs. 20,00`; con la información visible no se puede afirmar todavía si el modelo separa flete y dinero por cuenta del cliente. Debe verificarse en la entrega y movimientos de caja.
- Entorno A: corregido el fixture de Storage de firma en `functions/test/deliveryAndLogisticsControls.test.mjs`; se sembró el objeto sintético referenciado antes de probar la URL temporal. La aserción de ruta inexistente se conserva.
- Regresión Entorno A repetida: `10/10` aprobadas, `0` fallos, commit `2abc898` (`test(storage): seed signature fixture in emulator`).
- No se creó corrección de producto para el 401: es un bloqueo de infraestructura/sesión observado en B y requiere repetición tras restablecer autenticación local.

