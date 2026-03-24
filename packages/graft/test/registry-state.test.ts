import { describe, expect, it } from 'vitest'
import { AppRegistry } from '../src/app/registry-state.js'

describe('AppRegistry.snapshot', () => {
  it('returns arrays that are isolated from later registry mutations', () => {
    const registry = new AppRegistry()
    registry.tool('first', {
      description: 'First tool',
      handler: () => ({ ok: true }),
    })

    const snapshot = registry.snapshot()

    registry.tool('second', {
      description: 'Second tool',
      handler: () => ({ ok: true }),
    })

    expect(snapshot.tools.map((tool) => tool.name)).toEqual(['first'])
    expect(registry.snapshot().tools.map((tool) => tool.name)).toEqual(['first', 'second'])
  })

  it('does not let snapshot array mutation change registry-owned state', () => {
    const registry = new AppRegistry()
    registry.tool('first', {
      description: 'First tool',
      handler: () => ({ ok: true }),
    })

    const snapshot = registry.snapshot()
    ;(snapshot.tools as Array<typeof snapshot.tools[number]>).pop()

    expect(snapshot.tools).toHaveLength(0)
    expect(registry.snapshot().tools).toHaveLength(1)
  })
})
