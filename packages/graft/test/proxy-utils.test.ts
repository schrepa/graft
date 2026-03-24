import { describe, it, expect, vi } from 'vitest'
import { buildProxyRequest, parseProxyResponse, createProxyFunction, createProxyHandler } from '../src/proxy/utils.js'
import { ToolError } from '../src/errors.js'
import type { ToolContext } from '../src/types.js'

describe('buildProxyRequest', () => {
  it('extracts path params and fills resolvedPath', () => {
    const result = buildProxyRequest('GET', '/items/:id', { id: '42', q: 'foo' })
    expect(result.resolvedPath).toBe('/items/42')
    expect(result.queryArgs).toEqual({ q: 'foo' })
    expect(result.bodyArgs).toEqual({})
    expect(result.headerArgs).toEqual({})
  })

  it('routes remaining args to queryArgs for GET', () => {
    const result = buildProxyRequest('GET', '/items', { q: 'search', limit: 10 })
    expect(result.queryArgs).toEqual({ q: 'search', limit: 10 })
    expect(result.bodyArgs).toEqual({})
  })

  it('routes remaining args to queryArgs for HEAD', () => {
    const result = buildProxyRequest('HEAD', '/items', { q: 'search' })
    expect(result.queryArgs).toEqual({ q: 'search' })
    expect(result.bodyArgs).toEqual({})
  })

  it('routes remaining args to bodyArgs for POST', () => {
    const result = buildProxyRequest('POST', '/items', { name: 'Widget', price: 9.99 })
    expect(result.queryArgs).toEqual({})
    expect(result.bodyArgs).toEqual({ name: 'Widget', price: 9.99 })
  })

  it('routes remaining args to bodyArgs for PUT', () => {
    const result = buildProxyRequest('PUT', '/items/:id', { id: '1', name: 'Updated' })
    expect(result.resolvedPath).toBe('/items/1')
    expect(result.bodyArgs).toEqual({ name: 'Updated' })
  })

  it('routes header params via parameterLocations', () => {
    const result = buildProxyRequest('GET', '/items', { if_match: 'abc123', q: 'foo' }, {
      if_match: { in: 'header', name: 'If-Match' },
    })
    expect(result.headerArgs).toEqual({ 'If-Match': 'abc123' })
    expect(result.queryArgs).toEqual({ q: 'foo' })
  })

  it('supports string shorthand for parameterLocations', () => {
    const result = buildProxyRequest('GET', '/items', { accept: 'text/plain', q: 'foo' }, {
      accept: 'header',
    })
    expect(result.headerArgs).toEqual({ accept: 'text/plain' })
    expect(result.queryArgs).toEqual({ q: 'foo' })
  })

  it('uses arg name when parameterLocation has no name override', () => {
    const result = buildProxyRequest('GET', '/items', { accept: 'text/plain' }, {
      accept: { in: 'header' },
    })
    expect(result.headerArgs).toEqual({ accept: 'text/plain' })
  })

  it('encodes path params with special characters', () => {
    const result = buildProxyRequest('GET', '/items/:id', { id: 'hello world/foo' })
    expect(result.resolvedPath).toBe('/items/hello%20world%2Ffoo')
  })

  it('returns empty objects when no args provided', () => {
    const result = buildProxyRequest('GET', '/items', {})
    expect(result.resolvedPath).toBe('/items')
    expect(result.queryArgs).toEqual({})
    expect(result.bodyArgs).toEqual({})
    expect(result.headerArgs).toEqual({})
  })

  it('routes args with in: "query" to queryArgs on POST', () => {
    const result = buildProxyRequest('POST', '/items', { filter: 'active', name: 'Widget' }, {
      filter: { in: 'query' },
    })
    expect(result.queryArgs).toEqual({ filter: 'active' })
    expect(result.bodyArgs).toEqual({ name: 'Widget' })
  })

  it('applies custom wire names to query args', () => {
    const result = buildProxyRequest('POST', '/items', { search: 'ada', name: 'Widget' }, {
      search: { in: 'query', name: 'q' },
    })
    expect(result.queryArgs).toEqual({ q: 'ada' })
    expect(result.bodyArgs).toEqual({ name: 'Widget' })
  })

  it('routes args with in: "body" to bodyArgs on GET', () => {
    const result = buildProxyRequest('GET', '/items', { q: 'search', payload: { nested: true } }, {
      payload: { in: 'body' },
    })
    expect(result.queryArgs).toEqual({ q: 'search' })
    expect(result.bodyArgs).toEqual({ payload: { nested: true } })
  })

  it('routes args with in: "query" string shorthand to queryArgs on POST', () => {
    const result = buildProxyRequest('POST', '/items', { status: 'active', data: 'value' }, {
      status: 'query',
    })
    expect(result.queryArgs).toEqual({ status: 'active' })
    expect(result.bodyArgs).toEqual({ data: 'value' })
  })

  it('routes args with in: "body" string shorthand to bodyArgs on GET', () => {
    const result = buildProxyRequest('GET', '/items', { q: 'search', extra: 'data' }, {
      extra: 'body',
    })
    expect(result.queryArgs).toEqual({ q: 'search' })
    expect(result.bodyArgs).toEqual({ extra: 'data' })
  })

  it('ignores parameterLocations for missing args', () => {
    const result = buildProxyRequest('POST', '/items', { name: 'Widget' }, {
      filter: { in: 'query' },
    })
    expect(result.queryArgs).toEqual({})
    expect(result.bodyArgs).toEqual({ name: 'Widget' })
  })

  it('combines explicit query, body, and header routing on POST', () => {
    const result = buildProxyRequest('POST', '/items/:id', {
      id: '42',
      filter: 'active',
      auth_token: 'xyz',
      extra_body: 'data',
      name: 'Widget',
    }, {
      filter: { in: 'query' },
      auth_token: { in: 'header', name: 'X-Auth-Token' },
      extra_body: { in: 'body' },
    })
    expect(result.resolvedPath).toBe('/items/42')
    expect(result.queryArgs).toEqual({ filter: 'active' })
    expect(result.bodyArgs).toEqual({ extra_body: 'data', name: 'Widget' })
    expect(result.headerArgs).toEqual({ 'X-Auth-Token': 'xyz' })
  })

  it('path parameterLocation is a no-op (already handled by :param substitution)', () => {
    const result = buildProxyRequest('GET', '/items/:id', { id: '42', q: 'foo' }, {
      id: { in: 'path' },
    })
    expect(result.resolvedPath).toBe('/items/42')
    expect(result.queryArgs).toEqual({ q: 'foo' })
  })
})

