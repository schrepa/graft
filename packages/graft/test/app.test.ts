import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { AuthError } from '../src/errors.js'
import { createMcpTestClient } from '../src/testing.js'
import { bodyOf, statusOf } from './dispatch-outcome.js'
import { parseJsonText } from './helpers/common.js'

describe('createApp', () => {
  it('builds mcp adapter and fetch handler', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })

    const { mcp, fetch } = app.build()
    expect(mcp).toBeDefined()
    expect(fetch).toBeInstanceOf(Function)
    expect(mcp.getManifest().tools.length).toBe(1)
    expect(mcp.getManifest().tools.find(t => t.name === 'greet')).toBeDefined()
  })

  it('registers tool with inputSchema (JSON Schema path)', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('raw_tool', {
      description: 'Raw JSON Schema tool',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
      },
      handler: (params) => {
        // params is Record<string, unknown> for inputSchema tools
        return { echo: params.q }
      },
    })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.length).toBe(1)
    const tool = mcp.getManifest().tools.find(t => t.name === 'raw_tool')!
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { q: { type: 'string' } },
    })
  })

  it('registers tool with no schema', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('no_schema_tool', {
      description: 'No schema tool',
      handler: (params) => {
        return { keys: Object.keys(params) }
      },
    })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.length).toBe(1)
  })

  it('caches build result', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => 'hi',
    })

    const first = app.build()
    const second = app.build()
    expect(first).toBe(second)
  })

  it('empty app returns empty lists', async () => {
    const app = createApp({ name: 'test-app' })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(0)

    expect(app.routes()).toHaveLength(0)
  })

  it('routes() does not freeze later tool registration', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('first', {
      description: 'First tool',
      handler: () => 'ok',
    })

    expect(app.routes()).toHaveLength(1)

    expect(() => {
      app.tool('second', {
        description: 'Second tool',
        handler: () => 'ok',
      })
    }).not.toThrow()

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.map((tool) => tool.name)).toEqual(['first', 'second'])
  })
})

describe('route semantics — http overrides at definition time', () => {
  it('tool with http override has correct method/path in registry', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('update_item', {
      description: 'Update an item',
      sideEffects: true,
      handler: () => ({ done: true }),
      http: { method: 'PUT', path: '/api/items' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'update_item')!
    expect(tool.method).toBe('PUT')
    expect(tool.path).toBe('/api/items')
  })

  it('PUT tool routes correctly via HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('update_item', {
      description: 'Update an item',
      sideEffects: true,
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ updated: name }),
      http: { method: 'PUT', path: '/api/items' },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/api/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ updated: 'Widget' })
  })

  it('DELETE tool has sideEffects true in definition', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('delete_item', {
      description: 'Delete an item',
      sideEffects: true,
      handler: () => ({ deleted: true }),
      http: { method: 'DELETE', path: '/api/items/:id' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'delete_item')!
    expect(tool.method).toBe('DELETE')
    expect(tool.path).toBe('/api/items/:id')
    expect(tool.sideEffects).toBe(true)
  })
})

describe('tool HTTP routes', () => {
  it('auto-generates GET route for read-only tool', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('search_items', {
      description: 'Search items',
      params: z.object({ q: z.string() }),
      handler: ({ q }) => [{ name: q }],
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/search-items?q=hello'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ name: 'hello' }])
  })

  it('auto-generates POST route for side-effect tool', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create item',
      sideEffects: true,
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ id: '1', name }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: '1', name: 'Widget' })
  })

  it('skips HTTP route when expose: mcp', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('internal_tool', {
      description: 'MCP only',
      handler: () => 'secret',
      expose: 'mcp',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/internal-tool'))
    expect(res.status).toBe(404)
  })

  it('allows custom http path and method', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('search_items', {
      description: 'Search items',
      handler: () => [],
      http: { path: '/api/items', method: 'GET' },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/api/items'))
    expect(res.status).toBe(200)
  })
})

describe('tool MCP access', () => {
  it('lists tools via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('greet')
  })

  it('calls a tool via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('greet', { name: 'World' })
    expect((result as any).message).toBe('Hello, World!')
  })

  it('MCP-only tool is callable via MCP but not HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('internal_op', {
      description: 'Internal operation',
      handler: () => ({ done: true }),
      expose: 'mcp',
    })

    // MCP works
    const client = createMcpTestClient(app)
    const result = await client.callTool('internal_op', {})
    expect((result as any).done).toBe(true)

    // HTTP 404
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/internal-op'))
    expect(httpRes.status).toBe(404)
  })
})

