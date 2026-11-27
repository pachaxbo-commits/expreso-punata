# Seguimiento QA comercial

## Suite reproducible de Functions y Entorno A - 2026-11-26

- Se corrigieron los fixtures de `manifestDispatch.test.mjs`: limpian recursivamente `shipments` y `manifests`, incluyendo subcolecciones, y eliminan `shipment_notifications`.
- Se agregaron `scripts/runFunctionsSuiteIsolated.mjs`, `scripts/runFirestoreRulesQa.mjs` y los comandos `test:functions:qa`/`test:rules`. El ejecutor descubre los 34 archivos, aísla proyectos y datos del Entorno A, guarda logs por grupo y devuelve código distinto de cero ante fallos, omisiones o bloqueos.
- Ejecución 1: 34/34 archivos, 193/193 pruebas, 0 fallos, 0 omitidas, 0 bloqueadas, código 0. `blockBConfiguration` 2/2, `commissionsAndConsumables` 6/6 y `manifestDispatch` 10/10.
- Ejecución 2 consecutiva: 34/34 archivos, 193/193 pruebas, 0 fallos, 0 omitidas, 0 bloqueadas, código 0. El resumen queda en `.qa-automated/function-groups-official/summary.json`.
- `npm run test:rules`: 34/34 aprobadas, 0 fallos, código 0, reutilizando el emulador A en `127.0.0.1:17080` sin redescarga.
- Validación del proyecto: unitarias 93/93, typecheck y build aprobados. No se alteró el Entorno B, sus registros comerciales ni el worktree original.
- La ejecución monolítica queda documentada como no confiable por recursos compartidos de Node/Firebase Admin; el ejecutor aislado por archivo es la ruta reproducible aprobada y no usa `process.exit` para ocultar bloqueos.

## Multas y prÃ©stamos â€” continuaciÃ³n 2026-11-26

- La vista `Multas` muestra `SOC-QA-001` y el formulario de creaciÃ³n para Directiva QA. Se intentÃ³ registrar una multa ficticia de Bs30 mediante la interfaz, sin escribir directamente en Firestore.
- Resultado: el formulario quedÃ³ en `Guardandoâ€¦` y posteriormente no apareciÃ³ registro; lectura de comprobaciÃ³n del emulador confirma colecciÃ³n `fines` vacÃ­a. No se declara multa creada ni se ejecutÃ³ cobro.
- No se iniciÃ³ el bloque de prÃ©stamos porque no existe una operaciÃ³n financiera previa de multa que validar y la automatizaciÃ³n UI requiere investigar el fallo de guardado antes de continuar con seguridad.

## VinculaciÃ³n de afiliado completada â€” 2026-11-26

- Causa raÃ­z confirmada: `getUnionMembersRoster` no devolvÃ­a `branchId`; el editor de usuarios filtraba por sucursal y ocultaba `SOC-QA-001` aunque existÃ­a y estaba activo.
- CorrecciÃ³n: el roster ahora devuelve `branchId`; el editor puede seleccionar afiliados activos de la sucursal y enviar `unionMemberId` mediante `provisionUserThroughBackend`.
- Playwright con `domcontentloaded`: `afiliado@qa.local` vinculado desde Usuarios y Permisos a `member-soc-qa-001` (`SOC-QA-001`). Persistencia verificada en recarga.
- Portal del afiliado: Mi cuenta muestra nombre, `SOC-QA-001`, sucursal `punata`, cuota `2026-11` Bs50 `paid`, saldo de multas Bs0, saldo de prÃ©stamos Bs0 y obligaciones pendientes 0.
- No se ejecutaron multas ni prÃ©stamos en este bloque; permanecen independientes y pendientes.

## Estabilidad QA y vinculaciÃ³n administrativa â€” 2026-11-26

