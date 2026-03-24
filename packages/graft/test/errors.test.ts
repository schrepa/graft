import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import { ToolError, AuthError, ValidationError, GraftError } from '../src/errors.js'

describe('error hierarchy', () => {
  it('GraftError has correct defaults', () => {
    const err = new GraftError('something failed')
    expect(err.statusCode).toBe(500)
    expect(err.message).toBe('something failed')
    expect(err.name).toBe('GraftError')
    expect(err).toBeInstanceOf(Error)
  })

  it('ToolError carries status code', () => {
    const err = new ToolError('Item not found', 404)
    expect(err.statusCode).toBe(404)
    expect(err.name).toBe('ToolError')
    expect(err).toBeInstanceOf(GraftError)
    expect(err).toBeInstanceOf(Error)
  })

  it('GraftError carries explicit code', () => {
    const err = new GraftError('Rate limited', 429, 'RATE_LIMITED')
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.statusCode).toBe(429)
  })

  it('ToolError accepts options with code and headers', () => {
    const err = new ToolError('Already in cart', 409, { code: 'ALREADY_IN_CART', headers: { 'X-Reason': 'duplicate' } })
    expect(err.code).toBe('ALREADY_IN_CART')
    expect(err.headers).toEqual({ 'X-Reason': 'duplicate' })
    expect(err.statusCode).toBe(409)
  })

  it('ToolError works with no options', () => {
    const err = new ToolError('Server error')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBeUndefined()
    expect(err.headers).toBeUndefined()
  })

  it('ValidationError defaults to 400 and holds details', () => {
    const details = [{ path: 'name', message: 'Required' }]
    const err = new ValidationError('Invalid input', details)
    expect(err.statusCode).toBe(400)
    expect(err.name).toBe('ValidationError')
    expect(err.details).toEqual(details)
    expect(err).toBeInstanceOf(GraftError)
  })

  it('ValidationError details defaults to empty array', () => {
    const err = new ValidationError('Bad input')
    expect(err.details).toEqual([])
  })

  it('AuthError defaults to 401', () => {
    const err = new AuthError()
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Unauthorized')
    expect(err.name).toBe('AuthError')
    expect(err).toBeInstanceOf(GraftError)
  })

  it('AuthError supports 403', () => {
    const err = new AuthError('Forbidden', 403)
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('Forbidden')
  })
})

describe('typed errors in HTTP routes', () => {
  it('ToolError maps to correct HTTP status on GET', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('find_item', {
      description: 'Find item',
      params: z.object({ id: z.string() }),
      handler: ({ id }) => { throw new ToolError(`Item ${id} not found`, 404) },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/find-item?id=123'))
    expect(res.status).toBe(404)
    const body = await res.json() as any
    expect(body.error).toBe('Item 123 not found')
  })

  it('ToolError maps to correct HTTP status on POST', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create item',
      sideEffects: true,
      params: z.object({ name: z.string() }),
      handler: () => { throw new ToolError('Conflict: already exists', 409) },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/create-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(409)
    const body = await res.json() as any
    expect(body.error).toBe('Conflict: already exists')
  })

  it('AuthError returns 401 from route handler', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('secret_data', {
      description: 'Get secret data',
      handler: () => { throw new AuthError('Token expired', 401) },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/secret-data'))
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toBe('Token expired')
  })

  it('ToolError propagates through router catch', async () => {
    const app = createApp({ name: 'test-app' })
    app.route('GET', '/boom', () => {
      throw new ToolError('Service unavailable', 503)
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/boom'))
    expect(res.status).toBe(503)
    const body = await res.json() as any
    expect(body.error).toBe('Service unavailable')
  })
})

describe('typed errors in MCP tool calls', () => {
  it('ToolError in handler becomes MCP error response', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('fail_tool', {
      description: 'Always fails',
      handler: () => { throw new ToolError('Not found', 404) },
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('fail_tool') as any
    expect(result.error).toBe('NOT_FOUND')
    expect(result.status).toBe(404)
  })

  it('explicit error code surfaces in MCP response', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('cart_tool', {
      description: 'Add to cart',
      sideEffects: true,
      handler: () => { throw new ToolError('Item already in cart', 409, { code: 'ALREADY_IN_CART' }) },
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('cart_tool') as any
    expect(result.error).toBe('ALREADY_IN_CART')
    expect(result.status).toBe(409)
  })

  it('409 without explicit code maps to CONFLICT', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('conflict_tool', {
      description: 'Conflict',
      sideEffects: true,
      handler: () => { throw new ToolError('Conflict', 409) },
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('conflict_tool') as any
    expect(result.error).toBe('CONFLICT')
  })

  it('429 without explicit code maps to RATE_LIMITED', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('rate_tool', {
      description: 'Rate limited',
      handler: () => { throw new ToolError('Too many requests', 429) },
    })

    const client = createMcpTestClient(app)
    const result = await client.callTool('rate_tool') as any
    expect(result.error).toBe('RATE_LIMITED')
  })

})
