import { jsPDF } from 'jspdf'
import type { UnionRosterMember } from './unionService.ts'

export type UnionRosterScope = 'completo' | 'filtrado'

export const getUnionRosterScopeLabel = (scope: UnionRosterScope): string =>
  scope === 'completo' ? 'PADRÓN COMPLETO' : 'RESULTADOS FILTRADOS'

export interface UnionRosterFilters {
  searchTerm: string
  status: 'all' | 'active' | 'inactive' | 'suspended' | 'honorary' | 'retired'
}

export function filterUnionRosterMembers<T extends Pick<UnionRosterMember, 'fullName' | 'ci' | 'ciComplement' | 'status'> & Partial<Pick<UnionRosterMember, 'memberNumber' | 'vehiclePlate' | 'assignedMobileNumber'>>>(
  members: T[],
  filters: UnionRosterFilters
): T[] {
  const term = filters.searchTerm.trim().toLocaleLowerCase('es')
  return members.filter((member) => {
    const matchesSearch = !term ||
      member.fullName.toLocaleLowerCase('es').includes(term) ||
      (member.ci || '').toLocaleLowerCase('es').includes(term) ||
      (member.ciComplement || '').toLocaleLowerCase('es').includes(term) ||
      (member.memberNumber || '').toLocaleLowerCase('es').includes(term) ||
      (member.vehiclePlate || '').toLocaleLowerCase('es').includes(term) ||
      (member.assignedMobileNumber || '').toLocaleLowerCase('es').includes(term)
    const matchesStatus = filters.status === 'all' || member.status === filters.status
    return matchesSearch && matchesStatus
  })
}

export interface UnionRosterField {
  label: string
  value: string
}

export interface UnionRosterEntry {
  member: UnionRosterMember
  fields: UnionRosterField[]
  children: Array<{ child: UnionRosterMember['children'][number]; fields: UnionRosterField[] }>
}

const display = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'No registrado'
  return String(value)
}

const formatDate = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return 'No registrado'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

export function buildUnionRosterEntries(members: UnionRosterMember[]): UnionRosterEntry[] {
  return members.map((member) => ({
    member,
    fields: [
      { label: 'CI', value: `${display(member.ci)}${member.ciComplement ? ` ${member.ciComplement}` : ''}` },
      { label: 'Teléfono', value: display(member.phone) },
      { label: 'Teléfono alternativo', value: display(member.alternatePhone) },
      { label: 'Domicilio', value: [member.address, member.locality].filter(Boolean).join(' · ') || 'No registrado' },
      { label: 'Fecha de nacimiento', value: formatDate(member.birthDate) },
      { label: 'Fecha de ingreso', value: formatDate(member.joinedAt) },
      { label: 'Fecha de retiro', value: formatDate(member.retiredAt) },
      { label: 'Estado', value: display(member.status).toLocaleUpperCase('es') },
      { label: 'Chofer principal', value: member.primaryDriverName || (member.primaryDriverUid ? `Conductor ${member.primaryDriverUid}` : 'Sin vinculación') },
      { label: 'Observaciones', value: display(member.notes) },
    ],
    children: (member.children || []).map((child) => ({
      child,
      fields: [
        { label: 'CI', value: display(child.ci) },
        { label: 'Nacimiento', value: formatDate(child.birthDate) },
        { label: 'Teléfono', value: display(child.phone) },
        { label: 'Domicilio', value: display(child.address) },
        { label: 'Conductor vinculado', value: child.driverName || (child.driverUid ? `Conductor ${child.driverUid}` : 'Sin vinculación') },
        { label: 'Observaciones', value: display(child.notes) },
      ],
    })),
  }))
}