- Entorno B verificado activo: Vite `5175`; Auth/Functions `18099/18001`; Firestore `18080`; Storage `18199`. Entorno A permanece separado en `170xx`.
- El timeout de Playwright provenÃ­a de esperar `networkidle` en una SPA con listeners persistentes de Auth/Firestore. Con `domcontentloaded` + espera de indicadores funcionales, tres ejecuciones consecutivas con login y recarga pasaron; sin errores de consola ni solicitudes fallidas. Frontend conectado a Entorno B y proyecto demo.
- Brecha confirmada en Usuarios y Permisos: el alta nueva permitÃ­a `unionMemberId`, pero la ediciÃ³n de usuarios existentes no exponÃ­a ese campo. Se integrÃ³ selector de afiliados activos reutilizando `getUnionMembersRosterThroughBackend` y `provisionUserThroughBackend`.
- La vinculaciÃ³n de `afiliado@qa.local` a `SOC-QA-001` queda pendiente de ejecutar tras el reinicio/recarga del frontend con la nueva compilaciÃ³n; no se escribiÃ³ directamente en Firestore.

## ConfiguraciÃ³n administrativa y afiliados â€” 2026-11-26

- Defecto confirmado en configuraciÃ³n oficial: la vista mostraba `15` por fallback aunque el estado contenÃ­a `baseFeeBob=0` cuando el backend solo devolvÃ­a `baseFeeCents`. La validaciÃ³n impedÃ­a guardar una configuraciÃ³n vÃ¡lida.
- CorrecciÃ³n `c58ad7e`: normalizaciÃ³n de campos monetarios desde centavos y regresiÃ³n `systemConfigNormalization.test.ts`. Unitarias: `88/88`; typecheck aprobado.
- ConfiguraciÃ³n QA del 10% no se persistiÃ³ antes de la correcciÃ³n; queda pendiente repetir guardado mediante interfaz, crear recorrido con tarifa oficial y restaurar valores iniciales.
- Afiliado `SOC-QA-001` y cuota Bs50 pagada ya existen. La administraciÃ³n de usuarios debe vincular `afiliado@qa.local` mediante `unionMemberId`; el portal sigue mostrando cuenta no vinculada. Multas y prÃ©stamos aÃºn no ejecutados.

## Comisiones, afiliados y portal â€” 2026-11-26

- ConfiguraciÃ³n inicial observada: `system_config/expreso_punata` oficial/configurada, comisiÃ³n porcentual con valor 0; `commercial_settings/commission` no autorizÃ³ una regla vÃ¡lida para el recorrido manual. La pantalla administrativa tampoco permitiÃ³ guardar la regla QA porque rechazÃ³ la tarifa base obligatoria; no se persistieron cambios ficticios.
- Afiliados desde la interfaz: creado `SOC-QA-001` (Afiliado Conductor QA, activo, cuota Bs50). Emitida cuota `CUO-2026-11-SOC-QA-001`; cobro total Bs50 con recibo `REC-SOC-2026-00001`. Saldo pendiente Bs0, recaudado Bs50, movimiento y auditorÃ­a generados por el flujo oficial.
- Portal `afiliado@qa.local`: historial de encomiendas visible y restringido a la cuenta, pero `Mi cuenta` responde que el usuario no estÃ¡ vinculado a un afiliado. VinculaciÃ³n, multas, prÃ©stamos y desembolsos quedan no ejecutados; requieren completar la vinculaciÃ³n administrativa mediante el formulario existente.
- Decisiones comerciales pendientes: porcentaje definitivo, tratamiento de precios manuales y atribuciÃ³n multisucursal del caso 99.

## Custodia y comisiones â€” continuaciÃ³n 2026-11-26

- Desde Directiva QA se abriÃ³ el turno `TUR-PUN-2026-0003` con fondo Bs0 mediante la interfaz.
- RendiciÃ³n parcial de `CBB202600001`: Bs10. El sistema dejÃ³ Bs20 pendientes y generÃ³ comprobante/movimiento `SETTL-PUNATA-18342A86`.
- RendiciÃ³n final: Bs20. La cuenta del conductor quedÃ³ `cashUnderCustodyCents=0`, `pendingRemittanceCents=0`, `totalRemittedCents=3000`. Se generÃ³ `SETTL-PUNATA-A4926A7F`. Movimientos de caja: Bs10 + Bs20; diferencia de custodia Bs0.
- El flete COD de Bs30 no se contabilizÃ³ como nueva venta al liquidar: los movimientos son `internal_custody_transfer`/`driver_remittance`.
- Comisiones: la configuraciÃ³n oficial consultada en Entorno B estÃ¡ marcada oficial/configurada pero `defaultType=percentage` y `defaultValue=0`. AdemÃ¡s `CBB202600001` tiene `shippingFeeCents=null` por precio manual, aunque `agreedAmountCents=3000`. La Function rechaza correctamente el devengo porcentual sin base oficial; no se inventÃ³ porcentaje ni se modificÃ³ el registro histÃ³rico. Devengo/liquidaciÃ³n de comisiÃ³n quedan bloqueados por configuraciÃ³n comercial.

