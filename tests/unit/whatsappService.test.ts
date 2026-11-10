import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWhatsAppChatUrl, normalizeWhatsAppNumber } from '../../src/services/whatsappService.ts'

test('WhatsApp: normaliza números locales bolivianos e internacionales sin enviar mensajes', () => {
  assert.equal(normalizeWhatsAppNumber('7123-4567'), '59171234567')
  assert.equal(normalizeWhatsAppNumber('(4) 4571234'), '59144571234')
  assert.equal(normalizeWhatsAppNumber('+1 (202) 555-0123'), '12025550123')
  assert.equal(normalizeWhatsAppNumber('0044 20 7946 0958'), '442079460958')
  assert.equal(normalizeWhatsAppNumber('591 71234567'), '59171234567')
  assert.equal(buildWhatsAppChatUrl('+1 202 555 0123'), 'https://wa.me/12025550123')
  assert.equal(buildWhatsAppChatUrl('71234567')?.includes('?'), false)
})

test('WhatsApp: rechaza teléfono vacío, ambiguo, inválido o con múltiples números', () => {
  for (const phone of ['', 'abc', '123', '7123456789 / 44571234', '+591 71234567 ext 3', '+0 71234567']) {
    assert.equal(normalizeWhatsAppNumber(phone), null)
    assert.equal(buildWhatsAppChatUrl(phone), null)
  }
})
