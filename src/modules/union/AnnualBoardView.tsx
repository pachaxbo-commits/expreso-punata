import React, { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Edit2, Plus, RefreshCw, Save, Users, X } from 'lucide-react'
import type { AnnualBoard, AnnualBoardStatus, UnionMember } from '../../types/index.ts'
import { listAnnualBoardsThroughBackend, saveAnnualBoardThroughBackend } from '../../services/unionService.ts'

interface Props { members: UnionMember[] }
interface Entry { memberId: string; position: string }
interface FormState { id?: string; year: number; startDate: string; endDate: string; electedAt: string; observations: string; status: AnnualBoardStatus; members: Entry[] }
const statusLabels: Record<AnnualBoardStatus, string> = { planned: 'Programada', active: 'En ejercicio', completed: 'Concluida', cancelled: 'Cancelada' }
const blankForm = (): FormState => ({ year: new Date().getFullYear(), startDate: '', endDate: '', electedAt: '', observations: '', status: 'active', members: [{ memberId: '', position: '' }] })

export const AnnualBoardView: React.FC<Props> = ({ members }) => {
  const [boards, setBoards] = useState<AnnualBoard[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { const result = await listAnnualBoardsThroughBackend(); setBoards(result.boards); setTruncated(result.truncated) }
    catch (err: any) { setError(err?.message || 'No se pudo consultar el historial de directivas.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const openEdit = (board: AnnualBoard) => setForm({ id: board.id, year: board.year, startDate: board.startDate, endDate: board.endDate, electedAt: board.electedAt, observations: board.observations || '', status: board.status, members: board.members.map(({ memberId, position }) => ({ memberId, position })) })
  const addEntry = () => setForm((state) => state ? { ...state, members: [...state.members, { memberId: '', position: '' }] } : state)
  const updateEntry = (index: number, field: keyof Entry, value: string) => setForm((state) => state ? { ...state, members: state.members.map((entry, i) => i === index ? { ...entry, [field]: value } : entry) } : state)
  const removeEntry = (index: number) => setForm((state) => state ? { ...state, members: state.members.filter((_, i) => i !== index) } : state)
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form || saving) return
    setSaving(true); setError(''); setMessage('')
    try {
      await saveAnnualBoardThroughBackend(form)
      setForm(null); setMessage('La gestión se guardó correctamente.'); await refresh()
    } catch (err: any) { setError(err?.message || 'No se pudo guardar la gestión.') }
    finally { setSaving(false) }
  }

  const currentBoard = boards.find((board) => board.status === 'active')
  return <div className="space-y-4">
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div><h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900"><Users className="h-5 w-5 text-emerald-800"/>Directiva institucional</h2><p className="mt-1 text-xs text-slate-600">Consulte la gestión vigente y conserve el historial por período.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}/>Actualizar</button><button type="button" onClick={() => { setMessage(''); setError(''); setForm(blankForm()) }} className="inline-flex items-center gap-1 rounded-lg bg-[#064e3b] px-3 py-2 text-xs font-bold text-white"><Plus className="h-4 w-4"/>Nueva gestión</button></div>
    </section>
    {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{message}</p>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
    {!loading && currentBoard && <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="rounded-full bg-emerald-800 px-2 py-1 text-[10px] font-bold text-white">GESTIÓN ACTUAL</span><h3 className="mt-2 text-sm font-extrabold text-emerald-950">Período {currentBoard.year} · {currentBoard.startDate} al {currentBoard.endDate}</h3></div><button type="button" onClick={() => openEdit(currentBoard)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-800 px-3 py-2 text-xs font-bold text-emerald-900"><Edit2 className="h-3.5 w-3.5"/>Editar</button></div><BoardMembers board={currentBoard}/></article>}
    {form && <form onSubmit={(event) => void save(event)} className="space-y-4 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="font-extrabold text-slate-900">{form.id ? `Editar gestión ${form.year}` : 'Registrar nueva gestión'}</h3><button type="button" onClick={() => setForm(null)} className="rounded p-1 text-slate-500" aria-label="Cerrar formulario"><X className="h-4 w-4"/></button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-slate-700">Año<input type="number" min="1900" max="2200" required disabled={Boolean(form.id)} value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <label className="text-xs font-bold text-slate-700">Fecha de elección/designación<input type="date" required value={form.electedAt} onChange={(e) => setForm({ ...form, electedAt: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <label className="text-xs font-bold text-slate-700">Inicio<input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <label className="text-xs font-bold text-slate-700">Finalización<input type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <label className="text-xs font-bold text-slate-700 sm:col-span-2">Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AnnualBoardStatus })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-700 sm:col-span-2">Observaciones<textarea maxLength={2000} rows={2} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
      </div>
      <div className="space-y-2"><div className="flex items-center justify-between"><h4 className="text-sm font-extrabold text-slate-800">Integrantes y cargos</h4><button type="button" onClick={addEntry} disabled={form.members.length >= 30} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50">Agregar integrante</button></div>
        {form.members.map((entry, index) => <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs font-semibold text-slate-700">Afiliado<select required value={entry.memberId} onChange={(e) => updateEntry(index, 'memberId', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Seleccione un afiliado</option>{members.map((member) => <option key={member.id} value={member.id}>{member.memberNumber} · {member.fullName}{member.status === 'retired' ? ' (retirado)' : ''}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Cargo<input required maxLength={100} value={entry.position} onChange={(e) => updateEntry(index, 'position', e.target.value)} placeholder="Escriba el cargo" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
          {form.members.length > 1 && <button type="button" onClick={() => removeEntry(index)} className="self-end rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600">Quitar</button>}
        </div>)}
      </div>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold">Cancelar</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#064e3b] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4"/>{saving ? 'Guardando…' : 'Guardar gestión'}</button></div>
    </form>}
    <section className="space-y-2"><h3 className="font-extrabold text-slate-900">Historial de gestiones</h3>{loading ? <p className="rounded-lg bg-white p-5 text-center text-xs text-slate-600">Cargando historial…</p> : boards.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-600">Todavía no hay gestiones registradas.</p> : boards.map((board) => <article key={board.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-extrabold text-slate-900">Gestión {board.year} <span className="ml-1 rounded-full bg-slate-100 px-2 py-1 text-[10px]">{statusLabels[board.status]}</span></h4><p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-600"><CalendarDays className="h-3.5 w-3.5"/>{board.startDate} al {board.endDate} · Designación {board.electedAt}</p></div><button type="button" onClick={() => openEdit(board)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><Edit2 className="mr-1 inline h-3.5 w-3.5"/>Editar</button></div><BoardMembers board={board}/>{board.observations && <p className="mt-2 text-xs text-slate-600"><strong>Observaciones:</strong> {board.observations}</p>}</article>)}</section>
    {truncated && <p className="text-xs text-amber-800">Se muestran las 100 gestiones más recientes.</p>}
    <p className="text-[11px] text-slate-500">La designación institucional no crea usuarios ni modifica permisos del sistema.</p>
  </div>
}

const BoardMembers: React.FC<{ board: AnnualBoard }> = ({ board }) => <div className="mt-3 grid gap-2 sm:grid-cols-2">{board.members.map((entry) => <div key={entry.memberId} className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-xs font-bold text-slate-800">{entry.fullName}</p><p className="text-xs text-emerald-800">{entry.position} · {entry.memberNumber}</p></div>)}</div>
