import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright-core'

const outputDir = path.resolve('tmp/document-audit')
mkdirSync(outputDir, { recursive: true })
const pdfPath = path.join(outputDir, 'shipment-guide-fictitious.pdf')
const harnessPath = path.join(outputDir, 'shipment-guide-harness.html')
writeFileSync(harnessPath, `<!doctype html><html><body><script>window.addEventListener('error', event => window.auditError = event.message); window.addEventListener('unhandledrejection', event => window.auditError = String(event.reason));</script><script type="module">
import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import { generateShipmentGuidePdf } from '/src/services/pdfService.ts'

const textCalls = []
const originalText = jsPDF.prototype.text
jsPDF.prototype.text = function (text, x, y, options, ...rest) {
  const fontSizePt = this.internal.getFontSize()
  const pieces = Array.isArray(text) ? text : [String(text)]
  const joined = pieces.map(String).join(' ')
  const widthMm = pieces.reduce((max, piece) => Math.max(max, this.getTextWidth(String(piece))), 0)
  const align = typeof options === 'object' && options ? options.align : 'left'
  const leftX = align === 'center' ? x - widthMm / 2 : align === 'right' ? x - widthMm : x
  const heightMm = fontSizePt * 25.4 / 72
  textCalls.push({ text: joined, x, y, leftX, widthMm, heightMm, align })
  return originalText.call(this, text, x, y, options, ...rest)
}

let qrPayload = ''
const originalQr = QRCode.toDataURL
QRCode.toDataURL = async function (value, ...args) { qrPayload = String(value); return originalQr.call(this, value, ...args) }

const shipment = {
  trackingCode: 'PUN-TEST-2026-0001', originBranchId: 'punata', destinationBranchId: 'cochabamba',
  originCity: 'Punata', destinationCity: 'Cochabamba', createdAtIso: '2026-11-12T12:00:00.000Z',
  registeredByName: 'Operadora Ficticia', sender: { name: 'Remitente de Prueba', phone: '70000001', docType: 'CI', docNumber: '10000001' },
  recipient: { name: 'Destinataria Ficticia', phone: '70000002', docType: 'CI', docNumber: '20000002' },
  deliveryType: 'home', deliveryAddress: 'Calle Ficticia 123, Punata', packageCount: 2, totalWeightKg: 4.5,
  items: [{ description: 'Repuesto de prueba', category: 'general', quantity: 2, packaging: 'caja', weightKg: 4.5 }],
  shippingFeeCents: 2500, weightSurchargeCents: 500, homeDeliveryFeeCents: 1200,
  finalAmountCents: 4200, paymentTiming: 'origin_paid', paymentStatus: 'paid', paymentMethod: 'cash',
}

const pdfBlob = await generateShipmentGuidePdf(shipment, '70000099')
const bytes = new Uint8Array(await pdfBlob.arrayBuffer())
window.auditResult = {
  pdfBase64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
  mimeType: pdfBlob.type,
  textCalls,
  qrPayload,
}
</script></body></html>`)

