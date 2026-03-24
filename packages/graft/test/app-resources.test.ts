import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { AuthError } from '../src/errors.js'
import { createMcpTestClient } from '../src/testing.js'
import { parseJsonText } from './helpers/common.js'

describe('resource template middleware pipeline', () => {
  it('resource template read dispatches through middleware', async () => {
    const calls: string[] = []
    const app = createApp({ name: 'test-app' })
    app.use(async (_ctx, next) => {
      calls.push('middleware:before')
      const result = await next()
      calls.push('middleware:after')
      return result
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => {
        calls.push('handler')
        return { id }
      },
    })

    const client = createMcpTestClient(app)
    const result = await client.readResource('products://abc')
    const content = parseJsonText(result.text)
    expect(content).toEqual({ id: 'abc' })
    expect(calls).toEqual(['middleware:before', 'handler', 'middleware:after'])
  })

  it('resource template HTTP read dispatches through middleware', async () => {
    const calls: string[] = []
    const app = createApp({ name: 'test-app' })
    app.use(async (_ctx, next) => {
      calls.push('middleware:before')
      const result = await next()
      calls.push('middleware:after')
      return result
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => {
        calls.push('handler')
        return { id }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/products/xyz'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'xyz' })
    expect(calls).toEqual(['middleware:before', 'handler', 'middleware:after'])
  })

  it('auth on resource template is enforced through pipeline checkAuth', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1', roles: ['reader'] }
      },
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
      auth: { roles: ['admin'] },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/products/123', {
      headers: { authorization: 'Bearer token' },
    }))
    expect(res.status).toBe(403)
  })

  it('resource template entries do NOT appear in MCP tools/list', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('real_tool', { description: 'Real tool', handler: () => ({}) })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('real_tool')
  })

  it('static resources dispatch through middleware like resource templates', async () => {
    const calls: string[] = []
    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      calls.push(`middleware:${ctx.meta.toolName}`)
      return next()
    })
    app.resource({
      uri: 'config://settings',
      name: 'settings',
      description: 'App settings',
      handler: () => ({ theme: 'dark' }),
    })

    const client = createMcpTestClient(app)
    const result = await client.readResource('config://settings')
    const content = parseJsonText(result.text)
    expect(content).toEqual({ theme: 'dark' })
    expect(calls).toEqual(['middleware:settings'])
  })

  it('middleware receives synthetic tool name in ctx.meta.toolName', async () => {
    let capturedToolName: string | undefined
    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      capturedToolName = ctx.meta.toolName
      return next()
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const client = createMcpTestClient(app)
    await client.readResource('products://abc')
    expect(capturedToolName).toBe('product')
  })

  it('middleware that throws blocks the resource read', async () => {
    const app = createApp({ name: 'test-app' })
    app.use(async () => {
      throw new Error('Rate limit exceeded')
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const client = createMcpTestClient(app)
    await expect(client.readResource('products://abc')).rejects.toThrow(/Rate limit exceeded/)
  })

  it('middleware that throws blocks the HTTP resource read', async () => {
    const app = createApp({ name: 'test-app' })
    app.use(async () => {
      throw new Error('Rate limit exceeded')
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/products/abc'))
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('Rate limit exceeded')
  })

  it('auth-required resource template works via MCP when valid auth headers are present', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1' }
      },
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
      auth: true,
    })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer token123' } })
    const result = await client.readResource('products://123')
    const content = parseJsonText(result.text)
    expect(content).toEqual({ id: '123' })
  })

  it('auth-required resource template with roles blocks wrong role via MCP', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1', roles: ['viewer'] }
      },
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
      auth: { roles: ['admin'] },
    })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer token' } })
    await expect(client.readResource('products://123')).rejects.toThrow(/Forbidden/)
  })

  it('filtered middleware applies to resource templates via kind', async () => {
    const calls: string[] = []
    const app = createApp({ name: 'test-app' })

    app.use(async (_ctx, next) => {
      calls.push('resource-middleware')
      return next()
    }, { filter: (tool) => tool.kind === 'resource' })

    app.use(async (_ctx, next) => {
      calls.push('tool-middleware')
      return next()
    }, { filter: (tool) => tool.kind === 'tool' })

    app.tool('real_tool', { description: 'Real', handler: () => ({ ok: true }) })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const client = createMcpTestClient(app)

    const result = await client.readResource('products://abc')
    expect(result.text).toBeDefined()
    expect(calls).toEqual(['resource-middleware'])

    calls.length = 0
    const toolResult = await client.callTool('real_tool', {})
    expect(toolResult).toBeDefined()
    expect(calls).toEqual(['tool-middleware'])
  })
})
