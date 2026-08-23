/** Work Console slot/inject contracts. Component props are entirely framework-derived shares. */
import type {
  WorkConsoleExecutionPlanSnapshot,
  WorkConsoleExecutionPlacementRequest,
  WorkConsoleTaskType,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  HostObservable,
  InjectFace,
  PropsRuntime,
  PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkConsoleRemoteState } from './controller.ts'
import type { createWorkConsoleStore } from './store.ts'

/** Plain callbacks plus one bare observable source bound by the slot renderer. */
export type WorkConsoleInjected = {
  hooks: {
    workConsole: HostObservable<WorkConsoleRemoteState>
  }
  openConsole: (selectedTaskId: string | null) => void
  closeConsole: () => void
  refreshConsole: (selectedTaskId: string | null) => void
  selectTask: (taskId: string) => void
  /** Capture a passive Idea only. */
  createIdea: (title: string, summary: string, tags: readonly string[]) => Promise<boolean>
  /** Explicit Idea -> organizing Task transition; returns whether the Host committed it. */
  promoteIdea: (id: string, revision: number) => Promise<boolean>
  /** Human-selected deterministic Workflow/Validation template; does not start a Runner. */
  organizeTask: (taskId: string, taskRevision: number, taskType: WorkConsoleTaskType) => Promise<boolean>
  /** Read current zero-token execution candidates on demand. */
  loadExecutionPlan: (taskId: string) => Promise<WorkConsoleExecutionPlanSnapshot | undefined>
  /** Queue one explicit execution plan; P0 may contain up to three isolated placements. */
  startExecution: (
    taskId: string,
    taskRevision: number,
    placements: readonly WorkConsoleExecutionPlacementRequest[],
  ) => Promise<boolean>
  /** Explicit human decision after the user has inspected Task Detail/Evidence. */
  decideAcceptance: (
    taskId: string,
    taskRevision: number,
    generation: number,
    validatorIndex: number,
    decision: 'accept' | 'return',
  ) => Promise<boolean>
  clearError: () => void
}

/** Store share used by both root-scope entries. */
export type WorkConsoleStoreProps = PropsStore<ReturnType<typeof createWorkConsoleStore>>

/** Sidebar footer entry props: owner state + shared view store + injected Remote face. */
export type WorkConsoleTriggerProps =
  & PropsRuntime<'sidebar.footer.action'>
  & WorkConsoleStoreProps
  & InjectFace<WorkConsoleInjected>

/** Frame overlay props: runtime share + shared view store + injected Remote face. */
export type WorkConsoleRootProps =
  & PropsRuntime<'shell.overlay'>
  & WorkConsoleStoreProps
  & InjectFace<WorkConsoleInjected>
