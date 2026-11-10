import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FixedAsset } from '../../src/types/index.ts'
import { buildFixedAssetLabelsPdf } from '../../src/services/fixedAssetLabelsPdfService.ts'

test('Etiquetas patrimoniales: QR único por bien, PDF A4 paginado y rechaza duplicados', async () => {
  const assets = Array.from({ length: 50 }, (_, index) => ({
    id: `pdf-asset-${index + 1}`,
    assetCode: `ACT-PUN-${String(index + 1).padStart(4, '0')}`,
    barcodeQr: `ACT-PUN-${String(index + 1).padStart(4, '0')}`,
    qrPayload: `EXPRESO-PUNATA:ACTIVO:pdf-asset-${index + 1}`,
    name: `Silla de oficina ${index + 1}`,
    category: 'muebles',
    description: 'Silla de simulación',
    branchId: 'punata',
    patrimonialLocationId: 'sede_punata',
    physicalLocation: '',
    responsiblePersonName: '',
    acquisitionDate: '2026-11-10',
    status: 'available',
  })) as FixedAsset[]

  assert.equal(new Set(assets.map((asset) => asset.qrPayload)).size, 50)
  const pdf = await buildFixedAssetLabelsPdf(assets)
  assert.equal(pdf.getNumberOfPages(), 4, '15 etiquetas por página A4')
  const bytes = Buffer.from(pdf.output('arraybuffer'))
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  mkdirSync('tmp', { recursive: true })
  writeFileSync('tmp/patrimonial-labels-sample.pdf', bytes)
  await assert.rejects(() => buildFixedAssetLabelsPdf([assets[0], assets[0]]), /bienes repetidos/)
})
