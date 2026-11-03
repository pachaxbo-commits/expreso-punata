import React, { useState } from 'react'
import {
  X,
  Play,
  RotateCcw,
  CheckCircle,
  Clock,
  BookOpen,
  ArrowRight,
  Sparkles,
  AlertCircle,
  HelpCircle,
} from 'lucide-react'
import type { TutorialSection, TutorialOrchestratorState } from '../types'

interface TutorialCenterModalProps {
  isOpen: boolean
  onClose: () => void
  sections: TutorialSection[]
  state: TutorialOrchestratorState
  userRole: string
  onStartContinuous: () => void
  onStartSection: (sectionId: string, stepIndex?: number) => void
  onResume: () => void
  onReset: () => void
}

export const TutorialCenterModal: React.FC<TutorialCenterModalProps> = ({
  isOpen,
  onClose,
  sections,
  state,
  userRole,
  onStartContinuous,
  onStartSection,
  onResume,
  onReset,
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'completed' | 'pending'>('all')

  if (!isOpen) return null

  const completedCount = sections.filter((s) => state.completedSectionIds.includes(s.id)).length
  const totalSections = sections.length
  const completionPercentage = totalSections > 0 ? Math.round((completedCount / totalSections) * 100) : 0

  const hasResume = Boolean(state.currentSectionId)
  const resumeSection = sections.find((s) => s.id === state.currentSectionId)

  const filteredSections = sections.filter((sec) => {
    const isDone = state.completedSectionIds.includes(sec.id)
    if (activeTab === 'completed') return isDone
    if (activeTab === 'pending') return !isDone
    return true
  })

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabecera del Centro de Aprendizaje */}
        <div className="bg-[#064e3b] text-white p-4 sm:p-5 flex items-center justify-between border-b border-emerald-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#facc15] text-[#064e3b] flex items-center justify-center shadow-md shrink-0">
              <BookOpen className="w-5 h-5 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
                  Centro de Tutoriales Expreso Punata
                </h2>
                <span className="text-[10px] bg-emerald-900 text-[#facc15] font-bold px-2 py-0.5 rounded-full uppercase">
                  Rol {userRole.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-emerald-200 mt-0.5">
                Capacitación guiada e interactiva para dominar todos los módulos de la empresa.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-emerald-800 text-emerald-200 hover:text-white rounded-lg transition cursor-pointer"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Panel de Estado y Progreso */}
        <div className="bg-slate-50 border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Progreso General de Aprendizaje
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-black text-slate-900">{completionPercentage}%</span>
                <span className="text-xs text-slate-600 font-medium">
                  ({completedCount} de {totalSections} módulos completados)
                </span>
              </div>
            </div>

            {/* Acciones Rápidas */}
            <div className="flex flex-wrap items-center gap-2">
              {hasResume && (
                <button
                  type="button"
                  onClick={onResume}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#064e3b] hover:bg-[#053d2e] text-white shadow-sm transition cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 text-[#facc15]" />
                  <span>Continuar donde lo dejé</span>
                </button>
              )}

              <button
                type="button"
                onClick={onStartContinuous}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#facc15] hover:bg-yellow-400 text-[#064e3b] shadow-sm transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Iniciar Recorrido Completo</span>
              </button>
            </div>
          </div>

          {/* Barra de Progreso */}
          <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>

          {hasResume && resumeSection && (
            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Última sección en curso: <strong>{resumeSection.shortTitle}</strong> (Paso {state.currentStepIndex + 1} de {resumeSection.steps.length})
              </span>
            </p>
          )}
        </div>

        {/* Pestañas de Filtro de Módulos */}
        <div className="px-4 sm:px-5 pt-3 pb-2 flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Todos ({totalSections})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Pendientes ({totalSections - completedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                activeTab === 'completed'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Completados ({completedCount})
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="text-[11px] text-slate-500 hover:text-rose-600 font-semibold flex items-center gap-1 transition cursor-pointer"
            title="Reiniciar progreso del tutorial"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reiniciar progreso</span>
          </button>
        </div>

        {/* Modal de Confirmación de Reinicio */}
        {showResetConfirm && (
          <div className="p-4 bg-rose-50 border-b border-rose-200 flex items-start justify-between gap-3 animate-in fade-in">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-rose-900">
                  ¿Deseas reiniciar tu progreso en los tutoriales?
                </p>
                <p className="text-[11px] text-rose-800 mt-0.5">
                  Esta acción reiniciará los indicadores de módulos aprendidos a cero. <strong>No afectará encomiendas, cajas ni datos de la empresa.</strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset()
                  setShowResetConfirm(false)
                }}
                className="px-3 py-1 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer"
              >
                Sí, reiniciar
              </button>
            </div>
          </div>
        )}

        {/* Lista de Módulos Específicos */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
          {filteredSections.map((sec) => {
            const isCompleted = state.completedSectionIds.includes(sec.id)
            const isCurrent = state.currentSectionId === sec.id

            return (
              <div
                key={sec.id}
                className={`p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isCompleted
                    ? 'bg-emerald-50/50 border-emerald-200/80'
                    : isCurrent
                    ? 'bg-amber-50/50 border-amber-300 ring-1 ring-amber-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-sm text-slate-900">
                      {sec.title}
                    </span>
                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        Completado
                      </span>
                    ) : isCurrent ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3 text-amber-600" />
                        En Progreso
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        Pendiente
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {sec.description}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-0.5">
                    <span>{sec.steps.length} pasos formativos</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      ~{sec.estimatedMinutes} min
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onStartSection(sec.id, 0)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      isCompleted
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                        : 'bg-[#064e3b] hover:bg-[#053d2e] text-white shadow-xs'
                    }`}
                  >
                    <span>{isCompleted ? 'Repasar' : 'Aprender'}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#facc15]" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Pie Informativo */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>Los tutoriales son puramente didácticos; no generan cobros ni alteran inventarios reales.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
