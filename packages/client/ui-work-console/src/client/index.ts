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
import { WorkConsoleRoot, WorkConsoleTrigger } from './WorkConsoleRoot.tsx'
import { WorkConsoleUiStore } from './store.ts'

export { WorkConsoleRoot, WorkConsoleTrigger } from './WorkConsoleRoot.tsx'
export { WorkConsoleUiStore } from './store.ts'
export type { WorkConsoleUiState } from './store.ts'

/** Required services. The specific Remote namespace prevents activation before the Host contribution is mounted. */
export const inject = ['slots', 'remote', 'remote.workConsole']

/**
 * Register the project-independent Work Console entry and overlay.
 * @param ctx - browser root context carrying slots and generated Remote namespaces.
 */
export function apply(ctx: ClientContext): void {
  const store = new WorkConsoleUiStore(ctx)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'global-work-console',
    order: -20,
    inject: () => ({ store }),
  }, WorkConsoleTrigger))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'global-work-console',
    order: 10,
    inject: () => ({ store }),
  }, WorkConsoleRoot))

  ctx.effect(() => ctx.on('connection/reset', () => {
    if (store.getSnapshot().open) void store.refresh()
  }), 'ui-work-console: refresh after connection reset')
}
