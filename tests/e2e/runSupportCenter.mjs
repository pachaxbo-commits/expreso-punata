import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { registerSyntheticTestRecord } from '../helpers/supportCleanupProvenance.mjs'

const projectId = process.env.GCLOUD_PROJECT || 'demo-support-phase2'
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, process.env.EXPECTED_FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080')
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.EXPECTED_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099')
const app = initializeApp({ projectId })
const db = getFirestore(app)
const auth = getAuth(app)
for (const collection of ['support_cleanup_provenance', 'support_cleanup_backups', 'support_cleanup_operations', 'support_cleanup_plans', 'support_cleanup_restores', 'support_config_history', 'support_diagnostics']) {
  const existing = await db.collection(collection).get()
  for (const document of existing.docs) await db.recursiveDelete(document.ref)
}
const suffix = Date.now()
const email = `support-${suffix}@example.test`
const password = 'LocalSupportOnly!234'
const user = await auth.createUser({ email, password })
await db.collection('users').doc(user.uid).set({ uid: user.uid, email, fullName: 'Soporte local', role: 'soporte_pachax', primaryBranchId: 'punata', allowedBranchIds: ['punata'], isActive: true })
await db.collection('system_config').doc('expreso_punata').set({ status: 'configured', isOfficial: true, company: { tradeName: 'Nombre inicial' }, branches: { punata: { phone: '111' }, cochabamba: { phone: '222' } } })
const blockedGuideId = `PUN-BLOCKED-${suffix}`
const blockedSiblingId = `PUN-UNKNOWN-${suffix}`
const blockedManifestId = `MAN-BLOCKED-${suffix}`
const blockedGuide = { id: blockedGuideId, trackingCode: blockedGuideId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', manifestId: blockedManifestId, createdAtIso: new Date().toISOString() }
const blockedManifest = { id: blockedManifestId, manifestNumber: blockedManifestId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'dispatched', shipmentIds: [blockedGuideId, blockedSiblingId], shipmentSummaries: [{ shipmentId: blockedGuideId }, { shipmentId: blockedSiblingId }] }
await db.collection('shipments').doc(blockedGuideId).set(blockedGuide)
await registerSyntheticTestRecord(db, 'shipments', blockedGuideId, blockedGuide, `e2e-${suffix}`)
await db.collection('shipments').doc(blockedSiblingId).set({ id: blockedSiblingId, trackingCode: blockedSiblingId, status: 'in_transit', manifestId: blockedManifestId })
await db.collection('manifests').doc(blockedManifestId).set(blockedManifest)
await registerSyntheticTestRecord(db, 'manifests', blockedManifestId, blockedManifest, `e2e-${suffix}`)
const safeGuideId = `PUN-SAFE-${suffix}`
const safeManifestId = `MAN-SAFE-${suffix}`
const safeGuide = { id: safeGuideId, trackingCode: safeGuideId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'received', paymentStatus: 'pending', manifestId: safeManifestId, finalAmountCents: 1200, createdAtIso: new Date().toISOString() }
const safeManifest = { id: safeManifestId, manifestNumber: safeManifestId, originBranchId: 'punata', destinationBranchId: 'cochabamba', status: 'dispatched', shipmentIds: [safeGuideId], shipmentSummaries: [{ shipmentId: safeGuideId }], totalCodAmountCents: 1200, createdAtIso: new Date().toISOString() }
await db.collection('shipments').doc(safeGuideId).set(safeGuide)
await registerSyntheticTestRecord(db, 'shipments', safeGuideId, safeGuide, `e2e-${suffix}`)
await db.collection('manifests').doc(safeManifestId).set(safeManifest)
await registerSyntheticTestRecord(db, 'manifests', safeManifestId, safeManifest, `e2e-${suffix}`)
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4189', '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  for (let i = 0; i < 30; i++) {
    try { await page.goto('http://127.0.0.1:4189'); break } catch (error) { if (i === 29) throw error; await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  await page.getByRole('heading', { name: 'Centro de Soporte PACHAX' }).waitFor()
  await page.getByText('emulador', { exact: true }).waitFor()
  await page.getByText('Nombre inicial', { exact: true }).waitFor()
  await page.getByLabel('Nuevo valor').fill('Nombre revisado')
  await page.getByLabel('Motivo', { exact: true }).fill('Solicitud institucional de prueba')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Guardar cambio' }).click()
  await page.getByText('Nombre revisado', { exact: true }).waitFor()
  await page.getByLabel('Motivo', { exact: true }).fill('Restauración de prueba')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Restaurar valor anterior' }).first().click()
  await page.getByText('Nombre inicial', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Módulo' }).fill('cuenta')
  await page.getByLabel('Operación', { exact: true }).fill('getAccount')
  await page.getByLabel('Código', { exact: true }).fill('internal_0')
  await page.getByLabel('ID de correlación').fill('case-123')
  await page.getByRole('button', { name: 'Registrar diagnóstico' }).click()
  await page.getByText('Diagnóstico registrado.').waitFor()
  assert.equal((await db.collection('support_diagnostics').get()).size, 1)
  await page.getByLabel('IDs concretos').fill(blockedGuideId)
  await page.getByRole('button', { name: 'SIMULAR LIMPIEZA' }).click()
  await page.getByText('bloqueado', { exact: true }).waitFor()
  await page.locator('li').filter({ hasText: blockedSiblingId }).first().waitFor()
  assert.equal((await db.collection('shipments').doc(blockedGuideId).get()).exists, true)
  assert.equal((await db.collection('shipments').doc(blockedSiblingId).get()).exists, true)
  await page.getByLabel('IDs concretos').fill(safeGuideId)
  await page.getByRole('button', { name: 'SIMULAR LIMPIEZA' }).click()
  await page.getByText('simulado', { exact: true }).waitFor()
  await page.locator('li').filter({ hasText: safeManifestId }).first().waitFor()
  await page.locator('li').filter({ hasText: safeGuideId }).first().waitFor()
  const planText = await page.locator('p.font-mono').filter({ hasText: 'Plan cln_' }).textContent()
  const planId = planText.match(/Plan (cln_[a-f0-9-]+)/)?.[1]
  assert.ok(planId)
  await page.getByLabel('Confirmación exacta del plan').fill(`LIMPIAR ${planId}`)
  await page.getByRole('button', { name: 'Respaldar y ejecutar limpieza sintética' }).click()
  await page.getByText(/Operación completada: 2 documentos/).waitFor()
  assert.equal((await db.collection('shipments').doc(safeGuideId).get()).exists, false)
  assert.equal((await db.collection('manifests').doc(safeManifestId).get()).exists, false)
  const operationId = await page.getByLabel('ID de operación del respaldo').inputValue()
  assert.equal((await db.collection('support_cleanup_backups').doc(operationId).collection('records').get()).size, 2)
  await page.getByLabel('Confirmación exacta de recuperación').fill(`RESTAURAR ${operationId}`)
  await page.getByRole('button', { name: 'Verificar y restaurar respaldo' }).click()
  await page.getByText(/Recuperación restaurada: 2 documentos/).waitFor()
  assert.deepEqual((await db.collection('shipments').doc(safeGuideId).get()).data(), safeGuide)
  assert.deepEqual((await db.collection('manifests').doc(safeManifestId).get()).data(), safeManifest)
  await page.getByRole('button', { name: 'Actualizar', exact: true }).last().click()
  await page.locator('li').filter({ hasText: operationId }).first().waitFor()
  console.log('Support E2E: pantalla móvil, procedencia desconocida bloqueada, grafo compartido, plan persistente, respaldo por lotes, ejecución sintética y recuperación verificadas.')
} finally { await browser.close(); preview.kill() }
