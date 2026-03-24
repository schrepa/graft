import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import { ToolError } from '../src/errors.js'

describe('auth fail-closed', () => {
  it('tool with auth: true + no authenticate hook → build() throws', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('secret', {
      description: 'Secret',
      auth: true,
      handler: () => 'data',
    })

    expect(() => app.build()).toThrow('requires auth but no authenticate hook')
  })

  it('tool with auth: true + hook but no credential → dispatch returns 401', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: async (req) => {
        const token = req.headers.get('authorization')
        if (!token) throw new (await import('../src/errors.js')).AuthError('No token', 401)
        return { subject: 'user-1' }
      },
    })
    app.tool('secret', {
      description: 'Secret',
      auth: true,
      handler: () => ({ secret: 'data' }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/secret'))
    expect(res.status).toBe(401)
  })
})

describe('context parity', () => {
  it('HTTP dispatch → handler sees ctx.meta.requestId (string, not undefined)', async () => {
    let capturedRequestId: string | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('check_ctx', {
      description: 'Check context',
      handler: (_params, ctx) => {
        capturedRequestId = ctx.meta.requestId
        return { ok: true }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/check-ctx'))
    expect(capturedRequestId).toBeTruthy()
    expect(typeof capturedRequestId).toBe('string')
    expect(capturedRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('HTTP dispatch → handler sees ctx.meta.headers (from request)', async () => {
    let capturedHeaders: Record<string, string> | undefined

    const app = createApp({ name: 'test-app' })
    app.tool('check_headers', {
      description: 'Check headers',
      handler: (_params, ctx) => {
        capturedHeaders = ctx.meta.headers
        return { ok: true }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/check-headers', {
      headers: { 'Authorization': 'Bearer test-token', 'X-Custom': 'custom-value' },
    }))
    expect(capturedHeaders).toBeDefined()
    expect(capturedHeaders?.authorization).toBe('Bearer test-token')
    expect(capturedHeaders?.['x-custom']).toBe('custom-value')
  })
})

describe('transport fixes', () => {
  it('POST with empty body → handler receives {}', async () => {
    let receivedParams: unknown

    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: (params) => { receivedParams = params; return { ok: true } },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    }))
    expect(res.status).toBe(200)
    expect(receivedParams).toEqual({})
  })

  it('ToolError with headers → HTTP response includes those headers', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('rate_limited', {
      description: 'Rate limited',
      handler: () => {
        throw new ToolError('Rate limited', 429, { headers: { 'Retry-After': '60' } })
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/rate-limited'))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('inputSchema tool passes args through without runtime validation', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_user', {
      description: 'Create user',
      sideEffects: true,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: (params: any) => ({ created: params.name }),
    })

    const { fetch } = app.build()
    const res1 = await fetch(new Request('http://localhost:3000/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    }))
    expect(res1.status).toBe(200)
    const body1 = await res1.json() as any
    expect(body1.created).toBe('Alice')

    const res2 = await fetch(new Request('http://localhost:3000/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(res2.status).toBe(200)
  })
})

describe('prompt HTTP routes', () => {
  it('POST /prompts/name with JSON body returns { messages: [...] }', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'suggest',
      description: 'Generate recommendations',
      params: z.object({ category: z.string() }),
      handler: ({ category }) => [
        { role: 'user' as const, content: `Recommend ${category} items` },
      ],
      expose: 'both',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/prompts/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'Premium' }),
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const body = await res.json() as any
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toContain('Premium')
  })

  it('prompt with default expose (mcp) has no HTTP route', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'suggest',
      description: 'Generate recommendations',
      handler: () => [{ role: 'user' as const, content: 'hello' }],
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/prompts/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(404)
  })

  it('prompt with expose: "both" mounts HTTP route and MCP', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'greet_prompt',
      description: 'Greeting prompt',
      handler: () => [{ role: 'user' as const, content: 'Hello!' }],
      expose: 'both',
    })

    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/prompts/greet_prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(httpRes.status).toBe(200)
    const httpBody = await httpRes.json() as any
    expect(httpBody.messages[0].content).toBe('Hello!')

    const client = createMcpTestClient(app)
    const prompt = await client.getPrompt('greet_prompt')
    expect((prompt.messages[0].content as any).text).toBe('Hello!')
  })

  it('prompt with expose: "http" has HTTP route but not in MCP list', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'http_only',
      description: 'HTTP only prompt',
      handler: () => [{ role: 'user' as const, content: 'HTTP!' }],
      expose: 'http',
    })

    const { fetch } = app.build()
    const httpRes = await fetch(new Request('http://localhost:3000/prompts/http_only', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(httpRes.status).toBe(200)
  })

  it('prompt HTTP route returns proper error on invalid JSON', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'suggest',
      description: 'Suggest',
      handler: () => [{ role: 'user' as const, content: 'hi' }],
      expose: 'both',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/prompts/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    }))
    expect(res.status).toBe(400)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const body = await res.json() as any
    expect(body.error).toBe('Invalid JSON body')
  })

  it('prompt HTTP route supports custom path', async () => {
    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'suggest',
      description: 'Suggest',
      handler: () => [{ role: 'user' as const, content: 'custom' }],
      expose: 'both',
      http: { path: '/api/prompts/suggest' },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/api/prompts/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.messages[0].content).toBe('custom')
  })

  it('prompt POST with empty body → handler receives {}', async () => {
    let receivedParams: unknown

    const app = createApp({ name: 'test-app' })
    app.prompt({
      name: 'greet_empty',
      description: 'Greet',
      handler: (params) => {
        receivedParams = params
        return [{ role: 'user' as const, content: 'hello' }]
      },
      expose: 'both',
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/prompts/greet_empty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    }))
    expect(res.status).toBe(200)
    expect(receivedParams).toEqual({})
  })
})

