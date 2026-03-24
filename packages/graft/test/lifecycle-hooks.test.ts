import { describe, it, expect, vi } from 'vitest'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import type { ToolCallMiddleware, ToolMeta, DispatchLifecycleContext, DispatchSuccess } from '../src/types.js'
import { AuthError, ToolError } from '../src/errors.js'
import { createStateKey } from '../src/state.js'
import { bodyOf, statusOf } from './dispatch-outcome.js'

function simpleTool(overrides: Partial<PipelineTool> = {}): PipelineTool {
  return {
    name: 'greet',
    handler: async (args) => ({ message: `Hello, ${(args as any).name}!` }),
    ...overrides,
  }
}

const toolMeta: ToolMeta = {
  kind: 'tool', name: 'greet', tags: [], auth: true, sideEffects: false,
}

describe('lifecycle hooks — onError / onSuccess', () => {
  it('onError fires on auth failure (ctx undefined, auth undefined)', async () => {
    const onError = vi.fn()
    const tool = simpleTool({ auth: true, meta: toolMeta })
    const pipeline = createToolPipeline({
      tools: [tool],
      onError: [onError],
    })

    await pipeline.dispatch('greet', { name: 'X' })
    // No authResult → 401

    expect(onError).toHaveBeenCalledOnce()
    const [error, info] = onError.mock.calls[0] as [unknown, DispatchLifecycleContext]
    expect(error).toBeInstanceOf(AuthError)
    expect(info.toolName).toBe('greet')
    expect(info.toolContext).toBeUndefined()
    expect(info.auth).toBeUndefined()
  })

  it('onError fires on handler throw (ctx available, with state set by middleware)', async () => {
    const onError = vi.fn()
    const stateKey = createStateKey<string>('tenant')

    const mw: ToolCallMiddleware = async (ctx, next) => {
      stateKey.set(ctx, 'acme')
      return next()
    }
    const tool = simpleTool({
      auth: true,
      meta: toolMeta,
      middleware: mw,
      handler: () => { throw new ToolError('Conflict', 409) },
    })
    const pipeline = createToolPipeline({
      tools: [tool],
      onError: [onError],
    })

    await pipeline.dispatch('greet', {}, { authResult: { subject: 'u1' } })

    expect(onError).toHaveBeenCalledOnce()
    const [error, info] = onError.mock.calls[0] as [unknown, DispatchLifecycleContext]
    expect(error).toBeInstanceOf(ToolError)
    expect(info.toolContext).toBeDefined()
    expect(stateKey.get(info.toolContext!)).toBe('acme')
    expect(info.auth).toEqual({ subject: 'u1' })
  })

  it('onSuccess fires on success (result and ctx available)', async () => {
    const onSuccess = vi.fn()
    const tool = simpleTool({ meta: toolMeta })
    const pipeline = createToolPipeline({
      tools: [tool],
      onSuccess: [onSuccess],
    })

    await pipeline.dispatch('greet', { name: 'World' })

    expect(onSuccess).toHaveBeenCalledOnce()
    const [result, info] = onSuccess.mock.calls[0] as [DispatchSuccess, DispatchLifecycleContext]
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as any).message).toBe('Hello, World!')
    expect(info.toolName).toBe('greet')
    expect(info.toolContext).toBeDefined()
  })

  it('onSuccess not called on error', async () => {
    const onSuccess = vi.fn()
    const tool = simpleTool({
      handler: () => { throw new Error('boom') },
    })
    const pipeline = createToolPipeline({
      tools: [tool],
      onSuccess: [onSuccess],
    })

    await pipeline.dispatch('greet', {})
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('onError not called on success', async () => {
    const onError = vi.fn()
    const pipeline = createToolPipeline({
      tools: [simpleTool()],
      onError: [onError],
    })

    await pipeline.dispatch('greet', { name: 'X' })
    expect(onError).not.toHaveBeenCalled()
  })

  it('multiple hooks fire in order', async () => {
    const order: string[] = []
    const onSuccess1 = vi.fn(async () => { order.push('hook1') })
    const onSuccess2 = vi.fn(async () => { order.push('hook2') })

    const pipeline = createToolPipeline({
      tools: [simpleTool()],
      onSuccess: [onSuccess1, onSuccess2],
    })

    await pipeline.dispatch('greet', { name: 'X' })
    expect(order).toEqual(['hook1', 'hook2'])
  })

  it('hook errors are swallowed (don\'t break dispatch)', async () => {
    const onSuccess = vi.fn(async () => { throw new Error('hook crash') })
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const pipeline = createToolPipeline({
      tools: [simpleTool()],
      onSuccess: [onSuccess],
      logger,
    })

    const result = await pipeline.dispatch('greet', { name: 'X' })
    // Dispatch still succeeds
    expect(statusOf(result)).toBe(200)
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith('[graft] onSuccess hook failed:', expect.any(Error))
  })

  it('lifecycleInfo.toolContext is undefined when auth fails before ctx creation', async () => {
    const onError = vi.fn()
    const tool = simpleTool({ auth: true, meta: toolMeta })
    const pipeline = createToolPipeline({
      tools: [tool],
      onError: [onError],
    })

    await pipeline.dispatch('greet', {})

    const [, info] = onError.mock.calls[0] as [unknown, DispatchLifecycleContext]
    expect(info.toolContext).toBeUndefined()
  })

  it('lifecycleInfo.auth present when auth succeeded but handler failed', async () => {
    const onError = vi.fn()
    const tool = simpleTool({
      auth: true,
      meta: toolMeta,
      handler: () => { throw new Error('handler failed') },
    })
    const pipeline = createToolPipeline({
      tools: [tool],
      onError: [onError],
    })

    await pipeline.dispatch('greet', {}, { authResult: { subject: 'u1', roles: ['admin'] } })

    const [, info] = onError.mock.calls[0] as [unknown, DispatchLifecycleContext]
    expect(info.auth).toEqual({ subject: 'u1', roles: ['admin'] })
    expect(info.toolContext).toBeDefined()
  })

  it('lifecycleInfo contains transport and headers', async () => {
    const onSuccess = vi.fn()
    const pipeline = createToolPipeline({
      tools: [simpleTool()],
      onSuccess: [onSuccess],
    })

    await pipeline.dispatch('greet', { name: 'X' }, {
      transport: 'mcp',
      headers: { authorization: 'Bearer tok' },
    })

    const [, info] = onSuccess.mock.calls[0] as [DispatchSuccess, DispatchLifecycleContext]
    expect(info.transport).toBe('mcp')
    expect(info.headers).toEqual({ authorization: 'Bearer tok' })
  })
})
