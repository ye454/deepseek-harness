/**
 * Evidence-backed task validation: versioned validation generations, detailed Validator results,
 * compact Evidence references, and projection into Work Control's board summary.
 * @module @deepseek-ai/dsh-work-validation
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  WorkItemConflictError,
  WorkItemTransitionError,
  type TaskWorkItem,
  type ValidationPolicy,
  type ValidationSummary,
  type ValidatorSpec,
  type WorkItemId,
  type WorkItemRef,
} from '@deepseek-ai/dsh-work-control'
import { workValidationDomainSpec } from './spec.ts'
import type { WorkValidationSessionRecord, WorkValidatorResultRecord } from './spec.ts'
import type {
  EvidenceRef,
  RecordAutomatedValidationRequest,
  RecordUserAcceptanceRequest,
  WorkValidationSession,
  WorkValidationSessionChanged,
  WorkValidationView,
  WorkValidatorResult,
  WorkValidatorResultChanged,
} from './types.ts'

export { evidenceRefRecord, workValidationDomainSpec, workValidationSessionRecord, workValidatorResultRecord } from './spec.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workValidation: WorkValidationService
  }

  interface Events {
    /** @mode emit */
    'work-validation/session-changed'(change: WorkValidationSessionChanged): void
    /** @mode emit */
    'work-validation/result-changed'(change: WorkValidatorResultChanged): void
  }
}

/** Invalid generation, policy, evidence, or caller boundary. */
export class WorkValidationError extends Error {
  /** @param message - Concrete rejected validation operation reason. */
  constructor(message: string) {
    super(message)
    this.name = 'WorkValidationError'
  }
}

/** Durable detailed validation service. Work Control remains the compact board projection owner. */
export class WorkValidationService extends Service {
  static inject = ['storageDomain', 'workControl']

