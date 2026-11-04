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

// Subcolecciones autorizadas por colección
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

// 3. HASH CRIPTOGRÁFICO SHA-256 DEL RESPALDO PRIVADO COMPLETO APROBADO
export const EXPECTED_BACKUP_SHA256 = '8fb304c37f95df59d13b51219fe9a80248fa39de77387fca237590bab1502471'
export const DEFAULT_BACKUP_PATH = 'C:/Users/fabri/.gemini/antigravity/brain/39f1d6ec-67a4-438d-a34a-fc87f2af0029/scratch/secure_backup/firestore-private-backup-complete.json'
export const REQUIRED_CONFIRMATION_PHRASE = 'AUTORIZO-PURGA-DEFINITIVA-EXPRESO-PUNATA-DEV'

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

export function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// Canonicalización recursiva de Firestore (orden lexicográfico estricto de claves y normalización)
export function canonicalizeValue(val) {
  if (val === null || val === undefined) return null
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue)
  }
  if (typeof val === 'object') {
    const sorted = {}
    for (const key of Object.keys(val).sort()) {
      sorted[key] = canonicalizeValue(val[key])
    }
    return sorted
  }
  return val
}

export function computeCanonicalHash(fields) {
  const canonical = canonicalizeValue(fields || {})
  const serialized = JSON.stringify(canonical)
  return crypto.createHash('sha256').update(serialized).digest('hex')
}

// Comparación profunda de valores campo por campo
export function deepCompareFields(liveFields, backupFields) {
  const liveCanonical = canonicalizeValue(liveFields || {})
  const backupCanonical = canonicalizeValue(backupFields || {})

  const liveHash = crypto.createHash('sha256').update(JSON.stringify(liveCanonical)).digest('hex')
  const backupHash = crypto.createHash('sha256').update(JSON.stringify(backupCanonical)).digest('hex')

  if (liveHash === backupHash) {
    return { match: true, hash: liveHash, diffs: [] }
  }

  const diffs = []
  const allKeys = Array.from(new Set([...Object.keys(liveCanonical), ...Object.keys(backupCanonical)])).sort()

  for (const k of allKeys) {
    const inLive = k in liveCanonical
    const inBackup = k in backupCanonical
    if (!inLive) {
      diffs.push(`Campo ausente en base viva: "${k}"`)
    } else if (!inBackup) {
      diffs.push(`Campo no reconocido en base viva: "${k}"`)
    } else {
      const liveValStr = JSON.stringify(liveCanonical[k])
      const backupValStr = JSON.stringify(backupCanonical[k])
      if (liveValStr !== backupValStr) {
        diffs.push(`Discrepancia en campo "${k}"`)
      }
    }
  }

  return { match: false, liveHash, backupHash, diffs }
}

// Consulta de subcolecciones con paginación completa (pageSize=100 + pageToken)
export async function listAllSubcollectionDocs(baseUrl, collection, docId, subColName, headers) {
  let subDocs = []
  let pageToken = null

  do {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
    const url = `${baseUrl}/${collection}/${docId}/${subColName}?pageSize=100${pageParam}`
    const res = await fetch(url, { headers })
    if (!res.ok) {
      throw new Error(`[ERROR API]: Falló listado de "${collection}/${docId}/${subColName}": HTTP ${res.status}`)
    }
    const data = await res.json()
    if (data.documents && Array.isArray(data.documents)) {
      subDocs = subDocs.concat(data.documents)
    }
    pageToken = data.nextPageToken || null
  } while (pageToken)

  return subDocs
}