- CorrecciÃ³n adicional `003e7e3`: tras una entrega exitosa la guÃ­a se oculta de la acciÃ³n local `Realizar entrega`, evitando reintentos visuales mientras el listener del manifiesto conserva su resumen histÃ³rico. La Function mantiene la protecciÃ³n idempotente.

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

-
## Guardado de multas - 2026-11-26

- Reproducción desde Playwright con `domcontentloaded`: el formulario llegó a `Guardando…` y la callable `createUnionFine` no resolvió dentro de la espera observada; no se encontró documento nuevo en `union_fines`, por lo que no se reintentó para evitar duplicados.
- La Function exige autenticación y rol `directiva_admin`, valida afiliado, fecha, importe en centavos y persiste multa/auditoría en una transacción. No se modificaron permisos ni se insertaron datos manualmente.
- Corrección aplicada en `src/services/unionService.ts`: la llamada de creación ahora tiene timeout de 15 s y devuelve un error operativo comprensible si queda pendiente; el formulario conserva su `finally` para liberar `Guardando…` y permitir recuperación controlada.
- Validación: 88/88 unitarias, typecheck y build aprobados. La creación y el cobro completos siguen pendientes hasta repetir con una sesión callable que responda correctamente; no se declaran operativos.

## Diagnóstico aislado de createUnionFine - 2026-11-26

- Entorno A: `functions/test/unionFines.test.mjs` ejecutada con Auth/Firestore/Storage en `17099/17080/17199`: 1/1 suite aprobada en 5.3 s. Cubre creación válida, importe inválido, usuario no autorizado, cobro, idempotencia y concurrencia.
- La implementación de `createUnionFine` alcanza autenticación, permisos, validación de afiliado y transacción; no se observó bloqueo en Entorno A.
- Causa raíz frontend confirmada: `observedHttpsCallable` capturaba el error original y esperaba indefinidamente `reportClientDiagnostic`. La solicitud de diagnóstico podía quedar pendiente y ocultar el rechazo de `createUnionFine`.
- Corrección: `reportObservedError` tiene límite de 3 s; siempre vuelve a lanzar el error original. Se conserva el timeout de 15 s de creación como segunda protección.
- Validación posterior: 88/88 unitarias, typecheck y build aprobados. La operación comercial en B queda pendiente de repetir con Vite recargado y verificar el error/respuesta real antes de crear la multa.

## Regresión observability y pendientes comerciales - 2026-11-26

- Añadidas regresiones para resultado exitoso, error original, diagnóstico rechazado y diagnóstico pendiente. La prueba verifica que se conserva la misma instancia del error y que el diagnóstico vence sin bloquear.
- Suite unitaria actual: 91/91 aprobadas. Typecheck y build aprobados.
- No se repitió todavía la creación/cobro de multa ni el préstamo desde la interfaz en B: las pruebas automatizadas de UI anteriores no llegaron de forma fiable al formulario después del arranque frío de Vite, y no se debe declarar una operación financiera completada sin evidencia persistida.
-
## Cobro de multa y corrección de comprobante - 2026-11-26

- Chrome interactivo en Entorno B confirmó sesión real de Directiva QA, indicador `Operativa en tiempo real` y Firestore conectado.
- Existía una multa pendiente previa para `SOC-QA-001`, `MUL-5KUHQAQM`, importe Bs 30. No se creó duplicado.
- Se cobró desde la interfaz con turno autorizado. Resultado visible: `REC-MUL-2026-00001`, saldo Bs 0, estado `Pagada`, historial de pagos 1.
- Defecto confirmado: el comprobante mostraba `Bs. NaN` porque la vista leía `result.amountCents`, inexistente en la respuesta. Corrección: usa `result.payment.amountCents`, fuente oficial del cobro.
- Suite posterior: 91/91 unitarias, typecheck y build aprobados. El préstamo de Bs 500 aún no fue ejecutado desde interfaz.
-
## Préstamo PRE-2026-00001 completado - 2026-11-26