  private sessions?: KvTable<WorkItemId, WorkValidationSessionRecord>
  private results?: KvTable<string, WorkValidatorResultRecord>
  private readonly taskTails = new Map<WorkItemId, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'workValidation')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workValidationDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workValidation.domainClose')
    this.sessions = domain.table('sessions')
    this.results = domain.table('results')
  }

  /**
   * Enter validation and open a fresh generation. Starting another generation invalidates all older
   * results for completion purposes without deleting their audit history.
   * @param expected - Exact organized Task revision in running or validation state.
   * @returns the new active validation session.
   */
  async beginValidation(expected: WorkItemRef): Promise<WorkValidationSession> {
    return await this.withTaskLock(expected.id, async () => {
      let task = this.requireTask(expected.id)
      assertTaskRef(task, expected)
      if (task.status === 'running') {
        task = await this.ctx.workControl.setStatus(expected, 'validation')
      } else if (task.status !== 'validation') {
        throw new WorkValidationError(`task '${task.id}' cannot begin validation from status '${task.status}'`)
      }
      const policy = requirePolicy(task)
      const previous = this.getSession(task.id)
      const generation = (previous?.generation ?? 0) + 1
      const now = new Date().toISOString()
      const startedTaskRevision = task.revision
      const requiredTotal = countRequired(policy.validators)
      const initial: ValidationSummary = {
        state: requiredTotal === 0 ? 'passed' : 'pending',
        ...(requiredTotal === 0 ? { checkedAt: now } : {}),
        requiredPassed: 0,
        requiredTotal,
      }
      await this.ctx.workControl.setValidationSummary(
        { id: task.id, revision: task.revision },
        initial,
      )
      const session: WorkValidationSession = {
        taskId: task.id,
        generation,
        startedTaskRevision,
        policyFingerprint: fingerprint(policy),
        startedAt: now,
        updatedAt: now,
      }
      await this.requireSessionTable().put(task.id, session)
      this.emitSession(session)
      return session
    })
  }

  /**
   * Record an automated Validator result. At least one Evidence reference is mandatory and the
   * `user-acceptance` policy kind is rejected on this path.
   */
  async recordAutomatedResult(request: RecordAutomatedValidationRequest): Promise<WorkValidatorResult> {
    return await this.withTaskLock(request.taskId, async () => {
      const context = this.requireActiveValidator(request.taskId, request.generation, request.validatorIndex)
      if (context.validator.kind === 'user-acceptance') {
        throw new WorkValidationError('user-acceptance cannot be satisfied through the automated result path')
      }
      const evidence = normalizeEvidence(request.evidence)
      if (evidence.length === 0) {
        throw new WorkValidationError('automated validation requires at least one Evidence reference')
      }
      const result = await this.storeResult({
        task: context.task,
        session: context.session,
        validator: context.validator,
        validatorIndex: request.validatorIndex,
        outcome: request.outcome,
        source: 'automation',
        evidence,
        note: normalizeOptional(request.note),
      })
      await this.refreshSummary(context.task.id, context.session)
      return result
    })
  }

  /**
   * Record an explicit human decision for a `user-acceptance` policy entry. The durable user result
   * itself is evidence, so external Evidence references are optional on this path.
   */
  async recordUserAcceptance(request: RecordUserAcceptanceRequest): Promise<WorkValidatorResult> {
    return await this.withTaskLock(request.taskId, async () => {
      const context = this.requireActiveValidator(request.taskId, request.generation, request.validatorIndex)
      if (context.validator.kind !== 'user-acceptance') {
        throw new WorkValidationError('recordUserAcceptance requires a user-acceptance policy entry')
      }
      const actor = requireText(request.actor, 'user acceptance actor')
      const result = await this.storeResult({
        task: context.task,
        session: context.session,
        validator: context.validator,
        validatorIndex: request.validatorIndex,
        outcome: request.outcome,
        source: 'user',
        actor,
        evidence: normalizeEvidence(request.evidence ?? []),
        note: normalizeOptional(request.note),
      })
      await this.refreshSummary(context.task.id, context.session)
      return result
    })
  }

  /** Recompute Work Control's compact summary from the authoritative current generation. */
  async reconcile(taskId: WorkItemId): Promise<TaskWorkItem> {
    return await this.withTaskLock(taskId, async () => {
      const session = this.requireSession(taskId)
      return await this.refreshSummary(taskId, session)
    })
  }

  /** Read the active validation generation for one Task. */
  getSession(taskId: WorkItemId): WorkValidationSession | undefined {
    const record = this.requireSessionTable().get(taskId)
    return record === undefined ? undefined : asSession(record)
  }

  /** List detailed results for one generation, ordered by policy index. */
  listResults(taskId: WorkItemId, generation?: number): WorkValidatorResult[] {
    const activeGeneration = generation ?? this.getSession(taskId)?.generation
    if (activeGeneration === undefined) return []
    return [...this.requireResultTable().entries()]
      .map(([, record]) => asResult(record))
      .filter(result => result.taskId === taskId && result.generation === activeGeneration)
      .sort((left, right) => left.validatorIndex - right.validatorIndex)
  }

  /** Read Task + active session + active-generation detailed results for a detail page. */
  getView(taskId: WorkItemId): WorkValidationView {
    return {
      task: this.requireTask(taskId),
      session: this.getSession(taskId),
      results: this.listResults(taskId),
    }
  }

  private requireActiveValidator(taskId: WorkItemId, generation: number, validatorIndex: number): {
    task: TaskWorkItem
    session: WorkValidationSession
    validator: ValidatorSpec
  } {
    if (!Number.isSafeInteger(generation) || generation <= 0) throw new WorkValidationError('generation must be positive')
    if (!Number.isSafeInteger(validatorIndex) || validatorIndex < 0) throw new WorkValidationError('validatorIndex must be non-negative')
    const session = this.requireSession(taskId)
    if (session.generation !== generation) {
      throw new WorkValidationError(
        `validation generation ${generation} is stale; current generation is ${session.generation}`,
      )
    }
    const task = this.requireTask(taskId)
    if (task.status !== 'validation') {
      throw new WorkValidationError(`task '${taskId}' is not in validation`)
    }
    const policy = requirePolicy(task)
    if (fingerprint(policy) !== session.policyFingerprint) {
      throw new WorkValidationError(`task '${taskId}' validation policy changed after generation ${generation} started`)
    }
    const validator = policy.validators[validatorIndex]
    if (validator === undefined) throw new WorkValidationError(`task '${taskId}' has no validator at index ${validatorIndex}`)
    return { task, session, validator }
  }

  private async storeResult(input: {
    task: TaskWorkItem
    session: WorkValidationSession
    validator: ValidatorSpec
    validatorIndex: number
    outcome: 'passed' | 'failed'
    source: 'automation' | 'user'
    actor?: string
    evidence: readonly EvidenceRef[]
    note?: string
  }): Promise<WorkValidatorResult> {
    const key = resultKey(input.task.id, input.session.generation, input.validatorIndex)
    const previous = this.requireResultTable().get(key)
    const now = new Date().toISOString()
    const result: WorkValidatorResult = {
      taskId: input.task.id,
      generation: input.session.generation,
      validatorIndex: input.validatorIndex,
      validatorKind: input.validator.kind,
      requirement: input.validator.requirement,
      label: input.validator.label.trim(),
      outcome: input.outcome,
      source: input.source,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      evidence: input.evidence,
      ...(input.note === undefined ? {} : { note: input.note }),
      revision: previous === undefined ? 1 : asResult(previous).revision + 1,
      checkedAt: now,
      updatedAt: now,
    }
    await this.requireResultTable().put(key, result)
    this.emitResult(result)
    return result
  }

  private async refreshSummary(taskId: WorkItemId, session: WorkValidationSession): Promise<TaskWorkItem> {
    const results = this.listResults(taskId, session.generation)
    for (let attempt = 0; attempt < 4; attempt++) {
      const task = this.requireTask(taskId)
      if (task.status !== 'validation') throw new WorkValidationError(`task '${taskId}' left validation before summary projection`)
      const policy = requirePolicy(task)
      if (fingerprint(policy) !== session.policyFingerprint) {
        throw new WorkValidationError(`task '${taskId}' validation policy changed before summary projection`)
      }
      const summary = summarize(policy.validators, results)
      if (sameSummary(task.validation, summary)) return task
      try {
        return await this.ctx.workControl.setValidationSummary(
          { id: task.id, revision: task.revision },
          summary,
        )
      } catch (error) {
        if (!(error instanceof WorkItemConflictError)) throw error
      }
    }
    throw new WorkValidationError(`task '${taskId}' validation summary could not converge after concurrent updates`)
  }

  private requireTask(id: WorkItemId): TaskWorkItem {
    const item = this.ctx.workControl.get(id)
    if (item === undefined || item.kind !== 'task') throw new WorkValidationError(`unknown task '${id}'`)
    return item
  }

  private requireSession(taskId: WorkItemId): WorkValidationSession {
    const session = this.getSession(taskId)
    if (session === undefined) throw new WorkValidationError(`task '${taskId}' has no active validation generation`)
    return session
  }

  private requireSessionTable(): KvTable<WorkItemId, WorkValidationSessionRecord> {
    if (this.sessions === undefined) throw new Error('work-validation domain is not initialized')
    return this.sessions
  }

  private requireResultTable(): KvTable<string, WorkValidatorResultRecord> {
    if (this.results === undefined) throw new Error('work-validation domain is not initialized')
    return this.results
  }

  private async withTaskLock<T>(taskId: WorkItemId, operation: () => Promise<T>): Promise<T> {
    const previous = this.taskTails.get(taskId) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => next, () => next)
    this.taskTails.set(taskId, tail)
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.taskTails.get(taskId) === tail) this.taskTails.delete(taskId)
    }
  }

  private emitSession(session: WorkValidationSession): void {
    try {
      this.ctx.emit('work-validation/session-changed', { session })
    } catch (error) {
      this.ctx.logger.warn(`work-validation: session observer failed: ${String(error)}`)
    }
  }

  private emitResult(result: WorkValidatorResult): void {
    try {
      this.ctx.emit('work-validation/result-changed', { result })
    } catch (error) {
      this.ctx.logger.warn(`work-validation: result observer failed: ${String(error)}`)
    }
  }
}

