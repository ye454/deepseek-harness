/** Work Console slot/inject contracts. Component props are entirely framework-derived shares. */
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
