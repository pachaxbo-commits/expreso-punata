import React, { useEffect, useMemo, useState } from 'react'
import { FileText, Plus, Search, Pencil, X } from 'lucide-react'
import type { PatrimonialLocationId, PhysicalInventoryDocument, UserProfile } from '../../types/index.ts'
import { fetchPhysicalInventoryDocuments, managePhysicalInventoryDocument } from '../../services/assetService.ts'

const LOCATIONS: { id: PatrimonialLocationId; label: string }[] = [
  { id: 'sede_punata', label: 'Sede Punata' },
  { id: 'oficina_punata', label: 'Oficina Punata' },
  { id: 'oficina_cochabamba', label: 'Oficina Cochabamba' },
]
type DocumentForm = { title: string; documentType: string; description: string; patrimonialLocationId: PatrimonialLocationId; sheetCount: string; documentDate: string; responsibleReference: string; status: 'active' | 'archived' | 'missing'; notes: string }
const EMPTY_FORM: DocumentForm = { title: '', documentType: 'Carpeta', description: '', patrimonialLocationId: 'sede_punata', sheetCount: '0', documentDate: new Date().toISOString().slice(0, 10), responsibleReference: '', status: 'active', notes: '' }

export const PhysicalInventoryDocumentsView: React.FC<{ userProfile: UserProfile }> = ({ userProfile }) => {
  const [documents, setDocuments] = useState<PhysicalInventoryDocument[]>([])
  const [location, setLocation] = useState<PatrimonialLocationId | 'all'>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PhysicalInventoryDocument | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState<DocumentForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canManage = ['directiva_admin', 'encargado_agencia', 'tesoreria'].includes(userProfile.role)
  const load = async () => setDocuments(await fetchPhysicalInventoryDocuments({ patrimonialLocationId: location, search }))
  useEffect(() => { void load().catch((err) => setError(err.message || 'No se pudieron cargar los documentos físicos.')) }, [location])
  const filtered = useMemo(() => documents.filter((doc) => [doc.title, doc.documentType, doc.description].some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))), [documents, search])

  const beginEdit = (doc?: PhysicalInventoryDocument) => {
    setIsFormOpen(true)
    setEditing(doc || null)
    setForm(doc ? { title: doc.title, documentType: doc.documentType, description: doc.description, patrimonialLocationId: doc.patrimonialLocationId, sheetCount: String(doc.sheetCount), documentDate: doc.documentDate, responsibleReference: doc.responsibleReference || '', status: doc.status, notes: doc.notes || '' } : { ...EMPTY_FORM })
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await managePhysicalInventoryDocument({ ...form, action: editing ? 'update' : 'create', ...(editing ? { id: editing.id } : {}), sheetCount: Number(form.sheetCount) })
      setEditing(null); setIsFormOpen(false); setForm(EMPTY_FORM); await load()
    } catch (err: any) { setError(err.message || 'No se pudo guardar el registro.') } finally { setSaving(false) }
  }

  return <section className="space-y-3">
    <div className="flex flex-col sm:flex-row gap-2 justify-between bg-white p-3 rounded-xl border border-slate-200">
      <div className="flex gap-2 flex-1">
        <div className="relative flex-1"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, tipo o descripción" className="w-full pl-8 p-2 text-xs border rounded-lg"/></div>
        <select value={location} onChange={(e) => setLocation(e.target.value as typeof location)} className="p-2 text-xs border rounded-lg"><option value="all">Todas las sedes y oficinas</option>{LOCATIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      </div>
      {canManage && <button onClick={() => beginEdit()} className="px-3 py-2 text-xs rounded-lg bg-[#064e3b] text-white font-bold flex items-center gap-1"><Plus className="w-4 h-4"/>Registrar carpeta</button>}
    </div>
    {error && <div className="p-3 rounded-lg bg-rose-50 text-rose-800 text-xs">{error}</div>}
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{filtered.map((doc) => <article key={doc.id} className="p-4 bg-white border border-slate-200 rounded-xl">
      <div className="flex gap-2 justify-between"><div className="flex gap-2"><FileText className="w-4 h-4 text-[#064e3b]"/><div><h4 className="font-bold text-sm">{doc.title}</h4><p className="text-xs text-slate-500">{doc.documentType} · {LOCATIONS.find((item) => item.id === doc.patrimonialLocationId)?.label}</p></div></div>{canManage && <button onClick={() => beginEdit(doc)} aria-label="Editar registro" className="p-1 text-slate-500"><Pencil className="w-4 h-4"/></button>}</div>
      <p className="mt-3 text-xs"><strong>{doc.sheetCount}</strong> hojas · {doc.documentDate} · {doc.status === 'active' ? 'Vigente' : doc.status === 'missing' ? 'Extraviado' : 'Archivado'}</p>
      {doc.description && <p className="mt-1 text-xs text-slate-600">{doc.description}</p>}{doc.responsibleReference && <p className="mt-1 text-xs text-slate-500">Referencia: {doc.responsibleReference}</p>}
    </article>)}</div>
    {filtered.length === 0 && <div className="p-8 text-center bg-white border rounded-xl text-sm text-slate-500">No hay documentos físicos con estos filtros.</div>}
    {(canManage && isFormOpen) && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3"><form onSubmit={save} className="bg-white rounded-xl shadow-xl max-w-xl w-full p-5 space-y-3 max-h-[90vh] overflow-auto">
      <header className="flex justify-between"><h3 className="font-bold">{editing ? 'Editar documento físico' : 'Registrar documento físico'}</h3><button type="button" onClick={() => { setEditing(null); setIsFormOpen(false); setForm(EMPTY_FORM) }}><X className="w-4 h-4"/></button></header>
      <input required minLength={2} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Nombre o título" className="w-full p-2 border rounded text-sm"/>
      <div className="grid grid-cols-2 gap-2"><input required value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} placeholder="Tipo: carpeta, acta..." className="p-2 border rounded text-sm"/><select value={form.patrimonialLocationId} onChange={(e) => setForm({ ...form, patrimonialLocationId: e.target.value as PatrimonialLocationId })} className="p-2 border rounded text-sm">{LOCATIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción" className="w-full p-2 border rounded text-sm"/>
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">Número de hojas<input type="number" min="0" step="1" required value={form.sheetCount} onChange={(e) => setForm({ ...form, sheetCount: e.target.value })} className="mt-1 w-full p-2 border rounded text-sm"/></label><label className="text-xs">Fecha<input type="date" required value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} className="mt-1 w-full p-2 border rounded text-sm"/></label></div>
      <input value={form.responsibleReference} onChange={(e) => setForm({ ...form, responsibleReference: e.target.value })} placeholder="Responsable o referencia (opcional)" className="w-full p-2 border rounded text-sm"/>
      <div className="grid grid-cols-2 gap-2"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })} className="p-2 border rounded text-sm"><option value="active">Vigente</option><option value="archived">Archivado</option><option value="missing">Extraviado</option></select><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Observaciones" className="p-2 border rounded text-sm"/></div>
      <footer className="flex justify-end gap-2"><button type="button" onClick={() => { setEditing(null); setIsFormOpen(false); setForm(EMPTY_FORM) }} className="px-3 py-2 rounded border text-sm">Cancelar</button><button disabled={saving} className="px-3 py-2 rounded bg-[#064e3b] text-white text-sm">{saving ? 'Guardando…' : 'Guardar'}</button></footer>
    </form></div>}
  </section>
}
