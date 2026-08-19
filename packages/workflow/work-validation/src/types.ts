/**
 * Detailed evidence-backed validation vocabulary. Types only.
 * @module @deepseek-ai/dsh-work-validation/src/types
 */

import type {
  TaskWorkItem,
  ValidatorKind,
  ValidatorRequirement,
  WorkItemId,
} from '@deepseek-ai/dsh-work-control'

/** Evidence stays as a reference to an auditable artifact or observation, never an embedded transcript. */
export type EvidenceKind =
  | 'test'
  | 'command'
  | 'log'
  | 'benchmark'
  | 'artifact'
  | 'screenshot'
  | 'device'
  | 'runtime'
  | 'git'
  | 'url'

/** One compact pointer to evidence retained outside the model context. */
export interface EvidenceRef {
  readonly kind: EvidenceKind
  readonly label: string
  /** Path, URI, commit, run id, log id, or other stable lookup reference. */
  readonly reference: string
  /** Optional short factual description; large content is fetched on demand. */
  readonly summary?: string
}

/** A validator records a terminal judgment for the current validation generation. */
export type ValidatorOutcome = 'passed' | 'failed'

/** Active validation generation for one Task. A later generation invalidates all earlier results. */
export interface WorkValidationSession {
  readonly taskId: WorkItemId
  readonly generation: number
  readonly startedTaskRevision: number
  readonly policyFingerprint: string
  readonly startedAt: string
  readonly updatedAt: string
}

/** Durable result for one policy entry inside one validation generation. */
export interface WorkValidatorResult {
  readonly taskId: WorkItemId
  readonly generation: number
  readonly validatorIndex: number
  readonly validatorKind: ValidatorKind
  readonly requirement: ValidatorRequirement
  readonly label: string
  readonly outcome: ValidatorOutcome
  readonly source: 'automation' | 'user'
  /** Human actor identifier only for user-acceptance decisions. */
  readonly actor?: string
  readonly evidence: readonly EvidenceRef[]
  readonly note?: string
  readonly revision: number
  readonly checkedAt: string
  readonly updatedAt: string
}

/** Current detailed validation projection for a Task. */
export interface WorkValidationView {
  readonly task: TaskWorkItem
  readonly session: WorkValidationSession | undefined
  readonly results: readonly WorkValidatorResult[]
}

/** Automated validator result request. User acceptance is intentionally excluded. */
export interface RecordAutomatedValidationRequest {
  readonly taskId: WorkItemId
  readonly generation: number
  readonly validatorIndex: number
  readonly outcome: ValidatorOutcome
  readonly evidence: readonly EvidenceRef[]
  readonly note?: string
}

/** Explicit user decision for a `user-acceptance` policy entry. */
export interface RecordUserAcceptanceRequest {
  readonly taskId: WorkItemId
  readonly generation: number
  readonly validatorIndex: number
  readonly outcome: ValidatorOutcome
  readonly actor: string
  readonly evidence?: readonly EvidenceRef[]
  readonly note?: string
}

/** Session mutation event after durable commit. */
export interface WorkValidationSessionChanged {
  readonly session: WorkValidationSession
}

/** Validator-result mutation event after durable commit. */
export interface WorkValidatorResultChanged {
  readonly result: WorkValidatorResult
}
