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
  SkipForward,
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

type Rect = { top: number; left: number; width: number; height: number; bottom: number; right: number }

function rectFor(selector: string): Rect | null {
  try {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return null
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) return null
    return { top: b.top, left: b.left, width: b.width, height: b.height, bottom: b.bottom, right: b.right }
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

  // Posicionamiento adaptativo anti-desbordamiento
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768
  const windowH = typeof window !== 'undefined' ? window.innerHeight : 768
  const windowW = typeof window !== 'undefined' ? window.innerWidth : 1366

  let computedTop = 80
  let computedLeft = 24
  let cardMaxHeight = Math.min(windowH - 32, 580)

  if (targetRect) {
    const spaceBelow = windowH - (targetRect.bottom + 12)
    const spaceAbove = targetRect.top - 12

    if (spaceBelow >= 360) {
      // Suficiente espacio abajo del elemento
      computedTop = targetRect.bottom + 12
      cardMaxHeight = Math.min(spaceBelow - 16, 560)
    } else if (spaceAbove >= 360) {
      // Suficiente espacio arriba del elemento
      const neededH = Math.min(spaceAbove - 16, 540)
      computedTop = Math.max(16, targetRect.top - neededH - 12)
      cardMaxHeight = neededH
    } else {
      // Pantalla ajustada o elemento al centro: anclar con margen superior seguro
      computedTop = 20
      cardMaxHeight = windowH - 40
    }

    // Clamping horizontal seguro (nunca sale del margen derecho ni izquierdo)
    computedLeft = Math.max(16, Math.min(windowW - 440, targetRect.left))
  } else {
    computedTop = 80
    computedLeft = Math.max(16, windowW - 450)
    cardMaxHeight = windowH - 100
  }

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

      {/* Tarjeta Educativa del Paso — Rediseño Anti-Desbordamiento con Flexbox Estricto */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label={`${section.title}: ${step.title}`}
        data-tutorial-card="true"
        className={`pointer-events-auto bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-200 z-[1202] ${
          isMobile
            ? 'fixed bottom-0 left-0 right-0 max-h-[82vh] rounded-t-2xl border-b-0'
            : 'fixed rounded-2xl w-[420px]'
        }`}
        style={isMobile ? { maxHeight: '82vh' } : { top: computedTop, left: computedLeft, maxHeight: `${cardMaxHeight}px` }}
      >
        {/* Cabecera Fija (shrink-0) */}
        <div className="bg-[#064e3b] text-white p-3.5 flex items-center justify-between border-b border-emerald-800 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#facc15]">
                {section.shortTitle}
              </span>
              <span className="text-[10px] bg-emerald-900/80 text-emerald-200 px-2 py-0.5 rounded-full font-mono">
                {isContinuous ? 'Ruta Operativa' : 'Módulo Individual'} · {stepIndex + 1}/{totalSteps}
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
              className="p-1.5 hover:bg-emerald-800 text-emerald-200 hover:text-white rounded-lg transition cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExit}
              title="Salir del tutorial"
              className="p-1.5 hover:bg-emerald-800 text-emerald-200 hover:text-white rounded-lg transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barra de Progreso del Módulo (shrink-0) */}
        <div className="w-full bg-slate-100 h-1 shrink-0">
          <div
            className="bg-[#facc15] h-1 transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* Contenido Pedagógico Scrollable y Legible (flex-1 overflow-y-auto min-h-0) */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-3.5 text-xs text-slate-700 overscroll-contain">
          {/* Advertencia si no se detectó el elemento exacto */}
          {isMissing && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2 shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Elemento en vista actual</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Este control forma parte del proceso. Puedes revisar la explicación a continuación o pulsar "Siguiente" u "Omitir paso" para continuar.
                </p>
              </div>
            </div>
          )}

          {/* Bloque 1: ¿Para qué sirve? */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider">
              <HelpCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>¿Para qué sirve?</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-xs">
              {step.whatIsItFor || step.whatIsIt}
            </p>
          </div>

          {/* Bloque 2: ¿Qué debes hacer? */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider">
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>¿Qué debes hacer o seleccionar?</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-xs">
              {step.whatToWriteOrSelect}
            </p>
          </div>

          {/* Bloque 3: Ejemplo Práctico (Expreso Punata) */}
          <div className="bg-emerald-50/90 border border-emerald-200/90 rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-emerald-950 font-bold text-[11px] uppercase tracking-wider mb-1">
              <Lightbulb className="w-3.5 h-3.5 text-emerald-700" />
              <span>Ejemplo Práctico (Expreso Punata)</span>
            </div>
            <p className="text-emerald-900 text-xs leading-relaxed font-medium">
              {step.example}
            </p>
          </div>

          {/* Bloque 4: ¿Qué sucede después? */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>¿Qué sucede después?</span>
            </div>
            <p className="text-slate-600 leading-relaxed text-xs">
              {step.whatHappensAfter}
            </p>
          </div>

          {/* Bloque 5: Consejo Importante */}
          <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-2.5">
            <p className="text-[11px] text-amber-950 leading-snug">
              <strong className="font-extrabold text-amber-950">Consejo: </strong>
              {step.importantTip}
            </p>
          </div>
        </div>

        {/* Barra Inferior Fija de Navegación (shrink-0) — SIEMPRE VISIBLE */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onPrev}
            disabled={stepIndex === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Anterior</span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition cursor-pointer"
              title="Avanzar directamente al siguiente paso"
            >
              <SkipForward className="w-3 h-3 text-slate-400" />
              <span>Omitir paso</span>
            </button>

            <button
              type="button"
              onClick={onNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-[#064e3b] hover:bg-[#053d2e] text-white shadow-md transition cursor-pointer"
            >
              <span>{stepIndex === totalSteps - 1 ? 'Finalizar Módulo' : 'Siguiente'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#facc15]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
