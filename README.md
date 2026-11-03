# EXPRESO PUNATA 1.0 — SISTEMA WEB INDEPENDIENTE
## GESTIÓN MULTISUCURSAL DE ENCOMIENDAS, LOGÍSTICA, CAJA Y REPORTES

**Organización:** PACHAX (`pachaxbo-commits`)  
**Repositorio:** `https://github.com/pachaxbo-commits/expreso-punata`  
**Visibilidad:** **Público** (Decisión institucional expresa de PACHAX; protección absoluta de credenciales, secretos y tokens resguardados fuera de Git)  
**Alcance Técnico:** **100% Web** (Optimizado para navegadores en PC de escritorio y dispositivos móviles; sin instalador Windows, sin base de datos local y sin sincronización offline)  
**Rama Base de Integración:** `develop`  
**Rama de Producción:** `main`  
**Backend Cloud Unificado (Demostración):** Firebase `expreso-punata-dev` (Plan Blaze activo, compartido temporalmente por Vercel Preview y Vercel Production)  
**URL de Producción:** `https://expreso-punata.vercel.app`  

---

### 1. Entorno de Demostración Web 1.0

> [!NOTE]
> La versión 1.0 desplegada en producción funciona en **modo demostración** (`isDemo: true`).
> Todos los datos cargados (padrón de socios, nómina de personal, activos fijos, inventario de consumibles, encomiendas de prueba y tarifas referenciales) corresponden a datos de demostración para evaluación y presentación visual. No representan información tributaria, legal ni financiera oficial de Expreso Punata.

---

### 2. Descripción del Sistema

Aplicación web progresiva desarrollada exclusivamente para **EXPRESO PUNATA**, soportando la operación logística, financiera y administrativa en tiempo real entre sus dos agencias oficiales:
- **Agencia Central Punata (PUN)**
- **Agencia Cochabamba (CBB)**

#### Módulos Operativos y Administrativos:
1. **Recepción, Despacho y Entrega de Encomiendas**:
   - Asistente de emisión con correlativos únicos por agencia (`PUN2026...` y `CBB2026...`).
   - Tarifas sugeridas con posibilidad de precio acordado en ventanilla y justificación comercial.
   - Gestión de almacén físico dinámico (`Agencia → Estante → Módulo 1-5`).
   - Manifiestos de despacho interprovincial con aceptación de carga por conductor y confirmación de custodia.
   - Recepción en agencia destino con verificación de bultos y reporte de discrepancias.
   - Entrega final conforme con captura de firma digital manuscrita en Firebase Storage.
2. **Caja por Ventanilla y Sucursal**:
   - Turnos de caja auditables (`TUR-PUN-...` y `TUR-CBB-...`) con fondo inicial diferenciado.
   - Cobro de encomiendas pagadas en origen y cobro contraentrega (COD) en destino o ruta.
   - Rendición formal de custodia de dinero de conductores (`settleDriverCash`).
   - Egresos autorizados con códigos de autorización y arqueo físico con desglose estricto de billetes/monedas.
3. **Padrón de Socios y Mensualidades**:
   - Registro de afiliados, vehículos asociados y números internos (`Móvil 14`, `Móvil 07`).
   - Generación atómica mensual de cuotas sin fallbacks arbitrarios.
   - Cobro de mensualidades vinculado al turno de caja activo o cobro extraordinario auditado.
4. **Nómina de Personal y Gastos Operativos**:
   - Registro de trabajadores y pago de nómina con descuento transaccional en caja.
   - Registro de gastos operativos categorizados (combustible, mantenimiento, alquileres, servicios).
5. **Inventario de Bienes Fijos y Consumibles**:
   - Catálogo de bienes con códigos autogenerados (`ACT-PUN-XXXX` / `ACT-CBB-XXXX`).
   - Catálogo de consumibles de ventanilla con control de existencias y alertas de stock mínimo.
6. **Motor Central de Reportes y Analítica**:
   - Reportes especializados operativos, financieros, nómina, socios y Tablero Consolidado.
   - Exportación nativa a **PDF corporativo** y **Excel** (formato CSV UTF-8 con BOM).
   - Zona horaria oficial `America/La_Paz` (UTC-4) y cálculo monetario en centavos enteros.

---

### 3. Flujo de Trabajo Colaborativo (Multi-Desarrollador)

Para garantizar un desarrollo simultáneo seguro y sin conflictos:

- **Rama `develop`:** Es la rama compartida de integración. Todo cambio debe integrarse aquí mediante Pull Requests (PRs).
- **Ramas de Trabajo:** Todo desarrollo individual debe realizarse en ramas nombradas `feature/<nombre-tarea>` o `fix/<descripcion>`.
- **Pull Requests Obligatorias:** No se permite hacer push directo a `develop` ni a `main`. Cada PR debe someterse a revisión y pasar los tests automatizados antes de fusionarse.
- **Prohibido `push --force`:** Bajo ninguna circunstancia sobreescribir la historia remota de ramas compartidas.
- **Protección de `main`:** La rama `main` está reservada exclusivamente para versiones de Producción aprobadas.
- **Uso estricto de `npm ci`:** Para instalar dependencias idénticas basadas en el `package-lock.json`.

---

### 4. Puesta en Marcha en Desarrollo

#### Opción A: Desarrollo Local Aislado con Emuladores (Recomendado por Defecto)
Permite desarrollar y probar todas las funcionalidades sin costo y sin tocar datos reales:

```bash
# 1. Clonar el repositorio y situarse en develop
git clone https://github.com/pachaxbo-commits/expreso-punata.git
cd expreso-punata
git checkout develop

# 2. Instalar dependencias
npm ci

# 3. Iniciar los emuladores locales de Firebase
npm run emulators

# 4. En una segunda terminal, iniciar el servidor web de desarrollo
npm run dev
```

#### Opción B: Conexión a Firebase Cloud (`expreso-punata-dev`)
1. Configure `.env.local` con `VITE_USE_FIREBASE_EMULATORS=false` y las credenciales web públicas de Firebase.
2. Ejecute `npm run dev`.

---

### 5. Comandos de Verificación y Pruebas

Antes de abrir una Pull Request, verifique que todo el pipeline esté verde:

```bash
# 1. Comprobación estricta de tipos TypeScript
npm run typecheck

# 2. Pruebas unitarias de dominio y negocio (tarifas, estados, formatos, impresión)
npm run test:unit

# 3. Pruebas de reglas de seguridad de Firestore (Fail-Closed)
npm run test:rules

# 4. Pruebas de backend Cloud Functions (111 tests pasando en emuladores)
npm run test:functions

# 5. Compilación de producción con Vite
npm run build
```
