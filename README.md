# EXPRESO PUNATA 1.0 — SISTEMA WEB INDEPENDIENTE
## GESTIÓN MULTISUCURSAL DE ENCOMIENDAS, LOGÍSTICA, CAJA Y REPORTES

**Organización:** PACHAX (`pachaxbo-commits`)  
**Repositorio:** `https://github.com/pachaxbo-commits/expreso-punata`  
**Visibilidad:** **Público** (Decisión institucional expresa de PACHAX; protección absoluta de credenciales, secretos y datos de clientes resguardados fuera de Git)  
**Rama Base de Integración:** `develop`  
**Rama de Producción (Protegida):** `main`  
**Entorno de Desarrollo Cloud:** Firebase `expreso-punata-dev` & Vercel Preview  

---

### 1. Descripción del Sistema

Aplicación web progresiva desarrollada exclusivamente para **EXPRESO PUNATA**, soportando la operación logística, financiera y administrativa en tiempo real entre sus dos agencias oficiales:
- **Agencia Central Punata (PUN)**
- **Agencia Cochabamba (CBB)**

#### Módulos Operativos:
1. **Recepción, Despacho y Entrega de Encomiendas**:
   - Asistente de emisión con correlativos únicos por agencia (`PUN-2026-XXXXX` y `CBB-2026-XXXXX`).
   - Gestión de almacén físico dinámico (`Agencia → Estante → Módulo 1-5`).
   - Manifiestos de despacho interprovincial con aceptación de carga por conductor.
   - Entrega final conforme con captura de firma digital manuscrita en Firebase Storage.
2. **Caja por Ventanilla y Sucursal**:
   - Turnos de caja auditables (`TUR-PUN-...` y `TUR-CBB-...`) con fondo inicial diferenciado.
   - Cobro de encomiendas pagadas en origen y cobro contraentrega (COD) en destino o ruta.
   - Rendición formal de custodia de dinero de conductores (`settleDriverCash`).
   - Egresos autorizados con códigos de autorización y arqueo físico con desglose estricto de billetes/monedas.
3. **Padrón de Socios y Mensualidades**:
   - Registro de afiliados, vehículos asociados y números internos (`M-14`, `M-28`).
   - Generación atómica mensual de cuotas sin fallbacks arbitrarios.
   - Cobro de mensualidades vinculado al turno de caja activo o cobro extraordinario auditado.
4. **Nómina de Personal y Gastos Operativos**:
   - Registro de contratos y pago de sueldos/adelantos a secretarias y personal.
   - Registro de gastos operativos categorizados (combustible, alquileres, servicios, viáticos).
5. **Inventario de Bienes Fijos y Equipos**:
   - Catálogo de bienes con códigos autogenerados (`ACT-PUN-XXXX` / `ACT-CBB-XXXX`).
   - Trazabilidad de transferencias y bajas definitivas justificadas e inmutables.
6. **Motor Central de Reportes y Analítica (Entrega 7)**:
   - 6 reportes analíticos especializados + Tablero Consolidado Ejecutivo.
   - Exportación nativa a **PDF corporativo** (jsPDF + autoTable) y **Excel** (CSV con UTF-8 BOM).
   - Zona horaria oficial `America/La_Paz` (UTC-4) y precisión monetaria en centavos enteros.

---

### 2. Flujo de Trabajo Colaborativo (Multi-Desarrollador)

Para garantizar un desarrollo simultáneo seguro y sin conflictos:

- **Rama `develop`:** Es la rama compartida de integración. Todo cambio debe integrarse aquí mediante Pull Requests (PRs).
- **Ramas de Trabajo:** Todo desarrollo individual debe realizarse en ramas nombradas `feature/<nombre-tarea>` o `fix/<descripcion>`.
- **Pull Requests Obligatorias:** No se permite hacer push directo a `develop` ni a `main`. Cada PR debe someterse a revisión y pasar los tests automatizados antes de fusionarse.
- **Prohibido `push --force`:** Bajo ninguna circunstancia sobreescribir la historia remota de ramas compartidas.
- **Protección de `main`:** La rama `main` está reservada exclusivamente para despliegues de Producción autorizados. Ningún desarrollador puede fusionar a `main` sin autorización expresa.
- **Uso estricto de `npm ci`:** Para instalar dependencias idénticas basadas en el `package-lock.json`.