describe('parseProxyResponse', () => {
  it('parses JSON response', async () => {
    const response = new Response(JSON.stringify({ id: 1, name: 'Widget' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const result = await parseProxyResponse(response)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: 1, name: 'Widget' })
    expect(result.headers['content-type']).toBe('application/json')
  })

  it('parses text response', async () => {
    const response = new Response('Hello, world!', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
    const result = await parseProxyResponse(response)
    expect(result.body).toBe('Hello, world!')
  })

  it('parses image response as base64', async () => {
    const pixels = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header bytes
    const response = new Response(pixels, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
    const result = await parseProxyResponse(response)
    expect(result.status).toBe(200)
    expect(typeof result.body).toBe('string')
    // Verify it's base64 encoded
    const decoded = Buffer.from(result.body as string, 'base64')
    expect(decoded[0]).toBe(0x89)
    expect(decoded[1]).toBe(0x50)
  })

  it('parses audio response as base64', async () => {
    const audioData = new Uint8Array([0x52, 0x49, 0x46, 0x46]) // RIFF header
    const response = new Response(audioData, {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    })
    const result = await parseProxyResponse(response)
    expect(typeof result.body).toBe('string')
    const decoded = Buffer.from(result.body as string, 'base64')
    expect(decoded[0]).toBe(0x52)
  })

  it('handles content-type with charset parameter', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    const result = await parseProxyResponse(response)
    expect(result.body).toEqual({ ok: true })
  })

  it('parses application/problem+json as JSON', async () => {
    const response = new Response(JSON.stringify({ title: 'Conflict' }), {
      status: 409,
      headers: { 'content-type': 'application/problem+json; charset=utf-8' },
    })
    const result = await parseProxyResponse(response)
    expect(result.body).toEqual({ title: 'Conflict' })
  })

  it('extracts all response headers', async () => {
    const response = new Response('ok', {
      status: 200,
      headers: { 'x-custom': 'value', 'content-type': 'text/plain' },
    })
    const result = await parseProxyResponse(response)
    expect(result.headers['x-custom']).toBe('value')
  })

  it('handles 204 with application/json content-type and empty body', async () => {
    const response = new Response(null, {
      status: 204,
      headers: { 'content-type': 'application/json' },
    })
    const result = await parseProxyResponse(response)
    expect(result.status).toBe(204)
    expect(result.body).toBeNull()
  })

  it('handles 200 with application/json content-type and empty string body', async () => {
    const response = new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const result = await parseProxyResponse(response)
    expect(result.status).toBe(200)
    expect(result.body).toBeNull()
  })

  it('rejects malformed application/json responses', async () => {
    const response = new Response('{ invalid json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

    await expect(parseProxyResponse(response)).rejects.toThrow(/invalid json/i)
  })
})

// =========================================================================
// Header precedence
// =========================================================================

describe('createProxyFunction header precedence', () => {
  function captureHeaders() {
    const capturedHeaders: Record<string, string> = {}
    const dispatch = vi.fn(async (req: Request) => {
      req.headers.forEach((v, k) => { capturedHeaders[k] = v })
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    return { dispatch, getCaptured: () => capturedHeaders }
  }

  it('caller Authorization header is NOT overwritten by defaultHeaders', async () => {
    const { dispatch, getCaptured } = captureHeaders()
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
      defaultHeaders: { authorization: 'Bearer operator-default' },
    })

    await proxy('GET', '/items', {}, {
      headers: { authorization: 'Bearer caller-token' },
    })

    expect(getCaptured().authorization).toBe('Bearer caller-token')
  })

  it('caller Authorization IS overwritten by lockedHeaders', async () => {
    const { dispatch, getCaptured } = captureHeaders()
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
      lockedHeaders: { authorization: 'Bearer locked-key' },
    })

    await proxy('GET', '/items', {}, {
      headers: { authorization: 'Bearer caller-token' },
    })

    expect(getCaptured().authorization).toBe('Bearer locked-key')
  })

  it('defaultHeaders provide fallback when caller does not send a header', async () => {
    const { dispatch, getCaptured } = captureHeaders()
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
      defaultHeaders: { 'x-api-key': 'default-key' },
    })

    await proxy('GET', '/items', {}, {
      headers: {},
    })

    expect(getCaptured()['x-api-key']).toBe('default-key')
  })

  it('parameter-location header args override caller headers', async () => {
    const { dispatch, getCaptured } = captureHeaders()
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
    })

    await proxy('GET', '/items', { accept: 'text/plain' }, {
      headers: { accept: 'application/json' },
      parameterLocations: { accept: { in: 'header', name: 'accept' } },
    })

    expect(getCaptured().accept).toBe('text/plain')
  })

  it('full precedence: defaults < caller < paramLoc < locked', async () => {
    const { dispatch, getCaptured } = captureHeaders()
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
      defaultHeaders: {
        'x-default-only': 'from-default',
        'x-override-by-caller': 'from-default',
        'x-locked': 'from-default',
      },
      lockedHeaders: { 'x-locked': 'from-locked' },
    })

    await proxy('GET', '/items', {}, {
      headers: { 'x-override-by-caller': 'from-caller' },
    })

    const h = getCaptured()
    expect(h['x-default-only']).toBe('from-default')
    expect(h['x-override-by-caller']).toBe('from-caller')
    expect(h['x-locked']).toBe('from-locked')
  })

  it('does not override locked content-type when serializing JSON bodies', async () => {
    const { dispatch, getCaptured } = captureHeaders()
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
      lockedHeaders: { 'content-type': 'application/merge-patch+json' },
    })

    await proxy('PATCH', '/items/1', { name: 'Ada' })

    expect(getCaptured()['content-type']).toBe('application/merge-patch+json')
  })

  it('forwards the tool cancellation signal to the upstream request', async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    const dispatch = vi.fn(async (request: Request) => {
      capturedSignal = request.signal
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    const proxy = createProxyFunction({
      buildUrl: (p) => new URL(p, 'http://example.com'),
      dispatch,
    })

    await proxy('GET', '/items', {}, {
      toolContext: { signal: controller.signal } as ToolContext,
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(capturedSignal).toBeDefined()
    expect(capturedSignal?.aborted).toBe(false)

    controller.abort()
    expect(capturedSignal?.aborted).toBe(true)
  })
})

// =========================================================================
// createProxyHandler (moved from core pipeline.test.ts)
// =========================================================================

describe('createProxyHandler', () => {
  it('delegates to proxy and returns body on success', async () => {
    const mockProxy = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { items: [1, 2, 3] },
    }))
    const handler = createProxyHandler(mockProxy as any, { method: 'GET', path: '/items' })
    const ctx = { meta: { transport: 'mcp' as const, toolName: 'search' } } as ToolContext
    const result = await handler({}, ctx)
    expect(result).toEqual({ items: [1, 2, 3] })
    expect(mockProxy).toHaveBeenCalledTimes(1)
  })

  it('throws ToolError on 4xx/5xx', async () => {
    const mockProxy = vi.fn(async () => ({
      status: 404,
      headers: {},
      body: { error: 'Not found' },
    }))
    const handler = createProxyHandler(mockProxy as any, { method: 'GET', path: '/items/:id' })
    const ctx = { meta: { transport: 'mcp' as const, toolName: 'get_item' } } as ToolContext
    await expect(handler({ id: '999' }, ctx)).rejects.toThrow(ToolError)
  })

  it('uses body.message before the generic proxy error fallback', async () => {
    const mockProxy = vi.fn(async () => ({
      status: 502,
      headers: {},
      body: { message: 'Upstream timed out' },
    }))
    const handler = createProxyHandler(mockProxy as any, { method: 'GET', path: '/items/:id' })
    const ctx = { meta: { transport: 'mcp' as const, toolName: 'get_item' } } as ToolContext
    await expect(handler({ id: '999' }, ctx)).rejects.toThrow('Upstream timed out')
  })

  it('uses a plain-text error body when the proxy returns one', async () => {
    const mockProxy = vi.fn(async () => ({
      status: 503,
      headers: {},
      body: 'Temporarily unavailable',
    }))
    const handler = createProxyHandler(mockProxy as any, { method: 'GET', path: '/items/:id' })
    const ctx = { meta: { transport: 'mcp' as const, toolName: 'get_item' } } as ToolContext
    await expect(handler({ id: '999' }, ctx)).rejects.toThrow('Temporarily unavailable')
  })

  it('returns richResult for binary content types', async () => {
    const mockProxy = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: 'base64data',
    }))
    const handler = createProxyHandler(mockProxy as any, { method: 'GET', path: '/avatar' })
    const ctx = { meta: { transport: 'mcp' as const, toolName: 'get_avatar' } } as ToolContext
    const result = await handler({}, ctx) as any
    // richResult is an opaque marker — the pipeline unwraps it
    expect(result).toBeDefined()
  })

  it('forwards parameterLocations to proxy', async () => {
    const mockProxy = vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {},
    }))
    const parameterLocations = { accept: { in: 'header' as const, name: 'Accept' } }
    const handler = createProxyHandler(mockProxy as any, { method: 'GET', path: '/items', parameterLocations })
    const ctx = { meta: { transport: 'mcp' as const, toolName: 'search' } } as ToolContext
    await handler({}, ctx)
    expect(mockProxy).toHaveBeenCalledWith(
      'GET',
      '/items',
      {},
      expect.objectContaining({ parameterLocations }),
    )
  })
})
