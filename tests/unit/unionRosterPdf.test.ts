import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { UnionRosterMember } from '../../src/services/unionService.ts'
import {
  buildUnionMembersRosterPdf,
  buildUnionRosterEntries,
  filterUnionRosterMembers,
  getUnionRosterScopeLabel,
} from '../../src/services/unionRosterPdfService.ts'

function makeMember(index: number, status: UnionRosterMember['status'] = 'active'): UnionRosterMember {
  return {
    id: `member-${index}`,
    memberNumber: `SOC-${String(index).padStart(3, '0')}`,
    fullName: `Afiliado de Prueba ${index}`,
    ci: '',
    phone: '',
    joinedAt: '',
    status,
    category: 'socio_general',
    monthlyFeeBob: 0,
    children: [],
  }
}

test('Padrón PDF: incluye afiliado, complemento, chofer principal e hijos vinculados', () => {
  const member = {
    ...makeMember(1),
    ci: '1234567',
    ciComplement: 'A',
    phone: '70001122',
    alternatePhone: '70003344',
    address: 'Calle Central',
    locality: 'Punata',
    birthDate: '1980-01-02',
    joinedAt: '2015-06-01',
    primaryDriverUid: 'driver-main',
    primaryDriverName: 'Chofer Principal',
    notes: 'Observación afiliado',
    children: [{
      id: 'child-1', memberId: 'member-1', fullName: 'Hija de Prueba', ci: '7654321',
      birthDate: '2010-05-02', phone: '71112233', address: 'Avenida Dos', notes: 'Observación hija',
      driverUid: 'driver-child', driverName: 'Chofer Segundo',
    }],
  } satisfies UnionRosterMember

  const [entry] = buildUnionRosterEntries([member])
  assert.equal(entry.member.fullName, 'Afiliado de Prueba 1')
  assert.ok(entry.fields.some((field) => field.label === 'CI' && field.value === '1234567 A'))
  assert.ok(entry.fields.some((field) => field.label === 'Chofer principal' && field.value === 'Chofer Principal'))
  assert.equal(entry.children[0].child.fullName, 'Hija de Prueba')
  assert.ok(entry.children[0].fields.some((field) => field.label === 'Conductor vinculado' && field.value === 'Chofer Segundo'))
  assert.equal(getUnionRosterScopeLabel('completo'), 'PADRÓN COMPLETO')
  assert.equal(getUnionRosterScopeLabel('filtrado'), 'RESULTADOS FILTRADOS')
})

test('Padrón PDF: registros antiguos y opcionales vacíos producen campos legibles', () => {
  const oldMember = makeMember(2, 'retired')
  const [entry] = buildUnionRosterEntries([oldMember])
  assert.ok(entry.fields.every((field) => field.value && !field.value.includes('undefined')))
  assert.ok(entry.fields.some((field) => field.label === 'Fecha de retiro' && field.value === 'No registrado'))
  assert.equal(entry.children.length, 0)
  assert.ok(entry.fields.some((field) => field.label === 'Chofer principal' && field.value === 'Sin vinculación'))
})

test('Padrón PDF: búsqueda por nombre/CI y filtro de activos/retirados', () => {
  const active = { ...makeMember(3), fullName: 'María Afiliada', ci: '1234567' }
  const retired = { ...makeMember(4, 'retired'), fullName: 'Juan Retirado', ci: '998877' }
  const members = [active, retired]
  assert.deepEqual(filterUnionRosterMembers(members, { searchTerm: 'mArÍa', status: 'all' }).map((m) => m.id), ['member-3'])
  assert.deepEqual(filterUnionRosterMembers(members, { searchTerm: '998', status: 'retired' }).map((m) => m.id), ['member-4'])
  assert.deepEqual(filterUnionRosterMembers(members, { searchTerm: '', status: 'active' }).map((m) => m.id), ['member-3'])
})

test('Padrón PDF: genera un documento de varias páginas y conserva grupos de afiliados', () => {
  const members = Array.from({ length: 35 }, (_, index) => ({
    ...makeMember(index + 1, index % 4 === 0 ? 'retired' : 'active'),
    address: 'Avenida de prueba, zona central, municipio de Punata, Cochabamba',
    notes: `Observación extensa ficticia del afiliado ${index + 1}. `.repeat(5),
    children: [{
      id: `child-${index + 1}`, memberId: `member-${index + 1}`, fullName: `Hijo ${index + 1}`,
      ci: '', birthDate: null, phone: '', address: '', notes: '', driverUid: null,
    }],
  }))
  const pdf = buildUnionMembersRosterPdf(members, 'filtrado', new Date('2026-11-09T12:00:00.000Z'))
  assert.ok(pdf.getNumberOfPages() > 1)
  const output = pdf.output('arraybuffer')
  assert.equal(new TextDecoder().decode(output.slice(0, 4)), '%PDF')
})
