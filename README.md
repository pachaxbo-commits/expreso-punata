# S.M.T. EXPRESO PUNATA — SISTEMA WEB INDEPENDIENTE
## GESTIÓN MULTISUCURSAL DE ENCOMIENDAS & ADMINISTRACIÓN SINDICAL
**Propietario / Organización**: PACHAX (`pachaxbo-commits`)  
**Cuenta Administradora**: `pachax.bo@gmail.com`  
**Repositorio Privado**: `https://github.com/pachaxbo-commits/expreso-punata`  
**Commit Base de Extracción**: `b6e5996` de `pachaxbo-commits/pachax-platform` (PR #19)  

---

### Descripción del Proyecto
Aplicación web en la nube diseñada específicamente para **S.M.T. Expreso Punata**, permitiendo la operación simultánea y en tiempo real de dos sucursales:
- **Agencia Central Punata (PUN)**
- **Agencia Cochabamba (CBB)**

El sistema integra:
1. **Recepción, Despacho y Entrega de Encomiendas**:
   - Numeración única por agencia (`PUN-2026-XXXXX` y `CBB-2026-XXXXX`).
   - Ubicación física en destino por módulos (`Agencia → Estante → Módulo 1-5`).
   - Soporte para entrega directa por conductor en ruta con dinero contraentrega en custodia.
2. **Caja por Secretaria y Sucursal**:
   - Fondo inicial, ingresos en efectivo separados de QR/transferencias.
   - Arqueo físico al cierre y registro inmutable de movimientos.
3. **Padrón de Socios y Mensualidades**:
   - Registro de vehículos e internos (`M-14`, `M-28`).
   - Control de aportes, cuotas mensuales, moras y estados de cuenta.
4. **Inventario / Bienes Fijos del Sindicato**:
   - Control de equipos, mobiliario, herramientas, impresoras con código QR.
   - Bajas y transferencias auditadas.
5. **Seguridad y Permisos (RBAC)**:
   - Roles: `secretaria`, `encargado_agencia`, `tesoreria`, `directiva_admin`, `conductor`.
   - Firestore Security Rules y Storage Rules fail-closed.

---

### Puesta en Marcha en Desarrollo

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar emuladores locales de Firebase (Auth, Firestore, Storage)
npm run emulators

# 3. En otra terminal, iniciar servidor de desarrollo web
npm run dev
```

La aplicación se conectará automáticamente a los emuladores locales en `127.0.0.1`, garantizando cero consumo de recursos en la nube durante el desarrollo y pruebas.

---

### Comandos de Verificación

- `npm run typecheck`: Comprobación estricta de tipos de TypeScript.
- `npm run build`: Compilación de producción con Vite.
- `npm run test:unit`: Pruebas unitarias de cálculos tarifarios, validaciones y reglas de negocio.
- `npm run test:rules`: Pruebas de reglas de seguridad de Firestore con emuladores locales.