- Desde Chrome interactivo en Entorno B, Directiva QA registró `PRE-2026-00001` para `SOC-QA-001` por Bs 500, con 2 cuotas de Bs 250 y sin intereses.
- Se cerró el turno anterior conforme por Bs 110 y se abrió legítimamente `TUR-PUN-2026-0004` con fondo inicial QA de Bs 500.
- Desembolso desde interfaz: comprobante `REC-DES-PRE-2026-00001`, egreso de caja Bs 500.
- Amortización parcial desde interfaz: `REC-PRE-2026-00001`, Bs 250; saldo Bs 250.
- Liquidación final desde interfaz: `REC-PRE-2026-00002`, Bs 250; saldo final Bs 0, estado Pagado, historial 2 pagos.
- Mi cuenta del afiliado `afiliado@qa.local` mostró `PRE-2026-00001 Bs 0,00 pendiente` y saldo de préstamos Bs 0; cuota 2026-11 permaneció pagada y no mostró obligaciones pendientes.
- Defecto confirmado y corregido: comprobante de amortización mostraba `Bs. NaN` por leer `result.amountCents`; ahora usa `result.payment.amountCents`, igual que multas.
- Caja mostró fondo inicial Bs 500, egreso Bs 500 y recaudación de préstamos Bs 250 durante el turno; no se repitieron pagos ni desembolsos.
-
## Comisiones de conductores - 2026-11-26

- Chrome QA confirmó sesión Directiva QA y conexión `Operativa en tiempo real`.
- Configuración administrativa: la regla visible de comisión es porcentaje sobre flete y valor 10. Guardado temporal mediante `Guardar Cambios` confirmado con mensaje de éxito en Firestore Emulator.
- No se modificaron registros históricos ni se alteró CBB202600001.
- Bloqueo funcional: la navegación de Directiva no expone el botón `Comisiones de conductores` y el selector DOM tampoco encuentra esa acción, aunque `App.tsx` contiene el tab condicionado por `simpleTransferEnabled`. Por tanto no fue posible iniciar desde interfaz el devengo ni crear una encomienda nueva específicamente para comisión sin sustituir el flujo normal.
- No se declara operativa la comisión comercial. La configuración QA del 10% debe restaurarse/confirmarse antes de continuar; no se inventó una comisión ni se insertaron registros directamente.
## Bandera de comisiones y recorrido pendiente - 2026-11-26

- `simpleTransferEnabled` depende exclusivamente de `VITE_SIMPLE_SHIPMENT_TRANSFER === 'true'`. Controla la experiencia simplificada de custodia/traslado y la visibilidad del módulo `Comisiones de conductores`; no es una autorización financiera.
- En QA la variable no estaba definida, por lo que valía `false`. Se habilitó únicamente en `.env.local` del Entorno B y se reinició Vite. La navegación mostró `Comisiones de conductores` para Directiva QA; los roles no autorizados siguen sin ese tab.
- El formulario de devengo exige IDs internos de `shipments` y `manifests`, no códigos públicos. El intento con `CBB202600001`/`MAN-CBBA-2026-0001` fue rechazado por backend con 404 y no creó comisión.
- La configuración temporal 10% se restauró mediante la interfaz a 0%, con mensaje de guardado exitoso. No se generaron registros financieros ni se modificaron encomiendas históricas.
- El recorrido comercial de comisión sigue pendiente: requiere una nueva encomienda/manifiesto legítimos y obtener sus IDs internos desde el flujo de interfaz. No se declara operativa la comisión.
-
## Formulario usable de devengo de comisiones - 2026-11-26