describe('explicit routes', () => {
  it('serves explicit HTTP routes', async () => {
    const app = createApp({ name: 'test-app' })
    app.route('GET', '/custom-route', () => ({ status: 'ok' }))

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/custom-route'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })

  it('returns 404 for unknown routes', async () => {
    const app = createApp({ name: 'test-app' })
    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/unknown'))
    expect(res.status).toBe(404)
  })

  it('returns 204 when an explicit route returns undefined', async () => {
    const app = createApp({ name: 'test-app' })
    app.route('POST', '/webhook', async () => {})

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/webhook', { method: 'POST' }))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })
})

describe('agent.json discovery', () => {
  it('serves agent.json at well-known path', async () => {
    const app = createApp({ name: 'my-app' })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => 'hi',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.name).toBe('my-app')
    expect(body.capabilities.mcp.url).toBe('http://localhost:3000/mcp')
    expect(body.tools).toHaveLength(1)
  })
})

describe('resources', () => {
  it('registers resources and serves via HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://status',
      name: 'current_status',
      description: 'Current status',
      handler: async () => [{ name: 'Alpha', value: 42 }],
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/status'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ name: 'Alpha', value: 42 }])
  })

  it('lists resources via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://status',
      name: 'current_status',
      description: 'Current status',
      handler: async () => [{ name: 'Alpha' }],
    })

    const client = createMcpTestClient(app)
    const resources = await client.listResources()
    expect(resources).toHaveLength(1)
    expect(resources[0].uri).toBe('data://status')
    expect(resources[0].name).toBe('current_status')
  })

  it('reads a resource via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://status',
      name: 'current_status',
      description: 'Current status',
      handler: async () => [{ name: 'Alpha', value: 42 }],
    })

    const client = createMcpTestClient(app)
    const result = await client.readResource('data://status')
    const content = parseJsonText(result.text)
    expect(content).toEqual([{ name: 'Alpha', value: 42 }])
  })

  it('passes MCP headers and signal to static resource handlers', async () => {
    const app = createApp({ name: 'test-app' })
    const controller = new AbortController()
    let seenHeaders: Record<string, string> | undefined
    let seenSignal: AbortSignal | undefined

    app.resource({
      uri: 'data://status',
      name: 'current_status',
      description: 'Current status',
      handler: ({ headers, signal }) => {
        seenHeaders = headers
        seenSignal = signal
        return [{ name: 'Alpha', value: 42 }]
      },
    })

    const { mcp } = app.build()
    const response = await mcp.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'data://status' },
      }),
      signal: controller.signal,
    }))

    expect(response.status).toBe(200)
    expect(seenHeaders?.authorization).toBe('Bearer test-token')
    expect(seenSignal).toBeInstanceOf(AbortSignal)
    expect(seenSignal?.aborted).toBe(false)
    controller.abort()
    expect(seenSignal?.aborted).toBe(true)
  })

  it('skips HTTP route when expose: mcp', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://status',
      name: 'current_status',
      description: 'Current status',
      handler: async () => [{ name: 'Alpha' }],
      expose: 'mcp',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/status'))
    expect(res.status).toBe(404)
  })
})

describe('prompts', () => {
  it('lists prompts via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'recommend',
      description: 'Generate recommendations',
      params: z.object({
        preferences: z.string(),
        budget: z.number(),
      }),
      handler: ({ preferences, budget }) => [
        { role: 'user' as const, content: `Generate recommendations for ${preferences} with $${budget} budget` },
      ],
    })

    const client = createMcpTestClient(app)
    const prompts = await client.listPrompts()
    expect(prompts).toHaveLength(1)
    expect(prompts[0].name).toBe('recommend')
  })

  it('gets a prompt via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'recommend',
      description: 'Generate recommendations',
      params: z.object({
        preferences: z.string(),
        budget: z.string(),  // MCP prompt arguments are always strings
      }),
      handler: ({ preferences, budget }) => [
        { role: 'user' as const, content: `Generate recommendations for ${preferences} with $${budget} budget` },
      ],
    })

    const client = createMcpTestClient(app)
    const result = await client.getPrompt('recommend', { preferences: 'vegan', budget: '30' })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('user')
    expect((result.messages[0].content as any).text).toContain('vegan')
    expect((result.messages[0].content as any).text).toContain('30')
  })

  it('passes MCP signal to prompt handlers', async () => {
    const app = createApp({ name: 'test-app' })
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined

    app.prompt({
      name: 'recommend',
      description: 'Generate recommendations',
      params: z.object({
        preferences: z.string(),
      }),
      handler: ({ preferences }, ctx) => {
        seenSignal = ctx.signal
        return [{ role: 'user' as const, content: `Generate recommendations for ${preferences}` }]
      },
    })

    const { mcp } = app.build()
    const response = await mcp.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: {
          name: 'recommend',
          arguments: { preferences: 'vegan' },
        },
      }),
      signal: controller.signal,
    }))

    expect(response.status).toBe(200)
    expect(seenSignal).toBeInstanceOf(AbortSignal)
    expect(seenSignal?.aborted).toBe(false)
    controller.abort()
    expect(seenSignal?.aborted).toBe(true)
  })

  it('returns InvalidParams (not InternalError) for invalid prompt args', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'typed_prompt',
      description: 'Prompt with required params',
      params: z.object({
        name: z.string(),
        count: z.number(),
      }),
      handler: ({ name, count }) => [
        { role: 'user' as const, content: `${name} x${count}` },
      ],
    })

    const { mcp } = app.build()

    const MCP_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' }

    // Initialize
    await mcp.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
      }),
    }))

    // Send invalid args (missing required fields)
    const res = await mcp.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'prompts/get',
        params: { name: 'typed_prompt', arguments: {} },
      }),
    }))

    const body = await res.json() as any
    // Should be InvalidParams (-32602), not InternalError (-32603)
    expect(body.error.code).toBe(-32602)
  })
})