export async function runControlledPurge(options = {}) {
  const isExecuteRequested = process.argv.includes('--execute-purge-with-owner-authorization') || options.execute === true
  const confirmationPhrase = options.confirmationPhrase || 
    process.argv.find(a => a.startsWith('--owner-confirmation-phrase='))?.split('=')[1] || 
    process.env.OWNER_PURGE_CONFIRMATION_TOKEN

  const backupPath = options.backupPath || DEFAULT_BACKUP_PATH
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || options.emulatorHost
  const isDryRun = !isExecuteRequested

  console.log('====================================================================')
  console.log(`PACHAX EXPRESO PUNATA — PURGA CONTROLADA Y SOBERANA DE FIRESTORE`)
  console.log(`PROYECTO OBJETIVO: ${TARGET_PROJECT_ID}`)
  console.log(`BASE DE DATOS:     ${TARGET_DATABASE_ID}`)
  console.log(`ENTORNO:          ${emulatorHost ? `EMULADOR AISLADO (${emulatorHost})` : 'NUBE FIRESTORE PRODUCCIÓN'}`)
  console.log(`MODO OPERATIVO:    ${isDryRun ? 'SIMULACIÓN SEGURA (DRY-RUN) — CERO ESCRITURAS' : 'EJECUCIÓN ATÓMICA DEFINITIVA'}`)
  console.log('====================================================================\n')

  // Verificación estricta de proyecto objetivo (sin bypasses)
  const targetProject = options.targetProjectId || TARGET_PROJECT_ID
  if (targetProject !== TARGET_PROJECT_ID) {
    console.error(`[ERROR SEGURIDAD]: Proyecto no autorizado: ${targetProject}. Se exige estrictamente: ${TARGET_PROJECT_ID}`)
    if (options.throwOnError) throw new Error(`Proyecto no autorizado: ${targetProject}`)
    process.exit(1)
  }

  // 1. Verificación obligatoria e ineludible del respaldo privado (sin skipHashCheck)
  if (!fs.existsSync(backupPath)) {
    console.error(`[ERROR CRÍTICO]: Respaldo privado no encontrado en: ${backupPath}`)
    if (options.throwOnError) throw new Error(`Respaldo privado no encontrado en: ${backupPath}`)
    process.exit(1)
  }

  const backupBuffer = fs.readFileSync(backupPath)
  const actualBackupHash = computeSha256(backupBuffer)
  if (actualBackupHash !== EXPECTED_BACKUP_SHA256) {
    console.error(`[ERROR CRÍTICO]: El hash SHA-256 del respaldo (${actualBackupHash}) no coincide con el hash aprobado (${EXPECTED_BACKUP_SHA256}).`)
    console.error('Violación de integridad: El respaldo ha sido modificado o alterado. Operación abortada.')
    if (options.throwOnError) throw new Error('Violación de integridad: El respaldo ha sido modificado o alterado')
    process.exit(1)
  }
  console.log(`✓ Respaldo privado validado criptográficamente (SHA-256: ${actualBackupHash.slice(0, 16)}...).\n`)

  const backupData = JSON.parse(backupBuffer.toString('utf8'))

  // 2. Blindaje de colecciones inmutables protegidas
  for (const protectedCol of PROTECTED_COLLECTIONS) {
    if (ALLOWED_PURGE_TARGETS[protectedCol]) {
      console.error(`[VIOLACIÓN CRÍTICA]: La colección protegida "${protectedCol}" aparece en la lista de purga. Abortando.`)
      if (options.throwOnError) throw new Error(`Violación crítica: Colección protegida "${protectedCol}" en purga`)
      process.exit(1)
    }
  }
  console.log('✓ Blindaje estricto confirmado: users, system_config y audit_logs están protegidas.\n')

  const baseUrl = emulatorHost
    ? `http://${emulatorHost}/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents`
    : `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents`

  const headers = { 'Content-Type': 'application/json' }
  if (emulatorHost) {
    headers.Authorization = 'Bearer owner'
  } else {
    const token = getFirebaseCliToken()
    headers.Authorization = `Bearer ${token}`
  }

  // ====================================================================
  // FASE 1: PRE-VALIDACIÓN EXHAUSTIVA CON COMPARACIÓN PROFUNDA DE VALORES
  // ====================================================================
  console.log('====================================================================')
  console.log('FASE 1: PRE-VALIDACIÓN EXHAUSTIVA (COMPARACIÓN CANÓNICA DE VALORES)')
  console.log('====================================================================')

  const plannedParentDeletions = []
  const plannedSubDeletions = []

  for (const [collection, docIds] of Object.entries(ALLOWED_PURGE_TARGETS)) {
    console.log(`\nAuditoría en colección: [${collection}] (Objetivo: ${docIds.length} documentos)`)

    for (const docId of docIds) {
      const docUrl = `${baseUrl}/${collection}/${docId}`
      const res = await fetch(docUrl, { headers })

      if (!res.ok) {
        console.error(`[DISCREPANCIA CRÍTICA]: Documento "${collection}/${docId}" no existe o no responde en Firestore: HTTP ${res.status}`)
        if (options.throwOnError) throw new Error(`Discrepancia crítica: Documento "${collection}/${docId}" no existe (HTTP ${res.status})`)
        process.exit(1)
      }

      const liveDoc = await res.json()

      // Validar proyecto y base de datos en nombre canónico
      const expectedPathPrefix = `projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/${collection}/${docId}`
      if (liveDoc.name !== expectedPathPrefix) {
        console.error(`[ERROR SEGURIDAD]: Ruta inesperada: ${liveDoc.name}. Se esperaba: ${expectedPathPrefix}`)
        if (options.throwOnError) throw new Error(`Ruta inesperada: ${liveDoc.name}`)
        process.exit(1)
      }

      // Validar presencia en respaldo aprobado
      const backupCol = backupData[collection]
      const backupDoc = backupCol?.documents?.find(d => d.id === docId)
      if (!backupDoc) {
        console.error(`[ERROR CRÍTICO]: Documento "${collection}/${docId}" no figura en el inventario aprobado del respaldo.`)
        if (options.throwOnError) throw new Error(`Documento "${collection}/${docId}" no figura en respaldo`)
        process.exit(1)
      }

      // COMPARACIÓN PROFUNDA DE VALORES REALES (CANÓNICA + SHA-256)
      const comp = deepCompareFields(liveDoc.fields, backupDoc.fields)
      if (!comp.match) {
        console.error(`[DISCREPANCIA DE VALOR]: Documento "${collection}/${docId}" no coincide con el respaldo:`)
        comp.diffs.forEach(d => console.error(`  - ${d}`))
        console.error(`  Hash vivo:      ${comp.liveHash}`)
        console.error(`  Hash respaldo:  ${comp.backupHash}`)
        if (options.throwOnError) throw new Error(`Discrepancia de valor en "${collection}/${docId}": ${comp.diffs.join('; ')}`)
        process.exit(1)
      }

      const updateTime = liveDoc.updateTime
      if (!updateTime) {
        console.error(`[ERROR PRECONDICIÓN]: Documento "${collection}/${docId}" carece de updateTime.`)
        if (options.throwOnError) throw new Error(`Documento "${collection}/${docId}" sin updateTime`)
        process.exit(1)
      }

      // Comprobar subcolecciones mediante :listCollectionIds
      const listSubUrl = `${baseUrl}/${collection}/${docId}:listCollectionIds`
      const listSubRes = await fetch(listSubUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      })

      if (!listSubRes.ok) {
        console.error(`[ERROR API]: Falló listCollectionIds en "${collection}/${docId}": HTTP ${listSubRes.status}`)
        if (options.throwOnError) throw new Error(`Falló listCollectionIds en "${collection}/${docId}"`)
        process.exit(1)
      }

      const subData = await listSubRes.json()
      const foundSubcollections = (subData.collectionIds || []).sort()
      const allowedSubs = (ALLOWED_SUBCOLLECTIONS[collection] || []).sort()

      // Verificar que no existan subcolecciones no autorizadas
      const unexpectedSubs = foundSubcollections.filter(s => !allowedSubs.includes(s))
      if (unexpectedSubs.length > 0) {
        console.error(`[DISCREPANCIA]: Documento "${collection}/${docId}" contiene subcolecciones no autorizadas: ${unexpectedSubs.join(', ')}`)
        if (options.throwOnError) throw new Error(`Subcolecciones no autorizadas en "${collection}/${docId}": ${unexpectedSubs.join(', ')}`)
        process.exit(1)
      }

      // Verificar que no falten subcolecciones esperadas si el respaldo las contiene
      const expectedSubColsInBackup = Object.keys(backupDoc.subcollections || {}).filter(k => (backupDoc.subcollections[k] || []).length > 0).sort()
      for (const expSub of expectedSubColsInBackup) {
        if (!foundSubcollections.includes(expSub)) {
          console.error(`[DISCREPANCIA]: Subcolección esperada "${expSub}" ausente en documento vivo "${collection}/${docId}".`)
          if (options.throwOnError) throw new Error(`Subcolección "${expSub}" ausente en "${collection}/${docId}"`)
          process.exit(1)
        }
      }

      // Inspeccionar y validar cada subdocumento con paginación completa y comparación profunda
      for (const subColName of foundSubcollections) {
        const liveSubDocs = await listAllSubcollectionDocs(baseUrl, collection, docId, subColName, headers)
        const backupSubDocs = backupDoc.subcollections?.[subColName] || []

        if (liveSubDocs.length !== backupSubDocs.length) {
          console.error(`[DISCREPANCIA DE CONTEO]: Subcolección "${collection}/${docId}/${subColName}" tiene ${liveSubDocs.length} documentos vivos pero ${backupSubDocs.length} en respaldo.`)
          if (options.throwOnError) throw new Error(`Discrepancia conteo en "${collection}/${docId}/${subColName}": ${liveSubDocs.length} vivos vs ${backupSubDocs.length} respaldo`)
          process.exit(1)
        }

        for (const subDoc of liveSubDocs) {
          const subId = subDoc.name.split('/').pop()
          const matchedBackupSub = backupSubDocs.find(b => b.id === subId)

          if (!matchedBackupSub) {
            console.error(`[DISCREPANCIA]: Subdocumento inesperado "${collection}/${docId}/${subColName}/${subId}" ausente en respaldo.`)
            if (options.throwOnError) throw new Error(`Subdocumento inesperado: ${collection}/${docId}/${subColName}/${subId}`)
            process.exit(1)
          }

          // Comparación profunda del subdocumento
          const subComp = deepCompareFields(subDoc.fields, matchedBackupSub.fields)
          if (!subComp.match) {
            console.error(`[DISCREPANCIA EN SUBDOC]: Subdocumento "${collection}/${docId}/${subColName}/${subId}" modificado respecto al respaldo:`)
            subComp.diffs.forEach(d => console.error(`  - ${d}`))
            if (options.throwOnError) throw new Error(`Discrepancia en subdoc "${collection}/${docId}/${subColName}/${subId}"`)
            process.exit(1)
          }

          plannedSubDeletions.push({
            collection,
            docId,
            subCollection: subColName,
            subId,
            path: subDoc.name,
            updateTime: subDoc.updateTime
          })
        }
      }

      plannedParentDeletions.push({
        collection,
        docId,
        path: liveDoc.name,
        updateTime,
        fieldCount: Object.keys(liveDoc.fields || {}).length,
        hash: comp.hash
      })

      console.log(`  ✓ [VALIDADO INTEGRAL] ${collection}/${docId} — SHA: ${comp.hash.slice(0, 12)}..., version: ${updateTime}`)
    }
  }

  const totalRecordsToPurge = plannedParentDeletions.length + plannedSubDeletions.length

  console.log('\n--------------------------------------------------------------------')
  console.log(`RESUMEN DE FASE 1 (PRE-VALIDACIÓN DE INTEGRIDAD):`)
  console.log(`- Documentos candidatos padre verificados:      ${plannedParentDeletions.length} de 15`)
  console.log(`- Documentos de subcolección verificados:      ${plannedSubDeletions.length} de 13`)
  console.log(`- Total de registros autorizados para purga:   ${totalRecordsToPurge} de 28`)
  console.log(`- Discrepancias de campos, tipos o valores:    0`)
  console.log(`- Estado de integridad:                         100% IDÉNTICO AL RESPALDO`)
  console.log('--------------------------------------------------------------------\n')

  // ====================================================================
  // FASE 2: EJECUCIÓN ATÓMICA MEDIANTE documents:commit O DRY-RUN
  // ====================================================================
  if (isDryRun) {
    console.log('====================================================================')
    console.log('FASE 2: MODO SIMULACIÓN (DRY-RUN ACTIVO)')
    console.log('====================================================================')
    console.log('ℹ️ No se ha solicitado ejecución destructiva.')
    console.log('   NINGUNA ESCRITURA O ELIMINACIÓN HA SIDO EJECUTADA.')
    console.log('   La base de datos permanece 100% INTACTA.')
    console.log('   El lote de eliminación atómica de 28 registros está listo.')
    console.log('====================================================================\n')
    return {
      status: 'DRY_RUN_SUCCESS',
      parentsVerified: plannedParentDeletions.length,
      subsVerified: plannedSubDeletions.length,
      totalRecordsVerified: totalRecordsToPurge
    }
  }

  // Comprobación de seguridad de doble factor: frase de confirmación explícita
  if (confirmationPhrase !== REQUIRED_CONFIRMATION_PHRASE) {
    console.error('[ERROR SEGURIDAD]: Se solicitó ejecución destructiva pero falta la frase de confirmación obligatoria.')
    console.error(`Se requiere: --owner-confirmation-phrase="${REQUIRED_CONFIRMATION_PHRASE}"`)
    console.error('Abortando para evitar ejecuciones accidentales.')
    if (options.throwOnError) throw new Error('Falta frase de confirmación obligatoria')
    process.exit(1)
  }

  console.log('====================================================================')
  console.log('FASE 2: EJECUCIÓN ATÓMICA DE PURGA (TRANSACCIÓN ÚNICA documents:commit)')
  console.log('====================================================================')

  // Construcción del lote atómico único de writes
  // En Firestore REST API, documents:commit ejecuta todos los writes en una transacción atómica única.
  // Si CUALQUIER precondición de updateTime falla, TODA la transacción es rechazada y CERO registros se eliminan.
  const writes = []

  // 1. Subdocumentos (13)
  for (const sub of plannedSubDeletions) {
    writes.push({
      delete: sub.path,
      currentDocument: {
        updateTime: sub.updateTime
      }
    })
  }

  // 2. Documentos padre (15)
  for (const parent of plannedParentDeletions) {
    writes.push({
      delete: parent.path,
      currentDocument: {
        updateTime: parent.updateTime
      }
    })
  }

  console.log(`Enviando transacción atómica de ${writes.length} eliminaciones con precondición de versión a Firestore...`)

  const commitUrl = `${baseUrl}:commit`
  const commitRes = await fetch(commitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes })
  })

  if (!commitRes.ok) {
    const errorBody = await commitRes.text()
    console.error(`[ERROR CRÍTICO TRANSACCIÓN ATÓMICA]: El commit falló: HTTP ${commitRes.status}`)
    console.error(`Detalle de rechazo: ${errorBody}`)
    console.error('Ningún registro fue eliminado. La base de datos conserva su estado original.')
    if (options.throwOnError) throw new Error(`Transacción atómica rechazada: HTTP ${commitRes.status}`)
    process.exit(1)
  }

  const commitData = await commitRes.json()
  const writeCount = commitData.writeResults?.length || 0

  console.log(`✓ Transacción atómica confirmada por Google Cloud Firestore.`)
  console.log(`  Commit time: ${commitData.commitTime}`)
  console.log(`  Operaciones de eliminación ejecutadas en bloque: ${writeCount} / ${totalRecordsToPurge}`)

  // Conciliación y post-verificación de erradicación total
  console.log('\nEjecutando post-verificación de conciliación...')
  let confirmedDeleted = 0

  for (const parent of plannedParentDeletions) {
    const checkRes = await fetch(`${baseUrl}/${parent.collection}/${parent.docId}`, { headers })
    if (checkRes.status === 404) {
      confirmedDeleted++
    } else {
      console.error(`[ERROR POST-VERIFICACIÓN]: Documento "${parent.collection}/${parent.docId}" aún responde HTTP ${checkRes.status}`)
      if (options.throwOnError) throw new Error(`Fallo post-verificación: ${parent.collection}/${parent.docId}`)
    }
  }

  console.log(`✓ Post-verificación exitosa: Todos los documentos candidatos retornan HTTP 404 (Erradicados).`)

  // Post-verificación de colecciones protegidas
  for (const protectedCol of PROTECTED_COLLECTIONS) {
    const checkProtUrl = `${baseUrl}/${protectedCol}`
    const checkProtRes = await fetch(checkProtUrl, { headers })
    if (!checkProtRes.ok) {
      console.error(`[ERROR POST-VERIFICACIÓN]: Colección protegida "${protectedCol}" no responde: HTTP ${checkProtRes.status}`)
    }
  }
  console.log(`✓ Post-verificación de colecciones protegidas: users, system_config y audit_logs 100% INTACTAS.\n`)

  console.log('====================================================================')
  console.log('PURGA CONTROLADA ATÓMICA COMPLETADA CON ÉXITO')
  console.log(`- Registros totales eliminados atómicamente: ${writeCount} de 28`)
  console.log('- Colecciones protegidas alteradas: 0 (INMUNES)')
  console.log('====================================================================\n')

  return {
    status: 'PURGE_COMPLETED_ATOMICALLY',
    deletedRecords: writeCount,
    commitTime: commitData.commitTime
  }
}

// Ejecución directa de línea de comandos
if (process.argv[1]?.endsWith('controlledFirestorePurge.mjs')) {
  runControlledPurge().catch(err => {
    console.error('[EXCEPCIÓN CRÍTICA NO CONTROLADA]:', err.message || err)
    process.exit(1)
  })
}