- Se sustituyeron los campos manuales de IDs internos en `DriverCommissionsView` por selectores autorizados de manifiestos y encomiendas.
- El operador ahora ve número de manifiesto, nombre del conductor, cantidad de encomiendas, código público, destinatario e importe oficial; internamente se envían los IDs reales seleccionados.
- Los manifiestos cancelados quedan excluidos y la encomienda solo puede elegirse dentro del manifiesto seleccionado. El backend conserva la validación final de tarifa, estado, conductor, sucursal, permisos e idempotencia.
- Validación: la suite unitaria previa quedó en 91/91 aprobadas; typecheck y build aprobados después de eliminar el estado obsoleto de ID de manifiesto.
- El recorrido comercial sigue pendiente de crear una nueva encomienda/manifiesto desde la interfaz y completar devengo/liquidación. No se generaron registros financieros directamente.

## Comisión 10%: bloqueo de emisión tarifaria - 2026-11-26

- Se verificó desde Chrome que la regla temporal de comisión se guardó como porcentaje sobre flete, 10%, en Entorno B.
- Se habilitó únicamente en el frontend QA la sugerencia tarifaria automática. El asistente mostró tarifa oficial sugerida de Bs 10,00 para 2 kg y modalidad `Conductor en Ruta`.
- Al confirmar la emisión, Functions respondió visiblemente `failed-precondition` (incidencia `ded2d3eb31614d678327dc8f368fb9b5`): `El cálculo automático de tarifas está desactivado. Ingrese manualmente el precio acordado.` No se creó una guía ni se alteraron registros.
- Causa raíz confirmada: el backend del emulador B se ejecuta sin `ENABLE_AUTOMATIC_PARCEL_PRICING=true`; el frontend y Functions no comparten el mismo estado de activación. Un precio manual no es equivalente a flete tarifario y no debe usarse para forzar la comisión porcentual.
- La comisión temporal no pudo restaurarse de forma verificable: el control numérico de la interfaz quedó mostrando 10 durante la interacción; no se confirmó un guardado a 0. Se requiere restaurar con el control administrativo una vez corregida la operación del emulador. No se generaron comisiones, liquidaciones ni movimientos financieros nuevos.
- Estado: comisión comercial no operativa/no conciliada; bloqueo técnico concreto en la configuración del backend del Entorno B. `CBB202600001` y demás históricos permanecen sin modificar.

## Emulador Functions QA y manifiesto de comisión - 2026-11-26