describe('resource templates', () => {
  it('registers resource template and reads via MCP resources/read', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product by ID',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id, name: `Product ${id}` }),
    })

    const client = createMcpTestClient(app)
    const result = await client.readResource('products://123')
    const content = parseJsonText(result.text)
    expect(content).toEqual({ id: '123', name: 'Product 123' })
  })

  it('lists resource templates via MCP resources/templates/list', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product by ID',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const client = createMcpTestClient(app)
    const templates = await client.listResourceTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0].uriTemplate).toBe('products://{id}')
    expect(templates[0].name).toBe('product')
  })

  it('serves resource template via HTTP GET', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product by ID',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id, name: `Product ${id}` }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/products/abc'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'abc', name: 'Product abc' })
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('extracts multi-segment params via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'orders://{userId}/{orderId}',
      name: 'order',
      description: 'Get an order',
      params: z.object({ userId: z.string(), orderId: z.string() }),
      handler: ({ userId, orderId }) => ({ userId, orderId }),
    })

    const client = createMcpTestClient(app)
    const result = await client.readResource('orders://user1/order42')
    const content = parseJsonText(result.text)
    expect(content).toEqual({ userId: 'user1', orderId: 'order42' })
  })

  it('expose: mcp hides from HTTP', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
      expose: 'mcp',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/products/123'))
    expect(res.status).toBe(404)
  })

  it('expose: http hides from MCP templates/list', async () => {
    const app = createApp({ name: 'test-app' })
    // Need at least one MCP-exposed resource for the resources capability
    app.resource({
      uri: 'config://settings',
      name: 'settings',
      description: 'App settings',
      handler: () => ({}),
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
      expose: 'http',
    })

    const client = createMcpTestClient(app)
    const templates = await client.listResourceTemplates()
    expect(templates).toHaveLength(0)

    // But HTTP works
    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/products/123'))
    expect(httpRes.status).toBe(200)
  })

  it('auth: true returns 401 when unauthenticated via HTTP', async () => {
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

    const { fetch } = app.build()

    // No auth header → 401
    const res = await fetch(new Request('http://localhost:3000/products/123'))
    expect(res.status).toBe(401)

    // With auth header → 200
    const res2 = await fetch(new Request('http://localhost:3000/products/123', {
      headers: { authorization: 'Bearer token123' },
    }))
    expect(res2.status).toBe(200)
    const body = await res2.json()
    expect(body).toEqual({ id: '123' })
  })

  it('auth: true returns error when unauthenticated via MCP', async () => {
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

    // MCP read without auth headers → error
    const client = createMcpTestClient(app)
    await expect(client.readResource('products://123')).rejects.toThrow(/MCP error/)
  })

  it('throws at build() if auth set but no authenticate hook', () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      handler: () => ({}),
      auth: true,
    })

    expect(() => app.build()).toThrow('requires auth but no authenticate hook')
  })

  it('Zod validation failure returns clean error via MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string().min(5) }), // requires min 5 chars
      handler: ({ id }) => ({ id }),
    })

    // "ab" is only 2 chars, fails min(5) validation
    const client = createMcpTestClient(app)
    await expect(client.readResource('products://ab')).rejects.toThrow(/Validation error/)
  })

  it('reads resource templates through MCP when only templates are registered', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'items://{id}',
      name: 'item',
      description: 'Get item',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    // MCP resources/read should work
    const client = createMcpTestClient(app)
    const result = await client.readResource('items://xyz')
    const content = parseJsonText(result.text)
    expect(content).toEqual({ id: 'xyz' })
  })

  it('custom http path override', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
      http: { path: '/api/products/:id' },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/api/products/456'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: '456' })
  })

  it('supports chaining', () => {
    const app = createApp({ name: 'test-app' })
      .resourceTemplate({
        uriTemplate: 'a://{id}',
        name: 'a',
        description: 'A',
        handler: () => ({}),
      })
      .resourceTemplate({
        uriTemplate: 'b://{id}',
        name: 'b',
        description: 'B',
        handler: () => ({}),
      })

    const { mcp } = app.build()
    expect(mcp.getManifest().resourceTemplates).toHaveLength(2)
  })

  it('throws when adding resource template after build()', () => {
    const app = createApp({ name: 'test-app' })
    app.build()

    expect(() => {
      app.resourceTemplate({
        uriTemplate: 'x://{id}',
        name: 'x',
        description: 'X',
        handler: () => ({}),
      })
    }).toThrow('Cannot modify app after build()')
  })

  it('static resources still work alongside templates', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'config://settings',
      name: 'settings',
      description: 'App settings',
      handler: () => ({ theme: 'dark' }),
    })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    const client = createMcpTestClient(app)

    // Static resource works
    const staticResult = await client.readResource('config://settings')
    const staticContent = parseJsonText(staticResult.text)
    expect(staticContent).toEqual({ theme: 'dark' })

    // Template resource works
    const templateResult = await client.readResource('products://abc')
    const templateContent = parseJsonText(templateResult.text)
    expect(templateContent).toEqual({ id: 'abc' })
  })
})

