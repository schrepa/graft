import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import { createStateKey } from '../src/state.js'
import type { ToolContext } from '../src/types.js'

describe('ToolContext in handlers', () => {
  it('handler receives context as second argument', async () => {
    let receivedCtx: ToolContext | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: (params, ctx) => {
        receivedCtx = ctx
        return { message: `Hello, ${params.name}!` }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet?name=World'))
    expect(res.status).toBe(200)

    expect(receivedCtx).toBeDefined()
    expect(receivedCtx!.meta.transport).toBe('http')
    expect(receivedCtx!.meta.toolName).toBe('greet')
    expect(receivedCtx!.log).toBeDefined()
    expect(typeof receivedCtx!.log.info).toBe('function')
    expect(typeof receivedCtx!.log.error).toBe('function')
    expect(typeof receivedCtx!.reportProgress).toBe('function')
  })

  it('context is available for POST handlers', async () => {
    let receivedCtx: ToolContext | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create item',
      sideEffects: true,
      params: z.object({ name: z.string() }),
      handler: (params, ctx) => {
        receivedCtx = ctx
        return { id: '1', name: params.name }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))

    expect(receivedCtx).toBeDefined()
    expect(receivedCtx!.meta.transport).toBe('http')
    expect(receivedCtx!.meta.toolName).toBe('create_item')
  })

  it('context is available for MCP tool calls', async () => {
    let receivedCtx: ToolContext | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: (params, ctx) => {
        receivedCtx = ctx
        return { message: `Hello, ${params.name}!` }
      },
    })

    const client = createMcpTestClient(app)
    await client.callTool('greet', { name: 'World' })

    expect(receivedCtx).toBeDefined()
    expect(receivedCtx!.meta.transport).toBe('mcp')
    expect(receivedCtx!.meta.toolName).toBe('greet')
  })

  it('handler can call ctx.log without errors', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('logging_tool', {
      description: 'Tests logging',
      handler: (_params, ctx) => {
        ctx.log.debug('debug message')
        ctx.log.info('info message')
        ctx.log.warn('warning message')
        ctx.log.error('error message')
        return { logged: true }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/logging-tool'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.logged).toBe(true)
  })

  it('handler can call ctx.reportProgress without errors', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('progress_tool', {
      description: 'Tests progress',
      handler: (_params, ctx) => {
        ctx.reportProgress(0, 100)
        ctx.reportProgress(50, 100)
        ctx.reportProgress(100, 100)
        return { done: true }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/progress-tool'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.done).toBe(true)
  })
})

describe('ctx.params', () => {
  it('handler reads ctx.params with parsed values', async () => {
    let receivedParams: Record<string, unknown> | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: (params, ctx) => {
        receivedParams = ctx.params
        return { message: `Hello, ${params.name}!` }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/greet?name=World'))

    expect(receivedParams).toBeDefined()
    expect(receivedParams).toEqual({ name: 'World' })
  })

  it('onToolCall middleware reads ctx.params', async () => {
    let mwParams: Record<string, unknown> | undefined

    const app = createApp({
      name: 'test-app',
      onToolCall: async (ctx, next) => {
        mwParams = ctx.params
        return next()
      },
    })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: (params) => ({ message: `Hello, ${params.name}!` }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/greet?name=Alice'))

    expect(mwParams).toBeDefined()
    expect(mwParams).toEqual({ name: 'Alice' })
  })
})

describe('onToolCall middleware', () => {
  it('wraps tool execution with before/after logic', async () => {
    const log: string[] = []

    const app = createApp({
      name: 'test-app',
      onToolCall: async (ctx, next) => {
        log.push(`before:${ctx.meta.toolName}`)
        const result = await next()
        log.push(`after:${ctx.meta.toolName}`)
        return result
      },
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => {
        log.push('handler')
        return { message: 'hello' }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    expect(res.status).toBe(200)
    expect(log).toEqual(['before:greet', 'handler', 'after:greet'])
  })

  it('middleware can modify the result', async () => {
    const app = createApp({
      name: 'test-app',
      onToolCall: async (_ctx, next) => {
        const result = await next() as any
        return { ...result, enhanced: true }
      },
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => ({ message: 'hello' }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    const body = await res.json() as any
    expect(body.message).toBe('hello')
    expect(body.enhanced).toBe(true)
  })

  it('middleware can catch and handle errors', async () => {
    const app = createApp({
      name: 'test-app',
      onToolCall: async (_ctx, next) => {
        try {
          return await next()
        } catch {
          return { error: 'caught by middleware' }
        }
      },
    })
    app.tool('failing_tool', {
      description: 'Fails',
      handler: () => { throw new Error('boom') },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/failing-tool'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.error).toBe('caught by middleware')
  })

  it('middleware works for MCP calls too', async () => {
    const log: string[] = []

    const app = createApp({
      name: 'test-app',
      onToolCall: async (ctx, next) => {
        log.push(`middleware:${ctx.meta.toolName}`)
        return next()
      },
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => ({ message: 'hello' }),
    })

    const client = createMcpTestClient(app)
    await client.callTool('greet')

    expect(log).toContain('middleware:greet')
  })
})

describe('app.use() composable middleware', () => {
  it('runs multiple middleware in order', async () => {
    const log: string[] = []

    const app = createApp({ name: 'test-app' })
    app.use(async (_ctx, next) => {
      log.push('mw1:before')
      const result = await next()
      log.push('mw1:after')
      return result
    })
    app.use(async (_ctx, next) => {
      log.push('mw2:before')
      const result = await next()
      log.push('mw2:after')
      return result
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => {
        log.push('handler')
        return { message: 'hello' }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    expect(res.status).toBe(200)
    expect(log).toEqual(['mw1:before', 'mw2:before', 'handler', 'mw2:after', 'mw1:after'])
  })

  it('onToolCall runs before app.use() middleware', async () => {
    const log: string[] = []

    const app = createApp({
      name: 'test-app',
      onToolCall: async (_ctx, next) => {
        log.push('onToolCall')
        return next()
      },
    })
    app.use(async (_ctx, next) => {
      log.push('use-mw')
      return next()
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => {
        log.push('handler')
        return { ok: true }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/greet'))
    expect(log).toEqual(['onToolCall', 'use-mw', 'handler'])
  })

  it('middleware can modify results', async () => {
    const app = createApp({ name: 'test-app' })
    app.use(async (_ctx, next) => {
      const result = await next() as any
      return { ...result, fromMiddleware: true }
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => ({ message: 'hello' }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    const body = await res.json() as any
    expect(body.message).toBe('hello')
    expect(body.fromMiddleware).toBe(true)
  })

  it('app.use() middleware works for MCP calls', async () => {
    const log: string[] = []

    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      log.push(`mw:${ctx.meta.toolName}`)
      return next()
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => ({ message: 'hello' }),
    })

    const client = createMcpTestClient(app)
    await client.callTool('greet')

    expect(log).toContain('mw:greet')
  })

  it('throws when calling use() after build()', () => {
    const app = createApp({ name: 'test-app' })
    app.build()

    expect(() => {
      app.use(async (_ctx, next) => next())
    }).toThrow('Cannot modify app after build()')
  })
})

describe('ctx.state — middleware → handler data passing', () => {
  it('middleware sets state, handler reads it', async () => {
    let handlerState: Record<string, unknown> | undefined

    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      ctx.state.user = { id: '42', name: 'Alice' }
      return next()
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: (_params, ctx) => {
        handlerState = ctx.state
        return { greeting: `Hello, ${(ctx.state.user as any).name}!` }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.greeting).toBe('Hello, Alice!')
    expect(handlerState?.user).toEqual({ id: '42', name: 'Alice' })
  })

  it('createStateKey provides typed access', async () => {
    interface User { id: string; name: string }
    const userKey = createStateKey<User>('user')
    let resolvedUser: User | undefined

    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      userKey.set(ctx, { id: '1', name: 'Bob' })
      return next()
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: (_params, ctx) => {
        resolvedUser = userKey.get(ctx)
        return { name: resolvedUser?.name }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    expect(res.status).toBe(200)
    expect(resolvedUser).toEqual({ id: '1', name: 'Bob' })
  })

  it('state is fresh per request', async () => {
    const states: Record<string, unknown>[] = []

    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      ctx.state.counter = (ctx.state.counter as number ?? 0) + 1
      return next()
    })
    app.tool('greet', {
      description: 'Say hello',
      handler: (_params, ctx) => {
        states.push({ ...ctx.state })
        return { ok: true }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/greet'))
    await fetch(new Request('http://localhost:3000/greet'))
    // Each request gets a fresh state
    expect(states).toEqual([{ counter: 1 }, { counter: 1 }])
  })
})

describe('scoped middleware via filter', () => {
  it('filter restricts middleware to matching tools', async () => {
    const log: string[] = []

    const app = createApp({ name: 'test-app' })
    app.use(
      async (ctx, next) => {
        log.push(`scoped:${ctx.meta.toolName}`)
        return next()
      },
      { filter: (tool) => tool.sideEffects },
    )
    app.tool('read_item', {
      description: 'Read',
      handler: () => ({ read: true }),
    })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({ created: true }),
    })

    const { fetch } = app.build()

    // GET tool — middleware should NOT run (sideEffects=false)
    await fetch(new Request('http://localhost:3000/read-item'))
    expect(log).toEqual([])

    // POST tool — middleware SHOULD run (sideEffects=true)
    await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }))
    expect(log).toEqual(['scoped:create_item'])
  })

  it('filter by auth — only authenticated tools', async () => {
    const log: string[] = []

    const app = createApp({
      name: 'test-app',
      authenticate: async () => ({ subject: 'user' }),
    })
    app.use(
      async (ctx, next) => {
        log.push(`audit:${ctx.meta.toolName}`)
        return next()
      },
      { filter: (tool) => !!tool.auth },
    )
    app.tool('public_tool', {
      description: 'Public',
      handler: () => ({ public: true }),
    })
    app.tool('private_tool', {
      description: 'Private',
      auth: true,
      handler: () => ({ private: true }),
    })

    const { fetch } = app.build()

    await fetch(new Request('http://localhost:3000/public-tool'))
    expect(log).toEqual([])

    await fetch(new Request('http://localhost:3000/private-tool'))
    expect(log).toEqual(['audit:private_tool'])
  })

  it('filter by tags', async () => {
    const log: string[] = []

    const app = createApp({ name: 'test-app' })
    app.use(
      async (ctx, next) => {
        log.push(`cached:${ctx.meta.toolName}`)
        return next()
      },
      { filter: (tool) => tool.tags.includes('cacheable') },
    )
    app.tool('fast_tool', {
      description: 'Fast',
      tags: ['cacheable'],
      handler: () => ({ fast: true }),
    })
    app.tool('slow_tool', {
      description: 'Slow',
      handler: () => ({ slow: true }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/fast-tool'))
    await fetch(new Request('http://localhost:3000/slow-tool'))
    expect(log).toEqual(['cached:fast_tool'])
  })

  it('unfiltered middleware (no filter) runs for all tools', async () => {
    const log: string[] = []

    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      log.push(`global:${ctx.meta.toolName}`)
      return next()
    })
    app.tool('tool_a', {
      description: 'A',
      handler: () => 'a',
    })
    app.tool('tool_b', {
      description: 'B',
      handler: () => 'b',
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/tool-a'))
    await fetch(new Request('http://localhost:3000/tool-b'))
    expect(log).toEqual(['global:tool_a', 'global:tool_b'])
  })

  it('scoped middleware works via MCP', async () => {
    const log: string[] = []

    const app = createApp({ name: 'test-app' })
    app.use(
      async (ctx, next) => {
        log.push(`scoped:${ctx.meta.toolName}`)
        return next()
      },
      { filter: (tool) => tool.sideEffects },
    )
    app.tool('read_only', {
      description: 'Read only',
      handler: () => ({ data: true }),
    })
    app.tool('write_op', {
      description: 'Write',
      sideEffects: true,
      handler: () => ({ wrote: true }),
    })

    const client = createMcpTestClient(app)

    // MCP call to read_only — middleware should not run
    await client.callTool('read_only')
    expect(log).toEqual([])

    // MCP call to write_op — middleware should run
    await client.callTool('write_op')
    expect(log).toEqual(['scoped:write_op'])
  })
})
