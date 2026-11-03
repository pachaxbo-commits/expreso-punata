import type { TutorialStorageScope, TutorialOrchestratorState } from './types'

export function buildTutorialStorageKey(scope: TutorialStorageScope): string {
  const uid = scope.uid || 'anon'
  const role = scope.role || 'default'
  return `expreso-punata:tutorial:${uid}:${role}:v1`
}

export function createDefaultTutorialState(): TutorialOrchestratorState {
  return {
    currentSectionId: null,
    currentStepIndex: 0,
    completedSectionIds: [],
    isContinuousActive: false,
    isPaused: false,
    completedAll: false,
    lastUpdated: new Date().toISOString(),
  }
}

export function loadTutorialState(scope: TutorialStorageScope): TutorialOrchestratorState {
  if (typeof window === 'undefined') return createDefaultTutorialState()
  try {
    const key = buildTutorialStorageKey(scope)
    const raw = window.localStorage.getItem(key)
    if (!raw) return createDefaultTutorialState()

    const parsed = JSON.parse(raw) as Partial<TutorialOrchestratorState>
    return {
      currentSectionId: typeof parsed.currentSectionId === 'string' ? parsed.currentSectionId : null,
      currentStepIndex: typeof parsed.currentStepIndex === 'number' && Number.isFinite(parsed.currentStepIndex)
        ? Math.max(0, parsed.currentStepIndex)
        : 0,
      completedSectionIds: Array.isArray(parsed.completedSectionIds)
        ? parsed.completedSectionIds.filter((id): id is string => typeof id === 'string')
        : [],
      isContinuousActive: Boolean(parsed.isContinuousActive),
      isPaused: Boolean(parsed.isPaused),
      completedAll: Boolean(parsed.completedAll),
      lastUpdated: typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : new Date().toISOString(),
    }
  } catch {
    return createDefaultTutorialState()
  }
}

export function saveTutorialState(scope: TutorialStorageScope, state: TutorialOrchestratorState): void {
  if (typeof window === 'undefined') return
  try {
    const key = buildTutorialStorageKey(scope)
    const sanitized: TutorialOrchestratorState = {
      ...state,
      currentStepIndex: Math.max(0, state.currentStepIndex || 0),
      lastUpdated: new Date().toISOString(),
    }
    window.localStorage.setItem(key, JSON.stringify(sanitized))
  } catch {
    // Modo privado o cuota excedida: no romper la app
  }
}

export function resetTutorialState(scope: TutorialStorageScope): TutorialOrchestratorState {
  const reset = createDefaultTutorialState()
  saveTutorialState(scope, reset)
  return reset
}