describe('Zod generics — .default(), .optional(), .transform()', () => {
  it('applies z.number().default() values when query params are omitted', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('paginated', {
      description: 'Paginated search',
      params: z.object({ page: z.number().default(1) }),
      handler: (p) => ({ page: p.page }),
    })

    const { fetch } = app.build()
    // No page param → default kicks in
    const res = await fetch(new Request('http://localhost:3000/paginated'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.page).toBe(1)
  })

  it('accepts omitted optional string params', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('search', {
      description: 'Search',
      params: z.object({ q: z.string().optional() }),
      handler: (p) => ({ q: p.q ?? 'none' }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/search'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.q).toBe('none')
  })

  it('applies z.string().transform() before invoking the handler', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('upper', {
      description: 'Uppercase',
      params: z.object({ text: z.string().transform(s => s.toUpperCase()) }),
      handler: (p) => ({ text: p.text }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/upper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    }))
    // This is a GET route (no sideEffects), so we need to test via MCP or POST won't match
    // Actually let's just test via GET with query params
    const res2 = await fetch(new Request('http://localhost:3000/upper?text=hello'))
    expect(res2.status).toBe(200)
    const body = await res2.json() as any
    expect(body.text).toBe('HELLO')
  })
})

describe('sideEffects auto-inference from HTTP method', () => {
  it('infers sideEffects: true for PATCH method', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('update_item', {
      description: 'Update',
      handler: () => ({}),
      http: { method: 'PATCH', path: '/items/:id' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'update_item')!
    expect(tool.sideEffects).toBe(true)
  })

  it('infers sideEffects: true for POST method', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      handler: () => ({}),
      http: { method: 'POST', path: '/items' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'create_item')!
    expect(tool.sideEffects).toBe(true)
  })

  it('infers sideEffects: true for DELETE method', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('delete_item', {
      description: 'Delete',
      handler: () => ({}),
      http: { method: 'DELETE', path: '/items/:id' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'delete_item')!
    expect(tool.sideEffects).toBe(true)
  })

  it('keeps sideEffects: false for GET method', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_item', {
      description: 'Get',
      handler: () => ({}),
      http: { method: 'GET', path: '/items/:id' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'get_item')!
    expect(tool.sideEffects).toBe(false)
  })

  it('explicit sideEffects: false overrides method inference', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('safe_post', {
      description: 'Safe POST',
      sideEffects: false,
      handler: () => ({}),
      http: { method: 'POST', path: '/query' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'safe_post')!
    expect(tool.sideEffects).toBe(false)
  })

  it('explicit sideEffects: true overrides GET', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('mutating_get', {
      description: 'Mutating GET',
      sideEffects: true,
      handler: () => ({}),
      http: { method: 'GET', path: '/trigger' },
    })

    const { mcp } = app.build()
    const tool = mcp.getManifest().tools.find(t => t.name === 'mutating_get')!
    expect(tool.sideEffects).toBe(true)
  })
})

describe('path parameter routes', () => {
  it('extracts path params on GET', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_vendor', {
      description: 'Get vendor by slug',
      params: z.object({ slug: z.string() }),
      http: { path: '/vendors/:slug' },
      handler: ({ slug }) => ({ slug }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/vendors/farm-fresh'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.slug).toBe('farm-fresh')
  })

  it('extracts multiple path params', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_vendor_item', {
      description: 'Get vendor item',
      params: z.object({ vendor: z.string(), item: z.string() }),
      http: { path: '/vendors/:vendor/items/:item' },
      handler: ({ vendor, item }) => ({ vendor, item }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/vendors/acme/items/widget'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.vendor).toBe('acme')
    expect(body.item).toBe('widget')
  })

  it('exact routes take priority over parameterized routes', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_vendor', {
      description: 'Get vendor by slug',
      params: z.object({ slug: z.string() }),
      http: { path: '/vendors/:slug' },
      handler: ({ slug }) => ({ slug }),
    })
    app.tool('list_vendors', {
      description: 'List all vendors',
      http: { path: '/vendors' },
      handler: () => ({ list: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/vendors'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.list).toBe(true)
  })

  it('path params work with POST method', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('update_vendor', {
      description: 'Update vendor',
      params: z.object({ slug: z.string(), name: z.string() }),
      http: { method: 'PUT', path: '/vendors/:slug' },
      handler: ({ slug, name }) => ({ slug, name }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/vendors/acme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ACME Corp' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.slug).toBe('acme')
    expect(body.name).toBe('ACME Corp')
  })

  it('returns 404 for non-matching parameterized routes', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_vendor', {
      description: 'Get vendor by slug',
      params: z.object({ slug: z.string() }),
      http: { path: '/vendors/:slug' },
      handler: ({ slug }) => ({ slug }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/products/something'))
    expect(res.status).toBe(404)
  })

  it('coerces path param :id to number via JSON Schema integer type (GET)', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_item', {
      description: 'Get item by ID',
      inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      http: { path: '/items/:id' },
      handler: (params) => ({ id: params.id, type: typeof params.id }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/items/42'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(42)
    expect(body.type).toBe('number')
  })

  it('coerces path param :id to number via JSON Schema integer type (POST)', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('update_item', {
      description: 'Update item by ID',
      inputSchema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id'] },
      http: { method: 'PUT', path: '/items/:id' },
      handler: (params) => ({ id: params.id, name: params.name, idType: typeof params.id }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/items/42', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(42)
    expect(body.idType).toBe('number')
    expect(body.name).toBe('Widget')
  })
})

describe('CORS', () => {
  it('handles OPTIONS preflight', async () => {
    const app = createApp({ name: 'test-app', cors: { origin: '*' } })
    const { fetch } = app.build()

    const res = await fetch(new Request('http://localhost:3000/anything', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('chaining', () => {
  it('supports fluent chaining', () => {
    const app = createApp({ name: 'test-app' })
      .tool('a', { description: 'A', handler: () => 1 })
      .tool('b', { description: 'B', handler: () => 2 })
      .resource({ uri: 'x://y', name: 'r', description: 'R', handler: () => 3 })
      .prompt({ name: 'p', description: 'P', handler: () => [{ role: 'user' as const, content: 'hi' }] })
      .route('GET', '/custom-chain', () => 'ok')

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.length).toBe(2)
  })
})

describe('error handling', () => {
  it('returns 500 when tool handler throws', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('failing_tool', {
      description: 'Always fails',
      handler: () => { throw new Error('Something broke') },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/failing-tool'))
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('Something broke')
  })

  it('returns 400 for POST with invalid JSON body', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create item',
      sideEffects: true,
      handler: (params: any) => params,
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 400 for Zod validation failure on GET', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('search', {
      description: 'Search',
      params: z.object({ q: z.string().min(1) }),
      handler: ({ q }) => [q],
    })

    const { fetch } = app.build()
    // Missing required param
    const res = await fetch(new Request('http://localhost:3000/search'))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Validation error')
    expect(body.details).toBeDefined()
  })

  it('returns 500 when resource handler throws', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://broken',
      name: 'broken_resource',
      description: 'Always fails',
      handler: () => { throw new Error('DB connection lost') },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/broken'))
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('DB connection lost')
  })

  it('returns 500 when explicit route handler throws', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const app = createApp({ name: 'test-app', logger })
    app.route('GET', '/boom', () => { throw new Error('Kaboom') })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/boom'))
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('Internal server error')
    expect(logger.error).toHaveBeenCalledWith('[graft] Unhandled route error:', expect.any(Error))
  })
})

describe('immutability after build', () => {
  it('throws when adding tool after build()', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('a', { description: 'A', handler: () => 1 })
    app.build()

    expect(() => {
      app.tool('b', { description: 'B', handler: () => 2 })
    }).toThrow('Cannot modify app after build()')
  })

  it('throws when adding resource after build()', () => {
    const app = createApp({ name: 'test-app' })
    app.build()

    expect(() => {
      app.resource({ uri: 'x://y', name: 'r', description: 'R', handler: () => 1 })
    }).toThrow('Cannot modify app after build()')
  })

  it('throws when adding prompt after build()', () => {
    const app = createApp({ name: 'test-app' })
    app.build()

    expect(() => {
      app.prompt({ name: 'p', description: 'P', handler: () => [{ role: 'user' as const, content: 'hi' }] })
    }).toThrow('Cannot modify app after build()')
  })

  it('throws when adding route after build()', () => {
    const app = createApp({ name: 'test-app' })
    app.build()

    expect(() => {
      app.route('GET', '/health', () => 'ok')
    }).toThrow('Cannot modify app after build()')
  })
})

describe('CORS on responses', () => {
  it('includes CORS headers on GET responses', async () => {
    const app = createApp({ name: 'test-app', cors: { origin: '*' } })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => ({ message: 'hi' }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/greet'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('includes CORS headers on 404 responses', async () => {
    const app = createApp({ name: 'test-app', cors: { origin: '*' } })
    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/nonexistent'))
    expect(res.status).toBe(404)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to explicit route returning new Response()', async () => {
    const app = createApp({ name: 'test-app', cors: { origin: '*' } })
    app.route('GET', '/custom', () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/custom'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('content-type')).toBe('application/json')
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})

describe('trailing slash normalization', () => {
  it('matches route with trailing slash', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('list_items', {
      description: 'List items',
      handler: () => ({ results: [] }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/list-items/'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ results: [] })
  })

  it('still matches route without trailing slash', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('list_items', {
      description: 'List items',
      handler: () => ({ results: [] }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/list-items'))
    expect(res.status).toBe(200)
  })

  it('does not strip slash from root path', async () => {
    const app = createApp({ name: 'test-app' })
    app.route('GET', '/', () => ({ status: 'ok' }))

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })
})

describe('app.dispatch()', () => {
  it('dispatches a tool call', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('add', {
      description: 'Add',
      params: z.object({ a: z.number(), b: z.number() }),
      handler: ({ a, b }) => ({ sum: a + b }),
    })

    const result = await app.dispatch('add', { a: 2, b: 3 })
    expect(statusOf(result)).toBe(200)
    expect(bodyOf(result)).toEqual({ sum: 5 })
  })

  it('dispatch returns validation error', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('add', {
      description: 'Add',
      params: z.object({ a: z.number(), b: z.number() }),
      handler: ({ a, b }) => ({ sum: a + b }),
    })

    const result = await app.dispatch('add', { a: 'not a number' as any })
    expect(statusOf(result)).toBe(400)
  })

  it('dispatch returns 404 for unknown tool', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('add', {
      description: 'Add',
      handler: () => ({}),
    })

    const result = await app.dispatch('nonexistent', {})
    expect(statusOf(result)).toBe(404)
  })
})

describe('app.tools() batch registration', () => {
  it('registers multiple tools via app.tools()', async () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      list_vendors: {
        description: 'List vendors',
        handler: () => [{ name: 'Acme' }],
      },
      create_vendor: {
        description: 'Create vendor',
        sideEffects: true,
        params: z.object({ name: z.string() }),
        handler: (params: unknown) => {
          const { name } = params as { name: string }
          return { id: '1', name }
        },
      },
    })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.length).toBe(2)
    expect(mcp.getManifest().tools.find(t => t.name === 'list_vendors')).toBeDefined()
    expect(mcp.getManifest().tools.find(t => t.name === 'create_vendor')).toBeDefined()

    // Verify MCP tools/list
    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(2)
  })

  it('batch registration with shared options', () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      getOverview: { description: 'System overview', handler: () => ['summary'] },
      getHours: { description: 'Opening hours', handler: () => '9-5' },
    }, { tags: ['info'] })

    expect(app.routes()).toHaveLength(2)
  })

  it('applies shared tags to all tools in batch', async () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      list_vendors: {
        description: 'List vendors',
        handler: () => [],
      },
      get_vendor: {
        description: 'Get vendor',
        handler: () => ({}),
      },
    }, { tags: ['vendors'] })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.find(t => t.name === 'list_vendors')!.tags).toEqual(['vendors'])
    expect(mcp.getManifest().tools.find(t => t.name === 'get_vendor')!.tags).toEqual(['vendors'])
  })

  it('tool-level config overrides shared config', () => {
    const app = createApp({
      name: 'test-app',
      authenticate: () => ({ subject: 'user' }),
    })
    app.tools({
      viewer_tool: {
        description: 'Viewer override',
        auth: { roles: ['viewer'] },
        handler: () => ({}),
      },
      shared_auth_tool: {
        description: 'Uses shared auth',
        handler: () => ({}),
      },
    }, { auth: { roles: ['admin'] } })

    const { mcp } = app.build()
    // Tool-level auth overrides shared
    expect(mcp.getManifest().tools.find(t => t.name === 'viewer_tool')!.auth).toEqual({ roles: ['viewer'] })
    // Tool without auth gets shared auth
    expect(mcp.getManifest().tools.find(t => t.name === 'shared_auth_tool')!.auth).toEqual({ roles: ['admin'] })
  })

  it('tool-level tags override shared tags', () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      with_own_tags: {
        description: 'Has own tags',
        tags: ['custom'],
        handler: () => ({}),
      },
      inherits_tags: {
        description: 'Inherits shared tags',
        handler: () => ({}),
      },
    }, { tags: ['vendors'] })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.find(t => t.name === 'with_own_tags')!.tags).toEqual(['custom'])
    expect(mcp.getManifest().tools.find(t => t.name === 'inherits_tags')!.tags).toEqual(['vendors'])
  })

  it('shared sideEffects propagates to tools without explicit sideEffects', () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      batch_tool: {
        description: 'Inherits sideEffects',
        handler: () => ({}),
      },
      override_tool: {
        description: 'Overrides sideEffects',
        sideEffects: false,
        handler: () => ({}),
      },
    }, { sideEffects: true })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.find(t => t.name === 'batch_tool')!.sideEffects).toBe(true)
    expect(mcp.getManifest().tools.find(t => t.name === 'override_tool')!.sideEffects).toBe(false)
  })

  it('applies shared path prefix when tool has no explicit path', async () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      list_vendors: {
        description: 'List vendors',
        handler: () => [{ name: 'Acme' }],
      },
    }, { http: { pathPrefix: '/api/v1' } })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/api/v1/list-vendors'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ name: 'Acme' }])
  })

  it('explicit path wins over shared prefix', async () => {
    const app = createApp({ name: 'test-app' })
    app.tools({
      list_vendors: {
        description: 'List vendors',
        handler: () => [{ name: 'Custom' }],
        http: { path: '/custom' },
      },
    }, { http: { pathPrefix: '/api/v1' } })

    const { fetch } = app.build()
    // Custom path works
    const res = await fetch(new Request('http://localhost:3000/custom'))
    expect(res.status).toBe(200)
    // Prefixed path does NOT work
    const res2 = await fetch(new Request('http://localhost:3000/api/v1/list-vendors'))
    expect(res2.status).toBe(404)
  })

  it('returns this for chaining', () => {
    const app = createApp({ name: 'test-app' })
    const result = app.tools({
      a: { description: 'A', handler: () => 1 },
    })
    expect(result).toBe(app)
  })
})

