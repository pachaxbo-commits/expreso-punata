import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/config'

const affiliateModules = [
  ['encomiendas', 'Encomiendas'], ['pasajes', 'Pasajes'], ['almacen', 'Almacén'],
  ['caja', 'Caja'], ['comisiones', 'Comisiones'], ['afiliados', 'Afiliados'],
  ['aportes', 'Aportes'], ['prestamos', 'Préstamos'], ['multas', 'Multas'],
  ['deportes', 'Deportes'], ['inventario', 'Inventario'], ['personal', 'Personal'],
  ['gastos', 'Gastos'], ['reportes', 'Reportes'], ['historial', 'Historial'],
] as const

type Field = string | number | boolean
type Row = { date: string; values: Record<string, Field> }
type Filters = { search: string; from: string; to: string }
type Page = {
  columns: { key: string; label: string; money: boolean }[]
  rows: Row[]
  nextCursor: string | null
}
const emptyFilters = { search: '', from: '', to: '' }
const readPage = httpsCallable<Filters & { module: string; branchId: string; cursor: string }, Page>(functions, 'listAffiliateOperations')

function format(value: Field | undefined, money: boolean) {
  if (typeof value === 'number' && money) return 'Bs ' + (value / 100).toFixed(2)
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value ?? '—'
}

export function AffiliateOperationsView({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [module, setModule] = useState<(typeof affiliateModules)[number][0]>('encomiendas')
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [cursor, setCursor] = useState('')
  const [page, setPage] = useState<Page>()
  const [selected, setSelected] = useState<Row>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const title = affiliateModules.find(([key]) => key === module)?.[1]

  useEffect(() => {
    let current = true
    void readPage({ module, branchId, cursor, ...filters }).then(({ data }) => {
      if (current) setPage(data)
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : 'No se pudo consultar la agencia.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [module, branchId, cursor, filters])

  function clearResults(nextCursor = '') {
    setLoading(true)
    setError('')
    setPage(undefined)
    setSelected(undefined)
    setCursor(nextCursor)
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-bold text-slate-900">{title} · {branchName}</h2>
      <div className="flex flex-wrap gap-2 print:hidden" aria-label="Módulos de consulta">
        {affiliateModules.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={module === key}
            className={module === key ? 'rounded-lg bg-emerald-800 px-3 py-2 text-white' : 'rounded-lg bg-slate-100 px-3 py-2'}
            onClick={() => {
              if (module === key) return
              clearResults()
              setModule(key)
            }}>{label}</button>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-3 print:hidden" onSubmit={event => {
        event.preventDefault()
        clearResults()
        setFilters({ ...draft })
      }}>
        <label className="grid gap-1">Buscar<input className="rounded border p-2" value={draft.search} maxLength={80} onChange={event => setDraft({ ...draft, search: event.target.value })} /></label>
        <label className="grid gap-1">Desde<input className="rounded border p-2" type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
        <label className="grid gap-1">Hasta<input className="rounded border p-2" type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
        <button type="submit" className="rounded bg-emerald-800 px-3 py-2 text-white">Aplicar filtros</button>
      </form>
      {loading && <p role="status">Consultando registros…</p>}
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          <button type="button" disabled={!page.rows.length} className="rounded bg-slate-100 px-3 py-2 print:hidden" onClick={() => window.print()}>
            Imprimir resultados de esta página
          </button>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Fecha</th>{page.columns.map(column => <th key={column.key} className="p-2">{column.label}</th>)}<th className="print:hidden"><span className="sr-only">Detalle</span></th></tr></thead>
              <tbody>
                {page.rows.map((row, index) => (
                  <tr key={index} className="border-t">
                    <td className="p-2">{row.date || '—'}</td>
                    {page.columns.map(column => <td key={column.key} className="p-2">{format(row.values[column.key], column.money)}</td>)}
                    <td className="p-2 print:hidden"><button className="font-bold text-emerald-800" type="button" onClick={() => setSelected(row)}>Ver detalle</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.rows.length === 0 && <p>Esta página no contiene registros que coincidan con los filtros.</p>}
          {page.nextCursor && <button type="button" className="rounded bg-slate-100 px-3 py-2 print:hidden" onClick={() => clearResults(page.nextCursor ?? '')}>Continuar búsqueda</button>}
          {cursor && <button type="button" className="ml-2 rounded bg-slate-100 px-3 py-2 print:hidden" onClick={() => clearResults()}>Primera página</button>}
          {selected && <section className="rounded border p-3" aria-label="Detalle del registro">
            <div className="flex justify-between"><h3 className="font-bold">Detalle del registro</h3><button type="button" className="print:hidden" onClick={() => setSelected(undefined)}>Cerrar detalle</button></div>
            <dl className="grid grid-cols-2 gap-2 pt-2">
              <dt>Fecha</dt><dd>{selected.date || '—'}</dd>
              {page.columns.flatMap(column => [<dt key={column.key + '-label'}>{column.label}</dt>, <dd key={column.key}>{format(selected.values[column.key], column.money)}</dd>])}
            </dl>
          </section>}
        </>
      )}
    </section>
  )
}
