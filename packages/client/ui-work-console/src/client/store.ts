/**
 * Shared viewing/interaction state for the two Work Console slot entries.
 * Business Remote data lives in controller.ts, not this store.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Root-scoped viewing state shared by the sidebar trigger and overlay. */
export interface WorkConsoleViewState {
  readonly open: boolean
  readonly selectedTaskId: string | null
}

type WorkConsoleViewActions = {
  open: (draft: WorkConsoleViewState) => void
  close: (draft: WorkConsoleViewState) => void
  selectTask: (draft: WorkConsoleViewState, taskId: string | null) => void
}

/** Create the store handle passed to both root-scope Work Console registrations. */
export function createWorkConsoleStore(): EngineStoreHandle<WorkConsoleViewState, WorkConsoleViewActions> {
  return defineStore({
    init: (): WorkConsoleViewState => ({ open: false, selectedTaskId: null }),
    actions: {
      open: draft => { draft.open = true },
      close: draft => { draft.open = false },
      selectTask: (draft, taskId: string | null) => { draft.selectedTaskId = taskId },
    },
  })
}
