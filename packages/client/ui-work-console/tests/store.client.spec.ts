// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createWorkConsoleStore } from '../src/client/store.ts'

describe('createWorkConsoleStore', () => {
  it('creates independent closed stores with no selected Task', () => {
    const first = createWorkConsoleStore().create()
    const second = createWorkConsoleStore().create()
    expect(first.store.getSnapshot()).toEqual({ open: false, selectedTaskId: null })
    first.actions.open()
    first.actions.selectTask('task-1')
    expect(first.store.getSnapshot()).toEqual({ open: true, selectedTaskId: 'task-1' })
    expect(second.store.getSnapshot()).toEqual({ open: false, selectedTaskId: null })
  })

  it('closes without discarding selection and can explicitly clear selection', () => {
    const { store, actions } = createWorkConsoleStore().create()
    actions.selectTask('task-2')
    actions.open()
    actions.close()
    expect(store.getSnapshot()).toEqual({ open: false, selectedTaskId: 'task-2' })
    actions.selectTask(null)
    expect(store.getSnapshot()).toEqual({ open: false, selectedTaskId: null })
  })
})
