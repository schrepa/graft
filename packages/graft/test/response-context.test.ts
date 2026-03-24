import { describe, it, expect } from 'vitest'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import type { ToolCallMiddleware } from '../src/types.js'
import { ToolError } from '../src/errors.js'
import { headersOf, statusOf } from './dispatch-outcome.js'

function simpleTool(overrides: Partial<PipelineTool> = {}): PipelineTool {
  return {
    name: 'greet',
    handler: async (args) => ({ message: `Hello, ${(args as any).name}!` }),
    ...overrides,
  }
}

describe('ctx.response — response context for middleware', () => {
  it('middleware sets response header → appears in result.headers', async () => {
    const mw: ToolCallMiddleware = async (ctx, next) => {
      ctx.response.headers['X-Custom'] = 'val'
      return next()
    }
    const pipeline = createToolPipeline({
      tools: [simpleTool({ middleware: mw })],
    })
    const result = await pipeline.dispatch('greet', { name: 'World' })
    expect(statusOf(result)).toBe(200)
    expect(headersOf(result)).toEqual({ 'X-Custom': 'val' })
  })

  it('multiple middleware merge headers (last write wins per key)', async () => {
    const mw1: ToolCallMiddleware = async (ctx, next) => {
      ctx.response.headers['X-A'] = 'from-mw1'
      ctx.response.headers['X-Shared'] = 'mw1'
      return next()
    }
    const mw2: ToolCallMiddleware = async (ctx, next) => {
      ctx.response.headers['X-B'] = 'from-mw2'
      ctx.response.headers['X-Shared'] = 'mw2'
      return next()
    }
    const { composeMiddleware } = await import('../src/middleware.js')
    const composed = composeMiddleware([mw1, mw2])!
    const pipeline = createToolPipeline({
      tools: [simpleTool({ middleware: composed })],
    })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(headersOf(result)).toEqual({
      'X-A': 'from-mw1',
      'X-B': 'from-mw2',
      'X-Shared': 'mw2',
    })
  })

  it('ctx.response.status = 201 overrides success status', async () => {
    const mw: ToolCallMiddleware = async (ctx, next) => {
      const result = await next()
      ctx.response.status = 201
      return result
    }
    const pipeline = createToolPipeline({
      tools: [simpleTool({ middleware: mw })],
    })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(statusOf(result)).toBe(201)
  })

  it('status override ignored on error (error status preserved)', async () => {
    const mw: ToolCallMiddleware = async (ctx, next) => {
      ctx.response.status = 201
      return next()
    }
    const tool = simpleTool({
      middleware: mw,
      handler: () => { throw new ToolError('Conflict', 409) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(409)
  })

  it('response headers survive handler errors', async () => {
    const mw: ToolCallMiddleware = async (ctx, next) => {
      ctx.response.headers['X-RateLimit-Remaining'] = '99'
      return next()
    }
    const tool = simpleTool({
      middleware: mw,
      handler: () => { throw new Error('boom') },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(500)
    expect(headersOf(result)?.['X-RateLimit-Remaining']).toBe('99')
  })

  it('response headers merge with error headers (ToolError)', async () => {
    const mw: ToolCallMiddleware = async (ctx, next) => {
      ctx.response.headers['X-Request-Id'] = 'req-123'
      return next()
    }
    const tool = simpleTool({
      middleware: mw,
      handler: () => { throw new ToolError('Rate limited', 429, { headers: { 'Retry-After': '60' } }) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(429)
    // ctx.response.headers merge on top of error headers
    expect(headersOf(result)?.['Retry-After']).toBe('60')
    expect(headersOf(result)?.['X-Request-Id']).toBe('req-123')
  })

  it('no response context used → result.headers unchanged', async () => {
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    const result = await pipeline.dispatch('greet', { name: 'World' })
    expect(statusOf(result)).toBe(200)
    expect(headersOf(result)).toBeUndefined()
  })
})
