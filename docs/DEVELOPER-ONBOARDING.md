# GUÍA DE INCORPORACIÓN PARA DESARROLLADORES (ONBOARDING)
## EXPRESO PUNATA 1.0 — SISTEMA MULTISUCURSAL DE ENCOMIENDAS Y GESTIÓN

¡Bienvenido al equipo de ingeniería de **EXPRESO PUNATA 1.0**!

Este documento proporciona los pasos exactos para configurar tu estación de trabajo en **Windows**, comprender la arquitectura del sistema y colaborar de forma productiva y segura junto a Gemini y el equipo de PACHAX, evitando conflictos de código y protegiendo los datos de clientes y de la empresa.

---

### 1. REQUISITOS DEL SISTEMA

Antes de comenzar, asegúrate de tener instaladas las siguientes herramientas en tu PC Windows:

| Herramienta | Versión Recomendada | Propósito / Verificación |
| :--- | :--- | :--- |
| **Node.js** | **v22.x (LTS)** | Entorno de ejecución principal (`node -v`). Debe coincidir con el runtime de Firebase Cloud Functions. |
| **Git** | **v2.40+** | Control de versiones (`git --version`). Configurar saltos de línea con `git config --global core.autocrlf true`. |
| **Java JRE / JDK** | **Java 17 o 21 (LTS)** | Requerido exclusivamente para ejecutar los emuladores locales de Firebase (`java -version`). |
| **Firebase CLI** | **v13+ / v14+** | Herramientas de emuladores y despliegue (`firebase --version`). Instalar con `npm install -g firebase-tools`. |
| **Google Chrome** | Última estable | Navegador oficial para pruebas de interfaz y Playwright. |
| **GitHub CLI (`gh`)** | Opcional pero recomendada | Para gestión ágil de Pull Requests (`gh --version`). |

---

### 2. CLONACIÓN DEL REPOSITORIO Y PREPARACIÓN DE RAMAS

El repositorio se encuentra alojado en la organización `pachaxbo-commits`.

```powershell
# 1. Clona el repositorio oficial en tu carpeta de trabajo
git clone https://github.com/pachaxbo-commits/expreso-punata.git
cd expreso-punata

# 2. Sitúate inmediatamente en la rama compartida de integración 'develop'
git checkout develop

# 3. Verifica el último commit integrado
git log -1 --oneline
```

> [!IMPORTANT]
> **ESTRUCTURA DE RAMAS:**
> - `develop`: **Rama activa de desarrollo e integración.** Todo cambio debe ingresar aquí mediante Pull Request.
> - `main`: **Rama de Producción protegida.** No se toca durante el desarrollo diario y jamás se hace push directo.

---

### 3. INSTALACIÓN DE DEPENDENCIAS

Utiliza siempre `npm ci` para instalar exactamente las versiones fijadas en el lockfile:

```powershell
# 1. Dependencias de la aplicación web principal
npm ci

# 2. Dependencias del backend de Cloud Functions
cd functions
npm ci
cd ..
```

---

### 4. VARIABLES DE ENTORNO LOCALES (.env.local)

Copia la plantilla de variables de entorno para tu uso personal:

```powershell
Copy-Item .env.example .env.local
```

El archivo `.env.local` está explícitamente ignorado por `.gitignore`, por lo que tus configuraciones locales nunca se subirán al repositorio.

Por defecto, `.env.local` viene configurado en **Modo Emulador Local Aislado**:
```ini
VITE_USE_FIREBASE_EMULATORS=true
VITE_FIREBASE_API_KEY=demo-api-key-expreso-punata
VITE_FIREBASE_AUTH_DOMAIN=localhost
VITE_FIREBASE_PROJECT_ID=demo-expreso-punata
VITE_FIREBASE_STORAGE_BUCKET=demo-expreso-punata.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:demo-local
```

---

### 5. EJECUCIÓN DEL SISTEMA EN DESARROLLO

Para trabajar y programar sin costo y sin consumir cuotas de la nube, el sistema utiliza la suite de **Firebase Emulators**:

#### Paso 1: En una primera terminal, levanta los emuladores locales:
```powershell
npm run emulators
```
Esto iniciará los servicios locales en `127.0.0.1`:
- **Authentication:** `http://127.0.0.1:9099`
- **Firestore:** `127.0.0.1:8080`
- **Storage:** `http://127.0.0.1:9199`
- **Functions:** `http://127.0.0.1:5001`
- **Emulator UI:** `http://127.0.0.1:4000`

#### Paso 2: En una segunda terminal, arranca el servidor web Vite:
```powershell
npm run dev
```
Abre tu navegador en `http://localhost:5173`. La aplicación detectará automáticamente `localhost` y se enlazará a los emuladores.

