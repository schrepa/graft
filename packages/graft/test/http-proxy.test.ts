import { describe, it, expect } from 'vitest'
import { createHttpProxy } from '../src/proxy/http-proxy.js'

const TARGET = 'https://example.test'

type EchoHeadersBody = {
  authorization: string | null
  'x-api-key': string | null
  'x-custom': string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const parsed = await request.json()
  if (isRecord(parsed)) {
    return parsed
  }
  return {}
}

type FetchRoute = {
  matches(request: Request, url: URL): boolean
  respond(request: Request, url: URL): Promise<Response> | Response
}

const fetchRoutes: FetchRoute[] = [
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/items',
    respond: (_request, url) => {
      const q = url.searchParams.get('q')
      const items = [{ id: '1', name: 'Widget' }, { id: '2', name: 'Gadget' }]
      return Response.json(
        q ? items.filter((item) => item.name.toLowerCase().includes(q.toLowerCase())) : items,
      )
    },
  },
  {
    matches: (request, url) => request.method === 'GET' && /^\/items\/[^/]+$/.test(url.pathname),
    respond: (_request, url) => {
      const id = url.pathname.split('/')[2]
      return id === '1'
        ? Response.json({ id: '1', name: 'Widget' })
        : Response.json({ error: 'Not found' }, { status: 404 })
    },
  },
  {
    matches: (request, url) => request.method === 'POST' && url.pathname === '/items',
    respond: async (request) => Response.json({ id: '3', ...(await readJsonObject(request)) }, { status: 201 }),
  },
  {
    matches: (request, url) => request.method === 'PUT' && /^\/items\/[^/]+$/.test(url.pathname),
    respond: async (request, url) => {
      const id = url.pathname.split('/')[2]
      return Response.json({ id, ...(await readJsonObject(request)) })
    },
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/echo-headers',
    respond: (request) => Response.json({
      authorization: request.headers.get('authorization'),
      'x-api-key': request.headers.get('x-api-key'),
      'x-custom': request.headers.get('x-custom'),
    } satisfies EchoHeadersBody),
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/filter',
    respond: (_request, url) => Response.json({ genres: url.searchParams.getAll('genre') }),
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/text',
    respond: () => new Response('hello world', { headers: { 'content-type': 'text/plain' } }),
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/image',
    respond: () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      headers: { 'content-type': 'image/png' },
    }),
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/echo-all-headers',
    respond: (request) => Response.json(Object.fromEntries(request.headers.entries())),
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/api/v1/health',
    respond: (_request, url) => Response.json({ status: 'ok', path: url.pathname }),
  },
  {
    matches: (request, url) => request.method === 'GET' && url.pathname === '/api/v1/items',
    respond: () => Response.json([{ id: '1' }]),
  },
]

function createFetchDouble(): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const route = fetchRoutes.find((candidate) => candidate.matches(request, url))
    return route
      ? route.respond(request, url)
      : Response.json({ error: 'Not found' }, { status: 404 })
  }
}

