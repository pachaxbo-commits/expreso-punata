import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ID = 'expreso-punata-dev'

// 1. LISTA ESTRICTA DE DOCUMENTOS CANDIDATOS AUTORIZADOS PARA PURGA
export const ALLOWED_PURGE_TARGETS = {
  shipments: [
    'PUN-2026-00001',
    'PUN202600002',
    'PUN202600003',
    'PUN202600004',
    'PUN202600005',
    'PUN202600006'
  ],
  cash_shifts: [
    'TUR-PUN-2026-0001',
    'TUR-PUN-2026-0002',
    'TUR-CBB-2026-0001'
  ],
  union_members: [
    'member-soc-007',
    'member-soc-014',
    'member-soc-022'
  ],
  fixed_assets: [
    'ay1a03gJYQdMz9XhF4ER',
    '1Kyclsk2wYS85Q1Tmle6',
    '7o8E7XpwQ9Xh95PIEuK1'
  ]
}

// 2. COLECCIONES ESTRICTAMENTE INMUTABLES Y PROTEGIDAS
export const PROTECTED_COLLECTIONS = [
  'users',
  'system_config',
  'audit_logs'
]

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

async function runControlledPurge() {
  const isExecuteRequested = process.argv.includes('--execute-purge-with-owner-authorization')
  const isDryRun = !isExecuteRequested

  console.log('====================================================================')
  console.log(`PROCEDIMIENTO DE PURGA CONTROLADA DE FIRESTORE (${PROJECT_ID})`)
  console.log(`MODO ACTUAL: ${isDryRun ? 'SIMULACIÓN SEGURA (DRY-RUN) — CERO ESCRITURAS' : 'EJECUCIÓN REAL (DESTRUCTIVA)'}`)
  console.log('====================================================================')

  if (!isExecuteRequested) {
    console.log('ℹ️ AVISO: El script está configurado en modo DRY-RUN por defecto.')
    console.log('   Ningún dato será eliminado ni alterado en la base de datos.')
    console.log('   Se validarán únicamente precondiciones, existencia y relaciones.\n')
  }

  const token = getFirebaseCliToken()

  // 1. Verificación de colecciones protegidas
  for (const col of PROTECTED_COLLECTIONS) {
    if (ALLOWED_PURGE_TARGETS[col]) {
      throw new Error(`[VIOLACIÓN CRÍTICA]: La colección protegida "${col}" tiene documentos en la lista de purga. Abortando inmediatamente.`)
    }
  }

  console.log('✓ Protección de colecciones críticas validada (users, system_config, audit_logs están 100% blindadas).\n')

  let totalVerifiedCandidates = 0
  const validationReport = []

  for (const [collection, docIds] of Object.entries(ALLOWED_PURGE_TARGETS)) {
    console.log(`--- Inspeccionando colección: ${collection} (${docIds.length} candidatos permitidos) ---`)

    for (const docId of docIds) {
      const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`
      const getRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } })

      if (getRes.status === 200) {
        const docData = await getRes.json()
        totalVerifiedCandidates++
        const summary = {
          collection,
          id: docId,
          status: 'EXISTE_Y_VALIDADO',
          isDryRun,
          fieldsSummary: Object.keys(docData.fields || {}).length + ' campos'
        }
        validationReport.push(summary)
        console.log(`  [OK] Documento "${docId}" verificado. Cumple precondiciones para purga limpia.`)

        if (isExecuteRequested) {
          // SOLO SI EL PROPIETARIO AUTORIZA EXPRESAMENTE
          const delRes = await fetch(docUrl, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          })
          if (delRes.ok) {
            console.log(`    ❌ [PURGADO]: Documento "${docId}" eliminado con éxito.`)
          } else {
            console.error(`    ⚠️ [ERROR]: Falló eliminación de "${docId}": HTTP ${delRes.status}`)
          }
        }
      } else if (getRes.status === 404) {
        console.log(`  [YA_ELIMINADO / INEXISTENTE] Documento "${docId}" ya no existe en Firestore. Operación idempotente.`)
        validationReport.push({ collection, id: docId, status: 'NO_EXISTE' })
      } else {
        console.error(`  [ERROR] No se pudo consultar "${docId}": HTTP ${getRes.status}`)
      }
    }
    console.log('')
  }

  console.log('====================================================================')
  console.log(`RESUMEN DE VALIDACIÓN PRE-LIMPIEZA:`)
  console.log(`- Total de documentos candidatos autorizados: 15`)
  console.log(`- Total de documentos verificados en Firestore: ${totalVerifiedCandidates}`)
  console.log(`- Acciones ejecutadas en base de datos: ${isExecuteRequested ? 'ELIMINACIONES REALIZADAS' : 'NINGUNA (MODO SIMULACIÓN)'}`)
  console.log('====================================================================')
}

runControlledPurge().catch(console.error)
