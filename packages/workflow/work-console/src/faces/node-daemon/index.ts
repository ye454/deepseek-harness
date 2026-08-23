/**
 * Remote worker daemon: signed gateway polling, durable command deduplication, environment reporting,
 * and a daemon-local Runner provider registry.
 * @module @deepseek-ai/dsh-work-node-daemon
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionStopReason, RunnerMode } from '../../internal/execution/index.ts'
import type { WorkNodeFeature } from '../../internal/node/index.ts'
import type { RemoteNodeCommand, RemoteNodeCommandId } from '../node-gateway/index.ts'
import { WorkNodeGatewayClient, WorkNodeDaemonGatewayError } from './client.ts'
import { WorkNodeEnvironmentCollector } from './environment.ts'
import { workNodeDaemonDomainSpec } from './spec.ts'
import type { WorkNodeDaemonJournalRecordValue } from './spec.ts'
import type {
  WorkNodeDaemonCommandChanged,
  WorkNodeDaemonEnvironmentConfig,
  WorkNodeDaemonJournalRecord,
  WorkNodeRunnerHandle,
  WorkNodeRunnerProvider,
} from './types.ts'

export { WorkNodeDaemonGatewayError, WorkNodeGatewayClient } from './client.ts'
export { WorkNodeEnvironmentCollector } from './environment.ts'
export { workNodeDaemonDomainSpec, workNodeDaemonJournalRecord } from './spec.ts'
export type * from './types.ts'

/** Worker-daemon deployment configuration. */
export interface Config {
  readonly gatewayUrl: string
  readonly nodeKey: string
  readonly nodeName: string
  readonly credential: string
  readonly protocolVersion: number
  readonly pollIntervalMs: number
  readonly retryDelayMs: number
  readonly requestTimeoutMs: number
  readonly maxConcurrentRuns: number
  readonly gitCommand: string
  readonly environmentCommandOutputBytes: number
  readonly processGraceMs: number
  readonly environments: WorkNodeDaemonEnvironmentConfig[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workNodeDaemon: WorkNodeDaemon
  }

  interface Events {
    /**
     * One daemon command-journal mutation committed durably.
     * @param change - Current local journal projection.
     * @mode emit
     */
    'work-node-daemon/command-changed'(change: WorkNodeDaemonCommandChanged): void
  }
}

interface ActiveRun {
  readonly commandId: RemoteNodeCommandId
  readonly threadId: string
  readonly handle: WorkNodeRunnerHandle
  readonly controller: AbortController
}

/**
 * Persistent remote worker runtime. The daemon owns transport retries and command-id deduplication;
 * Runner plugins only register truthful local execution providers.
 */
export class WorkNodeDaemon extends Service {
  static inject = ['storageDomain', 'credentials', 'subprocess']

  static Config: s<Config> = s.object({
    gatewayUrl: s.string().required(),
    nodeKey: s.string().required(),
    nodeName: s.string().required(),
    credential: s.string().required(),
    protocolVersion: s.natural().required(),
    pollIntervalMs: s.natural().required(),
    retryDelayMs: s.natural().required(),
    requestTimeoutMs: s.natural().required(),
    maxConcurrentRuns: s.natural().required(),
    gitCommand: s.string().required(),
    environmentCommandOutputBytes: s.natural().required(),
    processGraceMs: s.natural().required(),
    environments: s.array(s.object({
      key: s.string().required(),
      name: s.string().required(),
      workspacePath: s.string().required(),
      capabilities: s.array(s.string()).default([]),
      devices: s.array(s.string()).default([]),
      secretRefs: s.array(s.string()).default([]),
    })).required(),
  })

