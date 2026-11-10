import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import type { UnionMember, UnionSportsAttendance, UnionSportsEvent } from '../../types/index.ts'
import {
  completeUnionSportsEventThroughBackend,
  createUnionSportsEventThroughBackend,
  decideUnionSportsJustificationThroughBackend,
  listUnionSportsEventsThroughBackend,
  requestUnionSportsJustificationThroughBackend,
  setUnionSportsAttendanceThroughBackend,
} from '../../services/unionService.ts'
import { formatCurrencyBob } from '../../domain/parcelEngine.ts'

const attendanceLabels: Record<UnionSportsAttendance, string> = {
  pending: 'Pendiente de control', present: 'Presente', late: 'Tardanza', absent: 'Ausente', exempt: 'Exento autorizado',
}
const attendanceTone: Record<UnionSportsAttendance, string> = {
  pending: 'text-slate-600', present: 'text-emerald-700', late: 'text-amber-700', absent: 'text-red-700', exempt: 'text-blue-700',
}
const makeKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export const UnionSportsView: React.FC<{
  members: UnionMember[]
  canManage: boolean
  canDecide: boolean
}> = ({ members, canManage, canDecide }) => {
  const [events, setEvents] = useState<UnionSportsEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [justificationReasons, setJustificationReasons] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ date: '', scheduledTime: '09:00', activityName: '', place: '', notes: '', memberIds: [] as string[] })
  const createOperationRef = useRef<{ fingerprint: string; key: string } | null>(null)

  const reload = async () => {
    setLoading(true); setError('')
    try {
      setEvents(await listUnionSportsEventsThroughBackend({
        ...(eventFilter ? { eventId: eventFilter } : {}),
        ...(memberFilter ? { memberId: memberFilter } : {}),
        ...(dateFilter ? { startDate: dateFilter, endDate: dateFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter as 'scheduled' | 'completed' } : {}),
      }))
    } catch (e: any) { setError(e?.message || 'No se pudieron consultar las jornadas deportivas.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [memberFilter, eventFilter, dateFilter, statusFilter])

  const visibleEvents = useMemo(() => events, [events])
  const createEvent = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const fingerprint = JSON.stringify(form)
      if (!createOperationRef.current || createOperationRef.current.fingerprint !== fingerprint) createOperationRef.current = { fingerprint, key: makeKey('sports-event') }
      await createUnionSportsEventThroughBackend({ ...form, idempotencyKey: createOperationRef.current.key })
      setNotice('Jornada creada y afiliados convocados. La asistencia quedó pendiente de control.')
      setForm((current) => ({ ...current, activityName: '', place: '', notes: '', memberIds: [] }))
      createOperationRef.current = null
      await reload()
    } catch (e: any) { setError(e?.message || 'No se pudo crear la jornada.') }
    finally { setSaving(false) }
  }

  const setAttendance = async (event: UnionSportsEvent, memberId: string, attendance: UnionSportsAttendance) => {
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await setUnionSportsAttendanceThroughBackend({ eventId: event.id, memberId, attendance, reason: 'Registro de asistencia', idempotencyKey: makeKey('sports-attendance') })
      setNotice(result.financialReviewRequired ? 'Asistencia actualizada. La multa ya tiene pagos y requiere revisión financiera autorizada.' : attendance === 'late' ? 'Tardanza registrada; multa deportiva de Bs 50 vinculada.' : attendance === 'absent' ? 'Inasistencia registrada; multa deportiva de Bs 100 vinculada.' : 'Asistencia actualizada; no se generó una nueva multa.')
      await reload()
    } catch (e: any) { setError(e?.message || 'No se pudo actualizar la asistencia.') }
    finally { setSaving(false) }
  }

  const requestJustification = async (event: UnionSportsEvent, memberId: string) => {
    const key = `${event.id}:${memberId}`
    const reason = (justificationReasons[key] || '').trim()
    if (reason.length < 3) { setError('Describe el motivo de la justificación.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      await requestUnionSportsJustificationThroughBackend({ eventId: event.id, memberId, reason, requestDate: new Date().toLocaleDateString('en-CA'), idempotencyKey: makeKey('sports-justification') })
      setJustificationReasons((current) => ({ ...current, [key]: '' }))
      setNotice('Justificación registrada. No concede exención hasta la decisión del Directorio.')
      await reload()
    } catch (e: any) { setError(e?.message || 'No se pudo registrar la justificación.') }
    finally { setSaving(false) }
  }

  const decideJustification = async (event: UnionSportsEvent, memberId: string, justificationId: string, decision: 'approved' | 'rejected') => {
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await decideUnionSportsJustificationThroughBackend({ eventId: event.id, memberId, justificationId, decision, idempotencyKey: makeKey('sports-decision') })
      setNotice(decision === 'approved'
        ? result.financialReviewRequired ? 'Exención autorizada. La multa ya tiene pagos; la situación financiera requiere revisión autorizada.' : 'Exención autorizada por el Directorio; la deuda impaga fue anulada sin movimiento de Caja.'
        : 'Justificación rechazada por el Directorio. Se conserva la asistencia registrada.')
      await reload()
    } catch (e: any) { setError(e?.message || 'No se pudo guardar la decisión del Directorio.') }
    finally { setSaving(false) }
  }

  const completeEvent = async (event: UnionSportsEvent) => {
    setSaving(true); setError(''); setNotice('')
    try {
      await completeUnionSportsEventThroughBackend({ eventId: event.id, idempotencyKey: makeKey('sports-complete') })
      setNotice('Jornada completada. El historial de asistencia quedó disponible.')
      await reload()
    } catch (e: any) { setError(e?.message || 'No se pudo completar la jornada.') }
    finally { setSaving(false) }
  }

  return <div className="space-y-4">
    {canManage && <form onSubmit={(event) => void createEvent(event)} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-4">
      <h3 className="text-sm font-extrabold text-emerald-900 md:col-span-2 lg:col-span-4">Crear jornada deportiva</h3>
      <label className="text-xs font-bold">Fecha<input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="text-xs font-bold">Hora programada<input required type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="text-xs font-bold">Actividad<input required maxLength={200} value={form.activityName} onChange={(e) => setForm({ ...form, activityName: e.target.value })} className="mt-1 w-full rounded-lg border p-2" placeholder="Ej. Campeonato de fútbol" /></label>
      <label className="text-xs font-bold">Lugar (opcional)<input maxLength={300} value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
      <label className="text-xs font-bold md:col-span-2">Afiliados convocados<select required multiple value={form.memberIds} onChange={(e) => setForm({ ...form, memberIds: Array.from(e.target.selectedOptions, (option) => option.value) })} className="mt-1 h-32 w-full rounded-lg border p-2">{members.filter((member) => member.status === 'active').map((member) => <option key={member.id} value={member.id}>{member.memberNumber} · {member.fullName}</option>)}</select><span className="mt-1 block font-normal text-slate-500">Usa Ctrl/Cmd para elegir varios afiliados. Solo las personas convocadas tendrán control de asistencia.</span></label>
      <label className="text-xs font-bold md:col-span-2">Observaciones<textarea maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
      <button disabled={saving || form.memberIds.length === 0} className="rounded-lg bg-[#064e3b] px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Crear y convocar'}</button>
    </form>}

    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
      <label className="text-xs font-bold">Afiliado<select value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} className="mt-1 block rounded border p-2"><option value="">Todos</option>{members.map((member) => <option key={member.id} value={member.id}>{member.memberNumber} · {member.fullName}</option>)}</select></label>
      <label className="text-xs font-bold">Jornada<select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} className="mt-1 block rounded border p-2"><option value="">Todas</option>{events.map((event) => <option key={event.id} value={event.id}>{event.date} · {event.activityName}</option>)}</select></label>
      <label className="text-xs font-bold">Fecha<input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="mt-1 block rounded border p-2" /></label>
      <label className="text-xs font-bold">Estado<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 block rounded border p-2"><option value="all">Todas</option><option value="scheduled">Programada</option><option value="completed">Completada</option></select></label>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
    {loading ? <div className="p-8 text-center text-sm text-slate-500"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />Cargando jornadas…</div> : visibleEvents.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-2 h-5 w-5" />No hay jornadas para los filtros seleccionados.</div> : <div className="space-y-4">{visibleEvents.map((event) => {
      const allControlled = event.participants.length > 0 && event.participants.every((participant) => participant.attendance !== 'pending')
      return <article key={event.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50 p-4"><div><h3 className="font-extrabold text-emerald-950">{event.activityName}</h3><p className="mt-1 text-xs text-slate-600">{event.date} · {event.scheduledTime}{event.place ? ` · ${event.place}` : ''} · {event.participantCount} convocados</p>{event.notes && <p className="mt-1 text-xs text-slate-600">{event.notes}</p>}</div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${event.status === 'completed' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-800'}`}>{event.status === 'completed' ? 'COMPLETADA' : 'PROGRAMADA'}</span>{canManage && event.status === 'scheduled' && <button type="button" disabled={!allControlled || saving} onClick={() => void completeEvent(event)} className="rounded-lg bg-[#064e3b] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Completar jornada</button>}</div></header>
        <div className="divide-y divide-slate-100">{event.participants.map((participant) => {
          const key = `${event.id}:${participant.memberId}`
          return <section key={participant.memberId} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">{participant.memberNumber} · {participant.memberName}</strong><p className={`mt-1 text-xs font-bold ${attendanceTone[participant.attendance]}`}>{attendanceLabels[participant.attendance]}</p></div>{canManage && <label className="text-xs font-bold">Asistencia<select disabled={saving || (participant.attendance === 'exempt' && !canDecide)} value={participant.attendance === 'exempt' ? 'exempt' : participant.attendance} onChange={(e) => void setAttendance(event, participant.memberId, e.target.value as UnionSportsAttendance)} className="ml-2 rounded border p-2"><option value="pending">Pendiente de control</option><option value="present">Presente</option><option value="late">Tardanza · Bs 50</option><option value="absent">Ausente · Bs 100</option>{participant.attendance === 'exempt' && <option value="exempt">Exento autorizado</option>}</select></label>}</div>
            {participant.sportsFine && <div className={`rounded-lg border p-3 text-xs ${participant.sportsFine.financialReviewRequired ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>Multa deportiva {participant.sportsFine.fineNumber}</strong><span>Importe {formatCurrencyBob(participant.sportsFine.amountCents, true)} · Pagado {formatCurrencyBob(participant.sportsFine.paidCents, true)} · Saldo {formatCurrencyBob(participant.sportsFine.balanceCents, true)}</span></div><p className="mt-1">Estado: {participant.sportsFine.status === 'voided' ? 'Anulada por corrección' : participant.sportsFine.status === 'paid' ? 'Pagada' : participant.sportsFine.status === 'partial' ? 'Parcialmente pagada' : 'Pendiente'} · Visible en Multas y en la ficha del afiliado.</p>{participant.sportsFine.financialReviewRequired && <p className="mt-1 font-bold text-red-800">Requiere una decisión financiera autorizada. No se borraron pagos ni movimientos.</p>}</div>}
            {canManage && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-bold">Registrar justificación deportiva</summary><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input value={justificationReasons[key] || ''} onChange={(e) => setJustificationReasons((current) => ({ ...current, [key]: e.target.value }))} maxLength={1500} placeholder="Motivo de la justificación" className="min-w-0 flex-1 rounded border p-2 text-xs" /><button type="button" disabled={saving} onClick={() => void requestJustification(event, participant.memberId)} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">Registrar solicitud</button></div></details>}
            {participant.justifications?.map((justification) => <div key={justification.id} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Justificación: {justification.reason}</strong><span className="font-bold">{justification.status === 'pending' ? 'Pendiente del Directorio' : justification.status === 'approved' ? 'Aprobada' : 'Rechazada'}</span></div><p className="mt-1 text-slate-600">Registrada {justification.requestDate} por {justification.requestedByName}{justification.decisionByName ? ` · Decidió ${justification.decisionByName} el ${justification.decisionAtIso?.slice(0, 10)}` : ''}{justification.decisionNotes ? ` · ${justification.decisionNotes}` : ''}</p>{canDecide && justification.status === 'pending' && <div className="mt-2 flex gap-2"><button type="button" disabled={saving} onClick={() => void decideJustification(event, participant.memberId, justification.id, 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" />Aprobar exención</button><button type="button" disabled={saving} onClick={() => void decideJustification(event, participant.memberId, justification.id, 'rejected')} className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2 font-bold text-red-800 disabled:opacity-50"><UserX className="h-3.5 w-3.5" />Rechazar</button></div>}</div>)}
            {participant.attendanceHistory?.length > 0 && <details><summary className="cursor-pointer text-xs font-bold text-slate-600">Historial de asistencia ({participant.attendanceHistory.length})</summary><ul className="mt-2 space-y-1 text-xs text-slate-600">{participant.attendanceHistory.map((entry, index) => <li key={`${entry.changedAtIso}-${index}`}>{entry.changedAtIso.slice(0, 16).replace('T', ' ')} · {attendanceLabels[entry.attendance]} · {entry.changedByName}{entry.reason ? ` · ${entry.reason}` : ''}</li>)}</ul></details>}
          </section>
        })}</div>
        {event.participants.length > 0 && <footer className="flex gap-2 border-t bg-slate-50 p-3 text-[11px] text-slate-600"><UserCheck className="h-4 w-4" />Las personas no convocadas no reciben estado ni multa por esta jornada.</footer>}
      </article>
    })}</div>}
  </div>
}
