import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { canonicalizeValue, computeCanonicalHash, deepCompareFields } from './controlledFirestorePurge.mjs'

export const TARGET_PROJECT_ID = 'expreso-punata-dev'
export const TARGET_DATABASE_ID = '(default)'
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

export function validateBackupSchema(inventory) {
  const requiredCollections = ['shipments', 'cash_shifts', 'union_members', 'fixed_assets']
  for (const col of requiredCollections) {
    if (!inventory[col] || !Array.isArray(inventory[col].documents)) {
      throw new Error(`[SCHEMA_ERROR]: Falta la colección requerida o array "documents" en "${col}".`)
    }
    for (const doc of inventory[col].documents) {
      if (!doc.id || typeof doc.id !== 'string') {
        throw new Error(`[SCHEMA_ERROR]: Documento sin ID válido en colección "${col}".`)
      }
      if (!doc.fields || typeof doc.fields !== 'object') {
        throw new Error(`[SCHEMA_ERROR]: Documento "${doc.id}" sin objeto "fields" en colección "${col}".`)
      }
      if (doc.subcollections && typeof doc.subcollections === 'object') {
        for (const [subName, subList] of Object.entries(doc.subcollections)) {
          if (!Array.isArray(subList)) {
            throw new Error(`[SCHEMA_ERROR]: Subcolección "${subName}" en "${doc.id}" debe ser un array.`)
          }
          for (const subDoc of subList) {
            if (!subDoc.id || !subDoc.fields) {
              throw new Error(`[SCHEMA_ERROR]: Subdocumento inválido en "${col}/${doc.id}/${subName}".`)
            }
          }
        }
      }
    }
  }
  return true
}

