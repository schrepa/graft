import { describe, it, expect, vi } from 'vitest'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { statusOf } from './dispatch-outcome.js'

function progressTool(): PipelineTool {
  return {
    name: 'progress',
    handler: async (_args, ctx) => {
      ctx.reportProgress(1, 10)
      ctx.reportProgress(5, 10)
      return { ok: true }
    },
  }
}

function logTool(): PipelineTool {
  return {
    name: 'log',
    handler: async (_args, ctx) => {
      ctx.log.info('hello', { key: 'val' })
      ctx.log.warn('danger')
      return { ok: true }
    },
  }
}

function mixedTool(): PipelineTool {
  return {
    name: 'mixed',
    handler: async (_args, ctx) => {
      ctx.log.info('starting')
      ctx.reportProgress(1, 5)
      ctx.log.debug('step 2')
      ctx.reportProgress(3, 5)
      return { ok: true }
    },
  }
}

function silentTool(): PipelineTool {
  return {
    name: 'silent',
    handler: async () => ({ ok: true }),
  }
}

function errorTool(): PipelineTool {
  return {
    name: 'failing',
    handler: async (_args, ctx) => {
      ctx.log.info('before error')
      ctx.reportProgress(1, 2)
      throw new Error('boom')
    },
  }
}

describe('DispatchResult events', () => {
  it('captures progress events from reportProgress', async () => {
    const pipeline = createToolPipeline({ tools: [progressTool()] })
    const result = await pipeline.dispatch('progress', {})

    expect(statusOf(result)).toBe(200)
    expect(result.events).toEqual([
      { type: 'progress', progress: 1, total: 10 },
      { type: 'progress', progress: 5, total: 10 },
    ])
    expect(result.eventsDropped).toBeUndefined()
  })

  it('captures log events from ctx.log.*', async () => {
    const pipeline = createToolPipeline({ tools: [logTool()] })
    const result = await pipeline.dispatch('log', {})

    expect(statusOf(result)).toBe(200)
    expect(result.events).toEqual([
      { type: 'log', level: 'info', message: 'hello', data: { key: 'val' } },
      { type: 'log', level: 'warn', message: 'danger', data: undefined },
    ])
  })

  it('preserves correct order for mixed events', async () => {
    const pipeline = createToolPipeline({ tools: [mixedTool()] })
    const result = await pipeline.dispatch('mixed', {})

    expect(result.events).toHaveLength(4)
    expect(result.events![0]).toEqual({ type: 'log', level: 'info', message: 'starting', data: undefined })
    expect(result.events![1]).toEqual({ type: 'progress', progress: 1, total: 5 })
    expect(result.events![2]).toEqual({ type: 'log', level: 'debug', message: 'step 2', data: undefined })
    expect(result.events![3]).toEqual({ type: 'progress', progress: 3, total: 5 })
  })

  it('returns undefined events when handler emits nothing', async () => {
    const pipeline = createToolPipeline({ tools: [silentTool()] })
    const result = await pipeline.dispatch('silent', {})

    expect(statusOf(result)).toBe(200)
    expect(result.events).toBeUndefined()
    expect(result.eventsDropped).toBeUndefined()
  })

  it('preserves events captured before an error', async () => {
    const pipeline = createToolPipeline({ tools: [errorTool()] })
    const result = await pipeline.dispatch('failing', {})

    expect(statusOf(result)).toBe(500)
    expect(result.events).toEqual([
      { type: 'log', level: 'info', message: 'before error', data: undefined },
      { type: 'progress', progress: 1, total: 2 },
    ])
  })

  it('MCP contextIngredients callbacks still fire alongside buffering', async () => {
    const onLog = vi.fn()
    const onProgress = vi.fn()

    const pipeline = createToolPipeline({ tools: [mixedTool()] })
    const result = await pipeline.dispatch('mixed', {}, {
      contextIngredients: { onLog, onProgress },
    })

    // Buffer has all events
    expect(result.events).toHaveLength(4)
    // Streaming callbacks also fired
    expect(onLog).toHaveBeenCalledTimes(2)
    expect(onLog).toHaveBeenCalledWith('info', 'starting', undefined)
    expect(onLog).toHaveBeenCalledWith('debug', 'step 2', undefined)
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalledWith(1, 5)
    expect(onProgress).toHaveBeenCalledWith(3, 5)
  })

  it('caps events at 1000 and tracks overflow; streaming callbacks still fire for all', async () => {
    const onProgress = vi.fn()

    const tool: PipelineTool = {
      name: 'flood',
      handler: async (_args, ctx) => {
        for (let i = 0; i < 1005; i++) {
          ctx.reportProgress(i, 1005)
        }
        return { ok: true }
      },
    }

    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('flood', {}, {
      contextIngredients: { onProgress },
    })

    expect(result.events).toHaveLength(1000)
    expect(result.eventsDropped).toBe(5)
    // Streaming callbacks fire for ALL events, not just buffered ones
    expect(onProgress).toHaveBeenCalledTimes(1005)
  })
})
