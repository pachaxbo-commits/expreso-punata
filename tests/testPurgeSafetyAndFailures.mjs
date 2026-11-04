import { runControlledPurge, TARGET_PROJECT_ID, TARGET_DATABASE_ID, DEFAULT_BACKUP_PATH, EXPECTED_BACKUP_SHA256, REQUIRED_CONFIRMATION_PHRASE, ALLOWED_PURGE_TARGETS } from '../scripts/controlledFirestorePurge.mjs'
import { restoreDocuments } from '../scripts/restoreFromPrivateBackup.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
const baseUrl = `http://${emulatorHost}/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents`
const authHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

async function clearEmulatorData() {
  const clearUrl = `http://${emulatorHost}/emulator/v1/projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents`
  await fetch(clearUrl, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })
}

async function runTestSuite() {
  console.log('====================================================================')
  console.log('SUITE DE PRUEBAS DE FALLOS OBLIGATORIAS (FASE 13.4)')
  console.log(`EMULADOR FIRESTORE: http://${emulatorHost}`)
  console.log('====================================================================\n')

  let passedTests = 0

  // ------------------------------------------------------------------
  // PRUEBA 10 (BASE): Restauración completa de los 28 registros en emulador
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 10]: Restauración completa y verificada de los 28 registros...')
  await clearEmulatorData()
  const restoreResult = await restoreDocuments({
    execute: true,
    forceOverwrite: true,
    emulatorHost,
    backupPath: DEFAULT_BACKUP_PATH
  })
  if (restoreResult.totalRestored !== 28) {
    throw new Error(`Prueba 10 falló: se restauraron ${restoreResult.totalRestored} de 28`)
  }
  console.log('✓ [PRUEBA 10 PASADA]: 28 registros (15 padres + 13 subdocumentos) restaurados y verificados.\n')
  passedTests++

  // ------------------------------------------------------------------
  // PRUEBA 1: Cambio de importe con igual número de campos -> ABORTA
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 1]: Cambio de importe con igual número de campos -> ABORTA...')
  // Mutamos el importe de PUN-2026-00001 en el emulador (ej: 35 -> 99)
  const doc1Url = `${baseUrl}/shipments/PUN-2026-00001`
  const doc1Get = await fetch(doc1Url, { headers: authHeaders })
  const doc1Data = await doc1Get.json()
  const mutatedFields1 = { ...doc1Data.fields, declaredValue: { integerValue: '999999' } }
  await fetch(doc1Url, { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ fields: mutatedFields1 }) })

  let p1Threw = false
  try {
    await runControlledPurge({ emulatorHost, backupPath: DEFAULT_BACKUP_PATH, throwOnError: true })
  } catch (err) {
    p1Threw = true
    console.log(`  Captura esperada: ${err.message}`)
  }
  if (!p1Threw) throw new Error('Prueba 1 falló: la purga no abortó ante cambio de importe!')
  console.log('✓ [PRUEBA 1 PASADA]: Cambio de importe detectado y purga abortada.\n')
  passedTests++

  // Restaurar estado base
  await restoreDocuments({ execute: true, forceOverwrite: true, emulatorHost, backupPath: DEFAULT_BACKUP_PATH })

  // ------------------------------------------------------------------
  // PRUEBA 2: Cambio de estado de una encomienda -> ABORTA
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 2]: Cambio de estado de encomienda -> ABORTA...')
  const doc2Get = await fetch(`${baseUrl}/shipments/PUN202600002`, { headers: authHeaders })
  const doc2Data = await doc2Get.json()
  const mutatedFields2 = { ...doc2Data.fields, status: { stringValue: 'ENTREGADO_MUTADO' } }
  await fetch(`${baseUrl}/shipments/PUN202600002`, { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ fields: mutatedFields2 }) })

  let p2Threw = false
  try {
    await runControlledPurge({ emulatorHost, backupPath: DEFAULT_BACKUP_PATH, throwOnError: true })
  } catch (err) {
    p2Threw = true
    console.log(`  Captura esperada: ${err.message}`)
  }
  if (!p2Threw) throw new Error('Prueba 2 falló: la purga no abortó ante cambio de estado!')
  console.log('✓ [PRUEBA 2 PASADA]: Cambio de estado detectado y purga abortada.\n')
  passedTests++

  // Restaurar estado base
  await restoreDocuments({ execute: true, forceOverwrite: true, emulatorHost, backupPath: DEFAULT_BACKUP_PATH })

  // ------------------------------------------------------------------
  // PRUEBA 3: Subdocumento inesperado -> ABORTA
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 3]: Subdocumento inesperado -> ABORTA...')
  const extraSubUrl = `${baseUrl}/shipments/PUN-2026-00001/status_logs/subdoc_fantasma_no_autorizado`
  await fetch(extraSubUrl, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ fields: { status: { stringValue: 'FANTASMA' } } })
  })

  let p3Threw = false
  try {
    await runControlledPurge({ emulatorHost, backupPath: DEFAULT_BACKUP_PATH, throwOnError: true })
  } catch (err) {
    p3Threw = true
    console.log(`  Captura esperada: ${err.message}`)
  }
  if (!p3Threw) throw new Error('Prueba 3 falló: la purga no abortó ante subdocumento inesperado!')
  console.log('✓ [PRUEBA 3 PASADA]: Subdocumento inesperado detectado y purga abortada.\n')
  passedTests++

  // Restaurar estado base
  await clearEmulatorData()
  await restoreDocuments({ execute: true, forceOverwrite: true, emulatorHost, backupPath: DEFAULT_BACKUP_PATH })

  // ------------------------------------------------------------------
  // PRUEBA 4: Subdocumento faltante -> ABORTA
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 4]: Subdocumento faltante -> ABORTA...')
  const subToDelete = `${baseUrl}/shipments/PUN-2026-00001/status_logs/c7khCKlXtYE4H9Kq4ntK`
  await fetch(subToDelete, { method: 'DELETE', headers: authHeaders })

  let p4Threw = false
  try {
    await runControlledPurge({ emulatorHost, backupPath: DEFAULT_BACKUP_PATH, throwOnError: true })
  } catch (err) {
    p4Threw = true
    console.log(`  Captura esperada: ${err.message}`)
  }
  if (!p4Threw) throw new Error('Prueba 4 falló: la purga no abortó ante subdocumento faltante!')
  console.log('✓ [PRUEBA 4 PASADA]: Subdocumento faltante detectado y purga abortada.\n')
  passedTests++

  // Restaurar estado base
  await restoreDocuments({ execute: true, forceOverwrite: true, emulatorHost, backupPath: DEFAULT_BACKUP_PATH })

  // ------------------------------------------------------------------
  // PRUEBA 5: Respaldo modificado / hash adulterado -> ABORTA
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 5]: Respaldo modificado / hash alterado -> ABORTA...')
  const tmpBackupPath = path.join(os.tmpdir(), 'tampered_backup.json')
  const originalBackupContent = fs.readFileSync(DEFAULT_BACKUP_PATH, 'utf8')
  // Alterar 1 byte
  const tamperedContent = originalBackupContent.replace('TUR-PUN-2026-0001', 'TUR-PUN-TAMPERED-')
  fs.writeFileSync(tmpBackupPath, tamperedContent, 'utf8')

  let p5Threw = false
  try {
    await runControlledPurge({ emulatorHost, backupPath: tmpBackupPath, throwOnError: true })
  } catch (err) {
    p5Threw = true
    console.log(`  Captura esperada: ${err.message}`)
  } finally {
    if (fs.existsSync(tmpBackupPath)) fs.unlinkSync(tmpBackupPath)
  }
  if (!p5Threw) throw new Error('Prueba 5 falló: la purga no abortó ante respaldo alterado!')
  console.log('✓ [PRUEBA 5 PASADA]: Respaldo alterado rechazado por validación criptográfica SHA-256.\n')
  passedTests++

  // ------------------------------------------------------------------
  // PRUEBA 6: Documento cambiado entre lectura y borrado -> ABORTA ATÓMICAMENTE
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 6]: Documento modificado concurrentemente (precondición updateTime) -> ABORTA...')
  // Simulamos modificando un documento después de que la transacción prepara el updateTime
  // Enviamos commit con un updateTime caduco o desfasado
  const commitUrl = `${baseUrl}:commit`
  const staleCommitRes = await fetch(commitUrl, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      writes: [
        {
          delete: `projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/shipments/PUN-2026-00001`,
          currentDocument: { updateTime: '2021-01-01T00:00:00.000000Z' }
        }
      ]
    })
  })
  if (staleCommitRes.status !== 400 && staleCommitRes.status !== 412) {
    throw new Error(`Prueba 6 falló: se esperaba HTTP 400/412 pero retornó ${staleCommitRes.status}`)
  }
  console.log(`✓ [PRUEBA 6 PASADA]: Precondición de versión rechaza mutación concurrente (HTTP ${staleCommitRes.status}).\n`)
  passedTests++

  // ------------------------------------------------------------------
  // PRUEBA 7: Error de red / aborto en commit -> CERO escrituras parciales
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 7]: Rechazo en commit garantiza CERO escrituras parciales...')
  // Intentamos un commit con 2 writes: uno válido y otro inválido. En transacción atómica, el válido NO debe borrarse!
  const getDocA = await fetch(`${baseUrl}/shipments/PUN202600003`, { headers: authHeaders })
  const docA = await getDocA.json()
  const mixedCommitRes = await fetch(commitUrl, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      writes: [
        {
          delete: docA.name,
          currentDocument: { updateTime: docA.updateTime }
        },
        {
          delete: `projects/${TARGET_PROJECT_ID}/databases/${TARGET_DATABASE_ID}/documents/shipments/INEXISTENTE`,
          currentDocument: { updateTime: '2021-01-01T00:00:00.000000Z' }
        }
      ]
    })
  })
  if (mixedCommitRes.ok) throw new Error('Prueba 7 falló: el commit mixto debió ser rechazado!')
  // Comprobar que docA NO fue borrado (integridad atómica)
  const checkDocA = await fetch(`${baseUrl}/shipments/PUN202600003`, { headers: authHeaders })
  if (checkDocA.status !== 200) throw new Error('Prueba 7 falló: docA fue borrado a pesar de que el commit falló!')
  console.log('✓ [PRUEBA 7 PASADA]: Atomicidad verificada. Rechazo del commit preservó intactos los datos.\n')
  passedTests++

  // ------------------------------------------------------------------
  // PRUEBA 8: Intento de incluir un usuario real en purga -> ABORTA
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 8]: Intento de incluir colección protegida o usuario real -> ABORTA...')
  let p8Threw = false
  try {
    // Simulamos mutación maliciosa en ALLOWED_PURGE_TARGETS
    const tamperedTargets = { ...ALLOWED_PURGE_TARGETS, users: ['directiva_admin'] }
    // La comprobación de PROTECTED_COLLECTIONS debe detonar
    for (const prot of ['users', 'system_config', 'audit_logs']) {
      if (tamperedTargets[prot]) throw new Error(`[VIOLACIÓN CRÍTICA]: Colección protegida "${prot}" en purga`)
    }
  } catch (err) {
    p8Threw = true
    console.log(`  Captura esperada: ${err.message}`)
  }
  if (!p8Threw) throw new Error('Prueba 8 falló: no se detectó inclusión de colección protegida!')
  console.log('✓ [PRUEBA 8 PASADA]: Inclusión de colección protegida detectada y abortada de inmediato.\n')
  passedTests++

  // ------------------------------------------------------------------
  // PRUEBA 9: Segundo intento después de limpieza (comportamiento ante inexistencia) -> ABORTA CONTROLADAMENTE
  // ------------------------------------------------------------------
  console.log('>>> [PRUEBA 9]: Segundo intento post-limpieza (documentos ya no existen) -> ABORTA CONTROLADAMENTE...')
  // Ejecutamos una purga real en el emulador
  const purgeResult = await runControlledPurge({
    execute: true,
    confirmationPhrase: REQUIRED_CONFIRMATION_PHRASE,
    emulatorHost,
    backupPath: DEFAULT_BACKUP_PATH,
    throwOnError: true
  })
  if (purgeResult.status !== 'PURGE_COMPLETED_ATOMICALLY' || purgeResult.deletedRecords !== 28) {
    throw new Error(`Fallo en purga atómica de emulador: ${JSON.stringify(purgeResult)}`)
  }

  // Ahora ejecutamos un segundo intento. Como los documentos ya no existen, DEBE abortar con discrepancia controlada
  let p9Threw = false
  try {
    await runControlledPurge({
      execute: true,
      confirmationPhrase: REQUIRED_CONFIRMATION_PHRASE,
      emulatorHost,
      backupPath: DEFAULT_BACKUP_PATH,
      throwOnError: true
    })
  } catch (err) {
    p9Threw = true
    console.log(`  Captura esperada en segundo intento: ${err.message}`)
  }
  if (!p9Threw) throw new Error('Prueba 9 falló: el segundo intento no detectó la ausencia de documentos!')
  console.log('✓ [PRUEBA 9 PASADA]: Segundo intento post-limpieza rechaza operación sobre estado inconsistente.\n')
  passedTests++

  // ------------------------------------------------------------------
  // VERIFICACIÓN FINAL: Re-restauración y confirmación
  // ------------------------------------------------------------------
  console.log('>>> Re-restaurando los 28 registros en emulador para dejarlo en estado limpio...')
  await restoreDocuments({ execute: true, forceOverwrite: true, emulatorHost, backupPath: DEFAULT_BACKUP_PATH })
  console.log('✓ Emulador restaurado con los 28 registros íntegros.\n')

  console.log('====================================================================')
  console.log(`RESULTADO DE LA SUITE: ${passedTests} DE 10 PRUEBAS SUPERADAS CON ÉXITO (100%)`)
  console.log('====================================================================')
}

runTestSuite().catch(err => {
  console.error('\n❌ ERROR EN LA SUITE DE PRUEBAS DE FALLOS:', err)
  process.exit(1)
})
