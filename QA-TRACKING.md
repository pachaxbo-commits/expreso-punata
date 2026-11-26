# Seguimiento QA comercial

## Entrega directa por conductor â€” 2026-11-26

- ImplementaciÃ³n `c5f1952`: `Mis Viajes` expone `Realizar entrega` por guÃ­a solo cuando el manifiesto estÃ¡ asignado al conductor, la custodia estÃ¡ aceptada y el resumen indica `direct_driver`. La guÃ­a se recupera con `fetchCurrentShipment`; no se aceptan importes introducidos por el conductor.
- Se reutiliza `ShipmentDeliveryModal` y `deliverShipmentThroughBackend`; firma, datos del receptor, COD, idempotencia y validaciones permanecen en la Function existente.
- Playwright `390x844`: `CBB202600001` â†’ firma del destinatario â†’ cobro efectivo COD Bs30 â†’ entrega confirmada. UI regresÃ³ a Mis Viajes tras la respuesta del backend.
- VerificaciÃ³n persistida en Emulator B: `status=delivered`, `paymentStatus=paid`, `deliveryChannel=route_delivery`, `deliveredByRole=conductor`, `collectedAmountCents=3000`, firma Storage verificada y `financialMovementId` presente.
- Custodia generada: cuenta del UID del Conductor QA con `pendingRemittanceCents=3000`, `cashUnderCustodyCents=3000`; un Ãºnico registro `route_collection` de Bs30 en `driver_custody_records`.
- No se alteraron estados ni movimientos directamente en Firestore. La conciliaciÃ³n y liquidaciÃ³n siguen pendientes porque requieren ejecutar el flujo autorizado de rendiciÃ³n desde el rol de caja/tesorerÃ­a.

## ContinuaciÃ³n desde fa03a49 â€” 2026-11-26

- Modalidad persistida de `CBB202600001`: el recorrido fue creado mediante el asistente con `deliveryType=direct_driver`; la generaciÃ³n de `MAN-CBBA-2026-0001` y el estado `TRÃNSITO` confirman que no era solo una selecciÃ³n visual.
- Defecto confirmado y corregido: el resumen del asistente convertÃ­a cualquier modalidad distinta de `home` en `En Agencia`. Se centralizÃ³ la etiqueta para mostrar `Conductor en Ruta` cuando corresponde. RegresiÃ³n en `tests/unit/deliveryType.test.ts`.
- Commit de correcciÃ³n: `1291f14 fix(shipments): label direct-driver delivery correctly`.
- Custodia: repeticiÃ³n con Playwright y `conductor@qa.local` mostrÃ³ posteriormente `MAN-CBBA-2026-0001` como `En Ruta (Custodia Aceptada)`. La primera automatizaciÃ³n expirÃ³ antes de observar la actualizaciÃ³n, pero no fue un rechazo de autenticaciÃ³n ni de permisos.
- RegresiÃ³n local: `87/87` unitarias aprobadas; typecheck y build aprobados. No se ejecutÃ³ todavÃ­a la entrega directa, cobro, liquidaciÃ³n o comisiÃ³n porque el conductor no dispone de una acciÃ³n de entrega visible en `Mis Viajes`; debe resolverse si el flujo comercial exige una nueva acciÃ³n UI para conductor o una entrega desde la pantalla operativa autorizada.

## EjecuciÃ³n autÃ³noma â€” 2026-11-26 â€” Entrega directa por conductor

- Entorno A recuperado sin tocar Entorno B: puertos 17001/17080/17099/17199; cachÃ© aislada con cloud-firestore-emulator-v1.22.0.jar y configuraciÃ³n .qa-automated/firebase-a.json.
- Firestore Rules contra Entorno A: 34/34 aprobadas, 0 fallos; los PERMISSION_DENIED observados son aserciones negativas esperadas.
- Entorno B desde Playwright y Auth real: creada CBB202600001, modalidad Conductor en Ruta, por cobrar/COD Bs30. Generado MAN-CBBA-2026-0001 con MÃ³vil QA-14 y Conductor QA; pasÃ³ a TRÃNSITO.
- El conductor autenticado conductor@qa.local ve el manifiesto como Pendiente de Custodia. El botÃ³n Confirmar Carga Recibida no produjo transiciÃ³n ni Ã©xito antes de expirar la automatizaciÃ³n. No se declara custodia, entrega, cobro, liquidaciÃ³n ni comisiÃ³n y no se insertaron movimientos financieros directamente.
- Defecto UX confirmado: el resumen muestra Modalidad: En Agencia aunque se seleccionÃ³ Conductor en Ruta; queda pendiente de correcciÃ³n y regresiÃ³n.

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

## Diagnóstico adicional del 401 — 2026-11-26

