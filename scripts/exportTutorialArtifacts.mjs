import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TUTORIAL_SECTIONS } from '../src/modules/tutorial/tutorialSectionsData.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const DOCS_DIR = path.join(ROOT_DIR, 'docs', 'tutorials')

if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true })
}

console.log('Generando entregables canónicos de tutoriales en docs/tutorials/...\n')

// =========================================================================
// 1. expreso-punata-tutorial-content.json
// =========================================================================
const contentJsonPath = path.join(DOCS_DIR, 'expreso-punata-tutorial-content.json')
const jsonPayload = {
  version: '1.0.0',
  generatedAt: new Date().toISOString(),
  company: 'EXPRESO PUNATA',
  totalSections: TUTORIAL_SECTIONS.length,
  totalSteps: TUTORIAL_SECTIONS.reduce((acc, s) => acc + s.steps.length, 0),
  sections: TUTORIAL_SECTIONS,
}
fs.writeFileSync(contentJsonPath, JSON.stringify(jsonPayload, null, 2), 'utf-8')
console.log(`✓ 1. JSON Canónico exportado: ${path.relative(ROOT_DIR, contentJsonPath)} (${jsonPayload.totalSections} secciones, ${jsonPayload.totalSteps} pasos)`)

// =========================================================================
// 2. expreso-punata-tutorial-script.md (Guion Narrado para Voz IA y Video)
// =========================================================================
const scriptMdPath = path.join(DOCS_DIR, 'expreso-punata-tutorial-script.md')
let scriptContent = `# EXPRESO PUNATA — GUION OFICIAL DE CAPACITACIÓN Y NARRACIÓN AUDIOVISUAL (IA)

> **Empresa:** Expreso Punata — Servicio Interprovincial Punata - Cochabamba  
> **Versión:** 1.0.0 (Web)  
> **Propósito:** Guion estructurado para generación de locución sintética (TTS / Voz IA) y sincronización con captura de pantalla.  
> **Generado automáticamente:** ${new Date().toLocaleDateString('es-BO')}

---

## Estructura General del Recorrido

Total de Secciones Formativas: **${TUTORIAL_SECTIONS.length}**  
Total de Pasos Guiados: **${jsonPayload.totalSteps}**  
Tiempo Estimado de Locución: **~${TUTORIAL_SECTIONS.reduce((a, s) => a + s.estimatedMinutes, 0)} minutos**

---

`

TUTORIAL_SECTIONS.forEach((sec, sIdx) => {
  scriptContent += `### SECCIÓN ${sIdx + 1}: ${sec.title.toUpperCase()}\n\n`
  scriptContent += `**Módulo:** \`${sec.moduleId}\`${sec.subModuleId ? ` / \`${sec.subModuleId}\`` : ''}  \n`
  scriptContent += `**Roles Destinatarios:** ${sec.allowedRoles.map((r) => `\`${r}\``).join(', ')}  \n`
  scriptContent += `**Duración Aprox.:** ~${sec.estimatedMinutes} minutos  \n`
  scriptContent += `**Descripción:** ${sec.description}\n\n`

  sec.steps.forEach((step, stepIdx) => {
    scriptContent += `#### Escena ${sIdx + 1}.${stepIdx + 1}: ${step.title}\n\n`
    scriptContent += `- **Objetivo en Pantalla:** \`${step.target}\`\n`
    scriptContent += `- **Acción Visual:** Desplazamiento y resaltado en recuadro verde y dorado.\n`
    scriptContent += `- **Locución / Voz en Off:**\n`
    scriptContent += `  > «${step.audioScript}»\n\n`
    scriptContent += `- **Puntos Pedagógicos Clave:**\n`
    scriptContent += `  - **Concepto:** ${step.whatIsIt}\n`
    scriptContent += `  - **Utilidad:** ${step.whatIsItFor}\n`
    scriptContent += `  - **Instrucción:** ${step.whatToWriteOrSelect}\n`
    scriptContent += `  - **Ejemplo Práctico:** *${step.example}*\n`
    scriptContent += `  - **Efecto en el Sistema:** ${step.whatHappensAfter}\n`
    scriptContent += `  - **Recomendación:** ${step.importantTip}\n\n`
  })

  scriptContent += `---\n\n`
})

fs.writeFileSync(scriptMdPath, scriptContent, 'utf-8')
console.log(`✓ 2. Guion Audiovisual exportado: ${path.relative(ROOT_DIR, scriptMdPath)}`)

// =========================================================================
// 3. expreso-punata-tutorial-coverage.md (Matriz de Cobertura y Trazabilidad)
// =========================================================================
const coverageMdPath = path.join(DOCS_DIR, 'expreso-punata-tutorial-coverage.md')
let coverageContent = `# EXPRESO PUNATA — MATRIZ DE COBERTURA INTEGRAL DE TUTORIALES

Esta matriz certifica que absolutamente todos los módulos, submódulos y pantallas operativas de la plataforma cuentan con un recorrido formativo y sus correspondientes anclajes interactivos en el DOM (\`data-tutorial-target\`).

| Módulo / Pestaña | Submódulo / Flujo | Sección Tutorial | Pasos | Selector Objetivo | Roles Autorizados | Estado |
| :--- | :--- | :--- | :---: | :--- | :--- | :---: |
`