describe('schema exclusivity', () => {
  it('throws when both params (Zod) and inputSchema (JSON Schema) are provided', () => {
    const app = createApp({ name: 'test-app' })
    const invalidConfig = {
      description: 'Has both',
      params: z.object({ name: z.string() }),
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      handler: () => 'nope',
    } as any
    expect(() => {
      app.tool('dual_schema', invalidConfig)
    }).toThrow('provide either params (Zod) or inputSchema (JSON Schema), not both')
  })

  it('allows params alone', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('zod_only', {
      description: 'Zod only',
      params: z.object({ name: z.string() }),
      handler: () => 'ok',
    })
    expect(() => app.build()).not.toThrow()
  })

  it('allows inputSchema alone', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('json_only', {
      description: 'JSON Schema only',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      handler: () => 'ok',
    })
    expect(() => app.build()).not.toThrow()
  })

  it('allows neither params nor inputSchema', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('no_schema', {
      description: 'No schema',
      handler: () => 'ok',
    })
    expect(() => app.build()).not.toThrow()
  })

  it('rejects parameterLocations.name for body params', () => {
    const app = createApp({ name: 'test-app' })

    expect(() => {
      app.tool('body_name_override', {
        description: 'Invalid body override',
        inputSchema: { type: 'object', properties: { payload: { type: 'string' } } },
        parameterLocations: { payload: { in: 'body', name: 'data' } },
        handler: () => 'nope',
      })
    }).toThrow(/parameterLocations\.payload\.name/)
  })

  it('rejects parameterLocations.name for path params', () => {
    const app = createApp({ name: 'test-app' })

    expect(() => {
      app.tool('path_name_override', {
        description: 'Invalid path override',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        http: { path: '/items/:id' },
        parameterLocations: { id: { in: 'path', name: 'itemId' } },
        handler: () => 'nope',
      })
    }).toThrow(/parameterLocations\.id\.name/)
  })
})