export async function restoreDocuments(options = {}) {
  const isExecuteRequested = process.argv.includes('--execute-restore') || options.execute === true
  const forceOverwrite = process.argv.includes('--force-overwrite') || options.forceOverwrite === true
  const backupPath = options.backupPath || process.argv.find(a => a.startsWith('--backup='))?.split('=')[1] || DEFAULT_BACKUP_PATH
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || options.emulatorHost

  console.log('====================================================================')
  console.log(`PACHAX EXPRESO PUNATA — RESTAURACIÓN SOBERANA DE FIRESTORE`)
  console.log(`PROYECTO OBJETIVO: ${TARGET_PROJECT_ID}`)
  console.log(`MODO:             ${isExecuteRequested ? 'RESTAURACIÓN REAL (ESCRITURA)' : 'SIMULACIÓN (DRY-RUN)'}`)
  console.log(`ENTORNO:          ${emulatorHost ? `EMULADOR AISLADO (${emulatorHost})` : 'NUBE FIRESTORE PRODUCCIÓN'}`)
  console.log(`ARCHIVO RESPALDO: ${backupPath}`)
  console.log(`SOBREESCRITURA:   ${forceOverwrite ? 'PERMITIDA (--force-overwrite)' : 'PROTEGIDA (RECHAZA COLISIÓN)'}`)
  console.log('====================================================================\n')

  // Validación estricta del proyecto
  const targetProject = options.targetProjectId || TARGET_PROJECT_ID
  if (targetProject !== TARGET_PROJECT_ID) {
    throw new Error(`[ERROR SEGURIDAD]: Proyecto objetivo ${targetProject} no coincide con el autorizado ${TARGET_PROJECT_ID}`)
  }

  // 1. Verificación obligatoria de integridad criptográfica (sin excepciones)
  if (!fs.existsSync(backupPath)) {
    throw new Error(`[ERROR CRÍTICO]: El archivo de respaldo privado no existe en: ${backupPath}`)
  }

  const backupBuffer = fs.readFileSync(backupPath)
  const actualHash = computeSha256(backupBuffer)
  if (actualHash !== EXPECTED_BACKUP_SHA256) {
    throw new Error(`[INTEGRIDAD FALLIDA]: Hash SHA-256 no coincide.\nEsperado: ${EXPECTED_BACKUP_SHA256}\nObtenido: ${actualHash}`)
  }
  console.log(`✓ Hash SHA-256 verificado con éxito (${actualHash.slice(0, 16)}...)\n`)

  const inventory = JSON.parse(backupBuffer.toString('utf8'))
  validateBackupSchema(inventory)
  console.log('✓ Esquema del respaldo validado correctamente.\n')

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

  const collectionsToRestore = ['shipments', 'cash_shifts', 'union_members', 'fixed_assets']
  let totalCandidatesRestorable = 0
  let totalSubdocsRestorable = 0
  let totalRestoredParents = 0
  let totalRestoredSubs = 0
  const successfullyRestoredRecords = []

  for (const col of collectionsToRestore) {
    const colData = inventory[col]
    if (!colData || !Array.isArray(colData.documents)) continue

    console.log(`--- Procesando colección "${col}" (${colData.documents.length} documentos) ---`)

    for (const doc of colData.documents) {
      totalCandidatesRestorable++
      const docUrl = `${baseUrl}/${col}/${doc.id}`

      // Comprobar existencia en destino
      const checkRes = await fetch(docUrl, { headers })
      if (!checkRes.ok && checkRes.status !== 404) {
        throw new Error(`[ERROR HTTP INESPERADO]: Consulta "${col}/${doc.id}" retornó HTTP ${checkRes.status}`)
      }
      const docExists = checkRes.status === 200

      if (docExists && !forceOverwrite) {
        console.log(`  ⚠️ [EXISTE_PROTEGIDO] Documento "${col}/${doc.id}" ya existe. Omitiendo para evitar sobreescritura accidental.`)
      } else {
        console.log(`  ✓ [CANDIDATO_LISTO] "${col}/${doc.id}" (${Object.keys(doc.fields || {}).length} campos)`)

        if (isExecuteRequested) {
          const writeRes = await fetch(docUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ fields: doc.fields })
          })

          if (!writeRes.ok) {
            throw new Error(`[ERROR HTTP RESTAURACIÓN] Falló escritura de "${col}/${doc.id}": HTTP ${writeRes.status}`)
          }
          totalRestoredParents++
          successfullyRestoredRecords.push({ type: 'parent', col, id: doc.id, fields: doc.fields })
          console.log(`    -> [ESCRITO] Documento padre "${doc.id}" restaurado exitosamente.`)
        }
      }

      // Procesar subcolecciones (13 subdocumentos)
      if (doc.subcollections) {
        for (const [subColName, subList] of Object.entries(doc.subcollections)) {
          for (const subDoc of subList) {
            totalSubdocsRestorable++
            const subUrl = `${baseUrl}/${col}/${doc.id}/${subColName}/${subDoc.id}`

            const checkSubRes = await fetch(subUrl, { headers })
            if (!checkSubRes.ok && checkSubRes.status !== 404) {
              throw new Error(`[ERROR HTTP INESPERADO]: Consulta "${col}/${doc.id}/${subColName}/${subDoc.id}" retornó HTTP ${checkSubRes.status}`)
            }
            const subExists = checkSubRes.status === 200

            if (subExists && !forceOverwrite) {
              console.log(`    ⚠️ [SUBDOC_EXISTE] "${col}/${doc.id}/${subColName}/${subDoc.id}" ya existe. Omitiendo.`)
            } else {
              console.log(`    ✓ [SUBDOC_LISTO] "${col}/${doc.id}/${subColName}/${subDoc.id}"`)

              if (isExecuteRequested) {
                const writeSubRes = await fetch(subUrl, {
                  method: 'PATCH',
                  headers,
                  body: JSON.stringify({ fields: subDoc.fields })
                })

                if (!writeSubRes.ok) {
                  throw new Error(`[ERROR HTTP RESTAURACIÓN SUBDOC] Falló escritura de "${subUrl}": HTTP ${writeSubRes.status}`)
                }
                totalRestoredSubs++
                successfullyRestoredRecords.push({ type: 'subdoc', col, parentId: doc.id, subCol: subColName, id: subDoc.id, fields: subDoc.fields })
                console.log(`      -> [ESCRITO] Subdocumento "${subDoc.id}" restaurado.`)
              }
            }
          }
        }
      }
    }
    console.log('')
  }

  // ====================================================================
  // POST-VERIFICACIÓN EXHAUSTIVA DE TODA LA ESCRITURA REALIZADA
  // ====================================================================
  if (isExecuteRequested && successfullyRestoredRecords.length > 0) {
    console.log('====================================================================')
    console.log('POST-VERIFICACIÓN DE RESTAURACIÓN (COMPARACIÓN CANÓNICA CAMPO POR CAMPO)')
    console.log('====================================================================')

    for (const rec of successfullyRestoredRecords) {
      const readUrl = rec.type === 'parent'
        ? `${baseUrl}/${rec.col}/${rec.id}`
        : `${baseUrl}/${rec.col}/${rec.parentId}/${rec.subCol}/${rec.id}`

      const readRes = await fetch(readUrl, { headers })
      if (!readRes.ok) {
        throw new Error(`[FALLO POST-VERIFICACIÓN]: Registro restaurado no accesible: HTTP ${readRes.status} en ${readUrl}`)
      }

      const liveData = await readRes.json()
      const comp = deepCompareFields(liveData.fields, rec.fields)
      if (!comp.match) {
        throw new Error(`[DISCREPANCIA EN RESTAURACIÓN]: Registro ${rec.id} no coincide con el respaldo:\n${comp.diffs.join('\n')}`)
      }
    }
    console.log(`✓ Verificación completada: ${successfullyRestoredRecords.length} registros verificados con 100% de coincidencia canónica.\n`)
  }

  console.log('====================================================================')
  console.log('RESUMEN DE PROCESO DE RESTAURACIÓN:')
  console.log(`- Documentos candidatos evaluados: ${totalCandidatesRestorable}`)
  console.log(`- Subdocumentos evaluados:         ${totalSubdocsRestorable}`)
  console.log(`- Total de registros evaluados:    ${totalCandidatesRestorable + totalSubdocsRestorable} de 28`)
  console.log(`- Documentos padres restaurados:   ${totalRestoredParents}`)
  console.log(`- Subdocumentos restaurados:       ${totalRestoredSubs}`)
  console.log(`- Estado:                          ${isExecuteRequested ? 'RESTAURACIÓN FINALIZADA Y VERIFICADA' : 'SIMULACIÓN COMPLETADA (DRY-RUN)'}`)
  console.log('====================================================================\n')

  return {
    totalCandidatesRestorable,
    totalSubdocsRestorable,
    totalRestoredParents,
    totalRestoredSubs,
    totalRestored: totalRestoredParents + totalRestoredSubs
  }
}

// Ejecución directa
if (process.argv[1]?.endsWith('restoreFromPrivateBackup.mjs')) {
  restoreDocuments().catch(err => {
    console.error('[EXCEPCIÓN CRÍTICA EN RESTAURACIÓN]:', err.message || err)
    process.exit(1)
  })
}
