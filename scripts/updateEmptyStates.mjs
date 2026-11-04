import fs from 'node:fs'

const unionPath = 'src/modules/union/UnionMembersView.tsx'
let unionContent = fs.readFileSync(unionPath, 'utf8')

const targetUnion = `<p className="text-sm font-bold text-slate-700">No se encontraron socios</p>
              <p className="text-xs text-slate-500 mt-1">
                {searchTerm ? 'Intente con otros criterios de búsqueda.' : 'Aún no hay socios registrados en el padrón.'}
              </p>`

const replacementUnion = `<p className="text-sm font-bold text-slate-700">
                {searchTerm ? 'No se encontraron socios' : 'Aún no existen socios registrados.'}
              </p>
              <p className="text-xs text-slate-500 mt-1 mb-3">
                {searchTerm ? 'Intente con otros criterios de búsqueda.' : 'El padrón oficial sindical está listo para incorporar al primer socio transportista o conductor.'}
              </p>
              {!searchTerm && (
                <button
                  type="button"
                  onClick={() => setIsMemberModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#064e3b] hover:bg-[#053d2e] text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-[#facc15]" />
                  <span>Agregar socio</span>
                </button>
              )}`

const targetUnionCRLF = targetUnion.replace(/\n/g, '\r\n')
const replacementUnionCRLF = replacementUnion.replace(/\n/g, '\r\n')

if (unionContent.includes(targetUnion)) {
  unionContent = unionContent.replace(targetUnion, replacementUnion)
  fs.writeFileSync(unionPath, unionContent, 'utf8')
  console.log('Union empty state updated (LF)')
} else if (unionContent.includes(targetUnionCRLF)) {
  unionContent = unionContent.replace(targetUnionCRLF, replacementUnionCRLF)
  fs.writeFileSync(unionPath, unionContent, 'utf8')
  console.log('Union empty state updated (CRLF)')
} else {
  console.log('Union target not found')
}
