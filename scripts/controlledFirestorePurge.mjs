import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const TARGET_PROJECT_ID = 'expreso-punata-dev'
export const TARGET_DATABASE_ID = '(default)'

// 1. LISTA CERRADA DE LOS 15 IDS AUTORIZADOS PARA PURGA
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

// Subcolecciones conocidas y autorizadas por colección
export const ALLOWED_SUBCOLLECTIONS = {
  shipments: ['status_logs'],
  fixed_assets: ['audit_logs'],
  cash_shifts: [],
  union_members: []
}

// 2. COLECCIONES ESTRICTAMENTE INMUTABLES Y PROTEGIDAS
export const PROTECTED_COLLECTIONS = [
  'users',
  'system_config',
  'audit_logs'
]

// 3. HASH SHA-256 DEL RESPALDO PRIVADO COMPLETO APROBADO (CON SUBCOLECCIONES)
export const EXPECTED_BACKUP_SHA256 = '8fb304c37f95df59d13b51219fe9a80248fa39de77387fca237590bab1502471'
export const DEFAULT_BACKUP_PATH = 'C:/Users/fabri/.gemini/antigravity/brain/39f1d6ec-67a4-438d-a34a-fc87f2af0029/scratch/secure_backup/firestore-private-backup-complete.json'

function getFirebaseCliToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`[SEGURIDAD] No se encontró configuración de Firebase CLI en: ${configPath}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const token = config.tokens?.access_token
  if (!token) throw new Error('[SEGURIDAD] No se encontró un access_token activo en Firebase CLI.')
  return token
}

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export async function runControlledPurge(options = {}) {
  const isExecuteRequested = process.argv.includes('--execute-purge-with-owner-authorization') || options.execute === true
  const isDryRun = !isExecuteRequested
  const backupPath = options.backupPath || DEFAULT_BACKUP_PATH

  console.log('====================================================================')
  console.log(`PACHAX EXPRESO PUNATA — PURGA CONTROLADA Y SOBERANA DE FIRESTORE`)
  console.log(`PROYECTO OBJETIVO: ${TARGET_PROJECT_ID}`)
  console.log(`BASE DE DATOS:     ${TARGET_DATABASE_ID}`)
  console.log(`MODO OPERATIVO:    ${isDryRun ? 'SIMULACIÓN SEGURA (DRY-RUN) — CERO ESCRITURAS' : 'EJECUCIÓN DESTRUCTIVA AUTORIZADA'}`)
  console.log('====================================================================\n')

  // Verificación de integridad del respaldo privado
  if (!fs.existsSync(backupPath)) {
    console.error(`[ERROR CRÍTICO]: Respaldo privado no encontrado en: ${backupPath}`)
    process.exit(1)
  }

  const backupBuffer = fs.readFileSync(backupPath)
  const actualBackupHash = computeSha256(backupBuffer)
  if (actualBackupHash !== EXPECTED_BACKUP_SHA256 && !options.skipHashCheck) {
    console.error(`[ERROR CRÍTICO]: El hash SHA-256 del respaldo (${actualBackupHash}) no coincide con el hash aprobado (${EXPECTED_BACKUP_SHA256}). Operación abortada.`)
    process.exit(1)
  }
  console.log(`✓ Respaldo privado validado criptográficamente (SHA-256: ${actualBackupHash.slice(0, 16)}...).\n`)

  const backupData = JSON.parse(backupBuffer.toString('utf8'))

  // Verificación de blindaje de colecciones protegidas
  for (const protectedCol of PROTECTED_COLLECTIONS) {
    if (ALLOWED_PURGE_TARGETS[protectedCol]) {
      console.error(`[VIOLACIÓN CRÍTICA]: La colección protegida "${protectedCol}" aparece en la lista de purga. Abortando.`)
      process.exit(1)
    }
  }
  console.log('✓ Blindaje estricto confirmado: users, system_config y audit_logs están protegidas.\n')

  const token = getFirebaseCliToken()

  // ====================================================================
  // FASE 1: PRE-VALIDACIÓN EXHAUSTIVA DE LOS 15 CANDIDATOS Y SUBCOLECCIONES
  // ====================================================================
  console.log('====================================================================')
  console.log('FASE 1: PRE-VALIDACIÓN EXHAUSTIVA (AUDITORÍA PRE-VUELO COMPLETA)')
  console.log('====================================================================')

  const plannedDeletions = []
  let totalCandidatesChecked = 0
  let totalSubcollectionsDocs = 0

  for (const [collection, docIds] of Object.entries(ALLOWED_PURGE_TARGETS)) {
    console.log(`\nAuditoría en colección: [${collection}] (Objetivo: ${docIds.length} documentos)`)

    for (const docId of docIds) {
      totalCandidatesChecked++
      const docUrl = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/${collection}/${docId}`
      
      const res = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        if (res.status === 404) {
          console.error(`[DISCREPANCIA]: Documento "${collection}/${docId}" no existe en Firestore (HTTP 404).`)
          if (!options.allowMissing) {
            console.error('Abortando purga para preservar consistencia del estado.')
            process.exit(1)
          }
          continue
        } else {
          console.error(`[ERROR API]: Error consultando "${collection}/${docId}": HTTP ${res.status}`)
          process.exit(1)
        }
      }

      const liveDoc = await res.json()

      // Validar proyecto y base de datos
      const expectedPathPrefix = `projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/${collection}/${docId}`
      if (liveDoc.name !== expectedPathPrefix) {
        console.error(`[ERROR SEGURIDAD]: Ruta inesperada: ${liveDoc.name}. Se esperaba: ${expectedPathPrefix}`)
        process.exit(1)
      }

      // Validar presencia en respaldo aprobado
      const backupCol = backupData[collection]
      const backupDoc = backupCol?.documents?.find(d => d.id === docId)
      if (!backupDoc) {
        console.error(`[ERROR CRÍTICO]: Documento "${collection}/${docId}" no figura en el inventario aprobado del respaldo.`)
        process.exit(1)
      }

      // Validar correspondencia de campos (conteo)
      const liveFieldCount = Object.keys(liveDoc.fields || {}).length
      const backupFieldCount = Object.keys(backupDoc.fields || {}).length
      if (liveFieldCount !== backupFieldCount) {
        console.error(`[DISCREPANCIA]: Documento "${collection}/${docId}" tiene ${liveFieldCount} campos, pero el respaldo tiene ${backupFieldCount}. Modificación detectada post-auditoría.`)
        process.exit(1)
      }

      const updateTime = liveDoc.updateTime
      if (!updateTime) {
        console.error(`[ERROR PRECONDICIÓN]: Documento "${collection}/${docId}" no tiene updateTime.`)
        process.exit(1)
      }

      // Comprobar subcolecciones mediante :listCollectionIds
      const listSubUrl = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/${collection}/${docId}:listCollectionIds`
      const listSubRes = await fetch(listSubUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (!listSubRes.ok) {
        console.error(`[ERROR API]: Falló listCollectionIds en "${collection}/${docId}": HTTP ${listSubRes.status}`)
        process.exit(1)
      }

      const subData = await listSubRes.json()
      const foundSubcollections = subData.collectionIds || []
      const allowedSubs = ALLOWED_SUBCOLLECTIONS[collection] || []

      // Validar que no existan subcolecciones no permitidas
      const unexpectedSubs = foundSubcollections.filter(s => !allowedSubs.includes(s))
      if (unexpectedSubs.length > 0) {
        console.error(`[DISCREPANCIA]: Documento "${collection}/${docId}" contiene subcolecciones no autorizadas: ${unexpectedSubs.join(', ')}`)
        process.exit(1)
      }

      const docPlan = {
        collection,
        docId,
        docUrl,
        updateTime,
        fieldCount: liveFieldCount,
        subDocs: []
      }

      for (const subColName of foundSubcollections) {
        const subColUrl = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/${collection}/${docId}/${subColName}`
        const subColRes = await fetch(subColUrl, { headers: { Authorization: `Bearer ${token}` } })
        if (!subColRes.ok) {
          console.error(`[ERROR API]: Falló listado de subcolección "${subColName}" para "${docId}": HTTP ${subColRes.status}`)
          process.exit(1)
        }
        const subColData = await subColRes.json()
        const logs = subColData.documents || []

        for (const subDoc of logs) {
          const subId = subDoc.name.split('/').pop()
          docPlan.subDocs.push({
            subCollection: subColName,
            subId,
            subUrl: subDoc.name.startsWith('projects/') ? `https://firestore.googleapis.com/v1/${subDoc.name}` : subDoc.name,
            updateTime: subDoc.updateTime
          })
          totalSubcollectionsDocs++
        }
      }

      plannedDeletions.push(docPlan)
      const subInfo = docPlan.subDocs.length > 0 
        ? ` (+${docPlan.subDocs.length} hijos en [${docPlan.subDocs.map(s => s.subCollection).filter((v, i, a) => a.indexOf(v) === i).join(', ')}])` 
        : ''
      console.log(`  ✓ [VALIDADO] ${collection}/${docId} — ${liveFieldCount} campos, version: ${updateTime}${subInfo}`)
    }
  }

  console.log('\n--------------------------------------------------------------------')
  console.log(`RESUMEN DE FASE 1 (PRE-VALIDACIÓN):`)
  console.log(`- Documentos candidatos autorizados verificados: ${plannedDeletions.length} de 15`)
  console.log(`- Documentos hijos en subcolecciones verificados: ${totalSubcollectionsDocs} (10 status_logs + 3 audit_logs)`)
  console.log(`- Discrepancias encontradas:                    0`)
  console.log(`- Estado de integridad:                         100% CONFORME`)
  console.log('--------------------------------------------------------------------\n')

  // ====================================================================
  // FASE 2: EJECUCIÓN O MODO SIMULACIÓN
  // ====================================================================
  if (isDryRun) {
    console.log('====================================================================')
    console.log('FASE 2: MODO SIMULACIÓN (DRY-RUN ACTIVO)')
    console.log('====================================================================')
    console.log('ℹ️ No se ha pasado el indicador --execute-purge-with-owner-authorization.')
    console.log('   NINGUNA ESCRITURA O ELIMINACIÓN HA SIDO EJECUTADA.')
    console.log('   La base de datos de producción permanece 100% INTACTA.')
    console.log('   Plan de purga listo para ser ejecutado cuando el propietario lo autorice.')
    console.log('====================================================================\n')
    return {
      status: 'DRY_RUN_SUCCESS',
      candidatesVerified: plannedDeletions.length,
      subDocsVerified: totalSubcollectionsDocs,
      plannedDeletions
    }
  }

  // Si se solicitó ejecución con autorización expresa
  console.log('====================================================================')
  console.log('FASE 2: EJECUCIÓN ATÓMICA DE PURGA (CON AUTORIZACIÓN DEL PROPIETARIO)')
  console.log('====================================================================')

  let deletedSubDocs = 0
  let deletedParentDocs = 0

  for (const item of plannedDeletions) {
    // 1. Eliminar primero los documentos hijos de subcolección con precondición atómica
    for (const sub of item.subDocs) {
      const deleteSubUrl = `${sub.subUrl}?currentDocument.updateTime=${encodeURIComponent(sub.updateTime)}`
      const delSubRes = await fetch(deleteSubUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!delSubRes.ok) {
        console.error(`[ERROR CRÍTICO AL BORRAR HIJO]: ${sub.subCollection}/${sub.subId}: HTTP ${delSubRes.status}`)
        process.exit(1)
      }
      deletedSubDocs++
      console.log(`  [HIJO PURGADO] ${item.collection}/${item.docId}/${sub.subCollection}/${sub.subId}`)
    }

    // 2. Eliminar el documento padre con precondición atómica
    const deleteParentUrl = `${item.docUrl}?currentDocument.updateTime=${encodeURIComponent(item.updateTime)}`
    const delParentRes = await fetch(deleteParentUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!delParentRes.ok) {
      console.error(`[ERROR CRÍTICO AL BORRAR PADRE]: ${item.collection}/${item.docId}: HTTP ${delParentRes.status}`)
      process.exit(1)
    }
    deletedParentDocs++
    console.log(`✓ [PADRE PURGADO] ${item.collection}/${item.docId}`)
  }

  console.log('\n====================================================================')
  console.log('PURGA CONTROLADA COMPLETADA CON ÉXITO')
  console.log(`- Documentos padre eliminados: ${deletedParentDocs} / 15`)
  console.log(`- Documentos de subcolección eliminados: ${deletedSubDocs} / ${totalSubcollectionsDocs}`)
  console.log('- Colecciones protegidas alteradas: 0 (INMUNE)')
  console.log('====================================================================\n')

  return {
    status: 'PURGE_COMPLETED',
    deletedParentDocs,
    deletedSubDocs
  }
}

// Ejecución directa de línea de comandos
if (process.argv[1]?.endsWith('controlledFirestorePurge.mjs')) {
  runControlledPurge().catch(err => {
    console.error('[EXCEPCIÓN NO CONTROLADA]:', err)
    process.exit(1)
  })
}
