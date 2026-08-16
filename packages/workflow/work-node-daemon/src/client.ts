/**
 * Signed HTTP client for the remote WorkNode gateway protocol.
 * @module @deepseek-ai/dsh-work-node-daemon/src/client
 */

import { createHmac } from 'node:crypto'
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
    if (base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
      throw new TypeError('work-node-daemon gatewayUrl must not contain credentials, query, or fragment')
    }
    if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new TypeError('work-node-daemon requestTimeoutMs must be a positive safe integer')
    }
    this.baseUrl = base
  }

  /** Send the initial/recovery node handshake. */
  hello(request: RemoteNodeHelloRequest, signal?: AbortSignal): Promise<RemoteNodeHelloResponse> {
    return this.post(HELLO_PATH, request, signal) as Promise<RemoteNodeHelloResponse>
  }

  /** Send one heartbeat/environment report and receive queued commands. */
  poll(request: RemoteNodePollRequest, signal?: AbortSignal): Promise<RemoteNodePollResponse> {
    return this.post(POLL_PATH, request, signal) as Promise<RemoteNodePollResponse>
  }

  /** Report remote Runner publication/refusal. */
  ack(request: RemoteNodeAckRequest, signal?: AbortSignal): Promise<{ command: RemoteNodeCommand }> {
    return this.post(ACK_PATH, request, signal) as Promise<{ command: RemoteNodeCommand }>
  }

  /** Report the terminal result of one accepted Runner. */
  result(request: RemoteNodeResultRequest, signal?: AbortSignal): Promise<{ command: RemoteNodeCommand }> {
    return this.post(RESULT_PATH, request, signal) as Promise<{ command: RemoteNodeCommand }>
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
