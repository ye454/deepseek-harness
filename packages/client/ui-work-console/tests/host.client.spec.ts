import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-work-console host half', () => {
  it('is intentionally inert', () => {
    expect(apply()).toBeUndefined()
  })
})
