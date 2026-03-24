import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import type { Logger } from '../src/types.js'

// =========================================================================
// Health check
// =========================================================================

describe('health check', () => {
  it('GET /health returns expanded health info by default', async () => {
    const app = createApp({ name: 'test-app' })
    const { fetch } = app.build()

    const res = await fetch(new Request('http://localhost:3000/health'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.name).toBe('test-app')
    expect(body.tools).toBe(0)
    expect(typeof body.uptime).toBe('number')
    expect(body.mcp).toBe('2025-11-25')
  })

  it('supports custom health check path', async () => {
    const app = createApp({ name: 'test-app', healthCheck: { path: '/ready' } })
    const { fetch } = app.build()

    const res = await fetch(new Request('http://localhost:3000/ready'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')

    // Default /health should 404
    const def = await fetch(new Request('http://localhost:3000/health'))
    expect(def.status).toBe(404)
  })

  it('healthCheck: false disables the endpoint', async () => {
    const app = createApp({ name: 'test-app', healthCheck: false })
    const { fetch } = app.build()

    const res = await fetch(new Request('http://localhost:3000/health'))
    expect(res.status).toBe(404)
  })
})

// =========================================================================
// Request ID — HTTP tools
// =========================================================================

describe('request ID (HTTP tools)', () => {
  it('GET tool response includes x-request-id header', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('search', {
      description: 'Search',
      handler: () => ({ results: [] }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/search'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('POST tool response includes x-request-id header', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
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
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('error responses (400) include x-request-id', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({}),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    }))
    expect(res.status).toBe(400)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('each request gets a unique ID', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('ping', {
      description: 'Ping',
      handler: () => 'pong',
    })

    const { fetch } = app.build()
    const res1 = await fetch(new Request('http://localhost:3000/ping'))
    const res2 = await fetch(new Request('http://localhost:3000/ping'))
    const id1 = res1.headers.get('x-request-id')
    const id2 = res2.headers.get('x-request-id')
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })
})

// =========================================================================
// Request ID — HTTP resources
// =========================================================================

describe('request ID (HTTP resources)', () => {
  it('resource GET response includes x-request-id header', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://items',
      name: 'items',
      description: 'All items',
      handler: () => [{ id: 1 }],
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/items'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('resource error response includes x-request-id header', async () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://broken',
      name: 'broken',
      description: 'Broken',
      handler: () => { throw new Error('DB error') },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/broken'))
    expect(res.status).toBe(500)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})

// =========================================================================
// Request ID — MCP
// =========================================================================

describe('request ID (MCP)', () => {
  it('MCP handler receives ctx.meta.requestId as a non-empty string', async () => {
    let capturedRequestId: string | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('capture_id', {
      description: 'Captures request ID',
      handler: (_params, ctx) => {
        capturedRequestId = ctx.meta.requestId
        return { ok: true }
      },
    })

    const client = createMcpTestClient(app)
    await client.callTool('capture_id')

    expect(capturedRequestId).toBeTruthy()
    expect(typeof capturedRequestId).toBe('string')
    // UUID format check
    expect(capturedRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})

// =========================================================================
// Route collision warning
// =========================================================================

describe('route collision', () => {
  it('duplicate registration throws on route collision', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', {
      description: 'Say hello',
      handler: () => 'hi',
    })
    // Register a second tool that maps to the same route
    app.route('GET', '/greet', () => 'override')

    expect(() => app.build()).toThrow('Route collision')
  })
})

// =========================================================================
// CORS dynamic methods
// =========================================================================

describe('CORS dynamic methods', () => {
  it('preflight Access-Control-Allow-Methods includes all registered methods', async () => {
    const app = createApp({ name: 'test-app', cors: { origin: '*' } })
    app.tool('search', {
      description: 'Search (GET)',
      handler: () => [],
    })
    app.tool('create_item', {
      description: 'Create (POST)',
      sideEffects: true,
      handler: () => ({}),
    })
    app.route('DELETE', '/items/1', () => ({ deleted: true }))

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/anything', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    const methods = res.headers.get('Access-Control-Allow-Methods')!
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })
})

// =========================================================================
// Custom logger
// =========================================================================

describe('custom logger', () => {
  it('mock logger receives ctx.log.info() calls from handlers', async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const app = createApp({ name: 'test-app', logger: mockLogger })
    app.tool('logging_tool', {
      description: 'Logs something',
      handler: (_params, ctx) => {
        ctx.log.info('Tool executed successfully')
        return { ok: true }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/logging-tool'))
    expect(res.status).toBe(200)
    expect(mockLogger.info).toHaveBeenCalledWith('Tool executed successfully')
  })

  it('build-time auth error throws when tool requires auth but no hook', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('protected_tool', {
      description: 'Requires auth',
      auth: true,
      handler: () => 'secret',
    })

    expect(() => app.build()).toThrow('requires auth but no authenticate hook')
  })
})

// =========================================================================
// Exposure strictness
// =========================================================================

describe('exposure strictness', () => {
  it('expose: "http" tool → tools/call returns NOT_FOUND', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('http_only', {
      description: 'HTTP only',
      handler: () => ({ result: 'web' }),
      expose: 'http',
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('http_only') as any
    expect(result.error).toBe('NOT_FOUND')
  })

  it('expose: "http" tool → not in agent.json', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('http_only', {
      description: 'HTTP only',
      handler: () => 'web',
      expose: 'http',
    })
    app.tool('visible', {
      description: 'Visible',
      handler: () => 'ok',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    const body = await res.json() as any
    const toolNames = body.tools.map((t: any) => t.name)
    expect(toolNames).not.toContain('http_only')
    expect(toolNames).toContain('visible')
  })

  it('expose: "mcp" tool → callable via tools/call, visible in tools/list', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('mcp_only', {
      description: 'MCP only',
      handler: () => ({ secret: true }),
      expose: 'mcp',
    })

    const client = createMcpTestClient(app)

    // tools/list includes it
    const tools = await client.listTools()
    expect(tools.map(t => t.name)).toContain('mcp_only')

    // tools/call works
    const result = await client.callTool('mcp_only')
    expect(result).toEqual({ secret: true })
  })
})

// =========================================================================
// Agent.json tool count
// =========================================================================

describe('agent.json tool count', () => {
  it('description count matches visible tools (hidden excluded)', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('visible_a', { description: 'A', handler: () => 1 })
    app.tool('visible_b', { description: 'B', handler: () => 2 })
    app.tool('hidden_c', { description: 'C', handler: () => 3, expose: 'http' })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    const body = await res.json() as any

    expect(body.tools).toHaveLength(2)
    expect(body.description).toContain('2 tool(s)')
    expect(body.tools.map((t: any) => t.name)).not.toContain('hidden_c')
  })
})

// =========================================================================
// Improved auth error message
// =========================================================================

describe('auth error message', () => {
  it('includes actionable guidance about --entry and authenticate hook', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('protected', {
      description: 'Protected',
      auth: true,
      handler: () => 'secret',
    })

    expect(() => app.build()).toThrow('--entry')
    expect(() => {
      const app2 = createApp({ name: 'test-app' })
      app2.tool('p', { description: 'P', auth: true, handler: () => 's' })
      app2.build()
    }).toThrow('authenticate hook')
  })
})

// =========================================================================
// Reserved path collision
// =========================================================================

describe('reserved path collision', () => {
  it('tool named "mcp" with sideEffects: true throws at build time', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('mcp', {
      description: 'Conflicts with MCP endpoint',
      sideEffects: true,
      handler: () => 'bad',
    })

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('tool with explicit http path /mcp and method POST throws at build time', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('my_tool', {
      description: 'Conflicts',
      http: { method: 'POST', path: '/mcp' },
      handler: () => 'bad',
    })

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('tool with explicit http path /.well-known/agent.json throws at build time', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('discovery', {
      description: 'Conflicts',
      http: { path: '/.well-known/agent.json' },
      handler: () => 'bad',
    })

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('tool with custom health path collision throws', () => {
    const app = createApp({ name: 'test-app', healthCheck: { path: '/ready' } })
    app.tool('ready', {
      description: 'Conflicts with health check',
      handler: () => 'bad',
    })

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('tool that does not collide with reserved paths builds fine', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('mcp_tools', {
      description: 'Does not conflict',
      sideEffects: true,
      handler: () => 'ok',
    })

    expect(() => app.build()).not.toThrow()
  })
})

// =========================================================================
// Tool name uniqueness (Finding #1)
// =========================================================================

describe('tool name uniqueness', () => {
  it('rejects duplicate tool name across different expose modes (mcp + http)', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('x', { description: 'First', expose: 'mcp', handler: () => 1 })
    expect(() => {
      app.tool('x', { description: 'Second', expose: 'http', handler: () => 2 })
    }).toThrow('already registered')
  })

  it('rejects duplicate tool name (both + mcp)', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('x', { description: 'First', expose: 'both', handler: () => 1 })
    expect(() => {
      app.tool('x', { description: 'Second', expose: 'mcp', handler: () => 2 })
    }).toThrow('already registered')
  })

  it('rejects cross-call collision between tool() and tools()', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('x', { description: 'First', handler: () => 1 })
    expect(() => {
      app.tools({ x: { description: 'Second', handler: () => 2 } })
    }).toThrow('already registered')
  })
})

// =========================================================================
// Reserved path collision for resources/prompts/routes (Finding #2)
// =========================================================================

describe('reserved path collision (extended)', () => {
  it('resource with http path /health throws', () => {
    const app = createApp({ name: 'test-app' })
    app.resource({
      uri: 'data://health',
      name: 'health_data',
      description: 'Conflicts',
      handler: () => ({}),
      http: { path: '/health' },
    })

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('prompt with http path /mcp throws (POST collision)', () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'mcp_prompt',
      description: 'Conflicts',
      handler: () => [{ role: 'user' as const, content: 'hi' }],
      expose: 'both',
      http: { path: '/mcp' },
    })

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('explicit route POST /mcp throws', () => {
    const app = createApp({ name: 'test-app' })
    app.route('POST', '/mcp', () => 'bad')

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })

  it('explicit route GET /health throws', () => {
    const app = createApp({ name: 'test-app' })
    app.route('GET', '/health', () => 'bad')

    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })
})
