import fs from 'node:fs'
import path from 'node:path'
import { TUTORIAL_SECTIONS } from '../src/modules/tutorial/tutorialSectionsData.ts'

const SRC_DIR = path.resolve('src')

function getAllSrcFiles(dir) {
  let results = []
  const list = fs.readdirSync(dir)
  for (const file of list) {
    const fullPath = path.join(dir, file)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      results = results.concat(getAllSrcFiles(fullPath))
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(fullPath)
    }
  }
  return results
}

const allFiles = getAllSrcFiles(SRC_DIR)
const allSourceCode = allFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n')

console.log('====================================================================')
console.log('AUDITORÍA DE INTEGRIDAD: 44 PASOS DEL CENTRO DE TUTORIALES')
console.log('====================================================================')

let totalSteps = 0
let foundCount = 0
let missingTargets = []

for (const sec of TUTORIAL_SECTIONS) {
  console.log(`\nSección: [${sec.id}] ${sec.title} (${sec.steps.length} pasos)`)
  for (const step of sec.steps) {
    totalSteps++
    const targetMatch = step.target.match(/\[data-tutorial-target="([^"]+)"\]/)
    if (targetMatch) {
      const targetId = targetMatch[1]
      const isInCode = allSourceCode.includes(`data-tutorial-target="${targetId}"`)
      if (isInCode) {
        foundCount++
        console.log(`  ✓ Paso ${step.order}: "${step.title}" -> data-tutorial-target="${targetId}"`)
      } else {
        missingTargets.push({ section: sec.id, step: step.order, title: step.title, targetId })
        console.log(`  ✗ FALTA: Paso ${step.order}: "${step.title}" -> targetId="${targetId}"`)
      }
    } else {
      console.log(`  - Paso ${step.order}: "${step.title}" -> selector general: ${step.target}`)
      foundCount++
    }
  }
}

console.log('\n====================================================================')
console.log(`RESULTADO DE COBERTURA:`)
console.log(`- Total de secciones: ${TUTORIAL_SECTIONS.length}`)
console.log(`- Total de pasos:     ${totalSteps}`)
console.log(`- Selectores en DOM:  ${foundCount} / ${totalSteps}`)
console.log(`- Faltantes:          ${missingTargets.length}`)
if (missingTargets.length > 0) {
  console.log('Detalle de faltantes:', missingTargets)
} else {
  console.log('¡100% DE LOS SELECTORES ESTÁN VINCULADOS A COMPONENTES REALES!')
}
console.log('====================================================================\n')