- Se levantó una instancia local exclusiva de Functions en `127.0.0.1:18002` con `ENABLE_AUTOMATIC_PARCEL_PRICING=true`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:18080` y `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:18099`. Los logs confirmaron autenticación válida y carga de `createShipment`/`createDispatchManifest`.
- El frontend Entorno B se conectó temporalmente a esa instancia y la tarifa automática fue aceptada.
- Nueva encomienda creada desde Chrome: `PUN202600003`, tarifa oficial Bs 10,00, modalidad `Conductor en Ruta`, pagada en origen, estado `RECIBIDO`.
- Manifiesto creado desde Chrome: `MAN-PUN-2026-0003`, Móvil `QA-14`, Conductor QA, 1 guía/1 bulto. La interfaz confirmó despacho y lo registró en historial.
- La continuación quedó bloqueada al cambiar de Directiva QA a Conductor QA: el botón visible `Cerrar Sesión` no produjo transición en la sesión CUA, por lo que no se aceptó custodia ni se simuló ese estado por backend.
- Las variables temporales de frontend y la instancia secundaria fueron detenidas/restauradas al terminar. No se generó comisión ni liquidación, no se insertaron movimientos directos y no se alteraron históricos.

## Sesiones independientes y restauración de comisión - 2026-11-26

- Se abrió un contexto Chrome independiente para `conductor@qa.local`; la autenticación fue exitosa y el perfil visible fue `Conductor QA`.
- En `Mis viajes`/`Encomiendas asignadas`, la interfaz mostró `No hay guías pendientes de aceptar` para el manifiesto existente `MAN-PUN-2026-0003`. No se forzó aceptación de custodia ni se alteraron estados directamente.
- Directiva QA conservó acceso al registro existente `PUN202600003`/`MAN-PUN-2026-0003`, pero el recorrido financiero no pudo continuar porque el conductor no recibió una guía elegible.
- Se confirmó un defecto visual en la configuración: `defaultValue || 10` convertía un porcentaje persistido de 0 en 10 al renderizar. Se corrigió a `defaultValue ?? 0` en `src/modules/admin/SystemConfigView.tsx`.
- Regresión técnica: typecheck aprobado; suite unitaria aprobada 91/91. La restauración del valor 0 debe verificarse desde la pantalla tras recargar la aplicación con esta corrección; no se declara generado ni liquidado ningún devengo.
- Estado: custodia, devengo, liquidación y conciliación de `PUN202600003` permanecen no ejecutados por bloqueo de elegibilidad del conductor. No se hicieron escrituras directas ni se accedió a producción.

## Visibilidad de manifiesto y entrega directa - 2026-11-26

- Lectura de Entorno B: `MAN-PUN-2026-0003` (`1bUnTr8EKF1xn2zuqoRN`) tiene `driverUid=5UpyGclN1eGbRBAxq0Ffqz6OE4H7`, `status=dispatched`, `driverCustodyStatus=pending`; `PUN202600003` tiene modalidad `direct_driver`, flete oficial Bs 10 y pago en origen.
- `conductor@qa.local` corresponde al mismo UID, está activo y `qa-vehicle`/Móvil QA-14 está vinculado al conductor.
- Causa raíz de la invisibilidad: el modo simplificado ocultaba `Despachos y Ruta` a conductores por exigir `isOperationalAdmin`, aunque `DispatchManifestView` ya implementaba `Mis Viajes` y entrega directa. Se corrigió `advancedDispatchVisible` para permitir la pestaña cuando `VITE_ADVANCED_DISPATCH=true`; los controles internos y el backend conservan las validaciones de rol, manifiesto y custodia.
- Verificación Chrome: el conductor vio `MAN-PUN-2026-0003`, aceptó custodia y luego pudo abrir `Realizar entrega · PUN202600003`. La modalidad mostrada fue entrega en ruta y el formulario exigió documento y firma.
- Bloqueo restante: la firma manuscrita obligatoria requiere un gesto de ratón/táctil sobre el lienzo; no se ejecutó una firma sintética ni se saltó el botón deshabilitado. Por ello no se generaron cobro adicional, devengo de Bs 1, liquidación ni egreso de caja.
- La variable `VITE_ADVANCED_DISPATCH` fue retirada de `.env.local` al terminar. No se modificaron registros directamente ni se accedió a producción.

## Verificación posterior de entrega PUN202600003 - 2026-11-26

- El usuario informó que revisó la firma y la entrega visualmente en Chrome.
- Consulta de solo lectura al Entorno B después de esa revisión: `PUN202600003.status` continúa en `in_transit`, sin `deliveryRecord`, sin `deliveredAt` y sin movimiento de cobro adicional; `MAN-PUN-2026-0003` continúa en `in_transit` con `driverCustodyStatus=accepted`.
- Resultado: la confirmación visual no quedó persistida en el emulador QA o Chrome estaba conectado a otra instancia. No se ejecutó el devengo ni la liquidación de Bs 1 para evitar contabilizar una entrega no confirmada.

## Reintento de entrega y verificación backend - 2026-11-26

- Tras la confirmación manual informada por el usuario, la consulta directa de solo lectura al Entorno B volvió a mostrar `PUN202600003.status=in_transit` y `MAN-PUN-2026-0003.status=in_transit`, con custodia aceptada.
- `deliveryRecord` y `deliveredAt` no existen en el documento de la encomienda.
- Storage Emulator no contiene objetos bajo `shipments/PUN202600003/signatures/`.
- Conclusión: la confirmación no llegó a los emuladores configurados en `18080/18199`, o Chrome estaba conectado a otra instancia. No se ejecutó devengo, liquidación ni conciliación para evitar registros financieros sin entrega persistida.

## Auditoría transversal de comprobantes - 2026-11-26

| Familia | Generador revisado | Estado |
|---|---|---|
| Encomiendas/guías | `buildFromShipment`, `printShipmentGuidePdf` | Revisado; importes desde centavos y datos de sucursal/operador |
| Almacén | `buildFromFixedAssetLabel` y etiquetas de operación | Revisado; impresión virtual cubierta por pruebas |
| Cobros | `buildFromCashMovement`, recibos de cuotas, multas y préstamos | Revisado; no se observaron defectos confirmados en pruebas existentes |
| Rendiciones/comisiones | `buildFromDriverSettlement`, `buildFromCommissionVoucher` | Revisado; Bs y saldos pendientes cubiertos |
| Caja | `buildFromCashShift` y movimientos | Revisado; apertura/cierre y diferencias cubiertos |
| Impresión | plantillas térmicas 58/80 mm, A4 y PDF | Validación virtual aprobada; impresión física no ejecutada |

- Defecto confirmado: `formatCurrencyBob()` podía producir `Bs. NaN` para entradas no finitas. Ahora devuelve `Bs. —` sin convertir el valor inválido en cero.
- Regresión añadida para Bs 0, Bs 0,01, Bs 1, Bs 10, Bs 30, Bs 250, Bs 500, importe grande, `NaN` e infinito.
- Validación: 93/93 pruebas unitarias aprobadas, typecheck y build aprobados. No se alteraron cálculos financieros ni registros QA.
## Entrega PUN202600003 y comisión verificada - 2026-11-26

- Causa raíz confirmada de la no persistencia: `processAndSaveSignatureToStorage` usaba como respaldo `expreso-punata-dev.firebasestorage.app`, incluso cuando Functions corría contra el Storage Emulator del proyecto `demo-expreso-punata-101`. La subida fallaba antes de la transacción que actualiza Firestore.
- Corrección aplicada: `functions/storageConfig.js` selecciona `${GCLOUD_PROJECT}.appspot.com` cuando existe `FIREBASE_STORAGE_EMULATOR_HOST`/`STORAGE_EMULATOR_HOST`, conserva `STORAGE_BUCKET_NAME` explícito y mantiene el bucket de desarrollo solo fuera del emulador. Se aplicó también a la lectura de firmas.
- Regresión agregada: `functions/test/storageConfig.test.mjs` verifica bucket de emulador y precedencia del bucket explícito (2/2 aprobadas).
- Reproducción desde Chrome QA con eventos reales de ratón sobre el canvas: formulario con documento `70000006`, botón pasó a `Procesando entrega...` y la ficha desapareció tras respuesta exitosa. No se escribieron estados directamente.
- Evidencia persistida en Entorno B: `PUN202600003.status=delivered`; `deliveryRecord.deliveredByUid=5UpyGclN1eGbRBAxq0Ffqz6OE4H7`; firma verificada en `shipments/PUN202600003/signatures/signature_1795733284736_4c932d5f.png`, objeto existente en Storage Emulator.
- Devengo desde Comisiones de conductores: guía `PUN202600003`, flete base Bs 10, regla temporal 10%, resultado Bs 1. Liquidación desde la interfaz: vale `COM-2026-00001`, egreso `mov_com_qkThLaw7A3yFMkqrmqSq` por 100 centavos, comisión `ACR-d5752592c7eaf85bdc2a2a3ae471c988dee95732e435b231de6e63d04e841625` en estado `paid`, saldo pendiente Bs 0.
- Auditoría: existe `commission_accrual_d5752592c7eaf85bdc2a2a3ae471c988dee95732e435b231de6e63d04e841625`; el comprobante visible fue `COM-2026-00001`. No se observó duplicación.
- Restauración completada desde Configuración administrativa: `system_config/expreso_punata.commissions.defaultValue=0`, verificado después del guardado. La regla histórica de devengo conserva el 10% aplicado al registro QA, sin convertirlo en predeterminado.
- Validación técnica parcial: regresión de bucket 2/2, unitarias del proyecto 93/93, typecheck/build previos aprobados. La suite completa de Functions no se declara aprobada en esta ejecución porque quedó interrumpida por falta de salida durante su ejecución.
- Auditoría solo lectura de `COM-2026-00001`: 1 vale, 1 asiento de comisión en `paid` por 100 centavos, 1 movimiento `mov_com_qkThLaw7A3yFMkqrmqSq` de tipo `expense`/categoría `driver_commission` por 100 centavos y 1 auditoría de devengo. No hay duplicados por vale, asiento ni movimiento.
- Suite Functions Entorno A: el primer intento quedó sin resumen/terminación; log persistente `.qa-automated/functions-suite-A.log` registró 145 pruebas visibles aprobadas y el fallo de seguridad de firmas, pero fue detenido por falta de salida. El fallo se reprodujo aislado en `deliveryAndLogisticsControls.test.mjs`.
- Causa del fallo aislado: fixture de prueba sembraba la firma con el bucket heredado `expreso-punata-dev.firebasestorage.app`; se corrigió para usar `getStorageBucketName()`. Regresión aislada de logística/firmas: 10/10 aprobadas.
- Repetición completa posterior: `.qa-automated/functions-suite-A-after-fix.log` avanzó hasta 136 aprobaciones y dos fallos aislados visibles (`tarifas y comisiones publicadas...` y `registerShipmentIncident...`); el primero pasó 2/2 al ejecutarse solo. El segundo falló con `6 !== 2` en el resumen de envíos, indicio de contaminación/estado compartido del emulador A o fixture de reporte; no se declara suite completa aprobada porque tampoco emitió resumen final.
- Reproducción adicional solo de `commissionsAndConsumables.test.mjs`: 5/6 pasan; `registerShipmentIncident...` falla de forma reproducible en la aserción del reporte (`8 !== 2` en otra ejecución). La función de negocio sí completa la incidencia y compensación; el problema pendiente está acotado a la expectativa/lectura del reporte y requiere una investigación separada antes de cambiar producto.
- Configuración auditada: B usa proyecto `demo-expreso-punata-101` y puertos Auth/Firestore/Storage/Functions `18099/18080/18199/18001`; A usa `demo-expreso-punata-admin-test` y `17099/17080/17199/17001`. `.env.local` mantiene `VITE_USE_FIREBASE_EMULATORS=true`; `VITE_SIMPLE_SHIPMENT_TRANSFER=true` y `VITE_ADVANCED_DISPATCH=true` son banderas QA locales. `ENABLE_AUTOMATIC_PARCEL_PRICING` solo debe activarse en Functions QA cuando se pruebe precio automático; no se activa en producción.
- El bucket frontend declarado en `.env.local` se ajustó localmente para coincidir con el proyecto QA (`demo-expreso-punata-101.appspot.com`). No se tocó producción ni el worktree original. `STORAGE_BUCKET_NAME` explícito conserva precedencia; en emulador el backend deriva el bucket del proyecto.
- Requisitos comerciales documentados: despliegue debe definir explícitamente proyecto/credenciales cloud, `VITE_USE_FIREBASE_EMULATORS=false`, bucket cloud real y `STORAGE_BUCKET_NAME`; las banderas de transferencia/precio automático deben corresponder a política aprobada y no heredarse desde QA.
- `registerShipmentIncident` aislada ahora pasa 1/1. La causa del `10 !== 2` fue limpieza incompleta: `clearCollections()` borraba el documento raíz de `shipments`, pero no `shipments/{id}/audit_logs`; las auditorías de ejecuciones anteriores se acumulaban. Se corrigió el fixture para limpiar esa subcolección antes de cada caso. No se cambió la expectativa ni la lógica comercial.
- Runner secuencial por archivo: 34 grupos ejecutados con logs individuales en `.qa-automated/function-groups/`, sin timeouts. 31 grupos terminaron con código 0; `blockBConfiguration`, `commissionsAndConsumables` y `manifestDispatch` terminaron con código 1 cuando compartieron el mismo emulador A. Los fallos observados son contaminación/aislamiento incompleto de fixtures (`shipment_notifications` y documentos históricos); no se declaran pruebas de esos grupos aprobadas.
- La ejecución monolítica de `test/*.test.mjs` sigue sin emitir resumen final: los archivos individuales sí terminan, por lo que el bloqueo pertenece al proceso compartido de Node/Firebase Admin y sus recursos abiertos, no a una transacción comercial específica. No se usó salida forzada para declarar éxito; los procesos sin resumen se marcaron incompletos.
- Firestore Rules ejecutadas directamente contra Entorno A (`17080`) con `FIRESTORE_RULES_PROJECT_ID=demo-expreso-punata-admin-test`: 34/34 aprobadas, código 0. El comando `npm run test:rules` no es utilizable en este estado porque intenta descargar otra vez Firestore Emulator v1.22.0 y falla por configuración local de CLI; la ejecución directa reutilizando A sí terminó correctamente.