  private journal?: KvTable<RemoteNodeCommandId, WorkNodeDaemonJournalRecordValue>
  private client?: WorkNodeGatewayClient
  private collector?: WorkNodeEnvironmentCollector
  private readonly runners = new Map<string, WorkNodeRunnerProvider>()
  private readonly activeByCommand = new Map<RemoteNodeCommandId, ActiveRun>()
  private readonly activeByThread = new Map<string, ActiveRun>()
  private readonly processing = new Map<RemoteNodeCommandId, Promise<void>>()
  private loopPromise?: Promise<void>
  private nodeRevision: number | undefined
  private recoveryPending = true

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workNodeDaemon')
    requirePositive(config.protocolVersion, 'protocolVersion')
    requirePositive(config.pollIntervalMs, 'pollIntervalMs')
    requirePositive(config.retryDelayMs, 'retryDelayMs')
    requirePositive(config.requestTimeoutMs, 'requestTimeoutMs')
    requirePositive(config.maxConcurrentRuns, 'maxConcurrentRuns')
    requireText(config.nodeKey, 'nodeKey')
    requireText(config.nodeName, 'nodeName')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workNodeDaemonDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workNodeDaemon.domainClose')
    this.journal = domain.table('commands')

    this.collector = new WorkNodeEnvironmentCollector(this.ctx, {
      gitCommand: this.config.gitCommand,
      commandOutputBytes: this.config.environmentCommandOutputBytes,
      processGraceMs: this.config.processGraceMs,
    })
    await this.collector.prepare(this.config.environments)
    this.client = new WorkNodeGatewayClient(this.ctx, {
      baseUrl: this.config.gatewayUrl,
      nodeKey: this.config.nodeKey,
      credential: credentialRef(this.config.credential),
      requestTimeoutMs: this.config.requestTimeoutMs,
    })