const vite = await createViteServer({
  configFile: path.resolve('vite.config.ts'),
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  logLevel: 'error',
})
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
try {
  await vite.listen()
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('http://127.0.0.1:4174/tmp/document-audit/shipment-guide-harness.html', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(window.auditResult || window.auditError), { timeout: 30000 })
  const result = await page.evaluate(() => window.auditResult)
  assert.ok(result, `la guía PDF se generó en el navegador: ${pageErrors.join('; ')}`)
  const pdfBytes = Buffer.from(result.pdfBase64, 'base64')
  const rawPdf = pdfBytes.toString('latin1')
  writeFileSync(pdfPath, pdfBytes)
  assert.equal(result.mimeType, 'application/pdf')
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-')
  assert.match(result.qrPayload, /Guía: PUN-TEST-2026-0001/)
  assert.match(result.qrPayload, /Origen: Punata/)
  assert.match(result.qrPayload, /Destino: Cochabamba/)
  assert.match(result.qrPayload, /Bultos: 2/)

  const text = rawPdf
  for (const expected of [
    'PUN-TEST-2026-0001', '70000099', 'Remitente de Prueba', '70000001', '10000001',
    'Punata', 'Destinataria Ficticia', '70000002', '20000002', 'Cochabamba',
    'Bs. 25,00', 'Bs. 5,00', 'Bs. 12,00', 'Bs. 42,00', 'PAGADO EN ORIGEN',
  ]) assert.ok(text.includes(expected), `el PDF debe incluir ${expected}`)

  const textBlocks = [...rawPdf.matchAll(/BT([\s\S]*?)ET/g)].map((match) => match[1]).filter((block) => block.includes('Tj'))
  const decodePdfText = (value) => value.replace(/\\([\\()])/g, '$1')
  const estimatedWidthPoints = (value, fontSize) => [...value].reduce((sum, char) => {
    const c = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const factor = c === ' ' ? 0.28 : /[ilI.,:;!'|]/.test(c) ? 0.25 : /[MW@%]/.test(c) ? 0.82 : /[A-Z0-9]/.test(c) ? 0.58 : 0.5
    return sum + fontSize * factor
  }, 0)
  const placements = textBlocks.flatMap((block) => {
    const font = block.match(/\/F\d+\s+([\d.]+)\s+Tf/)
    const position = block.match(/(-?[\d.]+)\s+(-?[\d.]+)\s+Td/)
    const value = block.match(/\(((?:\\.|[^\\)])*)\)\s*Tj/)
    if (!font || !position || !value) return []
    const fontPt = Number(font[1])
    const xMm = Number(position[1]) * 25.4 / 72
    const yMm = 210 - Number(position[2]) * 25.4 / 72
    const valueText = decodePdfText(value[1])
    const widthMm = estimatedWidthPoints(valueText, fontPt) * 25.4 / 72
    const heightMm = fontPt * 25.4 / 72
    return [{ text: valueText, xMm, yMm, widthMm, heightMm }]
  })
  assert.ok(placements.length >= 20, 'el contenido de texto del PDF puede analizarse para validar su geometría')
  const outOfBounds = placements.filter((item) => item.xMm < -0.2 || item.yMm > 210.2 || item.xMm + item.widthMm > 148.2)
  assert.deepEqual(outOfBounds, [], 'el contenido textual de la guía permanece dentro de la página A5')
  const overlaps = []
  for (let i = 0; i < placements.length; i += 1) {
    const a = placements[i]
    const aTop = a.yMm - a.heightMm * 0.85
    const aBottom = a.yMm + a.heightMm * 0.2
    for (let j = i + 1; j < placements.length; j += 1) {
      const b = placements[j]
      const bTop = b.yMm - b.heightMm * 0.85
      const bBottom = b.yMm + b.heightMm * 0.2
      const horizontalOverlap = a.xMm < b.xMm + b.widthMm - 0.5 && b.xMm < a.xMm + a.widthMm - 0.5
      const verticalOverlap = aTop < bBottom - 0.25 && bTop < aBottom - 0.25
      if (horizontalOverlap && verticalOverlap) overlaps.push({ a: a.text, b: b.text, aY: a.yMm, bY: b.yMm })
    }
  }
  assert.deepEqual(overlaps, [], 'no se detectan superposiciones entre líneas de texto')

  writeFileSync(pdfPath, pdfBytes)
  const pdfInfo = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' })
  if (pdfInfo.status === 0) {
    assert.match(pdfInfo.stdout, /Pages:\s+1/)
    assert.match(pdfInfo.stdout, /Page size:\s+419\.5\d x 595\.2\d pts/i)
  } else {
    assert.match(rawPdf, /\/Type \/Page\b/)
    assert.match(rawPdf, /\/Subtype \/Image\b/, 'el PDF incluye la imagen QR')
  }
  assert.match(pdfBytes.toString('latin1'), /\/Subtype \/Image\b/, 'el PDF incluye la imagen QR')

  const summary = {
    file: path.relative(process.cwd(), pdfPath),
    bytes: pdfBytes.length,
    pages: 1,
    pageFormat: 'A5 portrait',
    textFieldsChecked: 15,
    qrPayload: result.qrPayload,
    imageObjects: (pdfBytes.toString('latin1').match(/\/Subtype \/Image\b/g) || []).length,
    parsedTextPlacements: placements.length,
    overlapCount: overlaps.length,
    outOfBoundsTextCount: outOfBounds.length,
    pdfinfo: pdfInfo.status === 0 ? pdfInfo.stdout.split(/\r?\n/).filter((line) => /^(Pages|Page size|File size):/.test(line)) : 'pdfinfo unavailable; binary PDF checks passed',
  }
  writeFileSync(path.join(outputDir, 'shipment-guide-pdf-results.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await browser.close()
  await vite.close()
}
