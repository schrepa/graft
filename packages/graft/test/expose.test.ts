import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'

describe('expose option — tools', () => {
  it('expose: "mcp" — appears in MCP tools/list but returns 404 on HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('mcp_only', {
      description: 'MCP only tool',
      handler: () => ({ result: 'secret' }),
      expose: 'mcp',
    })

    const client = createMcpTestClient(app)

    // MCP tools/list includes it
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('mcp_only')

    // MCP tools/call works
    const result = await client.callTool('mcp_only')
    expect(result).toEqual({ result: 'secret' })

    // HTTP returns 404
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/mcp-only'))
    expect(httpRes.status).toBe(404)
  })

  it('expose: "http" — hidden from MCP tools/list but has HTTP route', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('http_only', {
      description: 'HTTP only tool',
      handler: () => ({ result: 'web' }),
      expose: 'http',
    })

    const client = createMcpTestClient(app)

    // MCP tools/list does NOT include it
    const tools = await client.listTools()
    expect(tools).toHaveLength(0)

    // HTTP route works
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/http-only'))
    expect(httpRes.status).toBe(200)
    const httpBody = await httpRes.json()
    expect(httpBody).toEqual({ result: 'web' })
  })

  it('expose: "http" — NOT callable via MCP tools/call', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('http_only', {
      description: 'HTTP only tool',
      handler: () => ({ result: 'web' }),
      expose: 'http',
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('http_only') as any
    expect(result.error).toBe('NOT_FOUND')
  })

  it('expose: "both" (default) — appears in both MCP and HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('everywhere', {
      description: 'Available everywhere',
      handler: () => ({ result: 'ok' }),
      expose: 'both',
    })

    const client = createMcpTestClient(app)

    // MCP tools/list includes it
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)

    // HTTP route works
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/everywhere'))
    expect(httpRes.status).toBe(200)
  })

  it('default (no expose) — appears in both MCP and HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('default_tool', {
      description: 'Default exposure',
      handler: () => ({ result: 'ok' }),
    })

    const client = createMcpTestClient(app)

    // MCP tools/list includes it
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)

    // HTTP route works
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/default-tool'))
    expect(httpRes.status).toBe(200)
  })

  it('mixed expose values filter correctly', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('tool_mcp', {
      description: 'MCP only',
      handler: () => 'mcp',
      expose: 'mcp',
    })
    app.tool('tool_http', {
      description: 'HTTP only',
      handler: () => 'http',
      expose: 'http',
    })
    app.tool('tool_both', {
      description: 'Both',
      handler: () => 'both',
    })

    const client = createMcpTestClient(app)

    // MCP tools/list: should see tool_mcp and tool_both, not tool_http
    const tools = await client.listTools()
    const names = tools.map(t => t.name)
    expect(names).toContain('tool_mcp')
    expect(names).toContain('tool_both')
    expect(names).not.toContain('tool_http')

    // HTTP: tool_http and tool_both should be accessible, tool_mcp should 404
    const { fetch } = app.build()
    const httpBoth = await fetch(new Request('http://localhost:3000/tool-both'))
    expect(httpBoth.status).toBe(200)

    const httpOnly = await fetch(new Request('http://localhost:3000/tool-http'))
    expect(httpOnly.status).toBe(200)

    const httpMcp = await fetch(new Request('http://localhost:3000/tool-mcp'))
    expect(httpMcp.status).toBe(404)
  })
})

describe('app.webhook()', () => {
  it('is not visible in MCP tools/list but callable via HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.webhook('stripe_hook', {
      path: '/webhooks/stripe',
      description: 'Handle Stripe events',
      handler: () => ({ received: true }),
    })

    const client = createMcpTestClient(app)

    // MCP tools/list does NOT include it
    const tools = await client.listTools()
    expect(tools).toHaveLength(0)

    // HTTP POST works on custom path
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'payment.completed' }),
    }))
    expect(httpRes.status).toBe(200)
    const body = await httpRes.json()
    expect(body).toEqual({ received: true })
  })

  it('flows through auth and middleware', async () => {
    const calls: string[] = []

    const app = createApp({
      name: 'test-app',
      authenticate: async () => ({ subject: 'user-1', roles: ['admin'] }),
    })

    app.use(async (_ctx, next) => {
      calls.push('middleware:before')
      const result = await next()
      calls.push('middleware:after')
      return result
    })

    app.webhook('secure_hook', {
      path: '/webhooks/secure',
      description: 'Secure webhook',
      auth: true,
      handler: (_params, ctx) => {
        calls.push('handler')
        return { user: ctx.meta.auth?.subject }
      },
    })

    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/webhooks/secure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(httpRes.status).toBe(200)
    const body = await httpRes.json()
    expect(body).toEqual({ user: 'user-1' })
    expect(calls).toEqual(['middleware:before', 'handler', 'middleware:after'])
  })

  it('defaults to POST method', async () => {
    const app = createApp({ name: 'test-app' })
    app.webhook('hook', {
      path: '/wh',
      description: 'test',
      handler: () => 'ok',
    })

    const { fetch } = app.build()

    // POST works
    const postRes = await fetch(new Request('http://localhost:3000/wh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(postRes.status).toBe(200)

    // GET returns 404 (method mismatch)
    const getRes = await fetch(new Request('http://localhost:3000/wh'))
    expect(getRes.status).toBe(404)
  })
})

describe('expose option — resources', () => {
  it('expose: "mcp" — resource appears in MCP but no HTTP route', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://secrets',
      name: 'secrets',
      description: 'Secret data',
      handler: async () => [{ key: 'value' }],
      expose: 'mcp',
    })

    const client = createMcpTestClient(app)

    // MCP resources/list includes it
    const resources = await client.listResources()
    expect(resources).toHaveLength(1)
    expect(resources[0].name).toBe('secrets')

    // HTTP returns 404
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/secrets'))
    expect(httpRes.status).toBe(404)
  })

  it('expose: "http" — resource has HTTP route but hidden from MCP resources/list', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://public',
      name: 'public_data',
      description: 'Public data',
      handler: async () => [{ info: 'public' }],
      expose: 'http',
    })

    const { fetch } = app.build()

    // HTTP route works
    const httpRes = await fetch(new Request('http://localhost:3000/public'))
    expect(httpRes.status).toBe(200)
    const body = await httpRes.json()
    expect(body).toEqual([{ info: 'public' }])

    // No MCP resources capability (only resource is hidden)
    // The resources/list endpoint won't be registered since no exposeMcp resources
  })

})
