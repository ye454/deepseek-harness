/** Remote-backed, read-only state owner for the global Work Console surface. */
import type { Context } from '@deepseek-ai/cordis'
import type {
  WorkConsoleSnapshot,
  WorkConsoleTaskDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated ctx.remote.workConsole namespace into this compilation face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** Immutable React-facing state. */
export interface WorkConsoleUiState {
  readonly open: boolean
  readonly loading: boolean
  readonly detailLoading: boolean
  readonly error?: string
  readonly snapshot?: WorkConsoleSnapshot
  readonly selectedTaskId?: string
  readonly detail?: WorkConsoleTaskDetail
}

type Listener = () => void

/** Small external store shared by the sidebar trigger and frame-wide overlay. */
export class WorkConsoleUiStore {
  private state: WorkConsoleUiState = {
    open: false,
    loading: false,
    detailLoading: false,
  }
  private readonly listeners = new Set<Listener>()
  private snapshotEpoch = 0
  private detailEpoch = 0

  /** @param ctx - client context carrying the generated Work Console Remote. */
  constructor(private readonly ctx: Context) {}

  /** Current immutable state for useSyncExternalStore. */
  getSnapshot = (): WorkConsoleUiState => this.state

  /** Subscribe to state replacement. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Open the global surface and asynchronously refresh its current facts. */
  open(): void {
    if (!this.state.open) this.replace({ ...this.state, open: true, error: undefined })
    void this.refresh()
  }

  /** Close the surface; remote polling is owned by the mounted overlay and stops immediately. */
  close(): void {
    if (!this.state.open) return
    this.replace({ ...this.state, open: false })
  }

  /** Toggle the frame-wide Work Console surface. */
  toggle(): void {
    if (this.state.open) this.close()
    else this.open()
  }

  /**
   * Pull the lightweight global snapshot. Concurrent refreshes use last-request-wins semantics;
   * a stale result cannot overwrite a newer snapshot.
   */
  async refresh(): Promise<void> {
    const epoch = ++this.snapshotEpoch
    this.replace({ ...this.state, loading: true, error: undefined })
    try {
      const result = await this.ctx.remote.workConsole.snapshot()
      if (epoch !== this.snapshotEpoch) return
      if (!result.ok) {
        this.replace({
          ...this.state,
          loading: false,
          error: `workConsole.snapshot: ${result.error.code}: ${result.error.message}`,
        })
        return
      }
      const snapshot = result.value
      const selected = chooseSelection(snapshot, this.state.selectedTaskId)
      this.replace({
        ...this.state,
        loading: false,
        error: undefined,
        snapshot,
        ...(selected === undefined ? { selectedTaskId: undefined, detail: undefined } : { selectedTaskId: selected }),
      })
      if (selected !== undefined) await this.loadTask(selected)
    } catch (error) {
      if (epoch !== this.snapshotEpoch) return
      this.replace({
        ...this.state,
        loading: false,
        error: renderError(error),
      })
    }
  }

  /** Select one Task card and fetch its on-demand detail projection. */
  selectTask(taskId: string): void {
    if (taskId === this.state.selectedTaskId && this.state.detail !== undefined) return
    this.replace({ ...this.state, selectedTaskId: taskId, detail: undefined })
    void this.loadTask(taskId)
  }

  /** Clear stale transport errors without changing authoritative data. */
  clearError(): void {
    if (this.state.error === undefined) return
    const { error: _error, ...next } = this.state
    this.replace(next)
  }

  private async loadTask(taskId: string): Promise<void> {
    const epoch = ++this.detailEpoch
    this.replace({ ...this.state, detailLoading: true })
    try {
      const result = await this.ctx.remote.workConsole.task(taskId)
      if (epoch !== this.detailEpoch || this.state.selectedTaskId !== taskId) return
      if (!result.ok) {
        this.replace({
          ...this.state,
          detailLoading: false,
          error: `workConsole.task: ${result.error.code}: ${result.error.message}`,
        })
        return
      }
      this.replace({
        ...this.state,
        detailLoading: false,
        detail: result.value,
      })
    } catch (error) {
      if (epoch !== this.detailEpoch || this.state.selectedTaskId !== taskId) return
      this.replace({ ...this.state, detailLoading: false, error: renderError(error) })
    }
  }

  private replace(next: WorkConsoleUiState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function chooseSelection(snapshot: WorkConsoleSnapshot, current: string | undefined): string | undefined {
  if (current !== undefined && snapshot.tasks.some(task => task.id === current)) return current
  return snapshot.tasks.find(task => task.priority === 'p0')?.id
    ?? snapshot.tasks.find(task => task.status === 'running')?.id
    ?? snapshot.tasks[0]?.id
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
