/**
 * Signed HTTP client for the remote WorkNode gateway protocol.
 * @module @deepseek-ai/dsh-work-node-daemon/src/client
 */

import { createHmac } from 'node:crypto'
import { z } from 'zod'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type {
  RemoteNodeAckRequest,
  RemoteNodeCommand,
  RemoteNodeHelloRequest,
  RemoteNodeHelloResponse,
  RemoteNodePollRequest,
  RemoteNodePollResponse,
  RemoteNodeResultRequest,
} from '@deepseek-ai/dsh-work-node-gateway'

const HELLO_PATH = '/work-node/v1/hello'
const POLL_PATH = '/work-node/v1/poll'
const ACK_PATH = '/work-node/v1/ack'
const RESULT_PATH = '/work-node/v1/result'

const stopReason = z.enum(['completed', 'failed', 'cancelled', 'interrupted', 'refused', 'limit', 'unknown'])
const executePayload = z.object({
  threadId: z.string(),
  threadRevision: z.number().int().positive(),
  environmentId: z.string(),
  environmentRevision: z.number().int().positive(),
  environmentKey: z.string(),
  runnerProvider: z.string(),
  mode: z.enum(['one-shot', 'continuable']),
  prompt: z.string(),
  promptBytes: z.number().int().nonnegative(),
  resumeSessionId: z.string().optional(),
}).strict()
const commandBase = {
  id: z.string(),
  nodeId: z.string(),
  state: z.enum(['queued', 'accepted', 'settled', 'rejected']),
  failureCode: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settledAt: z.string().optional(),
}
const command = z.discriminatedUnion('kind', [
  z.object({
    ...commandBase,
    kind: z.literal('execute'),
    payload: executePayload,
    publishedSessionId: z.string().optional(),
    acceptedThreadRevision: z.number().int().positive().optional(),
    resultStopReason: stopReason.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal('resume'),
    payload: executePayload,
    publishedSessionId: z.string().optional(),
    acceptedThreadRevision: z.number().int().positive().optional(),
    resultStopReason: stopReason.optional(),
  }).strict(),
  z.object({
    ...commandBase,
    kind: z.literal('cancel'),
    payload: z.object({
      threadId: z.string(),
      attemptSeq: z.number().int().positive(),
    }).strict(),
  }).strict(),
])
const helloResponse = z.object({ nodeId: z.string(), nodeRevision: z.number().int().positive() }).strict()
const pollResponse = z.object({
  nodeId: z.string(),
  nodeRevision: z.number().int().positive(),
  commands: z.array(command),
}).strict()
const commandResponse = z.object({ command }).strict()

/** A gateway returned a protocol-level non-2xx response. */
export class WorkNodeDaemonGatewayError extends Error {
  /**
   * @param status - HTTP response status.
   * @param code - Gateway machine-readable error code when present.
   * @param message - Stable remote error message.
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'WorkNodeDaemonGatewayError'
  }
}

/** Configuration needed by the signed gateway client. */
export interface WorkNodeGatewayClientOptions {
  readonly baseUrl: string
  readonly nodeKey: string
  readonly credential: CredentialRef
  readonly requestTimeoutMs: number
}

/** Minimal signed client. It owns no polling policy or command execution state. */
export class WorkNodeGatewayClient {
  private readonly baseUrl: URL

  /**
   * @param ctx - Context carrying the credential provider.
   * @param options - Gateway URL, node identity, credential reference, and request timeout.
   */
  constructor(private readonly ctx: Context, private readonly options: WorkNodeGatewayClientOptions) {
    const base = new URL(options.baseUrl)
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new TypeError('work-node-daemon gatewayUrl must use http or https')
    }
    if (
      base.username !== ''
      || base.password !== ''
      || base.search !== ''
      || base.hash !== ''
      || base.pathname !== '/'
    ) {
      throw new TypeError('work-node-daemon gatewayUrl must be an origin URL without credentials, path, query, or fragment')
    }
    if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new TypeError('work-node-daemon requestTimeoutMs must be a positive safe integer')
    }
    this.baseUrl = base
  }

  /**
   * Send the initial/recovery node handshake.
   * @param request - Node identity and current capability facts.
   * @param signal - Optional daemon shutdown signal.
   * @returns validated gateway node identity/revision.
   */
  async hello(request: RemoteNodeHelloRequest, signal?: AbortSignal): Promise<RemoteNodeHelloResponse> {
    return helloResponse.parse(await this.post(HELLO_PATH, request, signal)) as RemoteNodeHelloResponse
  }

  /**
   * Send one heartbeat/environment report and receive queued commands.
   * @param request - Current node revision, capabilities, and environment reports.
   * @param signal - Optional daemon shutdown signal.
   * @returns validated node revision and commands.
   */
  async poll(request: RemoteNodePollRequest, signal?: AbortSignal): Promise<RemoteNodePollResponse> {
    return pollResponse.parse(await this.post(POLL_PATH, request, signal)) as RemoteNodePollResponse
  }

  /**
   * Report remote Runner publication/refusal.
   * @param request - Command id, admission decision, and optional native session.
   * @param signal - Optional daemon shutdown signal.
   * @returns validated current central command projection.
   */
  async ack(request: RemoteNodeAckRequest, signal?: AbortSignal): Promise<{ command: RemoteNodeCommand }> {
    return commandResponse.parse(await this.post(ACK_PATH, request, signal)) as { command: RemoteNodeCommand }
  }

  /**
   * Report the terminal result of one accepted Runner.
   * @param request - Command id and terminal stop reason.
   * @param signal - Optional daemon shutdown signal.
   * @returns validated current central command projection.
   */
  async result(request: RemoteNodeResultRequest, signal?: AbortSignal): Promise<{ command: RemoteNodeCommand }> {
    return commandResponse.parse(await this.post(RESULT_PATH, request, signal)) as { command: RemoteNodeCommand }
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const credential = await this.ctx.credentials.resolve(this.options.credential)
    if (credential === undefined) {
      throw new WorkNodeDaemonGatewayError(401, 'CREDENTIAL_MISSING', 'configured WorkNode credential is unavailable')
    }
    const raw = JSON.stringify(body)
    const timestamp = String(Date.now())
    const signature = createHmac('sha256', credential.value)
      .update(`POST\n${path}\n${timestamp}\n${raw}`)
      .digest('hex')
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dsh-node-key': this.options.nodeKey,
          'x-dsh-timestamp': timestamp,
          'x-dsh-signature': signature,
        },
        body: raw,
        signal: combined,
      })
    } catch (error) {
      if (combined.aborted) {
        throw new WorkNodeDaemonGatewayError(0, 'REQUEST_ABORTED', `gateway request ${path} was aborted`)
      }
      throw error
    }
    const text = await response.text()
    let json: unknown
    try {
      json = text.length === 0 ? {} : JSON.parse(text)
    } catch {
      throw new WorkNodeDaemonGatewayError(response.status, 'INVALID_RESPONSE', 'gateway returned invalid JSON')
    }
    if (!response.ok) {
      const candidate = json as { error?: { code?: unknown; message?: unknown } }
      const code = typeof candidate.error?.code === 'string' ? candidate.error.code : 'HTTP_ERROR'
      const message = typeof candidate.error?.message === 'string'
        ? candidate.error.message
        : `gateway request failed with HTTP ${response.status}`
      throw new WorkNodeDaemonGatewayError(response.status, code, message)
    }
    return json
  }
}
