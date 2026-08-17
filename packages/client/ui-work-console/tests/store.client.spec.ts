// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createWorkConsoleStore } from '../src/client/store.ts'

describe('createWorkConsoleStore', () => {
  it('creates independent closed stores with no selected Task', () => {
    const first = createWorkConsoleStore().create()
    const second = createWorkConsoleStore().create()
    expect(first.getSnapshot()).toEqual({ open: false, selectedTaskId: null })
    first.actions.open()
    first.actions.selectTask('task-1')
    expect(first.getSnapshot()).toEqual({ open: true, selectedTaskId: 'task-1' })
    expect(second.getSnapshot()).toEqual({ open: false, selectedTaskId: null })
  })

  it('closes without discarding selection and can explicitly clear selection', () => {
    const instance = createWorkConsoleStore().create()
    instance.actions.selectTask('task-2')
    instance.actions.open()
    instance.actions.close()
    expect(instance.getSnapshot()).toEqual({ open: false, selectedTaskId: 'task-2' })
    instance.actions.selectTask(null)
    expect(instance.getSnapshot()).toEqual({ open: false, selectedTaskId: null })
  })
})
