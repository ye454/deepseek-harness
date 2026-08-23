/**
 * Authenticated HTTP-pull gateway for remote work nodes.
 * @module @deepseek-ai/dsh-work-node-gateway
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { clearInterval, setInterval } from 'node:timers'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionThread, ExecutionThreadId, ExecutionThreadRef, RunnerMode } from '../../internal/execution/index.ts'
import type { WorkEnvironmentRef, WorkEnvironmentSnapshot } from '../../internal/environment/index.ts'
import { WorkNodeConflictError, type WorkNode, type WorkNodeId } from '../../internal/node/index.ts'
import { buildBoundedWorkPrompt, type WorkHandoff } from '../../internal/runner-subagent/index.ts'
import { workNodeGatewayDomainSpec } from './spec.ts'
import type {
  RemoteEnvironmentIdentityRecord,
  RemoteNodeCommandRecord,
  RemoteNodeIdentityRecord,
} from './spec.ts'
import { ackRequest, helloRequest, pollRequest, resultRequest } from './wire.ts'
import type {
  RemoteEnvironmentIdentity,
  RemoteEnvironmentReport,
  RemoteNodeAckRequest,
  RemoteNodeCommand,
  RemoteNodeCommandChanged,
  RemoteNodeCommandId as RemoteNodeCommandIdBrand,
  RemoteNodeHelloRequest,
  RemoteNodeHelloResponse,
  RemoteNodeIdentity,
  RemoteNodePollRequest,
  RemoteNodePollResponse,
  RemoteNodeResultRequest,
} from './types.ts'

export type * from './types.ts'
export { workNodeGatewayDomainSpec } from './spec.ts'

/** Stable remote command identity. */
export type RemoteNodeCommandId = RemoteNodeCommandIdBrand

/**
 * Brand a raw string as a remote command id.
 * @param id - Raw persisted identifier.
 * @returns the same string with the remote-command brand.
 */
export function RemoteNodeCommandId(id: string): RemoteNodeCommandId {
  return id as RemoteNodeCommandId
}

const NODE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/
const HELLO_PATH = '/work-node/v1/hello'
const POLL_PATH = '/work-node/v1/poll'
const ACK_PATH = '/work-node/v1/ack'
const RESULT_PATH = '/work-node/v1/result'

/** Gateway deployment configuration. Secret values are credential references, never inline config. */
export interface Config {
  /** Configured node key to credential-reference name. */
  nodes: Record<string, string>
  /** Maximum complete JSON request body size. */
  maxRequestBodyBytes: number
  /** Maximum bounded Task Context prompt bytes in queued execute/resume commands. */
  maxPromptBytes: number
  /** Maximum queued commands returned by one poll. */
  maxCommandsPerPoll: number
  /** Maximum accepted absolute difference between signed request time and host time. */
  maxClockSkewMs: number
  /** A node older than this threshold is eligible for offline marking. */
  heartbeatTimeoutMs: number
  /** How often the gateway checks heartbeat age. */
  sweepIntervalMs: number
}

/** Scheduler-side preflight or remote-protocol admission failure. */
export class WorkNodeGatewayError extends Error {
  /** @param message - Concrete rejected operation reason. */
  constructor(message: string) {
    super(message)
    this.name = 'WorkNodeGatewayError'
  }
}

class HttpGatewayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'HttpGatewayError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workNodeGateway: WorkNodeGateway
  }

  interface Events {
    /**
     * One remote command mutation committed durably.
     * @param change - Current durable command projection.
     * @mode emit
     */
    'work-node-gateway/command-changed'(change: RemoteNodeCommandChanged): void
  }
}

/**
 * Durable command queue plus authenticated HTTP-pull transport. Remote nodes call hello/poll/ack/result;
 * local scheduler consumers enqueue commands through this service.
 */
export class WorkNodeGateway extends Service {
  static inject = [
    'storageDomain',
    'credentials',
    'webServer',
    'workControl',
    'workExecution',
    'workNodes',
    'workEnvironments',
  ]

  static Config: s<Config> = s.object({
    nodes: s.dict(s.string()).required(),
    maxRequestBodyBytes: s.natural().required(),
    maxPromptBytes: s.natural().required(),
    maxCommandsPerPoll: s.natural().required(),
    maxClockSkewMs: s.natural().required(),
    heartbeatTimeoutMs: s.natural().required(),
    sweepIntervalMs: s.natural().required(),
  })

