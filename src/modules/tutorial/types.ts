import type { UserRole } from '../../types'

export interface TutorialStorageScope {
  role: UserRole
  uid: string
  primaryBranchId?: string
}

export interface TutorialStep {
  id: string
  sectionId: string
  order: number
  target: string // CSS selector e.g. '[data-tutorial-target="..."]'
  fallbackTarget?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  title: string
  whatIsIt: string // ¿Qué es esto?
  whatIsItFor: string // ¿Para qué sirve?
  whatToWriteOrSelect: string // ¿Qué debo escribir o seleccionar?
  example: string // Ejemplo realista de Expreso Punata (Bolivia)
  whatHappensAfter: string // ¿Qué pasa después de guardar?
  importantTip: string // Consejo importante
  audioScript: string // Guion preparado para narración / voz IA
  requiredContext?: {
    tab?: string
    subTab?: string
    openModal?: string
  }
}

export interface TutorialSection {
  id: string
  moduleId: string
  subModuleId?: string
  title: string
  shortTitle: string
  description: string
  estimatedMinutes: number
  allowedRoles: UserRole[]
  steps: TutorialStep[]
  category?: 'operational' | 'configuration'
  isOptional?: boolean
}

export interface TutorialOrchestratorState {
  currentSectionId: string | null
  currentStepIndex: number
  completedSectionIds: string[]
  isContinuousActive: boolean
  isPaused: boolean
  completedAll: boolean
  lastUpdated: string
}

export interface ContinuousTransitionState {
  active: boolean
  completedTitle: string
  nextTitle: string
  nextSectionId: string
  nextTabId: string
  nextSubTabId?: string
}
