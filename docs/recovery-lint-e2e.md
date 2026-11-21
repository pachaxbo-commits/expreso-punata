# Recuperación de lint y pruebas de navegador

La configuración de ESLint aplica las reglas recomendadas de JavaScript y TypeScript, las reglas de Hooks y avisos de dependencias y Fast Refresh. El inventario completo con regla, ruta y línea se genera con:

```powershell
npm run lint -- --format json --output-file evidence/lint-recovery.json
```

La ejecución detecta 274 errores y 14 avisos en 72 archivos. Hay deuda en código y pruebas existentes. Los grupos principales son usos de `any`, variables sin uso, bloques vacíos y manejo de errores capturados. Las áreas con más hallazgos incluyen reportes, impresión, personal y gastos, activos, afiliados, pruebas de aprovisionamiento y Functions. Se corrigió el Hook condicional en el punto de entrada autenticado.

## Reproducir en Windows

Desde la raíz, con Node 22 y los emuladores libres en sus puertos predeterminados:

```powershell
$env:VITE_USE_FIREBASE_EMULATORS = 'true'
$env:VITE_FIREBASE_PROJECT_ID = 'demo-expreso-punata'
npm run build
firebase emulators:exec --project demo-expreso-punata --only auth,firestore,storage,functions 'npm run test:e2e'
```

Para la demo, ejecutar `$env:VITE_PUBLIC_DEMO = 'true'` y `npm run dev -- --host 127.0.0.1 --port 4178` en una terminal separada. Después ejecutar `node tests/e2e/runSimpleTransferDemo.mjs http://127.0.0.1:4178`. El recorrido bloquea solicitudes externas y verifica el historial, la firma y el tamaño del tutorial en cuatro pantallas.

## Incidencias

- El recorrido de negocio confirma el registro, cobro en origen y destino, caja y entrega con datos sintéticos. Falla al devengar una comisión para una guía con precio manual: `createShipment` guarda `shippingFeeCents: null` en ese modo y `accrueDriverCommission` exige un entero para calcular el flete base. Hace falta confirmar la base aprobada para esa modalidad antes de modificar el cálculo financiero.
- `8cfd6f7` mejoró la guía de registro y `04c5b89` introdujo precio manual. La comprobación local no confirma por sí sola qué versión de frontend y Functions se ejecuta en producción ni que el incidente original tenga la misma causa. Para verificarlo, correlacionar la hora y el error de un registro real reportado con los logs y revisiones publicadas, con acceso autorizado.
- La demo comparte el listado, asistente y ficha de encomienda. El panel de traslado de la ficha usa el estado de la demo. La vista de comisiones sigue siendo informativa.