    const controller = new AbortController()
    this.loopPromise = this.runLoop(controller.signal)
    this.ctx.effect(() => async () => {
      controller.abort()
      for (const active of this.activeByCommand.values()) active.controller.abort()
      for (const active of this.activeByCommand.values()) active.handle.cancel()
      await Promise.allSettled([...this.activeByCommand.values()].map(active => active.handle.dispose()))
      await this.loopPromise
    }, 'workNodeDaemon.runLoop')
  }

  /**
   * Register one daemon-local Runner provider.
   * @param provider - Stable provider name, truthful supported modes, and publication operation.
   * @returns a stale-safe disposer removing that exact provider registration.
   */
  registerRunner(provider: WorkNodeRunnerProvider): () => void {
    const name = requireText(provider.name, 'runner provider name')
    if (this.runners.has(name)) throw new Error(`work-node-daemon runner '${name}' is already registered`)
    const modes = normalizeModes(provider.modes)
    if (modes.length === 0) throw new Error(`work-node-daemon runner '${name}' must support at least one mode`)
    const registered: WorkNodeRunnerProvider = { ...provider, name, modes }
    this.runners.set(name, registered)
    return () => {
      if (this.runners.get(name) === registered) this.runners.delete(name)
    }
  }

  /**
   * Discover currently registered local Runner providers.
   * @returns stable provider names and truthful modes, sorted by provider name.
   */
  listRunners(): Array<{ name: string; modes: readonly RunnerMode[] }> {
    return [...this.runners.values()]
      .map(provider => ({ name: provider.name, modes: provider.modes }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Read one local deduplication-journal record.
   * @param commandId - Remote gateway command identity.
   * @returns current durable daemon state or undefined.
   */
  getJournal(commandId: RemoteNodeCommandId): WorkNodeDaemonJournalRecord | undefined {
    const value = this.requireJournal().get(commandId)
    return value === undefined ? undefined : asJournal(value)
  }

  /**
   * Snapshot all local journal records, newest first.
   * @returns a fresh ordered array.
   */
  listJournal(): WorkNodeDaemonJournalRecord[] {
    return [...this.requireJournal().entries()]
      .map(([, value]) => asJournal(value))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || String(left.commandId).localeCompare(String(right.commandId)))
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        if (this.nodeRevision === undefined) await this.connect(signal)
        if (this.recoveryPending) {
          await this.recoverInterrupted(signal)
          this.recoveryPending = false
        }
        await this.flushTerminalResults(signal)
        const environments = await this.collectEnvironments(signal)
        const nodeRevision = this.nodeRevision
        if (nodeRevision === undefined) throw new Error('work-node-daemon failed to establish a node revision')
        const poll = await this.requireClient().poll({
          nodeKey: this.config.nodeKey,
          nodeRevision,
          protocolVersion: this.config.protocolVersion,
          runnerProviders: this.runnerNames(),
          features: this.features(),
          environments,
        }, signal)
        this.nodeRevision = poll.nodeRevision
        for (const command of poll.commands) this.schedule(command, signal)
        await delay(this.config.pollIntervalMs, signal)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof WorkNodeDaemonGatewayError && (error.code === 'STALE_NODE_REVISION' || error.code === 'HELLO_REQUIRED')) {
          this.nodeRevision = undefined
          this.recoveryPending = true
        } else {
          this.ctx.logger.warn(`work-node-daemon: ${renderError(error)}`)
        }
        await delay(this.config.retryDelayMs, signal)
      }
    }
  }

  private async connect(signal: AbortSignal): Promise<void> {
    const hello = await this.requireClient().hello({
      nodeKey: this.config.nodeKey,
      name: this.config.nodeName,
      protocolVersion: this.config.protocolVersion,
      runnerProviders: this.runnerNames(),
      features: this.features(),
    }, signal)
    this.nodeRevision = hello.nodeRevision
  }

  private async collectEnvironments(signal: AbortSignal) {
    return await Promise.all(this.config.environments.map(environment => this.requireCollector().collect(environment, signal)))
  }

  private schedule(command: RemoteNodeCommand, daemonSignal: AbortSignal): void {
    if (this.processing.has(command.id)) return
    const operation = this.processCommand(command, daemonSignal)
      .catch((error) => {
        if (!daemonSignal.aborted) this.ctx.logger.warn(`work-node-daemon command '${command.id}': ${renderError(error)}`)
      })
      .finally(() => {
        if (this.processing.get(command.id) === operation) this.processing.delete(command.id)
      })
    this.processing.set(command.id, operation)
  }

  private async processCommand(command: RemoteNodeCommand, daemonSignal: AbortSignal): Promise<void> {
    if (command.kind === 'cancel') {
      await this.processCancel(command, daemonSignal)
      return
    }

    const existing = this.getJournal(command.id)
    if (existing !== undefined) {
      if (existing.state === 'rejected') {
        await this.requireClient().ack({ nodeKey: this.config.nodeKey, commandId: command.id, accepted: false }, daemonSignal)
        return
      }
      if (existing.state === 'settled') {
        await this.flushSettledRecord(existing, daemonSignal)
        return
      }
      const active = this.activeByCommand.get(command.id)
      if (active !== undefined) {
        await this.ackPublished(command, existing, active, daemonSignal)
        return
      }
      await this.recoverOne(existing, daemonSignal)
      return
    }

    if (this.activeByCommand.size >= this.config.maxConcurrentRuns) return
    const environment = this.config.environments.find(item => item.key === command.payload.environmentKey)
    const provider = this.runners.get(command.payload.runnerProvider)
    if (environment === undefined || provider === undefined || !provider.modes.includes(command.payload.mode)) {
      const rejected = await this.createJournal(command, 'rejected')
      await this.requireClient().ack({ nodeKey: this.config.nodeKey, commandId: command.id, accepted: false }, daemonSignal)
      void rejected
      return
    }

    const controller = new AbortController()
    const signal = AbortSignal.any([daemonSignal, controller.signal])
    await this.createJournal(command, 'starting')
    let handle: WorkNodeRunnerHandle
    try {
      handle = await provider.start({
        commandId: command.id,
        prompt: command.payload.prompt,
        cwd: environment.workspacePath,
        signal,
        mode: command.payload.mode,
        ...(command.payload.resumeSessionId === undefined
          ? {}
          : { resumeSessionId: command.payload.resumeSessionId }),
      })
      assertPublishedHandle(command, handle)
    } catch (error) {
      await this.updateJournal(command.id, current => ({
        ...current,
        state: 'rejected',
        updatedAt: new Date().toISOString(),
      }))
      try {
        await this.requireClient().ack({ nodeKey: this.config.nodeKey, commandId: command.id, accepted: false }, daemonSignal)
      } catch {
        // The durable rejected journal causes the next redelivery to retry the refusal.
      }
      this.ctx.logger.warn(`work-node-daemon runner '${command.payload.runnerProvider}' failed before publication: ${renderError(error)}`)
      return
    }

    const published = await this.updateJournal(command.id, current => ({
      ...current,
      state: 'published',
      ...(handle.sessionId === undefined ? {} : { sessionId: handle.sessionId }),
      updatedAt: new Date().toISOString(),
    }))
    const active: ActiveRun = {
      commandId: command.id,
      threadId: String(command.payload.threadId),
      handle,
      controller,
    }
    this.activeByCommand.set(command.id, active)
    this.activeByThread.set(active.threadId, active)
    void this.observeRun(command, active, daemonSignal)
    await this.ackPublished(command, published, active, daemonSignal)
  }

  private async ackPublished(
    command: Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }>,
    journal: WorkNodeDaemonJournalRecord,
    active: ActiveRun,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const response = await this.requireClient().ack({
        nodeKey: this.config.nodeKey,
        commandId: command.id,
        accepted: true,
        ...(active.handle.sessionId === undefined ? {} : { subagentSessionId: active.handle.sessionId }),
      }, signal)
      if (response.command.state === 'rejected') {
        active.controller.abort()
        active.handle.cancel()
        await active.handle.dispose()
        await this.updateJournal(command.id, current => ({
          ...current,
          state: 'rejected',
          updatedAt: new Date().toISOString(),
        }))
        return
      }
      if (response.command.state === 'accepted' || response.command.state === 'settled') {
        await this.updateJournal(command.id, current => current.state === 'settled'
          ? current
          : { ...current, state: 'accepted', updatedAt: new Date().toISOString() })
      }
    } catch (error) {
      if (error instanceof WorkNodeDaemonGatewayError && error.status >= 400 && error.status < 500 && error.code !== 'REQUEST_ABORTED') {
        active.controller.abort()
        active.handle.cancel()
        await active.handle.dispose()
        await this.updateJournal(command.id, current => ({
          ...current,
          state: 'rejected',
          updatedAt: new Date().toISOString(),
        }))
        return
      }
      // Network/timeout errors leave the published Runner live. The queued command is delivered again and ack retries.
      if (!signal.aborted) this.ctx.logger.warn(`work-node-daemon ack '${command.id}': ${renderError(error)}`)
    }
    void journal
  }

  private async observeRun(
    command: Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }>,
    active: ActiveRun,
    daemonSignal: AbortSignal,
  ): Promise<void> {
    let stopReason: ExecutionStopReason
    try {
      stopReason = await active.handle.result
    } catch (error) {
      stopReason = 'unknown'
      this.ctx.logger.warn(`work-node-daemon runner '${command.id}' violated never-reject result: ${renderError(error)}`)
    }
    try {
      await active.handle.dispose()
    } finally {
      if (this.activeByCommand.get(command.id) === active) this.activeByCommand.delete(command.id)
      if (this.activeByThread.get(active.threadId) === active) this.activeByThread.delete(active.threadId)
    }
    const settled = await this.updateJournal(command.id, current => ({
      ...current,
      state: 'settled',
      stopReason,
      updatedAt: new Date().toISOString(),
    }))
    try {
      await this.flushSettledRecord(settled, daemonSignal)
    } catch (error) {
      if (!daemonSignal.aborted) this.ctx.logger.warn(`work-node-daemon result '${command.id}': ${renderError(error)}`)
    }
  }

  private async processCancel(command: Extract<RemoteNodeCommand, { kind: 'cancel' }>, signal: AbortSignal): Promise<void> {
    const existing = this.getJournal(command.id)
    if (existing?.state === 'settled' || existing?.state === 'rejected') {
      await this.requireClient().ack({
        nodeKey: this.config.nodeKey,
        commandId: command.id,
        accepted: existing.state === 'settled',
      }, signal)
      return
    }
    const active = this.activeByThread.get(String(command.payload.threadId))
    if (active === undefined) {
      if (existing === undefined) await this.createJournal(command, 'rejected')
      else await this.updateJournal(command.id, current => ({ ...current, state: 'rejected', updatedAt: new Date().toISOString() }))
      await this.requireClient().ack({ nodeKey: this.config.nodeKey, commandId: command.id, accepted: false }, signal)
      return
    }
    active.controller.abort()
    active.handle.cancel()
    if (existing === undefined) await this.createJournal(command, 'settled')
    else await this.updateJournal(command.id, current => ({ ...current, state: 'settled', updatedAt: new Date().toISOString() }))
    await this.requireClient().ack({ nodeKey: this.config.nodeKey, commandId: command.id, accepted: true }, signal)
  }

  private async recoverInterrupted(signal: AbortSignal): Promise<void> {
    for (const record of this.listJournal()) {
      if (record.state === 'starting' || record.state === 'published' || record.state === 'accepted' || record.state === 'interrupted') {
        await this.recoverOne(record, signal)
      }
    }
  }

  private async recoverOne(record: WorkNodeDaemonJournalRecord, signal: AbortSignal): Promise<void> {
    const interrupted = record.state === 'interrupted'
      ? record
      : await this.updateJournal(record.commandId, current => ({
        ...current,
        state: 'interrupted',
        updatedAt: new Date().toISOString(),
      }))
    const response = await this.requireClient().ack({
      nodeKey: this.config.nodeKey,
      commandId: interrupted.commandId,
      accepted: false,
    }, signal)
    if (response.command.state === 'accepted' && interrupted.kind !== 'cancel') {
      const settled = await this.updateJournal(interrupted.commandId, current => ({
        ...current,
        state: 'settled',
        stopReason: 'unknown',
        updatedAt: new Date().toISOString(),
      }))
      await this.flushSettledRecord(settled, signal)
      return
    }
    if (response.command.state === 'settled') {
      const stopReason = response.command.kind === 'cancel' ? undefined : response.command.resultStopReason
      await this.updateJournal(interrupted.commandId, current => ({
        ...current,
        state: 'settled',
        ...(stopReason === undefined ? {} : { stopReason }),
        reportedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
      return
    }
    await this.updateJournal(interrupted.commandId, current => ({
      ...current,
      state: 'rejected',
      updatedAt: new Date().toISOString(),
    }))
  }

  private async flushTerminalResults(signal: AbortSignal): Promise<void> {
    for (const record of this.listJournal()) {
      if (record.state === 'settled' && record.reportedAt === undefined && record.kind !== 'cancel') {
        await this.flushSettledRecord(record, signal)
      }
    }
  }

  private async flushSettledRecord(record: WorkNodeDaemonJournalRecord, signal: AbortSignal): Promise<void> {
    if (record.kind === 'cancel' || record.stopReason === undefined || record.reportedAt !== undefined) return
    const ack = await this.requireClient().ack({
      nodeKey: this.config.nodeKey,
      commandId: record.commandId,
      accepted: true,
      ...(record.sessionId === undefined ? {} : { subagentSessionId: record.sessionId }),
    }, signal)
    if (ack.command.state === 'rejected') {
      await this.updateJournal(record.commandId, current => ({
        ...current,
        state: 'rejected',
        updatedAt: new Date().toISOString(),
      }))
      return
    }
    if (ack.command.state === 'accepted') {
      await this.requireClient().result({
        nodeKey: this.config.nodeKey,
        commandId: record.commandId,
        stopReason: record.stopReason,
      }, signal)
    }
    await this.updateJournal(record.commandId, current => ({
      ...current,
      reportedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  }

  private async createJournal(command: RemoteNodeCommand, state: WorkNodeDaemonJournalRecord['state']): Promise<WorkNodeDaemonJournalRecord> {
    const now = new Date().toISOString()
    const record: WorkNodeDaemonJournalRecord = {
      commandId: command.id,
      kind: command.kind,
      ...(command.kind === 'cancel' ? {} : { runnerProvider: command.payload.runnerProvider }),
      state,
      createdAt: now,
      updatedAt: now,
    }
    await this.requireJournal().put(command.id, record)
    this.emitJournalChanged(record)
    return record
  }

  private async updateJournal(
    commandId: RemoteNodeCommandId,
    update: (current: WorkNodeDaemonJournalRecord) => WorkNodeDaemonJournalRecord,
  ): Promise<WorkNodeDaemonJournalRecord> {
    const next = await this.requireJournal().update(commandId, current => update(asJournal(current)))
    const record = asJournal(next)
    this.emitJournalChanged(record)
    return record
  }

  private emitJournalChanged(record: WorkNodeDaemonJournalRecord): void {
    try {
      this.ctx.emit('work-node-daemon/command-changed', { record })
    } catch (error) {
      this.ctx.logger.warn(`work-node-daemon: command observer failed: ${renderError(error)}`)
    }
  }

  private runnerNames(): string[] {
    return [...this.runners.keys()].sort()
  }

  private features(): WorkNodeFeature[] {
    const features: WorkNodeFeature[] = ['environment-report']
    if (this.runners.size > 0) features.push('execute', 'cancel')
    if ([...this.runners.values()].some(provider => provider.modes.includes('continuable'))) features.push('resume')
    return features
  }

  private requireJournal(): KvTable<RemoteNodeCommandId, WorkNodeDaemonJournalRecordValue> {
    if (this.journal === undefined) throw new Error('work-node-daemon domain is not initialized')
    return this.journal
  }

  private requireClient(): WorkNodeGatewayClient {
    if (this.client === undefined) throw new Error('work-node-daemon client is not initialized')
    return this.client
  }

  private requireCollector(): WorkNodeEnvironmentCollector {
    if (this.collector === undefined) throw new Error('work-node-daemon collector is not initialized')
    return this.collector
  }
}

function asJournal(value: WorkNodeDaemonJournalRecordValue): WorkNodeDaemonJournalRecord {
  return value as WorkNodeDaemonJournalRecord
}

function normalizeModes(values: readonly RunnerMode[]): RunnerMode[] {
  const valid: RunnerMode[] = []
  for (const value of values) {
    if (value !== 'one-shot' && value !== 'continuable') throw new TypeError(`unknown runner mode '${String(value)}'`)
    if (!valid.includes(value)) valid.push(value)
  }
  return valid
}

function assertPublishedHandle(
  command: Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }>,
  handle: WorkNodeRunnerHandle,
): void {
  if (command.payload.mode === 'continuable' && handle.sessionId === undefined) {
    throw new Error(`runner '${command.payload.runnerProvider}' did not publish a session for continuable mode`)
  }
  if (command.payload.mode === 'one-shot' && handle.sessionId !== undefined) {
    throw new Error(`runner '${command.payload.runnerProvider}' published a session while declaring one-shot mode`)
  }
  if (command.kind === 'resume' && handle.sessionId !== command.payload.resumeSessionId) {
    throw new Error(`runner '${command.payload.runnerProvider}' did not preserve the native resume session`)
  }
}

function requirePositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`work-node-daemon ${field} must be a positive safe integer`)
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new TypeError(`work-node-daemon ${field} must not be empty`)
  return normalized
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = (): void => { finish() }
    const timer = setTimeout(finish, ms)
    timer.unref()
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) finish()
  })
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default WorkNodeDaemon