describe('auth error responses', () => {
  it('returns HTTP 401 (not 404) for auth-required tool without credentials', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1' }
      },
    })
    app.tool('secret_action', {
      description: 'Requires auth',
      auth: true,
      sideEffects: true,
      params: z.object({ data: z.string() }),
      handler: ({ data }) => ({ data }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/secret-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    }))
    expect(res.status).toBe(401)
  })

  it('returns HTTP 403 for insufficient roles', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1', roles: ['reader'] }
      },
    })
    app.tool('admin_action', {
      description: 'Admin only',
      auth: { roles: ['admin'] },
      handler: () => ({ done: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/admin-action', {
      headers: { authorization: 'Bearer token' },
    }))
    expect(res.status).toBe(403)
  })

  it('resource 404 includes NOT_FOUND in MCP error message', async () => {
    const app = createApp({ name: 'test-app' })
    app.resourceTemplate({
      uriTemplate: 'products://{id}',
      name: 'product',
      description: 'Get a product',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id }),
    })

    // Request a URI that doesn't match any template
    const client = createMcpTestClient(app)
    await expect(client.readResource('unknown://999')).rejects.toThrow(/Unknown resource/)
  })

  it('resource 401 includes UNAUTHORIZED in MCP error message', async () => {
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

    const client = createMcpTestClient(app)
    await expect(client.readResource('products://123')).rejects.toThrow(/No auth/)
  })

  it('returns MCP error with UNAUTHORIZED for auth-required tool without credentials', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1' }
      },
    })
    app.tool('secret_tool', {
      description: 'Requires auth',
      auth: true,
      handler: () => ({ done: true }),
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('secret_tool', {}) as any
    expect(result.error).toBe('UNAUTHORIZED')
  })
})

