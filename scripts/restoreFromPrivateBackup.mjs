import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ID = 'expreso-punata-dev'
const DEFAULT_BACKUP_PATH = 'C:/Users/fabri/.gemini/antigravity/brain/39f1d6ec-67a4-438d-a34a-fc87f2af0029/scratch/secure_backup/firestore-inventory-pre-clean.json'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`No se encontró configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) throw new Error('No se encontró un access_token activo en Firebase CLI.')
  return token
}

async function restoreDocuments() {
  const isExecuteRequested = process.argv.includes('--execute-restore')
  const backupPath = process.argv.find(a => a.startsWith('--backup='))?.split('=')[1] || DEFAULT_BACKUP_PATH

  console.log('====================================================================')
  console.log(`PROCEDIMIENTO DE RESTAURACIÓN SOBERANA DE FIRESTORE (${PROJECT_ID})`)
  console.log(`MODO: ${isExecuteRequested ? 'RESTAURACIÓN REAL' : 'SIMULACIÓN (DRY-RUN)'}`)
  console.log(`ARCHIVO DE RESPALDO: ${backupPath}`)
  console.log('====================================================================')

  if (!fs.existsSync(backupPath)) {
    throw new Error(`El archivo de respaldo privado no existe en: ${backupPath}`)
  }

  const inventory = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  const token = getFirebaseCliToken()

  const collectionsToRestore = ['shipments', 'cash_shifts', 'union_members', 'fixed_assets']
  let totalRestorable = 0

  for (const col of collectionsToRestore) {
    const colData = inventory[col]
    if (!colData || !Array.isArray(colData.documents)) continue

    console.log(`\nColección "${col}": ${colData.documents.length} documentos disponibles para restaurar:`)

    for (const doc of colData.documents) {
      totalRestorable++
      console.log(`  - ID: ${doc.id} (${Object.keys(doc.fields || {}).length} campos)`)

      if (isExecuteRequested) {
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}?documentId=${doc.id}`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: doc.fields })
        })

        if (res.ok) {
          console.log(`    ✓ Restaurado con éxito: ${doc.id}`)
        } else {
          console.error(`    ⚠️ Error al restaurar ${doc.id}: HTTP ${res.status}`)
        }
      }
    }
  }

  console.log('\n====================================================================')
  console.log(`Total documentos verificados para restauración: ${totalRestorable}`)
  console.log(`Acción ejecutada: ${isExecuteRequested ? 'DOCUMENTOS RESTAURADOS' : 'SIMULACIÓN (CERO ESCRITURAS)'}`)
  console.log('====================================================================')
}

restoreDocuments().catch(console.error)