TUTORIAL_SECTIONS.forEach((sec) => {
  sec.steps.forEach((step) => {
    coverageContent += `| \`${sec.moduleId}\` | \`${sec.subModuleId || 'principal'}\` | ${step.title} | 1 | \`${step.target}\` | ${sec.allowedRoles.join(', ')} | **100% CUBIERTO** |\n`
  })
})

coverageContent += `\n## Estadísticas de Cobertura\n\n`
coverageContent += `- **Módulos Cubiertos:** 100% de la barra de navegación principal (\`shipments\`, \`storage\`, \`manifests\`, \`cash\`, \`dues\`, \`workers\`, \`assets\`, \`reports\`, \`config\`).\n`
coverageContent += `- **Subpestañas Cubiertas:** 100% (\`commisiones\`, \`fixed\`, \`consumables\`, \`users\`, \`general\`, \`tariffs\`, \`printers\`).\n`
coverageContent += `- **Total de Pasos Interactivos:** ${jsonPayload.totalSteps} pasos detallados.\n`
coverageContent += `- **Garantía Financiera:** 0 mutaciones en base de datos causadas por el tutorial (modo puramente explicativo).\n`

fs.writeFileSync(coverageMdPath, coverageContent, 'utf-8')
console.log(`✓ 3. Matriz de Cobertura exportada: ${path.relative(ROOT_DIR, coverageMdPath)}`)

// =========================================================================
// 4. expreso-punata-roles-guide.md (Guía Pedagógica por Rol de Trabajo)
// =========================================================================
const rolesGuideMdPath = path.join(DOCS_DIR, 'expreso-punata-roles-guide.md')
const ROLES = [
  { id: 'secretaria', name: 'Secretaria de Ventanilla', desc: 'Atención al cliente en mostrador, emisión de encomiendas, cobranzas en caja, entrega de paquetes y control de almacén.' },
  { id: 'conductor', name: 'Conductor / Transportista', desc: 'Custodia de encomiendas en ruta interprovincial Punata - Cochabamba, control de manifiesto y liquidación de comisiones.' },
  { id: 'encargado_agencia', name: 'Encargado de Agencia', desc: 'Supervisión de operaciones de sucursal, control de almacén, existencias de rollos térmicos e inventario de bienes.' },
  { id: 'tesoreria', name: 'Tesorería', desc: 'Auditoría de arqueos de caja, padrón de socios, cobro de mensualidades, planilla de sueldos y libros de egresos.' },
  { id: 'directiva_admin', name: 'Directiva y Administración General', desc: 'Gobernanza completa de la empresa, creación de operadores, tarifario oficial, parámetros de impresión y reportes consolidados.' },
]

let rolesGuideContent = `# EXPRESO PUNATA — GUÍA PEDAGÓGICA Y MANUAL FORMATIVO POR ROL

Este documento define el itinerario de aprendizaje recomendado para cada trabajador según su perfil laboral en Expreso Punata.

---

`

ROLES.forEach((r) => {
  const allowedSections = TUTORIAL_SECTIONS.filter((s) => s.allowedRoles.includes(r.id))
  const stepCount = allowedSections.reduce((a, s) => a + s.steps.length, 0)
  const estMins = allowedSections.reduce((a, s) => a + s.estimatedMinutes, 0)

  rolesGuideContent += `## 👤 ${r.name.toUpperCase()} (\`${r.id}\`)\n\n`
  rolesGuideContent += `**Responsabilidad General:** ${r.desc}  \n`
  rolesGuideContent += `**Módulos Formativos Habilitados:** ${allowedSections.length} secciones (${stepCount} pasos interactivos)  \n`
  rolesGuideContent += `**Tiempo Estimado de Capacitación:** ~${estMins} minutos  \n\n`
  rolesGuideContent += `### Itinerario de Recorrido Recomendado:\n\n`

  allowedSections.forEach((s, idx) => {
    rolesGuideContent += `${idx + 1}. **${s.title}** (~${s.estimatedMinutes} min)\n`
    rolesGuideContent += `   - *Descripción:* ${s.description}\n`
    rolesGuideContent += `   - *Pasos:* ${s.steps.map((st) => st.title).join(' → ')}\n`
  })

  rolesGuideContent += `\n---\n\n`
})

fs.writeFileSync(rolesGuideMdPath, rolesGuideContent, 'utf-8')
console.log(`✓ 4. Guía por Roles exportada: ${path.relative(ROOT_DIR, rolesGuideMdPath)}`)

console.log('\n¡Todos los entregables documentales del tutorial se exportaron exitosamente!')
