/**
 * Authenticated HTTP-pull gateway for remote work nodes.
 * @module @deepseek-ai/dsh-work-node-gateway
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { clearInterval, setInterval } from 'node:timers'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionThread, ExecutionThreadId, ExecutionThreadRef, RunnerMode } from '@deepseek-ai/dsh-work-execution'
import type { WorkEnvironmentRef } from '@deepseek-ai/dsh-work-environment'
import { WorkNodeConflictError, type WorkNode, type WorkNodeId } from '@deepseek-ai/dsh-work-node'
import { buildBoundedWorkPrompt, type WorkHandoff } from '@deepseek-ai/dsh-work-runner-subagent'
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
}

/**
 * Durable command queue plus authenticated HTTP pull transport. Remote nodes call hello/poll/ack/result;
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
    requirePositive(config.heartbeatTimeoutMs, 'heartbeatTimeoutMs')
    requirePositive(config.sweepIntervalMs, 'sweepIntervalMs')
    for (const [nodeKey, rawRef] of Object.entries(config.nodes)) {
      requireNodeKey(nodeKey)
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
      kind: 'exact', path: HELLO_PATH, handler: (req, res) => this.handle(req, res, helloRequest, body => this.hello(body)),
    }), 'workNodeGateway.helloRoute')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: POLL_PATH, handler: (req, res) => this.handle(req, res, pollRequest, body => this.poll(body)),
    }), 'workNodeGateway.pollRoute')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: ACK_PATH, handler: (req, res) => this.handle(req, res, ackRequest, body => this.ack(body)),
    }), 'workNodeGateway.ackRoute')
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'exact', path: RESULT_PATH, handler: (req, res) => this.handle(req, res, resultRequest, body => this.result(body)),
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
    return await this.enqueueExecutionCommand('execute', threadRef, runnerProvider, mode, handoff)
  }

  /**
   * Queue native continuation for the previous continuable attempt.
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
    await this.requireCommandTable().put(command.id, command)
    return command
  }

  /** List current gateway commands, optionally for one node. */
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
    resumeSessionId?: import('@deepseek-ai/dsh-session').SessionId,
  ): Promise<RemoteNodeCommand> {
    const runnerProvider = requireText(runnerProviderValue, 'runner provider')
    const thread = this.requireIdleThread(threadRef)
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
        runnerProvider,
        mode,
        prompt: prompt.text,
        promptBytes: prompt.bytes,
        ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      },
      createdAt: now,
      updatedAt: now,
    }
    await this.requireCommandTable().put(command.id, command)
    return command
  }

  private async hello(request: RemoteNodeHelloRequest): Promise<RemoteNodeHelloResponse> {
    await this.authenticateCurrentRequest(request.nodeKey)
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
      }
      return { nodeId: node.id, nodeRevision: node.revision }
    })
  }

  private async poll(request: RemoteNodePollRequest): Promise<RemoteNodePollResponse> {
    await this.authenticateCurrentRequest(request.nodeKey)
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
        state: request.state,
        degradedReason: request.degradedReason,
      })
      for (const report of request.environments) {
        await this.applyEnvironmentReport(request.nodeKey, node.id, report)
      }
      const commands = this.listCommands(node.id)
        .filter(command => command.state === 'queued')
        .slice(0, this.config.maxCommandsPerPoll)
      return { nodeId: node.id, nodeRevision: node.revision, commands }
    })
  }

  private async ack(request: RemoteNodeAckRequest): Promise<{ command: RemoteNodeCommand }> {
    await this.authenticateCurrentRequest(request.nodeKey)
    return await this.withNodeLock(request.nodeKey, async () => {
      const identity = this.requireNodeIdentity(request.nodeKey)
      const current = this.requireCommand(request.commandId)
      if (current.nodeId !== identity.nodeId) throw new HttpGatewayError(403, 'COMMAND_NODE_MISMATCH', 'command belongs to another node')
      if (current.state !== 'queued') return { command: current }

      if (!request.accepted) {
        const rejected = await this.updateCommand(current.id, command => ({
          ...command,
          state: 'rejected',
          updatedAt: new Date().toISOString(),
          settledAt: new Date().toISOString(),
        }))
        return { command: rejected }
      }

      if (current.kind === 'cancel') {
        const settled = await this.updateCommand(current.id, command => ({
          ...command,
          state: 'settled',
          updatedAt: new Date().toISOString(),
          settledAt: new Date().toISOString(),
        }))
        return { command: settled }
      }

      const running = await this.ctx.workExecution.beginAttempt(
        { id: current.payload.threadId, revision: current.payload.threadRevision },
        {
          provider: current.payload.runnerProvider,
          mode: current.payload.mode,
          subagentSessionId: request.subagentSessionId,
        },
      )
      const accepted = await this.updateCommand(current.id, command => ({
        ...command,
        state: 'accepted',
        acceptedThreadRevision: running.revision,
        updatedAt: new Date().toISOString(),
      }))
      return { command: accepted }
    })
  }

  private async result(request: RemoteNodeResultRequest): Promise<{ command: RemoteNodeCommand }> {
    await this.authenticateCurrentRequest(request.nodeKey)
    return await this.withNodeLock(request.nodeKey, async () => {
      const identity = this.requireNodeIdentity(request.nodeKey)
      const current = this.requireCommand(request.commandId)
      if (current.nodeId !== identity.nodeId) throw new HttpGatewayError(403, 'COMMAND_NODE_MISMATCH', 'command belongs to another node')
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
    requireNodeKey(report.key)
    const key = `${nodeKey}/${report.key}`
    const identityRecord = this.requireEnvironmentIdentityTable().get(key)
    if (identityRecord === undefined) {
      const environment = await this.ctx.workEnvironments.registerEnvironment({
        nodeId,
        name: report.name,
        state: report.state,
        degradedReason: report.degradedReason,
        snapshot: report.snapshot,
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
    if (environment === undefined) throw new HttpGatewayError(409, 'ENVIRONMENT_IDENTITY_DANGLING', 'environment identity requires administrator repair')
    await this.ctx.workEnvironments.refreshEnvironment(
      { id: environment.id, revision: environment.revision } satisfies WorkEnvironmentRef,
      {
        state: report.state,
        degradedReason: report.degradedReason,
        snapshot: report.snapshot,
      },
    )
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

  private async authenticateCurrentRequest(nodeKeyValue: string): Promise<void> {
    const nodeKey = requireNodeKey(nodeKeyValue)
    const ref = this.authRefs.get(nodeKey)
    const request = currentRequest.getStore()
    if (ref === undefined || request === undefined) throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
    const authorization = request.headers.authorization
    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
    }
    const credential = await this.ctx.credentials.resolve(ref)
    if (credential === undefined || !safeSecretEqual(authorization.slice(7), credential.value)) {
      throw new HttpGatewayError(401, 'UNAUTHORIZED', 'authentication failed')
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
    const record = this.requireCommandTable().get(id)
    if (record === undefined) throw new HttpGatewayError(404, 'COMMAND_NOT_FOUND', 'unknown command')
    return asCommand(record)
  }

  private async updateCommand(
    id: RemoteNodeCommandId,
    mutate: (current: RemoteNodeCommand) => RemoteNodeCommand,
  ): Promise<RemoteNodeCommand> {
    const next = await this.requireCommandTable().update(id, record => mutate(asCommand(record)))
    return asCommand(next)
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
    const next = new Promise<void>(resolve => { release = resolve })
    this.nodeTails.set(nodeKey, previous.then(() => next, () => next))
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.nodeTails.get(nodeKey) === next) this.nodeTails.delete(nodeKey)
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

  private async handle<S extends { parse(value: unknown): unknown }>(
    req: IncomingMessage,
    res: ServerResponse,
    schema: S,
    operation: (body: ReturnType<S['parse']>) => Promise<unknown>,
  ): Promise<void> {
    try {
      if (req.method !== 'POST') throw new HttpGatewayError(405, 'METHOD_NOT_ALLOWED', 'POST required')
      const raw = await readBody(req, this.config.maxRequestBodyBytes)
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        throw new HttpGatewayError(400, 'INVALID_JSON', 'request body must be valid JSON')
      }
      let body: ReturnType<S['parse']>
      try {
        body = schema.parse(json) as ReturnType<S['parse']>
      } catch {
        throw new HttpGatewayError(400, 'INVALID_REQUEST', 'request does not match protocol schema')
      }
      const payload = await currentRequest.run(req, () => operation(body))
      writeJson(res, 200, payload)
    } catch (error) {
      if (error instanceof HttpGatewayError) {
        writeJson(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      this.ctx.logger.warn(error)
      writeJson(res, 500, { error: { code: 'INTERNAL', message: 'internal gateway failure' } })
    }
  }
}

import { AsyncLocalStorage } from 'node:async_hooks'
const currentRequest = new AsyncLocalStorage<IncomingMessage>()

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
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function safeSecretEqual(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate)
  const right = Buffer.from(expected)
  if (left.byteLength !== right.byteLength) return false
  return timingSafeEqual(left, right)
}

function requireNodeKey(value: string): string {
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
