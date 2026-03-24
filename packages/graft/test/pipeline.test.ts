import { describe, it, expect } from 'vitest'
import { createToolPipeline, richResult, buildSyntheticRequest } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { composeMiddleware } from '../src/middleware.js'
import { createStateKey } from '../src/state.js'
import { normalizeAuth, isAuthorized } from '../src/auth.js'
import { GraftError, ToolError } from '../src/errors.js'
import type { ToolCallMiddleware, ToolContext, ToolMeta } from '../src/types.js'
import { bodyOf, codeOf, contentTypeOf, headersOf, statusOf } from './dispatch-outcome.js'

// =========================================================================
// Helpers
// =========================================================================

function simpleTool(overrides: Partial<PipelineTool> = {}): PipelineTool {
  return {
    name: 'greet',
    handler: async (args) => ({ message: `Hello, ${(args as any).name}!` }),
    ...overrides,
  }
}

// =========================================================================
// normalizeAuth
// =========================================================================

describe('normalizeAuth', () => {
  it('undefined → undefined', () => {
    expect(normalizeAuth(undefined)).toBeUndefined()
  })

  it('false → undefined', () => {
    expect(normalizeAuth(false)).toBeUndefined()
  })

  it('true → {} (auth required, any role)', () => {
    expect(normalizeAuth(true)).toEqual({})
  })

  it('string[] shorthand → { roles }', () => {
    expect(normalizeAuth(['admin'])).toEqual({ roles: ['admin'] })
  })

  it('string[] with multiple roles', () => {
    expect(normalizeAuth(['admin', 'editor'])).toEqual({ roles: ['admin', 'editor'] })
  })

  it('{ roles: ["admin"] } → pass through', () => {
    expect(normalizeAuth({ roles: ['admin'] })).toEqual({ roles: ['admin'] })
  })

  it('empty object → {} (auth required, any role)', () => {
    expect(normalizeAuth({})).toEqual({})
  })
})

// =========================================================================
// isAuthorized
// =========================================================================

describe('isAuthorized', () => {
  it('returns true for public tools (undefined)', () => {
    expect(isAuthorized(undefined, undefined)).toBe(true)
  })

  it('returns true for public tools (false)', () => {
    expect(isAuthorized(false, undefined)).toBe(true)
  })

  it('returns false when auth required but no authResult', () => {
    expect(isAuthorized(true, undefined)).toBe(false)
  })

  it('returns true when auth required, any role (auth: true)', () => {
    expect(isAuthorized(true, { subject: 'user-1' })).toBe(true)
  })

  it('returns true when user has matching role', () => {
    expect(isAuthorized(['admin'], { subject: 'user-1', roles: ['admin'] })).toBe(true)
  })

  it('returns false when user lacks required role', () => {
    expect(isAuthorized(['admin'], { subject: 'user-1', roles: ['viewer'] })).toBe(false)
  })

  it('handles roles: [] (empty roles = any authenticated user)', () => {
    expect(isAuthorized({ roles: [] }, { subject: 'user-1' })).toBe(true)
  })
})

// =========================================================================
// createToolPipeline — dispatch
// =========================================================================