---

### 3. Puesta en Marcha en Desarrollo

#### Opción A: Desarrollo Local Aislado con Emuladores (Recomendado por Defecto)
Permite desarrollar y probar todas las funcionalidades sin costo, sin internet y sin tocar datos reales:

```bash
# 1. Clonar el repositorio y situarse en la rama develop
git clone https://github.com/pachaxbo-commits/expreso-punata.git
cd expreso-punata
git checkout develop

# 2. Instalar dependencias con lockfile estricto
npm ci

# 3. Crear archivo de entorno local desde la plantilla
cp .env.example .env.local

# 4. Iniciar los emuladores locales de Firebase (Auth, Firestore, Storage)
npm run emulators

# 5. En una segunda terminal, iniciar el servidor web de desarrollo
npm run dev
```

La aplicación detectará `localhost` y se conectará automáticamente a los emuladores locales en `127.0.0.1`:
- **Firebase Auth Emulator:** `http://127.0.0.1:9099`
- **Cloud Firestore Emulator:** `127.0.0.1:8080`
- **Cloud Storage Emulator:** `http://127.0.0.1:9199`
- **Cloud Functions Emulator:** `http://127.0.0.1:5001`
- **Vite Web App:** `http://localhost:5173`

#### Opción B: Conexión a Firebase Cloud Development (`expreso-punata-dev`)
Utilizar esta opción **únicamente cuando se requiera validar integración real** con Firebase Cloud y esté expresamente autorizado:

1. Edite `.env.local`:
   ```bash
   VITE_USE_FIREBASE_EMULATORS=false
   VITE_FIREBASE_API_KEY=<api-key-de-desarrollo>
   VITE_FIREBASE_AUTH_DOMAIN=expreso-punata-dev.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=expreso-punata-dev
   VITE_FIREBASE_STORAGE_BUCKET=expreso-punata-dev.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=405140168085
   VITE_FIREBASE_APP_ID=1:405140168085:web:a94720c5be75f910996a9c
   ```
2. Ejecute `npm run dev`.
3. Si falta alguna variable requerida, el sistema **fallará de forma controlada** con un mensaje de diagnóstico visible, impidiendo conectarse accidentalmente a un proyecto equivocado.

---

### 4. Seguridad de Credenciales y Prevención de Accidentes

- **Prohibido subir secretos a Git:** Nunca coloque credenciales administrativas, claves privadas de Service Accounts de Google Cloud (`*.json`), tokens de Vercel ni contraseñas dentro del repositorio.
- **Variables `VITE_*` son públicas:** Cualquier variable con prefijo `VITE_` se compila en el paquete del navegador. Nunca guarde secretos privados allí. Toda lógica sensible o con privilegios debe ejecutarse en Cloud Functions.
- **Aislamiento de Producción:** El proyecto de Producción (`expreso-punata`) es independiente. No configure variables de Producción en entornos de desarrollo ni reutilice identificadores de desarrollo en producción.

---

### 5. Comandos de Verificación y Pruebas

Antes de abrir una Pull Request, verifique que todo el pipeline esté verde:

```bash
# 1. Comprobación estricta de tipos TypeScript
npm run typecheck

# 2. Pruebas unitarias de dominio y negocio (tarifas, estados, formatos)
npm run test:unit

# 3. Pruebas de reglas de seguridad de Firestore (Fail-Closed)
npm run test:rules

# 4. Pruebas de backend Cloud Functions (Idempotencia, concurrencia, reportes)
npm run test:functions

# 5. Prueba de ciclo de vida completo (Recepción, manifiesto, entrega, COD, custodia)
npm run test:delivery-lifecycle

# 6. Compilación de producción con Vite
npm run build
```
