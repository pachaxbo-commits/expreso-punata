import fs from 'node:fs'
import path from 'node:path'
import { TUTORIAL_SECTIONS } from '../src/modules/tutorial/tutorialSectionsData.ts'

const operationalOrder = [
  'shipments_window',
  'shipments_pricing',
  'shipments_lifecycle',
  'cash_management',
  'storage_management',
  'dispatch_manifests',
  'driver_commissions',
  'union_members',
  'workers_expenses',
  'fixed_assets',
  'consumables_inventory',
  'reports_analytics',
  'printers_tickets',
  'login_profile',
  'panel_navigation',
  'admin_users',
  'system_config'
]

const optionalIds = new Set(['login_profile', 'panel_navigation', 'admin_users', 'system_config'])

const sectionMap = new Map(TUTORIAL_SECTIONS.map(s => [s.id, s]))

const reordered = []
let orderNumber = 1

for (const id of operationalOrder) {
  const sec = sectionMap.get(id)
  if (!sec) {
    throw new Error(`Sección ${id} no encontrada en TUTORIAL_SECTIONS`)
  }
  const isOpt = optionalIds.has(id)
  const category = isOpt ? 'configuration' : 'operational'
  
  // Re-number title
  const cleanTitle = sec.title.replace(/^\d+\.\s*/, '')
  const newTitle = `${orderNumber}. ${cleanTitle}${isOpt ? ' (Opcional)' : ''}`

  reordered.push({
    ...sec,
    title: newTitle,
    category,
    isOptional: isOpt
  })
  orderNumber++
}

const fileHeader = `import type { TutorialSection } from './types'\n\nexport const TUTORIAL_SECTIONS: TutorialSection[] = `
const outTs = fileHeader + JSON.stringify(reordered, null, 2) + '\n'

const targetPath = path.resolve('src/modules/tutorial/tutorialSectionsData.ts')
fs.writeFileSync(targetPath, outTs, 'utf8')
console.log(`Reordenamiento exitoso. ${reordered.length} secciones ordenadas en ${targetPath}`)
