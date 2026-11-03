import React from 'react'
import { CheckCircle2, ArrowRight, Pause, Sparkles } from 'lucide-react'
import type { ContinuousTransitionState } from '../types'

interface TutorialTransitionToastProps {
  transition: ContinuousTransitionState
  onContinueNow: () => void
  onPause: () => void
}

export const TutorialTransitionToast: React.FC<TutorialTransitionToastProps> = ({
  transition,
  onContinueNow,
  onPause,
}) => {
  if (!transition.active) return null

  return (
    <div className="fixed bottom-6 right-6 z-[1350] max-w-sm w-full bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 p-4 animate-in slide-in-from-bottom duration-300">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5 text-[#facc15] text-[11px] font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            <span>¡Módulo Completado!</span>
          </div>
          <p className="text-xs text-slate-300 mt-0.5">
            Has finalizado con éxito: <strong className="text-white">{transition.completedTitle}</strong>
          </p>
          <p className="text-xs text-emerald-400 mt-1 font-semibold flex items-center gap-1">
            <span>Siguiente: {transition.nextTitle}</span>
            <ArrowRight className="w-3 h-3" />
          </p>
        </div>
      </div>

      {/* Barra de progreso de transición (3.5s) */}
      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-3">
        <div className="bg-[#facc15] h-full rounded-full animate-[progress_3.5s_linear]" />
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-800 text-xs">
        <button
          type="button"
          onClick={onPause}
          className="flex items-center gap-1 text-slate-400 hover:text-white transition cursor-pointer"
        >
          <Pause className="w-3.5 h-3.5" />
          <span>Pausar aquí</span>
        </button>
        <button
          type="button"
          onClick={onContinueNow}
          className="flex items-center gap-1 font-extrabold text-[#facc15] hover:text-yellow-300 transition cursor-pointer"
        >
          <span>Ir ahora</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