#### ¿Cómo inicio sesión sin credenciales de Firebase Admin?
En la pantalla de inicio de sesión (`LoginView`), cuando estás en modo emulador verás el panel de **"Simulación de Roles (Emuladores Locales)"**. Con un solo clic puedes autenticarte como:
- **Secretaria Punata:** Operación de ventanilla, registro de guías y arqueo de caja Punata.
- **Secretaria Cochabamba:** Recepción de manifiestos, almacenamiento físico y entregas.
- **Directiva / Admin:** Acceso completo a inventario, usuarios, personal, caja y reportes consolidados.
- **Tesorería & Aportes:** Padrón de socios, emisión y recaudación de mensualidades y nómina.
- **Conductor Móvil 14:** Custodia de encomiendas, entregas contraentrega en ruta y rendición de dinero.

---

### 6. EJECUCIÓN DE PRUEBAS AUTOMATIZADAS

Antes de enviar cualquier cambio, ejecuta todas las pruebas localmente:

```powershell
# 1. Comprobación estricta de tipos de TypeScript
npm run typecheck

# 2. Pruebas unitarias de tarifas, transiciones de estado y motor de impresión
npm run test:unit

# 3. Pruebas de reglas de seguridad de Firestore (Fail-Closed)
npm run test:rules

# 4. Pruebas de backend Cloud Functions (Idempotencia, arqueo, concurrencia, reportes)
npm run test:functions

# 5. Prueba de ciclo de vida completo (Recepción, despacho, almacén, entrega y custodia)
npm run test:delivery-lifecycle

# 6. Compilación de producción
npm run build
```

---

### 7. FLUJO DE TRABAJO EN RAMAS Y PULL REQUESTS

1. **Crea tu rama de trabajo a partir de `develop`:**
   ```powershell
   git checkout develop
   git pull origin develop
   git checkout -b feature/nombre-de-tu-modulo
   ```

2. **Realiza tus cambios y confirma con commits atómicos y claros:**
   ```powershell
   git add .
   git commit -m "feat(modulo): descripción clara del cambio"
   ```

3. **Publica tu rama y abre la Pull Request hacia `develop`:**
   ```powershell
   git push -u origin feature/nombre-de-tu-modulo
   gh pr create --base develop --title "feat(modulo): ..." --body "Resumen de cambios"
   ```

4. **Reglas de Oro:**
   - **NUNCA hagas `git push --force`** en ramas compartidas.
   - **NUNCA hagas merge a `main`** sin autorización de la directiva y PACHAX.
   - **NUNCA subas claves privadas, archivos `.json` de credenciales ni tokens.**

---

### 8. CÓMO MANTENERTE ACTUALIZADO CON LOS CAMBIOS DE GEMINI

Cuando Gemini u otro desarrollador integren cambios en `develop`, sincroniza tu rama de la siguiente forma:

```powershell
# 1. Guarda tus cambios actuales o haz commit
git status

# 2. Actualiza tu copia local de develop
git checkout develop
git pull origin develop

# 3. Vuelve a tu rama e integra los cambios más recientes
git checkout feature/nombre-de-tu-modulo
git merge develop
```
Resuelve los conflictos en tus archivos si los hubiera, ejecuta `npm run typecheck` y `npm run test:unit` para verificar que todo siga funcionando, y continúa tu trabajo.

---

### 9. ARCHIVOS Y CARPETAS QUE REQUIEREN ESPECIAL CUIDADO

| Archivo / Carpeta | Nivel de Cuidado | Razón / Regla de Modificación |
| :--- | :--- | :--- |
| `firestore.rules` | **Crítico** | Define la seguridad autoritativa de la base de datos. Cualquier regla permisiva puede exponer datos financieros o violar la regla de fail-closed. |
| `functions/index.js` | **Crítico** | Contiene las 28 funciones de Cloud Functions con transacciones financieras en centavos enteros (`amountCents`) e idempotencia. |
| `src/firebase/config.ts` | **Crítico** | Inicializa los SDKs y contiene la protección fail-controlled que evita fallbacks silenciosos. |
| `src/domain/parcelEngine.ts` | **Alto** | Motor de tarifas, correlativos y validaciones de negocio. |
| `package-lock.json` | **Alto** | No editar manualmente; actualizar exclusivamente mediante `npm install` o `npm ci`. |

---

### 10. POLÍTICA DE ACCESO A FIREBASE CLOUD DEVELOPMENT

- Para el 95% del desarrollo frontend y pruebas de lógica, los **emuladores locales son más rápidos, seguros y suficientes**.
- Para realizar operaciones contra el proyecto en la nube `expreso-punata-dev` (como ejecutar `firebase deploy`, alterar índices en Firestore o modificar variables de Vercel), **se requiere coordinación previa**.
- Cada desarrollador debe contar con su propio usuario y cuenta corporativa invitada, evitando el uso compartido de contraseñas maestras o tokens personales.

¡Buen trabajo y excelente desarrollo en **EXPRESO PUNATA 1.0**!