describe('createHttpProxy', () => {
  const fetchImpl = createFetchDouble()

  it('proxies GET with query params', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/items', { q: 'widget' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual([{ id: '1', name: 'Widget' }])
  })

  it('proxies GET with path params', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/items/:id', { id: '1' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: '1', name: 'Widget' })
  })

  it('proxies POST with JSON body', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('POST', '/items', { name: 'New Item', price: 9.99 })

    expect(result.status).toBe(201)
    expect(result.body).toEqual({ id: '3', name: 'New Item', price: 9.99 })
  })

  it('proxies PUT with path params and body', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('PUT', '/items/:id', { id: '1', name: 'Updated' })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: '1', name: 'Updated' })
  })

  it('handles 404 errors', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/items/:id', { id: 'missing' })

    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Not found' })
  })

  it('handles plain text responses', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/text', {})

    expect(result.status).toBe(200)
    expect(result.body).toBe('hello world')
  })

  it('forwards context headers', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/echo-headers', {}, {
      headers: { authorization: 'Bearer token123' },
    })

    expect(result.status).toBe(200)
    expect((result.body as EchoHeadersBody).authorization).toBe('Bearer token123')
  })

  it('applies default headers', async () => {
    const proxy = createHttpProxy({
      target: TARGET,
      headers: { 'x-api-key': 'secret-key' },
      fetchImpl,
    })
    const result = await proxy('GET', '/echo-headers', {})

    expect(result.status).toBe(200)
    expect((result.body as EchoHeadersBody)['x-api-key']).toBe('secret-key')
  })

  it('caller headers override default headers', async () => {
    const proxy = createHttpProxy({
      target: TARGET,
      headers: { 'x-custom': 'operator-default' },
      fetchImpl,
    })
    const result = await proxy('GET', '/echo-headers', {}, {
      headers: { 'x-custom': 'caller-value' },
    })

    expect(result.status).toBe(200)
    expect((result.body as EchoHeadersBody)['x-custom']).toBe('caller-value')
  })

  it('locked headers take precedence over caller headers', async () => {
    const proxy = createHttpProxy({
      target: TARGET,
      lockedHeaders: { 'x-custom': 'locked-value' },
      fetchImpl,
    })
    const result = await proxy('GET', '/echo-headers', {}, {
      headers: { 'x-custom': 'client-override-attempt' },
    })

    expect(result.status).toBe(200)
    expect((result.body as EchoHeadersBody)['x-custom']).toBe('locked-value')
  })

  it('rejects non-allowed routes when allowedRoutes is set', async () => {
    const proxy = createHttpProxy({
      target: TARGET,
      allowedRoutes: new Set(['GET /items']),
      fetchImpl,
    })

    const ok = await proxy('GET', '/items', {})
    expect(ok.status).toBe(200)

    const forbidden = await proxy('GET', '/echo-headers', {})
    expect(forbidden.status).toBe(403)
    expect((forbidden.body as { error: string }).error).toBe('FORBIDDEN')
  })

  it('returns all items without query params', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/items', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual([
      { id: '1', name: 'Widget' },
      { id: '2', name: 'Gadget' },
    ])
  })

  it('proxies GET with array query params as repeated keys', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/filter', { genre: ['fiction', 'mystery', 'sci-fi'] })

    expect(result.status).toBe(200)
    expect((result.body as { genres: string[] }).genres).toEqual(['fiction', 'mystery', 'sci-fi'])
  })

  it('returns base64 for binary image responses', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/image', {})

    expect(result.status).toBe(200)
    expect(typeof result.body).toBe('string')
    const decoded = Buffer.from(result.body as string, 'base64')
    expect(decoded[0]).toBe(0x89)
    expect(decoded[1]).toBe(0x50)
  })

  it('preserves target base path when building URLs', async () => {
    const proxy = createHttpProxy({ target: `${TARGET}/api/v1`, fetchImpl })
    const result = await proxy('GET', '/health', {})

    expect(result.status).toBe(200)
    expect((result.body as { path: string }).path).toBe('/api/v1/health')
  })

  it('preserves target base path with trailing slash', async () => {
    const proxy = createHttpProxy({ target: `${TARGET}/api/v1/`, fetchImpl })
    const result = await proxy('GET', '/items', {})

    expect(result.status).toBe(200)
    expect(result.body).toEqual([{ id: '1' }])
  })

  it('normalizes header case for default and caller headers', async () => {
    const proxy = createHttpProxy({
      target: TARGET,
      headers: { Authorization: 'Bearer default' },
      fetchImpl,
    })
    const result = await proxy('GET', '/echo-all-headers', {}, {
      headers: { authorization: 'Bearer caller' },
    })

    expect(result.status).toBe(200)
    expect((result.body as Record<string, string>).authorization).toBe('Bearer caller')
  })

  it('normalizes header case so locked headers always win', async () => {
    const proxy = createHttpProxy({
      target: TARGET,
      lockedHeaders: { 'x-api-key': 'locked-value' },
      fetchImpl,
    })
    const result = await proxy('GET', '/echo-all-headers', {}, {
      headers: { 'X-Api-Key': 'caller-attempt' },
    })

    expect(result.status).toBe(200)
    expect((result.body as Record<string, string>)['x-api-key']).toBe('locked-value')
  })

  it('routes header args via parameterLocations', async () => {
    const proxy = createHttpProxy({ target: TARGET, fetchImpl })
    const result = await proxy('GET', '/echo-all-headers', { if_match: 'etag123' }, {
      parameterLocations: { if_match: { in: 'header', name: 'If-Match' } },
    })

    expect(result.status).toBe(200)
    expect((result.body as Record<string, string>)['if-match']).toBe('etag123')
  })
})
