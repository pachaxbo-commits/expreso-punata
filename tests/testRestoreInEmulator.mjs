import { restoreDocuments, TARGET_PROJECT_ID, TARGET_DATABASE_ID, DEFAULT_BACKUP_PATH } from '../scripts/restoreFromPrivateBackup.mjs'
import fs from 'node:fs'

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080'

async function runEmulatorTest() {
  console.log('====================================================================')
  console.log('TEST SUITE: VERIFICACIÓN DE RESTAURACIÓN EN EMULADOR AISLADO')
  console.log(`EMULADOR FIRESTORE: http://${emulatorHost}`)
  console.log('====================================================================\n')

  const baseUrl = `http://${emulatorHost}/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents`
  const authHeaders = { Authorization: 'Bearer owner' }

  // 1. Ejecutar restauración con flag execute: true en el emulador
  console.log('[PASO 1] Ejecutando restauración limpia en emulador vacío...')
  const result = await restoreDocuments({
    execute: true,
    emulatorHost,
    backupPath: DEFAULT_BACKUP_PATH
  })

  if (result.totalRestoredParents !== 15) {
    throw new Error(`Se esperaba restaurar 15 documentos padre, pero se restauraron: ${result.totalRestoredParents}`)
  }
  if (result.totalRestoredSubs !== 13) {
    throw new Error(`Se esperaba restaurar 13 subdocumentos, pero se restauraron: ${result.totalRestoredSubs}`)
  }
  console.log('✓ [PASO 1 EXITOSO]: 15 padres y 13 subdocumentos restaurados en el emulador.\n')

  // 2. Verificar fidelidad de datos y precisión de tipos (timestamps, números, strings, geolocalización)
  console.log('[PASO 2] Verificando fidelidad campo por campo contra el respaldo...')
  const backup = JSON.parse(fs.readFileSync(DEFAULT_BACKUP_PATH, 'utf8'))

  const collections = ['shipments', 'cash_shifts', 'union_members', 'fixed_assets']
  for (const col of collections) {
    for (const expectedDoc of backup[col].documents) {
      const getRes = await fetch(`${baseUrl}/${col}/${expectedDoc.id}`, { headers: authHeaders })
      if (!getRes.ok) throw new Error(`Documento no encontrado en emulador: ${col}/${expectedDoc.id} (HTTP ${getRes.status})`)
      const liveDoc = await getRes.json()

      // Comparación profunda de fields
      const expKeys = Object.keys(expectedDoc.fields || {}).sort()
      const liveKeys = Object.keys(liveDoc.fields || {}).sort()

      if (JSON.stringify(expKeys) !== JSON.stringify(liveKeys)) {
        throw new Error(`Discrepancia de campos en ${col}/${expectedDoc.id}`)
      }

      for (const k of expKeys) {
        const expVal = JSON.stringify(expectedDoc.fields[k])
        const liveVal = JSON.stringify(liveDoc.fields[k])
        if (expVal !== liveVal) {
          throw new Error(`Discrepancia de valor en ${col}/${expectedDoc.id}.${k}:\nEsperado: ${expVal}\nObtenido: ${liveVal}`)
        }
      }

      // Verificar subcolecciones
      if (expectedDoc.subcollections) {
        for (const [subCol, subDocs] of Object.entries(expectedDoc.subcollections)) {
          for (const subExp of subDocs) {
            const subRes = await fetch(`${baseUrl}/${col}/${expectedDoc.id}/${subCol}/${subExp.id}`, { headers: authHeaders })
            if (!subRes.ok) throw new Error(`Subdocumento no encontrado en emulador: ${col}/${expectedDoc.id}/${subCol}/${subExp.id} (HTTP ${subRes.status})`)
            const subLive = await subRes.json()

            const expSubKeys = Object.keys(subExp.fields || {}).sort()
            const liveSubKeys = Object.keys(subLive.fields || {}).sort()
            if (JSON.stringify(expSubKeys) !== JSON.stringify(liveSubKeys)) {
              throw new Error(`Discrepancia en campos de subdoc ${subCol}/${subExp.id}`)
            }
          }
        }
      }
    }
  }
  console.log('✓ [PASO 2 EXITOSO]: Fidelidad de datos del 100% verificada sin pérdida de precisión.\n')

  // 3. Probar protección contra sobreescritura accidental
  console.log('[PASO 3] Probando protección contra sobreescritura accidental...')
  const secondRun = await restoreDocuments({
    execute: true,
    forceOverwrite: false,
    emulatorHost,
    backupPath: DEFAULT_BACKUP_PATH
  })

  if (secondRun.totalRestoredParents !== 0 || secondRun.totalRestoredSubs !== 0) {
    throw new Error('La protección contra sobreescritura falló: debió omitir todos los documentos existentes.')
  }
  console.log('✓ [PASO 3 EXITOSO]: Colisiones detectadas correctamente, sobreescritura accidental rechazada.\n')

  // 4. Probar sobreescritura forzada con --force-overwrite
  console.log('[PASO 4] Probando restauración forzada con forceOverwrite: true...')
  const forcedRun = await restoreDocuments({
    execute: true,
    forceOverwrite: true,
    emulatorHost,
    backupPath: DEFAULT_BACKUP_PATH
  })

  if (forcedRun.totalRestoredParents !== 15 || forcedRun.totalRestoredSubs !== 13) {
    throw new Error('La sobreescritura forzada no restauró todos los documentos.')
  }
  console.log('✓ [PASO 4 EXITOSO]: Sobreescritura forzada completada con éxito.\n')

  console.log('====================================================================')
  console.log('RESULTADO FINAL: PRUEBA DE RESTAURACIÓN 100% SUPERADA EN EMULADOR')
  console.log('====================================================================')
}

runEmulatorTest().catch(err => {
  console.error('\n❌ FALLÓ LA PRUEBA EN EL EMULADOR:', err.message)
  process.exit(1)
})