export function buildUnionMembersRosterPdf(
  members: UnionRosterMember[],
  scope: UnionRosterScope,
  generatedAt = new Date()
): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const bottomLimit = pageHeight - 17
  const activeCount = members.filter((member) => member.status === 'active').length
  const retiredCount = members.filter((member) => member.status === 'retired').length
  const generatedDate = generatedAt.toLocaleDateString('es-BO')
  const scopeLabel = getUnionRosterScopeLabel(scope)
  let cursorY = 0

  const drawHeader = () => {
    pdf.setFillColor(6, 78, 59)
    pdf.rect(0, 0, pageWidth, 29, 'F')
    pdf.setTextColor(250, 204, 21)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.text('EXPRESO PUNATA', margin, 12)
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('Sindicato Mixto y Empresa de Transporte Interprovincial', margin, 19)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text(scopeLabel, pageWidth - margin, 12, { align: 'right' })
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Generado: ${generatedDate}`, pageWidth - margin, 19, { align: 'right' })
    pdf.setTextColor(15, 23, 42)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.text('Padrón de Afiliados', margin, 38)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(71, 85, 105)
    pdf.text(`Afiliados: ${members.length}   ·   Activos: ${activeCount}   ·   Retirados: ${retiredCount}`, margin, 44)
    pdf.setTextColor(15, 23, 42)
    cursorY = 52
  }

  const nextPage = () => {
    pdf.addPage()
    drawHeader()
  }

  const ensureSpace = (height: number) => {
    if (cursorY + height > bottomLimit) nextPage()
  }

  const writeWrapped = (label: string, value: string, indent = 0) => {
    const text = `${label}: ${value}`
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    const lines = pdf.splitTextToSize(text, contentWidth - indent)
    const lineHeight = 4.2
    ensureSpace(lines.length * lineHeight + 1)
    pdf.setTextColor(51, 65, 85)
    pdf.text(lines, margin + indent, cursorY)
    cursorY += lines.length * lineHeight
  }

  drawHeader()
  if (members.length === 0) {
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(9)
    pdf.setTextColor(100, 116, 139)
    pdf.text('No hay afiliados que coincidan con la selección.', margin, cursorY + 3)
  } else {
    for (const entry of buildUnionRosterEntries(members)) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      const memberLabel = `${entry.member.memberNumber ? `${entry.member.memberNumber} · ` : ''}${entry.member.fullName || 'Afiliado sin nombre'}`
      const memberLabelLines = pdf.splitTextToSize(memberLabel, contentWidth - 6)
      const memberLabelHeight = memberLabelLines.length * 4.5 + 3
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      const estimateRows = (fields: UnionRosterField[], indent: number) => fields.reduce((height, field) => {
        const lines = pdf.splitTextToSize(`${field.label}: ${field.value}`, contentWidth - indent)
        return height + lines.length * 4.2 + 1
      }, 0)
      const childHeight = entry.children.reduce((height, childEntry) => {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8.5)
        const childTitleLines = pdf.splitTextToSize(childEntry.child.fullName || 'Hijo sin nombre', contentWidth - 12)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8.5)
        return height + childTitleLines.length * 4.2 + 5 + estimateRows(childEntry.fields, 8)
      }, entry.children.length ? 6 : 5)
      const estimatedBlockHeight = memberLabelHeight + 8 + estimateRows(entry.fields, 2) + childHeight + 5
      const usablePageHeight = bottomLimit - 52
      if (estimatedBlockHeight <= usablePageHeight && cursorY + estimatedBlockHeight > bottomLimit) nextPage()
      ensureSpace(memberLabelHeight + 4)
      pdf.setFillColor(236, 253, 245)
      pdf.roundedRect(margin, cursorY - 4, contentWidth, memberLabelHeight, 1.5, 1.5, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.setTextColor(6, 78, 59)
      pdf.text(memberLabelLines, margin + 3, cursorY + 1)
      cursorY += memberLabelHeight
      for (const field of entry.fields) writeWrapped(field.label, field.value, 2)

      if (entry.children.length === 0) {
        writeWrapped('Hijos', 'Sin hijos registrados', 2)
      } else {
        ensureSpace(8)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8.5)
        pdf.setTextColor(6, 78, 59)
        pdf.text(`Hijos registrados (${entry.children.length})`, margin + 2, cursorY + 1)
        cursorY += 5
        for (const [index, childEntry] of entry.children.entries()) {
          ensureSpace(8)
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8.5)
          pdf.setTextColor(30, 41, 59)
          const childTitleLines = pdf.splitTextToSize(`${index + 1}. ${childEntry.child.fullName || 'Hijo sin nombre'}`, contentWidth - 12)
          ensureSpace(childTitleLines.length * 4.2 + 3)
          pdf.text(childTitleLines, margin + 5, cursorY + 1)
          cursorY += childTitleLines.length * 4.2 + 1
          for (const field of childEntry.fields) writeWrapped(field.label, field.value, 8)
        }
      }
      ensureSpace(5)
      pdf.setDrawColor(203, 213, 225)
      pdf.setLineWidth(0.25)
      pdf.line(margin, cursorY + 1, pageWidth - margin, cursorY + 1)
      cursorY += 5
    }
  }

  ensureSpace(20)
  pdf.setFillColor(248, 250, 252)
  pdf.roundedRect(margin, cursorY, contentWidth, 12, 1.5, 1.5, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(6, 78, 59)
  pdf.text(`Total de afiliados: ${members.length}  ·  Activos: ${activeCount}  ·  Retirados: ${retiredCount}`, margin + 3, cursorY + 7.5)

  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.setDrawColor(203, 213, 225)
    pdf.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(100, 116, 139)
    pdf.text(`EXPRESO PUNATA · ${scopeLabel}`, margin, pageHeight - 8)
    pdf.text(`Página ${page} de ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
  }
  return pdf
}

export function downloadUnionMembersRosterPdf(members: UnionRosterMember[], scope: UnionRosterScope): number {
  const pdf = buildUnionMembersRosterPdf(members, scope)
  const date = new Date().toISOString().slice(0, 10)
  pdf.save(`padron-afiliados-${scope}-${date}.pdf`)
  return pdf.getNumberOfPages()
}