describe('per-role tools/list filtering', () => {
  function createRoleApp() {
    return createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        // Decode role from token: "Bearer admin" → roles: ['admin']
        const role = auth.replace('Bearer ', '')
        return { subject: 'user1', roles: [role] }
      },
    })
  }

  it('unauthenticated caller sees only public tools when authenticate is configured', async () => {
    const app = createRoleApp()
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })
    app.tool('admin_tool', { description: 'Admin', auth: ['admin'], handler: () => ({}) })

    // No auth headers → only see public tools (auth-required tools hidden)
    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('public_tool')
  })

  it('admin caller sees all tools', async () => {
    const app = createRoleApp()
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })
    app.tool('admin_tool', { description: 'Admin', auth: ['admin'], handler: () => ({}) })
    app.tool('auditor_tool', { description: 'Auditor', auth: ['auditor'], handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin' } })
    const tools = await client.listTools()
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('public_tool')
    expect(names).toContain('admin_tool')
    expect(names).not.toContain('auditor_tool')
  })

  it('auditor caller sees only public + auditor-accessible tools', async () => {
    const app = createRoleApp()
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })
    app.tool('admin_tool', { description: 'Admin', auth: ['admin'], handler: () => ({}) })
    app.tool('auditor_tool', { description: 'Auditor', auth: ['auditor'], handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer auditor' } })
    const tools = await client.listTools()
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('public_tool')
    expect(names).toContain('auditor_tool')
    expect(names).not.toContain('admin_tool')
  })

  it('tool with auth: true (no roles) is visible to any authenticated caller', async () => {
    const app = createRoleApp()
    app.tool('authed_tool', { description: 'Needs auth', auth: true, handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer reader' } })
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('authed_tool')
  })

  it('auth failure on tools/list → shows only public tools', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: () => {
        throw new AuthError('Token expired')
      },
    })
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })
    app.tool('admin_tool', { description: 'Admin', auth: ['admin'], handler: () => ({}) })

    // Send auth header that will cause authenticate to throw
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer expired-token' } })
    const tools = await client.listTools()
    // Auth failed — only public tools shown (auth-required tools hidden)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('public_tool')
  })

  it('no authenticate hook → all tools shown (backward-compatible)', async () => {
    const app = createApp({ name: 'test-app' })  // no authenticate
    app.tool('tool_a', { description: 'A', handler: () => ({}) })
    app.tool('tool_b', { description: 'B', handler: () => ({}) })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(2)
  })
})