- Reproducción limpia con Secretaría Cochabamba desde Chrome: la interfaz mostró `Backend desconectado — Sin conexión a Firestore`, sin envíos visibles, incluso antes de abrir recepción.
- Causa de entorno corregida localmente: Vite estaba usando los valores predeterminados `9099/8080/9199/5001` y el proyecto `demo-expreso-punata`; Entorno B usa `18099/18080/18199/18001` y `demo-expreso-punata-101`. `.env.local` fue ajustado y Vite reiniciado sin limpiar emuladores ni datos.
- Verificación independiente con Firebase Client SDK contra Entorno B: login de `secretaria.cbba@qa.local` exitoso; UID `3UhJdmexRWRCZI9QOMjuCtuEH5Mi`; token presente sin registrar su contenido; consulta Firestore autorizada devuelve `PUN202600001` y `PUN202600002`.
- Después del ajuste de configuración y recarga forzada, la UI todavía muestra desconexión. No se ejecutó recepción, cobro ni liquidación para evitar alterar el recorrido con una sesión cuyo estado visual/backend no es confiable.
- Clasificación actual: bloqueo específico de inicialización/estado del frontend pendiente de observar en consola; no se confirmó defecto de Functions, reglas, Auth ni datos del manifiesto.

## Corrección de conexión y continuación COD — 2026-11-26

- Defecto confirmado: `subscribeManifestsByBranch` consultaba todos los manifiestos y filtraba sucursal en memoria. Firestore Rules rechazaba la lista por un documento histórico sin `originBranchId`, provocando falsamente `Backend desconectado`.
- Corrección: la consulta ahora restringe `originBranchId`/`destinationBranchId` mediante `or(...)` antes de aplicar Rules. No se tocaron documentos históricos ni se ampliaron permisos.
- Defecto de seguridad confirmado: el botón de simulación podía crear perfil `dev-*` sin `currentUser` Auth. Ahora se rechaza de forma controlada y exige sesión real de Firebase Emulator.
- Chrome con login real `secretaria.cbba@qa.local`: indicador `Operativa en tiempo real`, `Conectado a Firestore`, 2 envíos persistidos visibles.
- Recorrido COD desde interfaz continuado: recepción formal de `MAN-PUN-2026-0002` confirmada sin discrepancias; ubicación de `PUN202600002` confirmada en `MOD-1 / M-1` y el contador de almacén pasó a 1.
- Entrega COD completada desde Chrome con firma y CI `70000004`; la interfaz confirmó `¡ENCOMIENDA ENTREGADA CONFORME!`, comprobantes de acta/ticket y cobro de Bs20.
- La primera tentativa sin turno abierto fue rechazada por Functions (sin mutar la encomienda); se reprodujo con turno `TUR-CBB-2026-0001` abierto y se completó correctamente. La primera pantalla mostraba datos optimistas/stale durante la espera, por lo que la verificación final se hizo contra Firestore Emulator.
- Verificación persistente: `paymentStatus=paid`, `status=delivered`, `paidShiftId=TUR-CBB-2026-0001`, movimiento `cod_income` de 2000 centavos y `expectedCashCents=2000`.
- Cierre de caja desde Chrome: se contó 1 billete de Bs20; resultado `CONFORME`, diferencia Bs0, turno cerrado y pantalla `Sin turno abierto`.
- Prevención de duplicado: después del cierre, la pantalla de entrega no mostró encomiendas disponibles para `PUN202600002`; Firestore conservó un único movimiento COD.

## Custodia y comisiones — 2026-11-26

- Entorno B inspeccionado sin mutaciones: no existen todavía documentos en `driver_custody_accounts`, `driver_custody_records`, `driver_settlements`, `driver_commission_records`, `driver_commission_accounts` ni `driver_commission_vouchers`. No se declara operativo un recorrido de conductor a partir de datos inexistentes.
- El código y la interfaz contemplan entrega en ruta, custodia del conductor, rendición parcial/total y comisiones oficiales. La Function `deliverShipment` exige turno abierto para COD en ventanilla; `settleDriverCash` y `settleDriverCommission` validan saldo, sucursal, permisos e idempotencia.
- Suite unitaria: 85/85 aprobadas. Typecheck y build aprobados.
- Rules y jornada integral en Entorno A: no ejecutadas por bloqueo de infraestructura; Firebase CLI intentó descargar `cloud-firestore-emulator-v1.22.0` y terminó antes de iniciar por error de actualización/configuración local. No se clasifica como defecto del producto.
- Pendiente de ejecución real desde Chrome: crear una nueva encomienda de prueba de cobro en ruta, aceptación de custodia, entrega directa, rendición y comisión. Requiere decidir/usar la modalidad comercial de entrega directa y conservar un turno de caja válido en la sucursal receptora.
- Seguridad multisucursal: las Functions filtran por `primaryBranchId`/`allowedBranchIds`; las Rules contienen pruebas específicas para cuentas y registros de comisiones. La ejecución dinámica queda pendiente por el mismo bloqueo del emulador A.