  private nodeIdentities?: KvTable<string, RemoteNodeIdentityRecord>
  private environmentIdentities?: KvTable<string, RemoteEnvironmentIdentityRecord>
  private commands?: KvTable<RemoteNodeCommandId, RemoteNodeCommandRecord>
  private readonly authRefs = new Map<string, CredentialRef>()
  private readonly nodeTails = new Map<string, Promise<void>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workNodeGateway')
    requirePositive(config.maxRequestBodyBytes, 'maxRequestBodyBytes')
    requirePositive(config.maxPromptBytes, 'maxPromptBytes')
    requirePositive(config.maxCommandsPerPoll, 'maxCommandsPerPoll')
    requirePositive(config.maxClockSkewMs, 'maxClockSkewMs')
    requirePositive(config.heartbeatTimeoutMs, 'heartbeatTimeoutMs')
    requirePositive(config.sweepIntervalMs, 'sweepIntervalMs')
    for (const [nodeKey, rawRef] of Object.entries(config.nodes)) {
      validateConfiguredNodeKey(nodeKey)
      this.authRefs.set(nodeKey, credentialRef(rawRef))
    }
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workNodeGatewayDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workNodeGateway.domainClose')
    this.nodeIdentities = domain.table('nodes')
    this.environmentIdentities = domain.table('environments')
    this.commands = domain.table('commands')

    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: HELLO_PATH,
      handler: (req, res) => this.handle(req, res, HELLO_PATH, helloRequest, body => this.hello(body)),
    }), 'workNodeGateway.helloRoute')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: POLL_PATH,
      handler: (req, res) => this.handle(
        req,
        res,
        POLL_PATH,
        pollRequest,
        body => this.poll({
          nodeKey: body.nodeKey,
          nodeRevision: body.nodeRevision,
          protocolVersion: body.protocolVersion,
          runnerProviders: body.runnerProviders,
          features: body.features,
          environments: body.environments.map(report => ({
            key: report.key,
            name: report.name,
            snapshot: canonicalizeSnapshot(report.snapshot as unknown as WorkEnvironmentSnapshot),
            ...(report.state === undefined ? {} : { state: report.state }),
            ...(report.degradedReason === undefined ? {} : { degradedReason: report.degradedReason }),
          })),
          ...(body.state === undefined ? {} : { state: body.state }),
          ...(body.degradedReason === undefined ? {} : { degradedReason: body.degradedReason }),
        }),
      ),
    }), 'workNodeGateway.pollRoute')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: ACK_PATH,
      handler: (req, res) => this.handle(
        req,
        res,
        ACK_PATH,
        ackRequest,
        body => this.ack({
          nodeKey: body.nodeKey,
          commandId: body.commandId,
          accepted: body.accepted,
          ...(body.subagentSessionId === undefined ? {} : { subagentSessionId: body.subagentSessionId }),
        }),
      ),
    }), 'workNodeGateway.ackRoute')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact',
      path: RESULT_PATH,
      handler: (req, res) => this.handle(req, res, RESULT_PATH, resultRequest, body => this.result(body)),
    }), 'workNodeGateway.resultRoute')

    const timer = setInterval(() => {
      void this.sweepOffline().catch(error => this.ctx.logger.warn(error))
    }, this.config.sweepIntervalMs)
    timer.unref()
    this.ctx.effect(() => () => clearInterval(timer), 'workNodeGateway.heartbeatSweep')
  }

  /**
   * Queue fresh remote execution after environment/node/runner preflight passes.
   * @param threadRef - Exact idle execution thread revision.
   * @param runnerProvider - Provider the selected node must advertise.
   * @param mode - One-shot or continuable remote runner mode.
   * @param handoff - Optional operational conclusions; never a transcript.
   * @returns the durable queued command.
   */
  async enqueueExecute(
    threadRef: ExecutionThreadRef,
    runnerProvider: string,
    mode: RunnerMode,
    handoff?: WorkHandoff,
  ): Promise<RemoteNodeCommand> {
    if (mode === 'continuable') this.requireNodeFeatureForThread(threadRef.id, 'resume')
    return await this.enqueueExecutionCommand('execute', threadRef, runnerProvider, mode, handoff)
  }

  /**
   * Queue native continuation for the previous continuable attempt. Native continuation is admitted only when
   * the selected environment is still on the same node that published the retained native session.
   * @param threadRef - Exact idle execution thread revision.
   * @param runnerProvider - Provider that owns the previous native session.
   * @param handoff - Optional compact continuation conclusions.
   * @returns the durable queued resume command.
   */
  async enqueueResume(
    threadRef: ExecutionThreadRef,
    runnerProvider: string,
    handoff?: WorkHandoff,
  ): Promise<RemoteNodeCommand> {
    const thread = this.requireIdleThread(threadRef)
    const previous = thread.lastAttempt
    if (
      previous === undefined
      || previous.mode !== 'continuable'
      || previous.provider !== runnerProvider
      || previous.subagentSessionId === undefined
    ) {
      throw new WorkNodeGatewayError(`thread '${thread.id}' has no resumable '${runnerProvider}' attempt`)
    }
    const binding = this.ctx.workEnvironments.getBinding(thread.id)
    if (binding === undefined) throw new WorkNodeGatewayError(`thread '${thread.id}' has no environment binding`)
    const origin = this.findRemoteSessionOrigin(thread.id, runnerProvider, previous.subagentSessionId)
    if (origin === undefined || origin.nodeId !== binding.nodeId) {
      throw new WorkNodeGatewayError(
        `thread '${thread.id}' native session is not owned by the currently bound node; use system handoff instead`,
      )
    }
    this.requireNodeFeature(binding.nodeId, 'resume')
    return await this.enqueueExecutionCommand(
      'resume',
      threadRef,
      runnerProvider,
      'continuable',
      handoff,
      previous.subagentSessionId,
    )
  }

  /**
   * Queue a cancellation control message for the node hosting the current active attempt.
   * The original execute/resume command remains responsible for the terminal result.
   * @param threadId - Running execution thread.
   * @returns the durable cancel command.
   */
  async enqueueCancel(threadId: ExecutionThreadId): Promise<RemoteNodeCommand> {
    const thread = this.ctx.workExecution.get(threadId)
    if (thread?.state !== 'running' || thread.activeAttempt === undefined) {
      throw new WorkNodeGatewayError(`thread '${threadId}' has no active attempt to cancel`)
    }
    const binding = this.ctx.workEnvironments.getBinding(threadId)
    if (binding === undefined) throw new WorkNodeGatewayError(`thread '${threadId}' has no environment binding`)
    this.requireNodeFeature(binding.nodeId, 'cancel')
    const now = new Date().toISOString()
    const command: RemoteNodeCommand = {
      id: RemoteNodeCommandId(randomUUID()),
      nodeId: binding.nodeId,
      kind: 'cancel',
      state: 'queued',
      payload: { threadId, attemptSeq: thread.activeAttempt.seq },
      createdAt: now,
      updatedAt: now,
    }
    await this.storeNewCommand(command)
    return command
  }

  /**
   * Read one current remote command.
   * @param id - Durable remote command id.
   * @returns the current command or undefined.
   */
  getCommand(id: RemoteNodeCommandId): RemoteNodeCommand | undefined {
    const record = this.requireCommandTable().get(id)
    return record === undefined ? undefined : asCommand(record)
  }

  /**
   * List gateway commands in creation order, optionally limited to one node.
   * @param nodeId - Optional node filter.
   * @returns a fresh command array.
   */
  listCommands(nodeId?: WorkNodeId): RemoteNodeCommand[] {
    return [...this.requireCommandTable().entries()]
      .map(([, record]) => asCommand(record))
      .filter(command => nodeId === undefined || command.nodeId === nodeId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || String(left.id).localeCompare(String(right.id)))
  }

  private async enqueueExecutionCommand(
    kind: 'execute' | 'resume',
    threadRef: ExecutionThreadRef,
    runnerProviderValue: string,
    mode: RunnerMode,
    handoff?: WorkHandoff,
    resumeSessionId?: SessionId,
  ): Promise<RemoteNodeCommand> {
    const runnerProvider = requireText(runnerProviderValue, 'runner provider')
    const thread = this.requireIdleThread(threadRef)
    this.assertNoOpenExecutionCommand(thread.id)
    const preflight = this.ctx.workEnvironments.preflight(thread.id, runnerProvider)
    if (!preflight.ok) {
      throw new WorkNodeGatewayError(`thread '${thread.id}' remote preflight failed: ${preflight.issues.join(', ')}`)
    }
    const binding = this.ctx.workEnvironments.getBinding(thread.id)
    if (binding === undefined) throw new WorkNodeGatewayError(`thread '${thread.id}' has no environment binding`)
    const environment = this.ctx.workEnvironments.get(binding.environmentId)
    if (environment === undefined || environment.revision !== binding.environmentRevision) {
      throw new WorkNodeGatewayError(`thread '${thread.id}' environment binding is not current`)
    }
    const environmentIdentity = this.findEnvironmentIdentity(environment.id)
    if (environmentIdentity === undefined || this.getNodeIdentity(environmentIdentity.nodeKey)?.nodeId !== binding.nodeId) {
      throw new WorkNodeGatewayError(`environment '${environment.id}' has no remote-node identity on the selected node`)
    }
    const item = this.ctx.workControl.get(thread.taskId)
    if (item === undefined || item.kind !== 'task' || item.status !== 'running') {
      throw new WorkNodeGatewayError(`thread '${thread.id}' task is not running`)
    }
    const prompt = buildBoundedWorkPrompt(item, handoff, this.config.maxPromptBytes)
    const now = new Date().toISOString()
    const command: RemoteNodeCommand = {
      id: RemoteNodeCommandId(randomUUID()),
      nodeId: binding.nodeId,
      kind,
      state: 'queued',
      payload: {
        threadId: thread.id,
        threadRevision: thread.revision,
        environmentId: environment.id,
        environmentRevision: environment.revision,
        environmentKey: environmentIdentity.environmentKey,
        runnerProvider,
        mode,
        prompt: prompt.text,
        promptBytes: prompt.bytes,
        ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      },
      createdAt: now,
      updatedAt: now,
    }
    await this.storeNewCommand(command)
    return command
  }

  private async hello(request: RemoteNodeHelloRequest): Promise<RemoteNodeHelloResponse> {
    return await this.withNodeLock(request.nodeKey, async () => {
      let identity = this.getNodeIdentity(request.nodeKey)
      let node: WorkNode
      if (identity === undefined) {
        node = await this.ctx.workNodes.registerNode({
          name: request.name,
          protocolVersion: request.protocolVersion,
          runnerProviders: request.runnerProviders,
          features: request.features,
        })
        const now = new Date().toISOString()
        identity = { nodeKey: request.nodeKey, nodeId: node.id, createdAt: now, updatedAt: now }
        await this.requireNodeIdentityTable().put(request.nodeKey, identity)
      } else {
        const current = this.ctx.workNodes.get(identity.nodeId)
        if (current === undefined) throw new HttpGatewayError(409, 'IDENTITY_DANGLING', 'node identity requires administrator repair')
        node = await this.ctx.workNodes.refreshNode({ id: current.id, revision: current.revision }, {
          protocolVersion: request.protocolVersion,
          runnerProviders: request.runnerProviders,
          features: request.features,
          state: 'online',
        })
        await this.requireNodeIdentityTable().put(request.nodeKey, {
          ...identity,
          updatedAt: new Date().toISOString(),
        })
      }
      return { nodeId: node.id, nodeRevision: node.revision }
    })
  }

  private async poll(request: RemoteNodePollRequest): Promise<RemoteNodePollResponse> {
    return await this.withNodeLock(request.nodeKey, async () => {
      const identity = this.requireNodeIdentity(request.nodeKey)
      const current = this.ctx.workNodes.get(identity.nodeId)
      if (current === undefined) throw new HttpGatewayError(409, 'IDENTITY_DANGLING', 'node identity requires administrator repair')
      if (current.revision !== request.nodeRevision) {
        throw new HttpGatewayError(409, 'STALE_NODE_REVISION', 'node revision is stale; repeat hello')
      }
      const node = await this.ctx.workNodes.refreshNode({ id: current.id, revision: current.revision }, {
        protocolVersion: request.protocolVersion,
        runnerProviders: request.runnerProviders,
        features: request.features,
        ...(request.state === undefined ? {} : { state: request.state }),
        ...(request.degradedReason === undefined ? {} : { degradedReason: request.degradedReason }),
      })
      for (const report of request.environments) {
        await this.applyEnvironmentReport(request.nodeKey, node.id, report)
      }

      const commands: RemoteNodeCommand[] = []
      for (const candidate of this.listCommands(node.id)) {
        if (candidate.state !== 'queued') continue
        const failureCode = this.deliveryFailure(candidate, node)
        if (failureCode !== undefined) {
          await this.rejectQueuedCommand(candidate, failureCode)
          continue
        }
        commands.push(candidate)
        if (commands.length >= this.config.maxCommandsPerPoll) break
      }
      return { nodeId: node.id, nodeRevision: node.revision, commands }
    })
  }

  private async ack(request: RemoteNodeAckRequest): Promise<{ command: RemoteNodeCommand }> {
    return await this.withNodeLock(request.nodeKey, async () => {
      const identity = this.requireNodeIdentity(request.nodeKey)
      const current = this.requireCommand(request.commandId)
      if (current.nodeId !== identity.nodeId) {
        throw new HttpGatewayError(403, 'COMMAND_NODE_MISMATCH', 'command belongs to another node')
      }
      if (current.state !== 'queued') return { command: current }

      if (!request.accepted) {
        return { command: await this.rejectQueuedCommand(current, 'REMOTE_REJECTED') }
      }
      if (current.kind === 'cancel') {
        return { command: await this.updateCommand(current.id, command => ({
          ...command,
          state: 'settled',
          updatedAt: new Date().toISOString(),
          settledAt: new Date().toISOString(),
        })) }
      }

      if (current.payload.mode === 'continuable' && request.subagentSessionId === undefined) {
        throw new HttpGatewayError(409, 'SESSION_REQUIRED', 'continuable command must publish a native session id')
      }
      if (
        current.kind === 'resume'
        && request.subagentSessionId !== current.payload.resumeSessionId
      ) {
        throw new HttpGatewayError(409, 'SESSION_MISMATCH', 'native resume must preserve the requested session id')
      }

      // Recovery edge: a Host crash may happen after beginAttempt() commits but before
      // the gateway command is persisted as accepted. Reconcile that already-published
      // matching Runner before ordinary queued-command validation, which correctly sees
      // a running thread as stale for a *new* delivery.
      let running = this.reconcilePublishedAttempt(current, request.subagentSessionId)
      if (running === undefined) {
        const node = this.ctx.workNodes.get(current.nodeId)
        const failureCode = node === undefined ? 'NODE_MISSING' : this.deliveryFailure(current, node)
        if (failureCode !== undefined) {
          await this.rejectQueuedCommand(current, failureCode)
          throw new HttpGatewayError(409, 'COMMAND_INVALIDATED', 'command became invalid before runner publication was recorded')
        }

        try {
          running = await this.ctx.workExecution.beginAttempt(
            { id: current.payload.threadId, revision: current.payload.threadRevision },
            {
              provider: current.payload.runnerProvider,
              mode: current.payload.mode,
              ...(request.subagentSessionId === undefined ? {} : { subagentSessionId: request.subagentSessionId }),
            },
          )
        } catch {
          await this.rejectQueuedCommand(current, 'ATTEMPT_COMMIT_FAILED')
          throw new HttpGatewayError(409, 'ATTEMPT_COMMIT_FAILED', 'runner must stop because central attempt admission failed')
        }
      }

      const accepted = await this.updateCommand(current.id, command => ({
        ...command,
        state: 'accepted',
        ...(request.subagentSessionId === undefined ? {} : { publishedSessionId: request.subagentSessionId }),
        acceptedThreadRevision: running.revision,
        updatedAt: new Date().toISOString(),
      }))
      return { command: accepted }
    })
  }

  private async result(request: RemoteNodeResultRequest): Promise<{ command: RemoteNodeCommand }> {
    return await this.withNodeLock(request.nodeKey, async () => {
      const identity = this.requireNodeIdentity(request.nodeKey)
      const current = this.requireCommand(request.commandId)
      if (current.nodeId !== identity.nodeId) {
        throw new HttpGatewayError(403, 'COMMAND_NODE_MISMATCH', 'command belongs to another node')
      }
      if (current.kind === 'cancel') throw new HttpGatewayError(409, 'CONTROL_HAS_NO_RESULT', 'cancel commands settle through ack')
      if (current.state === 'settled') {
        if (current.resultStopReason !== request.stopReason) {
          throw new HttpGatewayError(409, 'RESULT_CONFLICT', 'command already settled with a different result')
        }
        return { command: current }
      }
      if (current.state !== 'accepted' || current.acceptedThreadRevision === undefined) {
        throw new HttpGatewayError(409, 'COMMAND_NOT_ACCEPTED', 'command must be accepted before result')
      }
      await this.ctx.workExecution.settleAttempt(
        { id: current.payload.threadId, revision: current.acceptedThreadRevision },
        { stopReason: request.stopReason },
      )
      const settled = await this.updateCommand(current.id, command => ({
        ...command,
        state: 'settled',
        resultStopReason: request.stopReason,
        updatedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      }))
      return { command: settled }
    })
  }

  private async applyEnvironmentReport(nodeKey: string, nodeId: WorkNodeId, report: RemoteEnvironmentReport): Promise<void> {
    validateWireNodeKey(report.key)
    const key = `${nodeKey}/${report.key}`
    const canonicalSnapshot = canonicalizeSnapshot(report.snapshot)
    const identityRecord = this.requireEnvironmentIdentityTable().get(key)
    if (identityRecord === undefined) {
      const environment = await this.ctx.workEnvironments.registerEnvironment({
        nodeId,
        name: report.name,
        snapshot: canonicalSnapshot,
        ...(report.state === undefined ? {} : { state: report.state }),
        ...(report.degradedReason === undefined ? {} : { degradedReason: report.degradedReason }),
      })
      const now = new Date().toISOString()
      const identity: RemoteEnvironmentIdentity = {
        key,
        nodeKey,
        environmentKey: report.key,
        environmentId: environment.id,
        createdAt: now,
        updatedAt: now,
      }
      await this.requireEnvironmentIdentityTable().put(key, identity)
      return
    }

    const identity = asEnvironmentIdentity(identityRecord)
    const environment = this.ctx.workEnvironments.get(identity.environmentId)
    if (environment === undefined) {
      throw new HttpGatewayError(409, 'ENVIRONMENT_IDENTITY_DANGLING', 'environment identity requires administrator repair')
    }
    const nextState = report.state ?? 'ready'
    const nextReason = report.degradedReason
    const currentReason = environment.degradedReason
    if (
      environment.state === nextState
      && currentReason === nextReason
      && stableJson(environment.snapshot) === stableJson(canonicalSnapshot)
    ) {
      return
    }
    await this.ctx.workEnvironments.refreshEnvironment(
      { id: environment.id, revision: environment.revision } satisfies WorkEnvironmentRef,
      {
        snapshot: canonicalSnapshot,
        ...(report.state === undefined ? {} : { state: report.state }),
        ...(report.degradedReason === undefined ? {} : { degradedReason: report.degradedReason }),
      },
    )
  }

  private deliveryFailure(command: RemoteNodeCommand, node: WorkNode): string | undefined {
    if (node.state === 'offline') return 'NODE_OFFLINE'
    if (node.state === 'degraded') return 'NODE_DEGRADED'
    if (command.kind === 'cancel') {
      if (!node.features.includes('cancel')) return 'NODE_CANCEL_UNSUPPORTED'
      const thread = this.ctx.workExecution.get(command.payload.threadId)
      if (thread?.state !== 'running' || thread.activeAttempt?.seq !== command.payload.attemptSeq) {
        return 'ACTIVE_ATTEMPT_CHANGED'
      }
      const binding = this.ctx.workEnvironments.getBinding(command.payload.threadId)
      return binding?.nodeId === node.id ? undefined : 'NODE_BINDING_CHANGED'
    }

    if (!node.features.includes('execute')) return 'NODE_EXECUTE_UNSUPPORTED'
    if (command.payload.mode === 'continuable' && !node.features.includes('resume')) return 'NODE_RESUME_UNSUPPORTED'
    if (!node.runnerProviders.includes(command.payload.runnerProvider)) return 'RUNNER_UNAVAILABLE'
    const thread = this.ctx.workExecution.get(command.payload.threadId)
    if (
      thread === undefined
      || thread.state !== 'idle'
      || thread.activeAttempt !== undefined
      || thread.revision !== command.payload.threadRevision
    ) return 'THREAD_CHANGED'
    const item = this.ctx.workControl.get(thread.taskId)
    if (item === undefined || item.kind !== 'task' || item.status !== 'running') return 'TASK_NOT_RUNNING'
    const binding = this.ctx.workEnvironments.getBinding(thread.id)
    if (
      binding === undefined
      || binding.nodeId !== node.id
      || binding.environmentId !== command.payload.environmentId
      || binding.environmentRevision !== command.payload.environmentRevision
    ) return 'ENVIRONMENT_BINDING_CHANGED'
    const environment = this.ctx.workEnvironments.get(command.payload.environmentId)
    if (environment === undefined) return 'ENVIRONMENT_MISSING'
    if (environment.revision !== command.payload.environmentRevision) return 'ENVIRONMENT_STALE'
    if (environment.state !== 'ready') return 'ENVIRONMENT_NOT_READY'
    return undefined
  }

  private reconcilePublishedAttempt(command: Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }>, sessionId: SessionId | undefined): ExecutionThread | undefined {
    const thread = this.ctx.workExecution.get(command.payload.threadId)
    const active = thread?.activeAttempt
    if (
      thread?.state !== 'running'
      || active === undefined
      || active.provider !== command.payload.runnerProvider
      || active.mode !== command.payload.mode
      || active.subagentSessionId !== sessionId
    ) return undefined
    return thread
  }

  private findRemoteSessionOrigin(threadId: ExecutionThreadId, provider: string, sessionId: SessionId): Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }> | undefined {
    return this.listCommands()
      .filter((command): command is Extract<RemoteNodeCommand, { kind: 'execute' | 'resume' }> =>
        command.kind !== 'cancel'
        && command.state === 'settled'
        && command.payload.threadId === threadId
        && command.payload.runnerProvider === provider
        && command.publishedSessionId === sessionId,
      )
      .at(-1)
  }

  private findEnvironmentIdentity(environmentId: import('../../internal/environment/index.ts').WorkEnvironmentId): RemoteEnvironmentIdentity | undefined {
    for (const [, record] of this.requireEnvironmentIdentityTable().entries()) {
      const identity = asEnvironmentIdentity(record)
      if (identity.environmentId === environmentId) return identity
    }
    return undefined
  }

  private requireIdleThread(expected: ExecutionThreadRef): ExecutionThread {
    const current = this.ctx.workExecution.get(expected.id)
    if (current === undefined) throw new WorkNodeGatewayError(`unknown execution thread '${expected.id}'`)
    if (current.revision !== expected.revision) {
      throw new WorkNodeGatewayError(`stale execution thread '${expected.id}' revision ${expected.revision}; current revision is ${current.revision}`)
    }
    if (current.state !== 'idle' || current.activeAttempt !== undefined) {
      throw new WorkNodeGatewayError(`execution thread '${expected.id}' is not idle`)
    }
    return current
  }

  private assertNoOpenExecutionCommand(threadId: ExecutionThreadId): void {
    const open = this.listCommands().find(command =>
      command.kind !== 'cancel'
      && command.payload.threadId === threadId
      && (command.state === 'queued' || command.state === 'accepted'),
    )
    if (open !== undefined) throw new WorkNodeGatewayError(`thread '${threadId}' already has open remote command '${open.id}'`)
  }

  private requireNodeFeatureForThread(threadId: ExecutionThreadId, feature: 'resume'): void {
    const binding = this.ctx.workEnvironments.getBinding(threadId)
    if (binding === undefined) throw new WorkNodeGatewayError(`thread '${threadId}' has no environment binding`)
    this.requireNodeFeature(binding.nodeId, feature)
  }

  private requireNodeFeature(nodeId: WorkNodeId, feature: 'cancel' | 'resume'): void {
    const node = this.ctx.workNodes.get(nodeId)
    if (node === undefined || !node.features.includes(feature)) {
      throw new WorkNodeGatewayError(`node '${nodeId}' does not advertise ${feature}`)
    }
  }

  private getNodeIdentity(nodeKey: string): RemoteNodeIdentity | undefined {
    const record = this.requireNodeIdentityTable().get(nodeKey)
    return record === undefined ? undefined : asNodeIdentity(record)
  }

  private requireNodeIdentity(nodeKey: string): RemoteNodeIdentity {
    const identity = this.getNodeIdentity(nodeKey)
    if (identity === undefined) throw new HttpGatewayError(409, 'HELLO_REQUIRED', 'node must complete hello first')
    return identity
  }

  private requireCommand(id: RemoteNodeCommandId): RemoteNodeCommand {
    const command = this.getCommand(id)
    if (command === undefined) throw new HttpGatewayError(404, 'COMMAND_NOT_FOUND', 'unknown command')
    return command
  }

  private async storeNewCommand(command: RemoteNodeCommand): Promise<void> {
    await this.requireCommandTable().put(command.id, command)
    this.emitCommandChanged(command)
  }

  private async updateCommand(
    id: RemoteNodeCommandId,
    mutate: (current: RemoteNodeCommand) => RemoteNodeCommand,
  ): Promise<RemoteNodeCommand> {
    const next = await this.requireCommandTable().update(id, record => mutate(asCommand(record)))
    const command = asCommand(next)
    this.emitCommandChanged(command)
    return command
  }

  private async rejectQueuedCommand(command: RemoteNodeCommand, failureCode: string): Promise<RemoteNodeCommand> {
    if (command.state !== 'queued') return command
    const now = new Date().toISOString()
    return await this.updateCommand(command.id, current => ({
      ...current,
      state: 'rejected',
      failureCode,
      updatedAt: now,
      settledAt: now,
    }))
  }

  private emitCommandChanged(command: RemoteNodeCommand): void {
    try {
      this.ctx.emit('work-node-gateway/command-changed', { command })
    } catch (error) {
      this.ctx.logger.warn(`work-node-gateway: command observer failed: ${String(error)}`)
    }
  }

  private async sweepOffline(): Promise<void> {
    const now = Date.now()
    for (const identity of this.listNodeIdentities()) {
      const node = this.ctx.workNodes.get(identity.nodeId)
      if (node === undefined || node.state === 'offline') continue
      const seen = Date.parse(node.lastSeenAt)
      if (!Number.isFinite(seen) || now - seen <= this.config.heartbeatTimeoutMs) continue
      try {
        await this.ctx.workNodes.markOffline({ id: node.id, revision: node.revision })
      } catch (error) {
        if (!(error instanceof WorkNodeConflictError)) throw error
      }
    }
  }

  private listNodeIdentities(): RemoteNodeIdentity[] {
    return [...this.requireNodeIdentityTable().entries()].map(([, record]) => asNodeIdentity(record))
  }

  private async withNodeLock<T>(nodeKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.nodeTails.get(nodeKey) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => next, () => next)
    this.nodeTails.set(nodeKey, tail)
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.nodeTails.get(nodeKey) === tail) this.nodeTails.delete(nodeKey)
    }
  }

  private requireNodeIdentityTable(): KvTable<string, RemoteNodeIdentityRecord> {
    if (this.nodeIdentities === undefined) throw new Error('work-node-gateway domain is not initialized')
    return this.nodeIdentities
  }

  private requireEnvironmentIdentityTable(): KvTable<string, RemoteEnvironmentIdentityRecord> {
    if (this.environmentIdentities === undefined) throw new Error('work-node-gateway domain is not initialized')
    return this.environmentIdentities
  }

  private requireCommandTable(): KvTable<RemoteNodeCommandId, RemoteNodeCommandRecord> {
    if (this.commands === undefined) throw new Error('work-node-gateway domain is not initialized')
    return this.commands
  }

  private async handle<T extends { nodeKey: string }>(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    schema: { parse(value: unknown): T },
    operation: (body: T) => Promise<unknown>,
  ): Promise<void> {
    try {
      if (req.method !== 'POST') throw new HttpGatewayError(405, 'METHOD_NOT_ALLOWED', 'POST required')
      const raw = await readBody(req, this.config.maxRequestBodyBytes)
      const signedNodeKey = await this.authenticateRequest(req, path, raw)
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        throw new HttpGatewayError(400, 'INVALID_JSON', 'request body must be valid JSON')
      }
      let body: T
      try {
        body = schema.parse(json)
      } catch {
        throw new HttpGatewayError(400, 'INVALID_REQUEST', 'request does not match protocol schema')
      }
      if (body.nodeKey !== signedNodeKey) {
        throw new HttpGatewayError(401, 'NODE_KEY_MISMATCH', 'signed node key does not match request body')
      }
      writeJson(res, 200, await operation(body))
    } catch (error) {
      if (error instanceof HttpGatewayError) {
        writeJson(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      this.ctx.logger.warn(error)
      writeJson(res, 500, { error: { code: 'INTERNAL', message: 'internal gateway failure' } })
    }
  }

  private async authenticateRequest(req: IncomingMessage, path: string, rawBody: string): Promise<string> {
    const nodeKeyHeader = singleHeader(req, 'x-dsh-node-key')
    const timestampHeader = singleHeader(req, 'x-dsh-timestamp')
    const signature = singleHeader(req, 'x-dsh-signature').toLowerCase()
    const nodeKey = validateWireNodeKey(nodeKeyHeader)
    const timestamp = Number(timestampHeader)
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > this.config.maxClockSkewMs) {
      throw new HttpGatewayError(401, 'STALE_SIGNATURE', 'request timestamp is outside the configured clock-skew window')
    }
    if (!SIGNATURE_PATTERN.test(signature)) throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
    const ref = this.authRefs.get(nodeKey)
    const credential = ref === undefined ? undefined : await this.ctx.credentials.resolve(ref)
    if (credential === undefined) throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
    const material = `${req.method}\n${path}\n${timestampHeader}\n${rawBody}`
    const expected = createHmac('sha256', credential.value).update(material).digest('hex')
    if (!safeHexEqual(signature, expected)) throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
    return nodeKey
  }
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    bytes += chunk.byteLength
    if (bytes > maxBytes) throw new HttpGatewayError(413, 'BODY_TOO_LARGE', 'request body exceeds configured limit')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function singleHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
  }
  return value
}