function assertTaskRef(task: TaskWorkItem, expected: WorkItemRef): void {
  if (task.revision !== expected.revision) throw new WorkItemConflictError(expected, task.revision)
}

function requirePolicy(task: TaskWorkItem): ValidationPolicy {
  if (task.validationPolicy === undefined) throw new WorkItemTransitionError(`task '${task.id}' has no validation policy`)
  return task.validationPolicy
}

function fingerprint(policy: ValidationPolicy): string {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex')
}

function resultKey(taskId: WorkItemId, generation: number, validatorIndex: number): string {
  return `${String(taskId)}:${generation}:${validatorIndex}`
}

function normalizeEvidence(values: readonly EvidenceRef[]): EvidenceRef[] {
  const normalized: EvidenceRef[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const item: EvidenceRef = {
      kind: value.kind,
      label: requireText(value.label, 'Evidence label'),
      reference: requireText(value.reference, 'Evidence reference'),
      ...(normalizeOptional(value.summary) === undefined ? {} : { summary: normalizeOptional(value.summary)! }),
    }
    const key = `${item.kind}\n${item.reference}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(item)
  }
  return normalized
}

function summarize(validators: readonly ValidatorSpec[], results: readonly WorkValidatorResult[]): ValidationSummary {
  const required = validators
    .map((validator, index) => ({ validator, index }))
    .filter(item => item.validator.requirement === 'required')
  const byIndex = new Map(results.map(result => [result.validatorIndex, result]))
  const requiredPassed = required.filter(item => byIndex.get(item.index)?.outcome === 'passed').length
  const requiredFailed = required.some(item => byIndex.get(item.index)?.outcome === 'failed')
  const requiredTotal = required.length
  const state: ValidationSummary['state'] = requiredFailed
    ? 'failed'
    : requiredPassed === requiredTotal
      ? 'passed'
      : 'pending'
  return {
    state,
    checkedAt: new Date().toISOString(),
    requiredPassed,
    requiredTotal,
  }
}

function sameSummary(left: ValidationSummary | undefined, right: ValidationSummary): boolean {
  return left?.state === right.state
    && left.requiredPassed === right.requiredPassed
    && left.requiredTotal === right.requiredTotal
}

function countRequired(validators: readonly ValidatorSpec[]): number {
  return validators.filter(validator => validator.requirement === 'required').length
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new WorkValidationError(`${field} must not be empty`)
  return normalized
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function asSession(record: WorkValidationSessionRecord): WorkValidationSession {
  return record as WorkValidationSession
}

function asResult(record: WorkValidatorResultRecord): WorkValidatorResult {
  return record as WorkValidatorResult
}

export default WorkValidationService
