import React, { useState } from 'react'
import { ClipboardList, Printer, Settings2 } from 'lucide-react'
import { PrinterSettingsView } from './PrinterSettingsView.tsx'
import { TicketTemplateEditor } from './TicketTemplateEditor.tsx'
import { RongtaPrintTestPage } from './RongtaPrintTestPage.tsx'

type Panel = 'profiles' | 'templates' | 'diagnostic'

export const PrinterOperationsView: React.FC<{ currentBranchId?: string; operatorName?: string }> = ({ currentBranchId = 'punata', operatorName = 'Operador' }) => {
  const [panel, setPanel] = useState<Panel>('profiles')
  const items: Array<{ id: Panel; label: string; icon: React.ReactNode }> = [
    { id: 'profiles', label: 'Perfiles de estación', icon: <Settings2 className="h-4 w-4" /> },
    { id: 'templates', label: 'Editor de guías', icon: <ClipboardList className="h-4 w-4" /> },
    { id: 'diagnostic', label: 'Prueba Rongta Windows', icon: <Printer className="h-4 w-4" /> },
  ]
  return <div className="space-y-4">
    <nav aria-label="Herramientas de impresión" className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
      {items.map(item => <button key={item.id} type="button" aria-pressed={panel === item.id} onClick={() => setPanel(item.id)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${panel === item.id ? 'bg-[#064e3b] text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{item.icon}{item.label}</button>)}
    </nav>
    {panel === 'profiles' && <PrinterSettingsView currentBranchId={currentBranchId} operatorName={operatorName} />}
    {panel === 'templates' && <TicketTemplateEditor currentBranchId={currentBranchId} />}
    {panel === 'diagnostic' && <RongtaPrintTestPage currentBranchId={currentBranchId} />}
  </div>
}
