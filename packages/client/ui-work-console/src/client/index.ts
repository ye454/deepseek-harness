/**
 * Global Work Console browser plugin: one sidebar action plus a frame-wide read-only overlay.
 * It neither replaces the conversation slot nor owns Host work state.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls ctx.remote.workConsole into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: declares the target slot contracts used by this contribution.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { WorkConsoleController, chooseWorkConsoleTask } from './controller.ts'
import type { WorkConsoleInjected, WorkConsoleStoreProps } from './contract.ts'
import { WorkConsoleRoot, WorkConsoleTrigger } from './WorkConsoleRoot.tsx'
import { createWorkConsoleStore } from './store.ts'

export { createWorkConsoleStore } from './store.ts'
export type {
  WorkConsoleInjected,
  WorkConsoleRootProps,
  WorkConsoleStoreProps,
  WorkConsoleTriggerProps,
} from './contract.ts'

/** Required services. The specific Remote namespace prevents activation before the Host contribution is mounted. */
export const inject = ['slots', 'remote', 'remote.workConsole']

/**
 * Register the project-independent Work Console entry and overlay.
 * @param ctx - browser root context carrying slots and generated Remote namespaces.
 */
export function apply(ctx: ClientContext): void {
  const store = createWorkConsoleStore()
  const controller = new WorkConsoleController(ctx)

  const synchronize = async (
    selectedTaskId: string | null,
    actions: WorkConsoleStoreProps['actions'],
  ): Promise<void> => {
    const snapshot = await controller.refresh()
    if (snapshot === undefined) return
    const selected = chooseWorkConsoleTask(snapshot, selectedTaskId)
    if (selected !== selectedTaskId) actions.selectTask(selected)
    if (selected !== null) await controller.loadTask(selected)
  }

  const injected = (actions: WorkConsoleStoreProps['actions']): WorkConsoleInjected => ({
    hooks: { workConsole: controller },
    openConsole: selectedTaskId => {
      actions.open()
      void synchronize(selectedTaskId, actions)
    },
    closeConsole: () => { actions.close() },
    refreshConsole: selectedTaskId => { void synchronize(selectedTaskId, actions) },
    selectTask: taskId => {
      actions.selectTask(taskId)
      void controller.loadTask(taskId)
    },
    clearError: () => { controller.clearError() },
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'global-work-console',
    order: -20,
    store,
    inject: injected,
  }, WorkConsoleTrigger))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'global-work-console',
    order: 10,
    store,
    inject: injected,
  }, WorkConsoleRoot))
}