function safeHexEqual(candidate: string, expected: string): boolean {
  if (!SIGNATURE_PATTERN.test(candidate) || !SIGNATURE_PATTERN.test(expected)) return false
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'))
}

function validateConfiguredNodeKey(value: string): string {
  if (!NODE_KEY_PATTERN.test(value)) throw new TypeError(`configured node key '${value}' is invalid`)
  return value
}

function validateWireNodeKey(value: string): string {
  if (!NODE_KEY_PATTERN.test(value)) throw new HttpGatewayError(400, 'INVALID_NODE_KEY', 'node key is invalid')
  return value
}

function requireText(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new WorkNodeGatewayError(`${field} must not be empty`)
  return normalized
}

function requirePositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive safe integer`)
}

function canonicalizeSnapshot(snapshot: WorkEnvironmentSnapshot): WorkEnvironmentSnapshot {
  const workspace = snapshot.workspace
  const runtime = snapshot.runtime
  return {
    workspace: {
      path: workspace.path.trim(),
      ...(workspace.repository === undefined ? {} : { repository: workspace.repository.trim() }),
      ...(workspace.branch === undefined ? {} : { branch: workspace.branch.trim() }),
      ...(workspace.commit === undefined ? {} : { commit: workspace.commit.trim() }),
      ...(workspace.worktree === undefined ? {} : { worktree: workspace.worktree.trim() }),
      ...(workspace.dirty === undefined ? {} : { dirty: workspace.dirty }),
    },
    runtime: {
      os: runtime.os.trim(),
      arch: runtime.arch.trim(),
      ...(runtime.shell === undefined ? {} : { shell: runtime.shell.trim() }),
      versions: Object.fromEntries(
        Object.entries(runtime.versions)
          .map(([name, version]) => [name.trim(), version.trim()] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    services: snapshot.services
      .map(service => ({ ...service, name: service.name.trim() }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    devices: normalizeStrings(snapshot.devices),
    capabilities: normalizeStrings(snapshot.capabilities),
    secretRefs: normalizeStrings(snapshot.secretRefs),
  }
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort()
}

function stableJson(value: WorkEnvironmentSnapshot): string {
  return JSON.stringify(value)
}

function asNodeIdentity(record: RemoteNodeIdentityRecord): RemoteNodeIdentity {
  return record as RemoteNodeIdentity
}

function asEnvironmentIdentity(record: RemoteEnvironmentIdentityRecord): RemoteEnvironmentIdentity {
  return record as RemoteEnvironmentIdentity
}

function asCommand(record: RemoteNodeCommandRecord): RemoteNodeCommand {
  return record as RemoteNodeCommand
}

export default WorkNodeGateway
