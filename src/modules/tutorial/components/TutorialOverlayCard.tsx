import React, { useState, useEffect, useLayoutEffect } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  X,
  Pause,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  FileText,
} from 'lucide-react'
import type { TutorialStep, TutorialSection } from '../types'

interface TutorialOverlayCardProps {
  section: TutorialSection
  step: TutorialStep
  stepIndex: number
  totalSteps: number
  isContinuous: boolean
  onNext: () => void
  onPrev: () => void
  onPause: () => void
  onExit: () => void
}

type Rect = { top: number; left: number; width: number; height: number }

function rectFor(selector: string): Rect | null {
  try {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return null
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) return null
    return { top: b.top, left: b.left, width: b.width, height: b.height }
  } catch {
    return null
  }
}

export const TutorialOverlayCard: React.FC<TutorialOverlayCardProps> = ({
  section,
  step,
  stepIndex,
  totalSteps,
  isContinuous,
  onNext,
  onPrev,
  onPause,
  onExit,
}) => {
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [isMissing, setIsMissing] = useState(false)

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onPause()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        onNext()
      } else if (e.key === 'ArrowLeft') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        if (stepIndex > 0) {
          e.preventDefault()
          onPrev()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNext, onPrev, onPause, stepIndex])

  // Element tracking & Auto-scroll
  useLayoutEffect(() => {
    let hasScrolled = false
    let timeoutId: number | null = null

    const updateRect = () => {
      let r = rectFor(step.target)
      if (!r && step.fallbackTarget) {
        r = rectFor(step.fallbackTarget)
      }

      if (r) {
        setTargetRect(r)
        setIsMissing(false)
        if (!hasScrolled) {
          hasScrolled = true
          const targetEl = document.querySelector<HTMLElement>(step.target) || (step.fallbackTarget ? document.querySelector<HTMLElement>(step.fallbackTarget) : null)
          const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
          targetEl?.scrollIntoView({ block: 'center', behavior: prefersReduced ? 'auto' : 'smooth' })
        }
      } else {
        timeoutId = window.setTimeout(() => {
          setIsMissing(true)
          setTargetRect(null)
        }, 350)
      }
    }

    updateRect()
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)

    const observer = new MutationObserver(updateRect)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId)
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
      observer.disconnect()
    }
  }, [step])

  // Positioning
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768

  // PC smart positioning
  const estimatedCardHeight = 440
  const cardBelow = targetRect ? targetRect.top + targetRect.height + 16 : 90
  const cardAbove = targetRect ? targetRect.top - estimatedCardHeight - 16 : 90
  const hasRoomBelow = targetRect ? cardBelow + estimatedCardHeight <= window.innerHeight - 16 : false
  const hasRoomAbove = targetRect ? cardAbove >= 16 : false

  const computedTop = targetRect
    ? hasRoomBelow
      ? cardBelow
      : hasRoomAbove
      ? cardAbove
      : Math.max(16, Math.min(window.innerHeight - estimatedCardHeight - 16, cardBelow))
    : 90

  const computedLeft = targetRect
    ? Math.max(16, Math.min(window.innerWidth - 440, targetRect.left))
    : 16

  return (
    <div className="fixed inset-0 z-[1200] pointer-events-none" aria-live="polite">
      {/* Resaltado del elemento enfocado (Spotlight) */}
      {targetRect && (
        <>
          <div
            className="fixed pointer-events-none rounded-xl ring-4 ring-[#facc15] shadow-2xl transition-all duration-300"
            style={{
              top: targetRect.top - 4,
              left: targetRect.left - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />
          {/* Sombra de atenuación suave alrededor */}
          <div
            className="fixed inset-0 bg-slate-950/40 pointer-events-auto"
            onClick={onPause}
            title="Haz clic para pausar el tutorial"
          />
        </>
      )}

      {/* Tarjeta Educativa del Paso */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`${section.title}: ${step.title}`}
        className={`pointer-events-auto bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-200 ${
          isMobile
            ? 'fixed bottom-0 left-0 right-0 max-h-[85vh] rounded-b-none border-b-0'
            : 'fixed z-[1202] w-[420px] max-h-[90vh]'
        }`}
        style={isMobile ? undefined : { top: computedTop, left: computedLeft }}
      >
        {/* Cabecera con Título de Sección y Progreso */}
        <div className="bg-[#064e3b] text-white p-3.5 flex items-center justify-between border-b border-emerald-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#facc15]">
                {section.shortTitle}
              </span>
              <span className="text-[10px] bg-emerald-900/80 text-emerald-200 px-2 py-0.5 rounded-full font-mono">
                {isContinuous ? 'Recorrido Continuo' : 'Módulo Individual'} · {stepIndex + 1}/{totalSteps}
              </span>
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-tight mt-0.5 text-white">
              {step.title}
            </h3>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPause}
              title="Pausar tutorial (Escape)"
              className="p-1.5 hover:bg-emerald-800 text-emerald-200 hover:text-white rounded-lg transition"
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExit}
              title="Salir del tutorial"
              className="p-1.5 hover:bg-emerald-800 text-emerald-200 hover:text-white rounded-lg transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de Progreso del Módulo */}
        <div className="w-full bg-slate-100 h-1">
          <div
            className="bg-[#facc15] h-1 transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* Contenido Pedagógico Scrollable */}
        <div className="p-4 overflow-y-auto space-y-3.5 text-xs sm:text-sm text-slate-700 max-h-[60vh] sm:max-h-[65vh]">
          {/* Advertencia si no se detectó el elemento exacto */}
          {isMissing && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Control en pantalla o formulario</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Este elemento forma parte del flujo actual. Puedes revisar la explicación a continuación o avanzar directamente al siguiente paso.
                </p>
              </div>
            </div>
          )}

          {/* Bloque 1: ¿Qué es esto? y ¿Para qué sirve? */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-slate-900 font-bold text-xs uppercase tracking-wide">
              <HelpCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>¿Qué es y para qué sirve?</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-xs">
              {step.whatIsIt} {step.whatIsItFor}
            </p>
          </div>

          {/* Bloque 2: ¿Qué debo escribir o seleccionar? */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-slate-900 font-bold text-xs uppercase tracking-wide">
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>¿Qué debo hacer o seleccionar?</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-xs">
              {step.whatToWriteOrSelect}
            </p>
          </div>

          {/* Bloque 3: Ejemplo Boliviano Realista */}
          <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-emerald-950 font-bold text-xs uppercase tracking-wide mb-1">
              <Lightbulb className="w-3.5 h-3.5 text-emerald-700" />
              <span>Ejemplo Práctico (Expreso Punata)</span>
            </div>
            <p className="text-emerald-900 text-xs leading-relaxed font-medium">
              {step.example}
            </p>
          </div>

          {/* Bloque 4: ¿Qué pasa después de guardar? */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-slate-900 font-bold text-xs uppercase tracking-wide">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>¿Qué pasa después?</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-xs">
              {step.whatHappensAfter}
            </p>
          </div>

          {/* Bloque 5: Consejo Importante */}
          <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-2.5">
            <p className="text-[11px] text-amber-900 leading-snug">
              <strong className="font-bold text-amber-950">Consejo: </strong>
              {step.importantTip}
            </p>
          </div>
        </div>

        {/* Barra Inferior con Controles */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={stepIndex === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Anterior</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-[#064e3b] hover:bg-[#053d2e] text-white shadow-md transition cursor-pointer"
            >
              <span>{stepIndex === totalSteps - 1 ? 'Finalizar Módulo' : 'Siguiente'}</span>
              <ArrowRight className="w-4 h-4 text-[#facc15]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
