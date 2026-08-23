/**
 * React-free Work Console object layer: Remote reads/commands enter, immutable snapshots exit.
 * The slot renderer binds this bare observable through the inject `hooks` compartment.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  CreateWorkConsoleIdeaRequest,
  CreatedWorkConsoleIdea,
  DecideWorkConsoleAcceptanceRequest,
  OrganizedWorkConsoleTask,
  OrganizeWorkConsoleTaskRequest,
  PromoteWorkConsoleIdeaRequest,
  PromotedWorkConsoleTask,
  StartWorkConsoleExecutionRequest,
  StartedWorkConsoleExecution,
  WorkConsoleAcceptanceDecisionValue,
  WorkConsoleCommandFailure,
  WorkConsoleExecutionPlanSnapshot,
  WorkConsoleSnapshot,
  WorkConsoleTaskDetail,
} from '@deepseek-ai/dsh-api-remotes/client'
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

/** Remote object layer. It is a bare observable source, not a UI store and imports no React. */
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

  /** @param ctx - client apply-world context carrying generated Work Console Remotes. */
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
      if (epoch !== this.detailEpoch) return this.state.detail
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
      if (epoch !== this.detailEpoch) return this.state.detail
      this.publish({ ...this.state, detailLoading: false, error: renderError(error) })
      return undefined
    }
  }

  /** Load current zero-token scheduler candidates only when execution-plan UI asks for them. */
  async executionPlan(taskId: string): Promise<WorkConsoleExecutionPlanSnapshot | undefined> {
    this.publish({ ...this.state, error: undefined })
    try {
      const transport = await this.ctx.remote.workConsole.executionPlan(taskId)
      if (!transport.ok) {
        this.publish({ ...this.state, error: `workConsole.executionPlan: ${transport.error.code}: ${transport.error.message}` })
        return undefined
      }
      return transport.value
    } catch (error) {
      this.publish({ ...this.state, error: renderError(error) })
      return undefined
    }
  }

  /** Queue one explicit one-shot execution plan through the Host orchestrator. */
  async startExecution(request: StartWorkConsoleExecutionRequest): Promise<StartedWorkConsoleExecution | undefined> {
    this.publish({ ...this.state, error: undefined })
    try {
      const transport = await this.ctx.remote.workConsole.startExecution(request)
      if (!transport.ok) {
        this.publish({ ...this.state, error: `workConsole.startExecution: ${transport.error.code}: ${transport.error.message}` })
        return undefined
      }
      if (!transport.value.ok) {
        const failure = transport.value.error
        const prefix = failure.code === 'partial-start'
          ? `执行已部分启动（${failure.started.length} 个已入队）`
          : failure.code === 'execution-unavailable' ? '执行通道不可用' : '执行计划无效'
        this.publish({ ...this.state, error: `${prefix}：${failure.reason}` })
        return undefined
      }
      await this.refresh()
      await this.loadTask(request.taskId)
      return transport.value.value
    } catch (error) {
      this.publish({ ...this.state, error: renderError(error) })
      return undefined
    }
  }

  /** Capture one passive Idea. The Host writes no execution state. */
  async createIdea(request: CreateWorkConsoleIdeaRequest): Promise<CreatedWorkConsoleIdea | undefined> {
    this.publish({ ...this.state, error: undefined })
    try {
      const transport = await this.ctx.remote.workConsole.createIdea(request)
      if (!transport.ok) {
        this.publish({ ...this.state, error: `workConsole.createIdea: ${transport.error.code}: ${transport.error.message}` })
        return undefined
      }
      if (!transport.value.ok) {
        this.publish({ ...this.state, error: `想法内容无效：${transport.value.error.reason}` })
        return undefined
      }
      await this.refresh()
      return transport.value.value
    } catch (error) {
      this.publish({ ...this.state, error: renderError(error) })
      return undefined
    }
  }

  /** Explicitly promote one passive Idea. No automatic organization/model work is started. */
  async promoteIdea(request: PromoteWorkConsoleIdeaRequest): Promise<PromotedWorkConsoleTask | undefined> {
    this.publish({ ...this.state, error: undefined })
    try {
      const transport = await this.ctx.remote.workConsole.promoteIdea(request)
      if (!transport.ok) {
        this.publish({ ...this.state, error: `workConsole.promoteIdea: ${transport.error.code}: ${transport.error.message}` })
        return undefined
      }
      if (!transport.value.ok) {
        this.publish({ ...this.state, error: renderCommandFailure(transport.value.error) })
        return undefined
      }
      await this.refresh()
      return transport.value.value
    } catch (error) {
      this.publish({ ...this.state, error: renderError(error) })
      return undefined
    }
  }

  /** Commit one human-selected deterministic Workflow/Validation template. */
  async organizeTask(request: OrganizeWorkConsoleTaskRequest): Promise<OrganizedWorkConsoleTask | undefined> {
    this.publish({ ...this.state, error: undefined })
    try {
      const transport = await this.ctx.remote.workConsole.organizeTask(request)
      if (!transport.ok) {
        this.publish({ ...this.state, error: `workConsole.organizeTask: ${transport.error.code}: ${transport.error.message}` })
        return undefined
      }
      if (!transport.value.ok) {
        this.publish({ ...this.state, error: renderCommandFailure(transport.value.error) })
        return undefined
      }
      await this.refresh()
      return transport.value.value
    } catch (error) {
      this.publish({ ...this.state, error: renderError(error) })
      return undefined
    }
  }

  /** Record one explicit human acceptance decision through the Host-owned command boundary. */
  async decideAcceptance(
    request: DecideWorkConsoleAcceptanceRequest,
  ): Promise<WorkConsoleAcceptanceDecisionValue | undefined> {
    this.publish({ ...this.state, error: undefined })
    try {
      const transport = await this.ctx.remote.workConsole.decideAcceptance(request)
      if (!transport.ok) {
        this.publish({ ...this.state, error: `workConsole.decideAcceptance: ${transport.error.code}: ${transport.error.message}` })
        return undefined
      }
      if (!transport.value.ok) {
        this.publish({ ...this.state, error: renderCommandFailure(transport.value.error) })
        return undefined
      }
      await this.refresh()
      return transport.value.value
    } catch (error) {
      this.publish({ ...this.state, error: renderError(error) })
      return undefined
    }
  }

  /** Remove only the transient transport/business error; authoritative snapshots stay intact. */
  clearError(): void {
    if (this.state.error === undefined) return
    this.publish({ ...this.state, error: undefined })
  }

  private publish(next: WorkConsoleRemoteState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function renderCommandFailure(error: WorkConsoleCommandFailure): string {
  switch (error.code) {
    case 'not-found': return `目标已不存在：${error.id}`
    case 'conflict': return `内容已更新，请刷新后重试（当前 revision ${error.currentRevision}）`
    case 'invalid-state': return `当前状态不可执行此操作：${error.reason}`
    case 'stale-generation': return '验收轮次已变化，请重新查看验收证据'
    case 'invalid-validator': return '该验收项已变化，请重新打开 Task Detail'
    case 'not-ready': return error.reason === 'automated-failed'
      ? '自动验收未通过，不能进入人工通过流程'
      : '自动验收尚未完成，暂不能人工通过'
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
