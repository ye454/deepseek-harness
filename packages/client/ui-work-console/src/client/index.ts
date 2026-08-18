/**
 * Global Work Console browser plugin: one sidebar action plus a frame-wide global work surface.
 * It neither replaces the conversation slot nor owns Host work state.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls generated Work Console Remote namespaces into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: declares the target slot contracts used by this contribution.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { WorkConsoleController } from './controller.ts'
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

/** Required services. Specific namespaces prevent activation before both Host contributions are mounted. */
export const inject = ['slots', 'remote', 'remote.workConsole', 'remote.workConsoleCommands']

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
    if (snapshot === undefined || selectedTaskId === null) return
    if (!snapshot.tasks.some(task => task.id === selectedTaskId)) {
      actions.selectTask(null)
      return
    }
    await controller.loadTask(selectedTaskId)
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
    promoteIdea: async (id, revision) =>
      (await controller.promoteIdea({ id, revision })) !== undefined,
    decideAcceptance: async (taskId, taskRevision, generation, validatorIndex, decision) => {
      const value = await controller.decideAcceptance({
        taskId,
        taskRevision,
        generation,
        validatorIndex,
        decision,
      })
      if (value === undefined) return false
      if (value.status === 'validation') await controller.loadTask(taskId)
      else actions.selectTask(null)
      return true
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
