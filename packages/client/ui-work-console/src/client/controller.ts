/**
 * React-free Work Console object layer: Remote reads enter, immutable snapshots exit.
 * The slot renderer binds this bare observable through the inject `hooks` compartment.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  WorkConsoleSnapshot,
  WorkConsoleTaskDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated ctx.remote.workConsole namespace into this compilation face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Immutable business snapshot consumed through the framework-generated `useWorkConsole` hook. */
export interface WorkConsoleRemoteState {
  readonly loading: boolean
  readonly detailLoading: boolean
  readonly error: string | undefined
  readonly snapshot: WorkConsoleSnapshot | undefined
  readonly detailTaskId: string | undefined
  readonly detail: WorkConsoleTaskDetail | undefined
}

type Listener = () => void

/** Remote read controller. It is a bare observable source, not a UI store and imports no React. */
export class WorkConsoleController {
  private state: WorkConsoleRemoteState = {
    loading: false,
    detailLoading: false,
    error: undefined,
    snapshot: undefined,
    detailTaskId: undefined,
    detail: undefined,
  }
  private readonly listeners = new Set<Listener>()
  private snapshotEpoch = 0
  private detailEpoch = 0

  /** @param ctx - client apply-world context carrying the generated Work Console Remote. */
  constructor(private readonly ctx: Context) {}

  /** Stable observable snapshot getter. */
  getSnapshot = (): WorkConsoleRemoteState => this.state

  /** Stable observable subscription function. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Refresh only the lightweight global board/resource projection. */
  async refresh(): Promise<WorkConsoleSnapshot | undefined> {
    const epoch = ++this.snapshotEpoch
    this.publish({ ...this.state, loading: true, error: undefined })
    try {
      const result = await this.ctx.remote.workConsole.snapshot()
      if (epoch !== this.snapshotEpoch) return this.state.snapshot
      if (!result.ok) {
        this.publish({
          ...this.state,
          loading: false,
          error: `workConsole.snapshot: ${result.error.code}: ${result.error.message}`,
        })
        return undefined
      }
      this.publish({ ...this.state, loading: false, error: undefined, snapshot: result.value })
      return result.value
    } catch (error) {
      if (epoch !== this.snapshotEpoch) return this.state.snapshot
      this.publish({ ...this.state, loading: false, error: renderError(error) })
      return undefined
    }
  }

  /** Fetch one Task Detail without appending logs or large artifact bodies. */
  async loadTask(taskId: string): Promise<WorkConsoleTaskDetail | undefined> {
    const epoch = ++this.detailEpoch
    this.publish({ ...this.state, detailLoading: true, detailTaskId: taskId, detail: undefined })
    try {
      const result = await this.ctx.remote.workConsole.task(taskId)
      if (epoch !== this.detailEpoch || this.state.detailTaskId !== taskId) return this.state.detail
      if (!result.ok) {
        this.publish({
          ...this.state,
          detailLoading: false,
          error: `workConsole.task: ${result.error.code}: ${result.error.message}`,
        })
        return undefined
      }
      this.publish({ ...this.state, detailLoading: false, detail: result.value })
      return result.value
    } catch (error) {
      if (epoch !== this.detailEpoch || this.state.detailTaskId !== taskId) return this.state.detail
      this.publish({ ...this.state, detailLoading: false, error: renderError(error) })
      return undefined
    }
  }

  /** Remove only the transient transport error; authoritative snapshots stay intact. */
  clearError(): void {
    if (this.state.error === undefined) return
    this.publish({ ...this.state, error: undefined })
  }

  private publish(next: WorkConsoleRemoteState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