// =========================================================================
// ctx.meta.tool — tool metadata exposed to middleware at runtime
// =========================================================================

describe('ctx.meta.tool in middleware', () => {
  it('middleware reads ctx.meta.tool.auth (declarative role config)', async () => {
    let capturedAuth: unknown
    const app = createApp({
      name: 'test-app',
      authenticate: () => ({ subject: 'user1', roles: ['admin'] }),
    })
    app.use(async (ctx, next) => {
      capturedAuth = ctx.meta.tool?.auth
      return next()
    })
    app.tool('admin_action', {
      description: 'Admin action',
      auth: ['admin'],
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/admin-action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))
    expect(res.status).toBe(200)
    expect(capturedAuth).toEqual(['admin'])
  })

  it('middleware reads ctx.meta.tool.tags', async () => {
    let capturedTags: string[] | undefined
    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      capturedTags = ctx.meta.tool?.tags
      return next()
    })
    app.tool('tagged_tool', {
      description: 'A tagged tool',
      tags: ['billing', 'v2'],
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/tagged-tool'))
    expect(capturedTags).toEqual(['billing', 'v2'])
  })

  it('resource template middleware sees kind: "resource" and sideEffects: false', async () => {
    let capturedMeta: unknown
    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      capturedMeta = ctx.meta.tool
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
    expect(capturedMeta).toEqual({
      kind: 'resource',
      name: 'product',
      tags: [],
      auth: undefined,
      sideEffects: false,
    })
  })

  it('middleware reads ctx.meta.tool.sideEffects on regular tool', async () => {
    let capturedSideEffects: boolean | undefined
    const app = createApp({ name: 'test-app' })
    app.use(async (ctx, next) => {
      capturedSideEffects = ctx.meta.tool?.sideEffects
      return next()
    })
    app.tool('read_only', {
      description: 'Read only tool',
      sideEffects: false,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/read-only'))
    expect(capturedSideEffects).toBe(false)
  })
})
