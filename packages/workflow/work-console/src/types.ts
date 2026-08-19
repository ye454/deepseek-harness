/**
 * Client-safe read/write vocabulary for the global continuous-work console.
 * Detailed logs and artifact payloads intentionally remain outside this projection.
 * Browser mutation requests never contain an acceptance actor; the Host owns that identity boundary.
 * @module @deepseek-ai/dsh-work-console/types
 */

/** Stable global-board status independent from task-specific workflow stages. */
export type WorkConsoleBoardStatus = 'unclaimed' | 'running' | 'blocked' | 'validation' | 'done'

/** Human-facing acceptance readiness after the automated validation subset is considered. */
export type WorkConsoleAcceptanceState = 'automated-pending' | 'automated-failed' | 'human-ready' | 'passed'

/** Passive idea card. It has no Runner, Environment, or execution state. */
export interface WorkConsoleIdeaCard {
  readonly id: string
  readonly revision: number
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Compact current workflow-stage projection. */
export interface WorkConsoleStageView {
  readonly id: string
  readonly title: string
  readonly kind: string
}

/** Compact validation projection suitable for execution/acceptance routing. */
export interface WorkConsoleValidationView {
  readonly state: 'pending' | 'passed' | 'failed'
  readonly requiredPassed: number
  readonly requiredTotal: number
  readonly checkedAt?: string
  /** Whether automated gates are still running/failed, a human can now decide, or the task fully passed. */
  readonly acceptanceState: WorkConsoleAcceptanceState
  /** Required user-acceptance entries that are currently actionable; absent is rendered as zero. */
  readonly pendingUserAcceptance?: number
}

/** Current/most-relevant execution facts for a task card. */
export interface WorkConsoleExecutionView {
  readonly threadCount: number
  readonly runningThreadCount: number
  readonly blockedThreadCount: number
  readonly provider?: string
  readonly mode?: 'one-shot' | 'continuable'
  readonly attemptStartedAt?: string
  readonly lastStopReason?: string
}

/** Exact Thread -> Environment -> Node placement projected without silently adopting a new Environment revision. */
export interface WorkConsolePlacementView {
  readonly threadId: string
  readonly nodeId: string
  readonly nodeName?: string
  readonly nodeState?: 'online' | 'degraded' | 'offline'
  readonly environmentId: string
  readonly environmentName?: string
  readonly environmentState?: 'ready' | 'degraded' | 'unavailable'
  readonly boundEnvironmentRevision: number
  readonly currentEnvironmentRevision?: number
  readonly stale: boolean
}

/** One task card shown on the global work surface. */
export interface WorkConsoleTaskCard {
  readonly id: string
  readonly revision: number
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly priority: 'p0' | 'p1' | 'p2'
  readonly status: WorkConsoleBoardStatus
  readonly taskType?: string
  readonly stage?: WorkConsoleStageView
  readonly execution: WorkConsoleExecutionView
  readonly placement?: WorkConsolePlacementView
  readonly validation?: WorkConsoleValidationView
  readonly updatedAt: string
}

/** Aggregated WorkNode resource counts. */
export interface WorkConsoleNodeSummary {
  readonly total: number
  readonly online: number
  readonly degraded: number
  readonly offline: number
}

/** Aggregated WorkEnvironment resource counts. */
export interface WorkConsoleEnvironmentSummary {
  readonly total: number
  readonly ready: number
  readonly degraded: number
  readonly unavailable: number
}

/** Availability of one Runner provider as actually advertised by registered WorkNodes. */
export interface WorkConsoleRunnerSummary {
  readonly provider: string
  readonly nodeCount: number
  readonly onlineNodeCount: number
}

/** Compact global resource center strip. */
export interface WorkConsoleResourceSummary {
  readonly nodes: WorkConsoleNodeSummary
  readonly environments: WorkConsoleEnvironmentSummary
  readonly runners: readonly WorkConsoleRunnerSummary[]
}

/** Attention counts used by the lightweight top strip. */
export interface WorkConsolePendingSummary {
  readonly blockedTasks: number
  readonly validationTasks: number
  /** Only acceptance gates that are actually ready for a human decision. */
  readonly pendingUserAcceptance: number
}

/** Main-dashboard snapshot. */
export interface WorkConsoleSnapshot {
  readonly generatedAt: string
  readonly ideas: readonly WorkConsoleIdeaCard[]
  readonly tasks: readonly WorkConsoleTaskCard[]
  readonly resources: WorkConsoleResourceSummary
  readonly pending: WorkConsolePendingSummary
}

/** Compact execution attempt projection used only in Task Detail. */
export interface WorkConsoleAttemptView {
  readonly provider: string
  readonly mode: 'one-shot' | 'continuable'
  readonly startedAt: string
  readonly finishedAt?: string
  readonly stopReason?: string
  readonly nativeSessionId?: string
}

/** Thread detail with its exact current Environment binding. */
export interface WorkConsoleThreadView {
  readonly id: string
  readonly revision: number
  readonly state: 'idle' | 'running' | 'blocked' | 'closed' | 'cancelled'
  readonly blocker?: string
  readonly activeAttempt?: WorkConsoleAttemptView
  readonly lastAttempt?: WorkConsoleAttemptView
  readonly placement?: WorkConsolePlacementView
  readonly updatedAt: string
}

/** Workspace/runtime facts shown on Task Detail without service logs or secret values. */
export interface WorkConsoleEnvironmentDetail {
  readonly id: string
  readonly revision: number
  readonly name: string
  readonly state: 'ready' | 'degraded' | 'unavailable'
  readonly workspace: {
    readonly path: string
    readonly repository?: string
    readonly branch?: string
    readonly commit?: string
    readonly dirty?: boolean
  }
  readonly runtime: {
    readonly os: string
    readonly arch: string
    readonly versions: Readonly<Record<string, string>>
  }
  readonly devices: readonly string[]
  readonly capabilities: readonly string[]
}

/** Current-generation Validator result and compact Evidence references. */
export interface WorkConsoleValidatorDetail {
  readonly index: number
  readonly kind: string
  readonly requirement: 'required' | 'advisory' | 'optional'
  readonly label: string
  readonly outcome?: 'passed' | 'failed'
  readonly source?: 'automation' | 'user'
  readonly actor?: string
  readonly checkedAt?: string
  readonly evidence: readonly {
    readonly kind: string
    readonly label: string
    readonly reference: string
    readonly summary?: string
  }[]
}

/** On-demand Task Detail projection. */
export interface WorkConsoleTaskDetail {
  readonly card: WorkConsoleTaskCard
  readonly threads: readonly WorkConsoleThreadView[]
  readonly environments: readonly WorkConsoleEnvironmentDetail[]
  readonly validationGeneration?: number
  readonly validators: readonly WorkConsoleValidatorDetail[]
}

/** Explicit promotion of one passive Idea into the execution area. */
export interface PromoteWorkConsoleIdeaRequest {
  readonly id: string
  readonly revision: number
  readonly priority?: 'p0' | 'p1' | 'p2'
}

/** Human decision for one required user-acceptance entry in the active Validation Generation. */
export interface DecideWorkConsoleAcceptanceRequest {
  readonly taskId: string
  readonly taskRevision: number
  readonly generation: number
  readonly validatorIndex: number
  readonly decision: 'accept' | 'return'
}

/** Compact mutation acknowledgement returned after promotion. */
export interface PromotedWorkConsoleTask {
  readonly id: string
  readonly revision: number
  readonly status: 'organizing'
  readonly priority: 'p0' | 'p1' | 'p2'
}

/** Compact post-decision Task state. */
export interface WorkConsoleAcceptanceDecisionValue {
  readonly taskId: string
  readonly revision: number
  readonly status: 'validation' | 'done' | 'running'
  readonly decision: 'accept' | 'return'
}

export interface WorkConsoleCommandNotFound {
  readonly code: 'not-found'
  readonly id: string
}

export interface WorkConsoleCommandConflict {
  readonly code: 'conflict'
  readonly id: string
  readonly expectedRevision: number
  readonly currentRevision: number
}

export interface WorkConsoleCommandInvalidState {
  readonly code: 'invalid-state'
  readonly id: string
  readonly reason: string
}

export interface WorkConsoleCommandStaleGeneration {
  readonly code: 'stale-generation'
  readonly taskId: string
  readonly expectedGeneration: number
  readonly currentGeneration?: number
}

export interface WorkConsoleCommandInvalidValidator {
  readonly code: 'invalid-validator'
  readonly taskId: string
  readonly validatorIndex: number
}

export interface WorkConsoleCommandNotReady {
  readonly code: 'not-ready'
  readonly taskId: string
  readonly reason: 'automated-pending' | 'automated-failed'
}

/** Stable expected business failures from Work Console mutation commands. */
export type WorkConsoleCommandFailure =
  | WorkConsoleCommandNotFound
  | WorkConsoleCommandConflict
  | WorkConsoleCommandInvalidState
  | WorkConsoleCommandStaleGeneration
  | WorkConsoleCommandInvalidValidator
  | WorkConsoleCommandNotReady

/** Successful command result. */
export interface WorkConsoleCommandSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Expected command rejection. Infrastructure/storage failures still throw. */
export interface WorkConsoleCommandRejected<E extends WorkConsoleCommandFailure = WorkConsoleCommandFailure> {
  readonly ok: false
  readonly error: E
}

/** Result from `promoteIdea`. */
export type PromoteWorkConsoleIdeaResult =
  | WorkConsoleCommandSuccess<PromotedWorkConsoleTask>
  | WorkConsoleCommandRejected<WorkConsoleCommandNotFound | WorkConsoleCommandConflict | WorkConsoleCommandInvalidState>

/** Result from `decideAcceptance`. */
export type DecideWorkConsoleAcceptanceResult =
  | WorkConsoleCommandSuccess<WorkConsoleAcceptanceDecisionValue>
  | WorkConsoleCommandRejected<WorkConsoleCommandFailure>
