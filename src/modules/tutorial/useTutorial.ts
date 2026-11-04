import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type {
  TutorialStorageScope,
  TutorialOrchestratorState,
  TutorialSection,
  TutorialStep,
  ContinuousTransitionState,
} from './types'
import {
  loadTutorialState,
  saveTutorialState,
  resetTutorialState,
} from './storage'
import {
  TUTORIAL_SECTIONS,
  getSectionsForRole,
} from './tutorialSectionsData'

interface UseTutorialOptions {
  scope: TutorialStorageScope
  onNavigateToTab?: (tabId: string) => void
  onSetSubTab?: (module: string, subTabId: string) => void
}

export function useTutorial({
  scope,
  onNavigateToTab,
  onSetSubTab,
}: UseTutorialOptions) {
  const [state, setState] = useState<TutorialOrchestratorState>(() => loadTutorialState(scope))
  const [isCenterOpen, setIsCenterOpen] = useState(false)
  const [isTourActive, setIsTourActive] = useState(false)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [transitionState, setTransitionState] = useState<ContinuousTransitionState | null>(null)
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState(false)

  const transitionTimerRef = useRef<number | null>(null)

  // Rol-filtered sections
  const roleSections = useMemo(() => {
    return getSectionsForRole(scope.role)
  }, [scope.role])

  const sectionsById = useMemo(() => {
    return new Map(TUTORIAL_SECTIONS.map((sec) => [sec.id, sec]))
  }, [])

  // Dynamic scope update (e.g. role switch)
  const prevScopeRef = useRef(scope)
  useEffect(() => {
    const prev = prevScopeRef.current
    if (prev.role !== scope.role || prev.uid !== scope.uid) {
      prevScopeRef.current = scope
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
        transitionTimerRef.current = null
      }
      setTransitionState(null)
      setIsTourActive(false)
      setActiveSectionId(null)
      setCurrentStepIndex(0)
      const fresh = loadTutorialState(scope)
      setState(fresh)
    }
  }, [scope])

  const updateState = useCallback(
    (updater: (prev: TutorialOrchestratorState) => TutorialOrchestratorState) => {
      setState((prev) => {
        const next = updater(prev)
        saveTutorialState(scope, next)
        return next
      })
    },
    [scope]
  )

  const activeSection = useMemo<TutorialSection | null>(() => {
    if (!activeSectionId) return null
    return sectionsById.get(activeSectionId) || null
  }, [activeSectionId, sectionsById])

  const currentStep = useMemo<TutorialStep | null>(() => {
    if (!activeSection) return null
    return activeSection.steps[currentStepIndex] || null
  }, [activeSection, currentStepIndex])

  // Context synchronizer (ensures the correct tab/subtab is open when step renders)
  const applyStepContext = useCallback((step: TutorialStep) => {
    if (step.requiredContext?.tab && onNavigateToTab) {
      onNavigateToTab(step.requiredContext.tab)
    }
    if (step.requiredContext?.subTab && onSetSubTab && step.requiredContext?.tab) {
      onSetSubTab(step.requiredContext.tab, step.requiredContext.subTab)
    }
  }, [onNavigateToTab, onSetSubTab])

  // Open Learning Center
  const openTutorialCenter = useCallback(() => {
    setIsCenterOpen(true)
  }, [])

  const closeTutorialCenter = useCallback(() => {
    setIsCenterOpen(false)
  }, [])

  // Launch a specific section
  const startSection = useCallback(
    (sectionId: string, initialStep = 0) => {
      const targetSec = sectionsById.get(sectionId)
      if (!targetSec) return

      const safeStep = Math.max(0, Math.min(initialStep, targetSec.steps.length - 1))
      setActiveSectionId(sectionId)
      setCurrentStepIndex(safeStep)
      setIsTourActive(true)
      setIsCenterOpen(false)

      const targetStep = targetSec.steps[safeStep]
      if (targetStep) {
        applyStepContext(targetStep)
      }

      updateState((prev) => ({
        ...prev,
        currentSectionId: sectionId,
        currentStepIndex: safeStep,
        isPaused: false,
      }))
    },
    [sectionsById, applyStepContext, updateState]
  )

  // Start continuous sequence
  const startContinuous = useCallback(
    (startSecId?: string) => {
      if (roleSections.length === 0) return
      const initialSec = (startSecId ? sectionsById.get(startSecId) : null) || roleSections[0]

      updateState((prev) => ({
        ...prev,
        isContinuousActive: true,
        isPaused: false,
        completedAll: false,
      }))

      startSection(initialSec.id, 0)
    },
    [roleSections, sectionsById, startSection, updateState]
  )

  // Resume where left off
  const resumeTutorial = useCallback(() => {
    if (state.currentSectionId) {
      startSection(state.currentSectionId, state.currentStepIndex)
    } else if (roleSections.length > 0) {
      startContinuous()
    }
  }, [state.currentSectionId, state.currentStepIndex, roleSections, startSection, startContinuous])

  // Pause tutorial
  const pauseTutorial = useCallback(() => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
    setTransitionState(null)
    setIsTourActive(false)
    updateState((prev) => ({
      ...prev,
      isPaused: true,
      currentStepIndex,
    }))
  }, [currentStepIndex, updateState])

  // Exit tutorial
  const exitTutorial = useCallback(() => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
    setTransitionState(null)
    setIsTourActive(false)
    setActiveSectionId(null)
    updateState((prev) => ({
      ...prev,
      isContinuousActive: false,
      isPaused: false,
    }))
  }, [updateState])

  // Reset all progress
  const resetTutorial = useCallback(() => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
    setTransitionState(null)
    setIsTourActive(false)
    setActiveSectionId(null)
    setCurrentStepIndex(0)
    const fresh = resetTutorialState(scope)
    setState(fresh)
  }, [scope])

  // Next step / Advance
  const nextStep = useCallback(() => {
    if (!activeSection) return

    if (currentStepIndex < activeSection.steps.length - 1) {
      const nextIndex = currentStepIndex + 1
      setCurrentStepIndex(nextIndex)
      const nextTargetStep = activeSection.steps[nextIndex]
      if (nextTargetStep) {
        applyStepContext(nextTargetStep)
      }
      updateState((prev) => ({
        ...prev,
        currentStepIndex: nextIndex,
      }))
    } else {
      // Finished section!
      const completedIds = Array.from(new Set([...state.completedSectionIds, activeSection.id]))
      const currentIndex = roleSections.findIndex((s: TutorialSection) => s.id === activeSection.id)
      const nextSec = currentIndex >= 0 && currentIndex < roleSections.length - 1
        ? roleSections[currentIndex + 1]
        : null

      if (state.isContinuousActive && nextSec && !nextSec.isOptional) {
        // Continuous transition
        const transition: ContinuousTransitionState = {
          active: true,
          completedTitle: activeSection.shortTitle,
          nextTitle: nextSec.shortTitle,
          nextSectionId: nextSec.id,
          nextTabId: nextSec.moduleId,
          nextSubTabId: nextSec.subModuleId,
        }
        setTransitionState(transition)
        setIsTourActive(false)

        updateState((prev) => ({
          ...prev,
          completedSectionIds: completedIds,
          currentSectionId: nextSec.id,
          currentStepIndex: 0,
        }))

        const isReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const delayMs = isReducedMotion ? 1200 : 3500

        transitionTimerRef.current = window.setTimeout(() => {
          setTransitionState(null)
          startSection(nextSec.id, 0)
          transitionTimerRef.current = null
        }, delayMs)
      } else {
        // Final section or single tour finished!
        setIsTourActive(false)
        setActiveSectionId(null)
        const isAllDone = roleSections.every((s: TutorialSection) => completedIds.includes(s.id))

        updateState((prev) => ({
          ...prev,
          completedSectionIds: completedIds,
          isContinuousActive: false,
          isPaused: false,
          completedAll: isAllDone,
          currentSectionId: null,
          currentStepIndex: 0,
        }))

        if (isAllDone || state.isContinuousActive) {
          setIsCompletionModalOpen(true)
        }
      }
    }
  }, [activeSection, currentStepIndex, applyStepContext, updateState, state.completedSectionIds, state.isContinuousActive, roleSections, startSection])

  // Force skip transition timer
  const continueTransitionNow = useCallback(() => {
    if (!transitionState) return
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
    const nextSecId = transitionState.nextSectionId
    setTransitionState(null)
    startSection(nextSecId, 0)
  }, [transitionState, startSection])

  // Prev step
  const prevStep = useCallback(() => {
    if (!activeSection || currentStepIndex <= 0) return
    const prevIndex = currentStepIndex - 1
    setCurrentStepIndex(prevIndex)
    const prevTargetStep = activeSection.steps[prevIndex]
    if (prevTargetStep) {
      applyStepContext(prevTargetStep)
    }
    updateState((prev) => ({
      ...prev,
      currentStepIndex: prevIndex,
    }))
  }, [activeSection, currentStepIndex, applyStepContext, updateState])

  return {
    state,
    roleSections,
    activeSection,
    currentStep,
    currentStepIndex,
    isTourActive,
    isCenterOpen,
    isCompletionModalOpen,
    transitionState,
    openTutorialCenter,
    closeTutorialCenter,
    startSection,
    startContinuous,
    resumeTutorial,
    pauseTutorial,
    exitTutorial,
    resetTutorial,
    nextStep,
    prevStep,
    continueTransitionNow,
    setIsCompletionModalOpen,
  }
}