describe('schema-driven GET query deserialization', () => {
  it('coerces ?age=30 to number when schema says integer', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('get_user', {
      description: 'Get user',
      inputSchema: {
        type: 'object',
        properties: { age: { type: 'integer' } },
      },
      handler: (params: any) => ({ age: params.age, type: typeof params.age }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/get-user?age=30'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.age).toBe(30)
    expect(body.type).toBe('number')
  })

  it('coerces ?active=true to boolean', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('filter', {
      description: 'Filter',
      inputSchema: {
        type: 'object',
        properties: { active: { type: 'boolean' } },
      },
      handler: (params: any) => ({ active: params.active, type: typeof params.active }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/filter?active=true'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.active).toBe(true)
    expect(body.type).toBe('boolean')
  })

  it('preserves invalid boolean strings for downstream validation', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('filter', {
      description: 'Filter',
      inputSchema: {
        type: 'object',
        properties: { active: { type: 'boolean' } },
      },
      handler: (params: any) => ({ active: params.active, type: typeof params.active }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/filter?active=maybe'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.active).toBe('maybe')
    expect(body.type).toBe('string')
  })

  it('coerces ?price=9.99 to number', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('price_check', {
      description: 'Check price',
      inputSchema: {
        type: 'object',
        properties: { price: { type: 'number' } },
      },
      handler: (params: any) => ({ price: params.price }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/price-check?price=9.99'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.price).toBe(9.99)
  })

  it('preserves empty numeric strings instead of coercing them to 0', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('price_check', {
      description: 'Check price',
      inputSchema: {
        type: 'object',
        properties: { price: { type: 'number' } },
      },
      handler: (params: any) => ({ price: params.price, type: typeof params.price }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/price-check?price='))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.price).toBe('')
    expect(body.type).toBe('string')
  })

  it('preserves repeated keys as array for array-typed schema property', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('tag_search', {
      description: 'Search by tags',
      inputSchema: {
        type: 'object',
        properties: { tag: { type: 'array', items: { type: 'string' } } },
      },
      handler: (params: any) => ({ tags: params.tag }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/tag-search?tag=a&tag=b'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.tags).toEqual(['a', 'b'])
  })

  it('coerces array items by type', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('ids_search', {
      description: 'Search by IDs',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'array', items: { type: 'integer' } } },
      },
      handler: (params: any) => ({ ids: params.id }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/ids-search?id=1&id=2&id=3'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ids).toEqual([1, 2, 3])
  })

  it('keeps non-finite coercion as string → passes through to handler', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('numeric_tool', {
      description: 'Numeric',
      inputSchema: {
        type: 'object',
        properties: { val: { type: 'number' } },
      },
      handler: (params: any) => ({ val: params.val }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/numeric-tool?val=abc'))
    expect(res.status).toBe(200)
  })

  it('unknown repeated keys (no schema entry) → preserved as array', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('passthrough', {
      description: 'Passthrough',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: (params: any) => params,
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/passthrough?x=1&x=2'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.x).toEqual(['1', '2'])
  })

  it('no schema → falls back to plain string fromEntries', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('no_schema_tool', {
      description: 'No schema',
      handler: (params: any) => params,
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/no-schema-tool?q=hello&n=42'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.q).toBe('hello')
    expect(body.n).toBe('42')
  })
})

describe('non-object JSON body', () => {
  it('POST with body `5` returns 400, not 500', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '5',
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Request body must be a JSON object')
  })

  it('POST with body `"hello"` returns 400', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"hello"',
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Request body must be a JSON object')
  })

  it('POST with body `[1,2,3]` returns 400', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[1,2,3]',
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Request body must be a JSON object')
  })

  it('POST with body `null` returns 400', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe('Request body must be a JSON object')
  })

  it('POST with valid object body still works', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: (params: any) => ({ name: params.name }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.name).toBe('Widget')
  })
})

describe('CORS default disabled', () => {
  it('default app (no cors option) has no Access-Control-Allow-Origin header', async () => {
    const app = createApp({ name: 'test-app' })
    const { fetch } = app.build()

    const res = await fetch(new Request('http://localhost:3000/anything', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('app with cors: { origin: "*" } has Access-Control-Allow-Origin: *', async () => {
    const app = createApp({ name: 'test-app', cors: { origin: '*' } })
    const { fetch } = app.build()

    const res = await fetch(new Request('http://localhost:3000/anything', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
