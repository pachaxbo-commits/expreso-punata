import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ID = 'expreso-punata-dev'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`No se encontró el archivo de configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) {
    throw new Error('No se encontró un access_token activo en Firebase CLI.')
  }
  return token
}

async function auditCollections() {
  const token = getFirebaseCliToken()
  console.log(`[AUDITORIA FIRESTORE] Conectando a ${PROJECT_ID}...`)

  // Colecciones estándar conocidas en el sistema
  const knownCollections = [
    'users',
    'system_config',
    'agencias',
    'branches',
    'shipments',
    'cash_shifts',
    'cash_movements',
    'dispatch_manifests',
    'driver_settlements',
    'union_members',
    'union_fees',
    'workers',
    'general_expenses',
    'fixed_assets',
    'consumables',
    'audit_logs'
  ]

  const inventory = {}

  for (const col of knownCollections) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}?pageSize=100`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data = await res.json()
      const docs = data.documents || []
      inventory[col] = {
        count: docs.length,
        documents: docs.map(d => {
          const id = d.name.split('/').pop()
          const fields = d.fields || {}
          return { id, fields }
        })
      }
    } else if (res.status === 404) {
      inventory[col] = { count: 0, documents: [] }
    } else {
      console.error(`Error consultando colección ${col}: HTTP ${res.status}`)
    }
  }

  console.log('====================================================================')
  console.log('INVENTARIO DETALLADO DE COLECCIONES EN FIRESTORE (expreso-punata-dev)')
  console.log('====================================================================')
  for (const [col, info] of Object.entries(inventory)) {
    console.log(`- Colección "${col}": ${info.count} documentos`)
    if (info.count > 0 && info.count <= 10) {
      for (const d of info.documents) {
        console.log(`    • ID: ${d.id}`)
      }
    } else if (info.count > 10) {
      console.log(`    • Primeros 5 IDs: ${info.documents.slice(0, 5).map(d => d.id).join(', ')} ...`)
    }
  }
  console.log('====================================================================')

  // Guardar archivo de inventario json para respaldo y análisis
  const outPath = path.resolve('docs/audit/firestore-inventory-pre-clean.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(inventory, null, 2), 'utf8')
  console.log(`Inventario completo guardado en: ${outPath}`)
}

auditCollections().catch(console.error)