describe('createToolPipeline', () => {
  it('dispatches to a known tool', async () => {
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    const result = await pipeline.dispatch('greet', { name: 'World' })
    expect(statusOf(result)).toBe(200)
    expect(bodyOf(result)).toEqual({ message: 'Hello, World!' })
  })

  it('returns 404 for unknown tool', async () => {
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    const result = await pipeline.dispatch('nonexistent', {})
    expect(statusOf(result)).toBe(404)
    expect((bodyOf(result) as any).error).toContain('Unknown tool')
    expect(codeOf(result)).toBe('NOT_FOUND')
  })

  it('passes validated args to handler', async () => {
    const tool = simpleTool({
      validate: (args) => {
        if (!args.name) throw Object.assign(new Error('Invalid'), { issues: [{ message: 'name required' }] })
        return { name: String(args.name).toUpperCase() }
      },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', { name: 'alice' })
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as any).message).toBe('Hello, ALICE!')
  })

  it('returns 400 for ValidationError from validate function', async () => {
    const { ValidationError } = await import('../src/errors.js')
    const tool = simpleTool({
      validate: () => { throw new ValidationError('Validation error', [{ path: 'address.zip', message: 'required' }]) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(400)
    expect((bodyOf(result) as any).error).toBe('Validation error')
    expect((bodyOf(result) as any).details).toEqual([{ path: 'address.zip', message: 'required' }])
  })

  it('non-ValidationError from validate is treated as 500', async () => {
    const tool = simpleTool({
      validate: () => { throw Object.assign(new Error('bad'), { issues: [{ path: ['name'], message: 'required' }] }) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(500)
  })

  it('catches GraftError and returns its status code', async () => {
    const tool = simpleTool({
      handler: () => { throw new ToolError('Not found', 404) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(404)
    expect((bodyOf(result) as any).error).toBe('Not found')
  })

  it('propagates explicit error code through DispatchResult', async () => {
    const tool = simpleTool({
      handler: () => { throw new ToolError('Already in cart', 409, { code: 'ALREADY_IN_CART' }) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(409)
    expect(codeOf(result)).toBe('ALREADY_IN_CART')
    expect((bodyOf(result) as any).error).toBe('Already in cart')
  })

  it('has no code when ToolError omits it', async () => {
    const tool = simpleTool({
      handler: () => { throw new ToolError('Conflict', 409) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(409)
    expect(codeOf(result)).toBeUndefined()
  })

  it('propagates code from GraftError', async () => {
    const tool = simpleTool({
      handler: () => { throw new GraftError('Rate limited', 429, 'RATE_LIMITED') },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(429)
    expect(codeOf(result)).toBe('RATE_LIMITED')
  })

  it('propagates headers from ToolError options', async () => {
    const tool = simpleTool({
      handler: () => { throw new ToolError('Too many requests', 429, { headers: { 'Retry-After': '60' }, code: 'RATE_LIMITED' }) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(429)
    expect(codeOf(result)).toBe('RATE_LIMITED')
    expect(headersOf(result)).toEqual({ 'Retry-After': '60' })
  })

  it('catches generic errors and returns 500', async () => {
    const tool = simpleTool({
      handler: () => { throw new Error('boom') },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(500)
    expect((bodyOf(result) as any).error).toBe('boom')
  })

  it('skips raw args through when no validate', async () => {
    let receivedArgs: unknown
    const tool = simpleTool({
      handler: async (args) => { receivedArgs = args; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { foo: 'bar' })
    expect(receivedArgs).toEqual({ foo: 'bar' })
  })
})

// =========================================================================
// Pipeline auto-validation via inputSchema
// =========================================================================

describe('pipeline validation', () => {
  it('Zod validate runs when present', async () => {
    let validateCalled = false
    const tool = simpleTool({
      validate: (args) => { validateCalled = true; return { name: String(args.name).toUpperCase() } },
      handler: async (args) => args,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', { name: 'alice' })
    expect(statusOf(result)).toBe(200)
    expect(validateCalled).toBe(true)
    expect((bodyOf(result) as any).name).toBe('ALICE')
  })

  it('passes raw args through when no validate function', async () => {
    let receivedArgs: unknown
    const tool = simpleTool({
      handler: async (args) => { receivedArgs = args; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { anything: 'goes' })
    expect(receivedArgs).toEqual({ anything: 'goes' })
  })

  it('passes raw args through when inputSchema present but no validate', async () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
    let receivedArgs: unknown
    const tool = simpleTool({
      inputSchema: schema,
      handler: async (args) => { receivedArgs = args; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { name: 'Alice' })
    expect(receivedArgs).toEqual({ name: 'Alice' })
  })
})

// =========================================================================
// Middleware
// =========================================================================

describe('pipeline middleware', () => {
  it('runs middleware before/after handler', async () => {
    const log: string[] = []
    const mw: ToolCallMiddleware = async (_ctx, next) => {
      log.push('before')
      const result = await next()
      log.push('after')
      return result
    }
    const tool = simpleTool({
      handler: async () => { log.push('handler'); return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool], middleware: mw })
    await pipeline.dispatch('greet', {})
    expect(log).toEqual(['before', 'handler', 'after'])
  })

  it('middleware can modify the result', async () => {
    const mw: ToolCallMiddleware = async (_ctx, next) => {
      const result = await next() as any
      return { ...result, enhanced: true }
    }
    const pipeline = createToolPipeline({
      tools: [simpleTool()],
      middleware: mw,
    })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect((bodyOf(result) as any).enhanced).toBe(true)
    expect((bodyOf(result) as any).message).toBe('Hello, X!')
  })

  it('middleware can catch errors', async () => {
    const mw: ToolCallMiddleware = async (_ctx, next) => {
      try { return await next() } catch { return { caught: true } }
    }
    const tool = simpleTool({
      handler: () => { throw new Error('boom') },
    })
    const pipeline = createToolPipeline({ tools: [tool], middleware: mw })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as any).caught).toBe(true)
  })
})

// =========================================================================
// composeMiddleware
// =========================================================================

describe('composeMiddleware', () => {
  it('returns undefined for empty array', () => {
    expect(composeMiddleware([])).toBeUndefined()
  })

  it('returns the single middleware for length-1 array', () => {
    const mw: ToolCallMiddleware = async (_ctx, next) => next()
    expect(composeMiddleware([mw])).toBe(mw)
  })

  it('chains multiple middlewares in order', async () => {
    const log: string[] = []
    const mw1: ToolCallMiddleware = async (_ctx, next) => { log.push('1'); return next() }
    const mw2: ToolCallMiddleware = async (_ctx, next) => { log.push('2'); return next() }
    const composed = composeMiddleware([mw1, mw2])!

    await composed({} as any, async () => { log.push('handler'); return 'done' })
    expect(log).toEqual(['1', '2', 'handler'])
  })
})

// =========================================================================
// richResult
// =========================================================================

describe('richResult', () => {
  it('unwraps richResult on dispatch', async () => {
    const tool = simpleTool({
      handler: async () => richResult('base64data', 'image/png'),
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(200)
    expect(bodyOf(result)).toBe('base64data')
    expect(contentTypeOf(result)).toBe('image/png')
  })

  it('preserves byte payloads for transport-specific formatters', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const tool = simpleTool({
      handler: async () => richResult(bytes, 'image/png'),
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})

    expect(statusOf(result)).toBe(200)
    expect(bodyOf(result)).toBe(bytes)
    expect(contentTypeOf(result)).toBe('image/png')
  })

  it('no contentType when handler returns plain value', async () => {
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(contentTypeOf(result)).toBeUndefined()
  })
})

// =========================================================================
// buildSyntheticRequest
// =========================================================================

describe('buildSyntheticRequest', () => {
  it('builds request with headers', () => {
    const req = buildSyntheticRequest({ authorization: 'Bearer token', 'x-custom': 'value' })
    expect(req.headers.get('authorization')).toBe('Bearer token')
    expect(req.headers.get('x-custom')).toBe('value')
  })

  it('skips undefined header values', () => {
    const req = buildSyntheticRequest({ authorization: 'Bearer token', skip: undefined })
    expect(req.headers.get('authorization')).toBe('Bearer token')
    expect(req.headers.has('skip')).toBe(false)
  })
})


// =========================================================================
// ToolContext wiring
// =========================================================================

describe('pipeline context', () => {
  it('provides ToolContext to handler on HTTP dispatch', async () => {
    let receivedCtx: ToolContext | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedCtx = ctx; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {}, { requestId: 'test-123' })
    expect(receivedCtx).toBeDefined()
    expect(receivedCtx!.meta.transport).toBe('http')
    expect(receivedCtx!.meta.toolName).toBe('greet')
    expect(receivedCtx!.state).toEqual({})
  })

  it('creates fresh context per dispatch (pipeline always creates context)', async () => {
    let receivedCtx: ToolContext | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedCtx = ctx; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })

    await pipeline.dispatch('greet', {}, { transport: 'mcp', requestId: 'test-id' })
    expect(receivedCtx).toBeDefined()
    expect(receivedCtx!.meta.transport).toBe('mcp')
    expect(receivedCtx!.meta.requestId).toBe('test-id')
  })

  it('populates headers on context from dispatch options', async () => {
    let receivedHeaders: Record<string, string> | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedHeaders = ctx.meta.headers; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {}, { headers: { authorization: 'Bearer x', 'x-custom': 'val' } })
    expect(receivedHeaders).toEqual({ authorization: 'Bearer x', 'x-custom': 'val' })
  })

  it('initializes empty state on new context', async () => {
    let receivedState: Record<string, unknown> | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedState = ctx.state; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})
    expect(receivedState).toEqual({})
  })

  it('auto-generated requestId is consistent between callId and context', async () => {
    let receivedRequestId: string | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedRequestId = ctx.meta.requestId; return {} },
    })

    const records: any[] = []
    const { toolCallChannel } = await import('../src/telemetry.js')
    const sub = (record: any) => { records.push(record) }
    toolCallChannel.subscribe(sub)

    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { name: 'test' })

    toolCallChannel.unsubscribe(sub)

    expect(receivedRequestId).toBeDefined()
    expect(records).toHaveLength(1)
    // The callId in telemetry must match the requestId in context
    expect(records[0].callId).toBe(receivedRequestId)
  })
})

// =========================================================================
// Cancellation via AbortSignal
// =========================================================================

describe('cancellation', () => {
  it('returns 499 when signal is already aborted', async () => {
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    const controller = new AbortController()
    controller.abort()
    const result = await pipeline.dispatch('greet', { name: 'X' }, { signal: controller.signal })
    expect(statusOf(result)).toBe(499)
    expect((bodyOf(result) as any).error).toBe('Request cancelled')
    expect(codeOf(result)).toBe('REQUEST_CANCELLED')
  })

  it('forwards signal to handler via ctx.signal', async () => {
    let receivedSignal: AbortSignal | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedSignal = ctx.signal; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const controller = new AbortController()
    await pipeline.dispatch('greet', { name: 'X' }, { signal: controller.signal })
    expect(receivedSignal).toBe(controller.signal)
    expect(receivedSignal!.aborted).toBe(false)
  })

  it('forwards signal from DispatchOptions to created context', async () => {
    let receivedSignal: AbortSignal | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedSignal = ctx.signal; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })

    const controller = new AbortController()
    await pipeline.dispatch('greet', { name: 'X' }, { signal: controller.signal })
    expect(receivedSignal).toBe(controller.signal)
  })

  it('works fine without signal (backward compatible)', async () => {
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    const result = await pipeline.dispatch('greet', { name: 'World' })
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as any).message).toBe('Hello, World!')
  })
})

// =========================================================================
// Per-tool middleware
// =========================================================================

describe('per-tool middleware', () => {
  it('uses tool-level middleware when present', async () => {
    const log: string[] = []
    const toolMw: ToolCallMiddleware = async (_ctx, next) => {
      log.push('tool-mw')
      return next()
    }
    const pipelineMw: ToolCallMiddleware = async (_ctx, next) => {
      log.push('pipeline-mw')
      return next()
    }
    const tool = simpleTool({
      handler: async () => { log.push('handler'); return {} },
      middleware: toolMw,
    })
    const pipeline = createToolPipeline({ tools: [tool], middleware: pipelineMw })
    await pipeline.dispatch('greet', {})
    // tool-level middleware wins — pipeline-level is NOT called
    expect(log).toEqual(['tool-mw', 'handler'])
  })

  it('falls back to pipeline middleware when tool has none', async () => {
    const log: string[] = []
    const pipelineMw: ToolCallMiddleware = async (_ctx, next) => {
      log.push('pipeline-mw')
      return next()
    }
    const tool = simpleTool({
      handler: async () => { log.push('handler'); return {} },
      // no tool.middleware
    })
    const pipeline = createToolPipeline({ tools: [tool], middleware: pipelineMw })
    await pipeline.dispatch('greet', {})
    expect(log).toEqual(['pipeline-mw', 'handler'])
  })
})

// =========================================================================
// createStateKey
// =========================================================================

describe('createStateKey', () => {
  it('provides typed get/set for ctx.state', () => {
    const userKey = createStateKey<{ id: string; name: string }>('user')
    const ctx: ToolContext = {
      meta: { requestId: 'test', transport: 'http', toolName: 'test' },
      params: {},
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      reportProgress: () => {},
      state: {},
      response: { headers: {} },
    }

    expect(userKey.get(ctx)).toBeUndefined()

    userKey.set(ctx, { id: '1', name: 'Alice' })
    expect(userKey.get(ctx)).toEqual({ id: '1', name: 'Alice' })
    expect(Reflect.ownKeys(ctx.state)).toHaveLength(1)
  })

  it('separate keys are independent', () => {
    const aKey = createStateKey<string>('a')
    const bKey = createStateKey<number>('b')
    const ctx: ToolContext = {
      meta: { requestId: 'test', transport: 'http', toolName: 'test' },
      params: {},
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      reportProgress: () => {},
      state: {},
      response: { headers: {} },
    }

    aKey.set(ctx, 'hello')
    bKey.set(ctx, 42)
    expect(aKey.get(ctx)).toBe('hello')
    expect(bKey.get(ctx)).toBe(42)
  })

  it('same labels do not collide at runtime', () => {
    const stringKey = createStateKey<string>('shared')
    const numberKey = createStateKey<number>('shared')
    const ctx: ToolContext = {
      meta: { requestId: 'test', transport: 'http', toolName: 'test' },
      params: {},
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      reportProgress: () => {},
      state: {},
      response: { headers: {} },
    }

    stringKey.set(ctx, 'alpha')
    numberKey.set(ctx, 42)

    expect(stringKey.get(ctx)).toBe('alpha')
    expect(numberKey.get(ctx)).toBe(42)
    expect(Reflect.ownKeys(ctx.state)).toHaveLength(2)
  })
})

// =========================================================================
// ctx.meta.tool — tool metadata exposed to handlers and middleware
// =========================================================================

describe('ctx.meta.tool', () => {
  const toolMeta: ToolMeta = {
    kind: 'tool',
    name: 'greet',
    tags: ['public'],
    auth: ['admin'],
    sideEffects: true,
  }

  it('is populated in handler when meta is set on PipelineTool', async () => {
    let receivedMeta: ToolMeta | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedMeta = ctx.meta.tool; return {} },
      meta: toolMeta,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})
    expect(receivedMeta).toEqual(toolMeta)
  })

  it('is populated in middleware before handler runs', async () => {
    let mwMeta: ToolMeta | undefined
    const mw: ToolCallMiddleware = async (ctx, next) => {
      mwMeta = ctx.meta.tool
      return next()
    }
    const tool = simpleTool({
      handler: async () => ({}),
      meta: toolMeta,
      middleware: mw,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})
    expect(mwMeta).toEqual(toolMeta)
  })

  it('has correct values for auth, tags, and sideEffects', async () => {
    let receivedMeta: ToolMeta | undefined
    const meta: ToolMeta = { kind: 'tool', name: 'read_only', tags: ['internal', 'cache'], sideEffects: false }
    const tool: PipelineTool = {
      name: 'read_only',
      handler: async (_args, ctx) => { receivedMeta = ctx.meta.tool; return {} },
      meta,
    }
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('read_only', {})
    expect(receivedMeta!.name).toBe('read_only')
    expect(receivedMeta!.tags).toEqual(['internal', 'cache'])
    expect(receivedMeta!.auth).toBeUndefined()
    expect(receivedMeta!.sideEffects).toBe(false)
  })

  it('is undefined when PipelineTool has no meta', async () => {
    let receivedMeta: ToolMeta | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedMeta = ctx.meta.tool; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})
    expect(receivedMeta).toBeUndefined()
  })

  it('is populated on existing MCP context (mutation pattern)', async () => {
    let receivedMeta: ToolMeta | undefined
    const tool = simpleTool({
      handler: async (_args, ctx) => { receivedMeta = ctx.meta.tool; return {} },
      meta: toolMeta,
    })
    const pipeline = createToolPipeline({ tools: [tool] })

    await pipeline.dispatch('greet', {}, { transport: 'mcp' })
    expect(receivedMeta).toEqual(toolMeta)
  })
})

// =========================================================================
// ctx.params in middleware
// =========================================================================

describe('ctx.params in middleware', () => {
  it('middleware reads Zod-validated params', async () => {
    let mwParams: Record<string, unknown> | undefined
    const mw: ToolCallMiddleware = async (ctx, next) => {
      mwParams = ctx.params
      return next()
    }
    const tool = simpleTool({
      validate: (args) => ({ name: String(args.name).toUpperCase() }),
      handler: async (args) => ({ message: `Hello, ${(args as any).name}!` }),
      middleware: mw,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', { name: 'alice' })
    expect(statusOf(result)).toBe(200)
    expect(mwParams).toEqual({ name: 'ALICE' })
  })

  it('middleware reads raw args when no validate', async () => {
    let mwParams: Record<string, unknown> | undefined
    const mw: ToolCallMiddleware = async (ctx, next) => {
      mwParams = ctx.params
      return next()
    }
    const tool = simpleTool({
      handler: async (args) => args,
      middleware: mw,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { foo: 'bar' })
    expect(mwParams).toEqual({ foo: 'bar' })
  })

  it('params is empty object for no-arg tools', async () => {
    let mwParams: Record<string, unknown> | undefined
    const mw: ToolCallMiddleware = async (ctx, next) => {
      mwParams = ctx.params
      return next()
    }
    const tool = simpleTool({
      handler: async () => ({ ok: true }),
      middleware: mw,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})
    expect(mwParams).toEqual({})
  })

  it('handler still receives original parsed value', async () => {
    let handlerArgs: unknown
    const mw: ToolCallMiddleware = async (_ctx, next) => next()
    const tool = simpleTool({
      validate: (args) => ({ name: String(args.name).toUpperCase() }),
      handler: async (args) => { handlerArgs = args; return {} },
      middleware: mw,
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { name: 'alice' })
    expect(handlerArgs).toEqual({ name: 'ALICE' })
  })
})
