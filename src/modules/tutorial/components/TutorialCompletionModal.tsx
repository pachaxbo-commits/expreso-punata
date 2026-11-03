import React from 'react'
import { CheckCircle, Trophy, RotateCcw, X, ShieldCheck } from 'lucide-react'
import type { TutorialSection } from '../types'

interface TutorialCompletionModalProps {
  isOpen: boolean
  onClose: () => void
  onRestart: () => void
  completedSections: TutorialSection[]
  userRole: string
}

export const TutorialCompletionModal: React.FC<TutorialCompletionModalProps> = ({
  isOpen,
  onClose,
  onRestart,
  completedSections,
  userRole,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[1350] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col text-center p-6">
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-[#064e3b] flex items-center justify-center mx-auto shadow-md mb-3">
          <Trophy className="w-8 h-8 text-[#064e3b]" />
        </div>

        <div className="inline-flex items-center gap-1.5 justify-center text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full mx-auto mb-2 border border-emerald-200">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Capacitación Oficial Completada</span>
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
          ¡Felicitaciones! Has dominado el sistema
        </h2>

        <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
          Has completado todos los módulos interactivos correspondientes a tu rol de <strong>{userRole.replace('_', ' ')}</strong> en Expreso Punata.
        </p>

        {/* Resumen de Competencias Adquiridas */}
        <div className="mt-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-left max-h-48 overflow-y-auto space-y-2">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Módulos certificados ({completedSections.length}):
          </p>
          {completedSections.map((sec) => (
            <div key={sec.id} className="flex items-center gap-2 text-xs font-semibold text-slate-800">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{sec.title}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRestart}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-300 transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Repetir Tutorial</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-extrabold bg-[#064e3b] hover:bg-[#053d2e] text-white shadow-md transition cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Volver al Trabajo</span>
          </button>
        </div>
      </div>
    </div>
  )
}
