import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { AuthError } from '../src/errors.js'
import { zodToJsonSchemaOrNull } from '../src/schema.js'
import { createMcpTestClient } from '../src/testing.js'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import type { ToolMeta } from '../src/types.js'
import { statusOf } from './dispatch-outcome.js'

// =========================================================================
// z.record(z.string()) crash → clear error message
// =========================================================================

describe('z.record() single-arg crash', () => {
  it('throws clear error for z.record(z.string()) single-arg form', () => {
    const recordWithValueOnly = z.record as unknown as (valueType: z.ZodString) => z.ZodTypeAny
    const schema = z.object({
      metadata: recordWithValueOnly(z.string()),
    })

    expect(() => zodToJsonSchemaOrNull(schema)).toThrow(
      /z\.record\(\).*provide both key and value types/,
    )
  })

  it('z.record(z.string(), z.string()) two-arg form works fine', () => {
    const schema = z.object({
      metadata: z.record(z.string(), z.string()),
    })

    const result = zodToJsonSchemaOrNull(schema)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('object')
  })

  it('other Zod conversion errors get a generic message', () => {
    // Create a schema that will fail conversion for a different reason
    const badSchema = { _zod: true }

    expect(() => zodToJsonSchemaOrNull(badSchema)).toThrow(
      /Zod schema conversion failed/,
    )
  })
})

// =========================================================================
// authorize hook receives params
// =========================================================================

describe('authorize hook receives params', () => {
  const toolMeta: ToolMeta = {
    kind: 'tool', name: 'update_account', tags: [], auth: true, sideEffects: true,
  }

  it('authorize receives rawArgs on tool dispatch', async () => {
    const authorize = vi.fn(async () => true)
    const tool: PipelineTool = {
      name: 'update_account',
      auth: true,
      meta: toolMeta,
      handler: async () => ({ ok: true }),
    }
    const pipeline = createToolPipeline({ tools: [tool], authorize })
    await pipeline.dispatch('update_account', { accountId: '123', amount: 50 }, {
      authResult: { subject: 'user-1' },
    })

    expect(authorize).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledWith(
      toolMeta,
      { subject: 'user-1' },
      { phase: 'call', params: { accountId: '123', amount: 50 } },
    )
  })

  it('authorize can use params for ownership check', async () => {
    const authorize = vi.fn(async (_tool: ToolMeta, auth: any, ctx: { phase: string; params?: Record<string, unknown> }) => {
      // Only allow if the user owns the account
      return ctx.params?.ownerId === auth.subject
    })
    const tool: PipelineTool = {
      name: 'update_account',
      auth: true,
      meta: toolMeta,
      handler: async () => ({ ok: true }),
    }
    const pipeline = createToolPipeline({ tools: [tool], authorize })

    // User owns the account
    const allowed = await pipeline.dispatch('update_account', { ownerId: 'user-1' }, {
      authResult: { subject: 'user-1' },
    })
    expect(statusOf(allowed)).toBe(200)

    // User does NOT own the account
    const denied = await pipeline.dispatch('update_account', { ownerId: 'user-2' }, {
      authResult: { subject: 'user-1' },
    })
    expect(statusOf(denied)).toBe(403)
  })

  it('tools/list passes undefined for params', async () => {
    const authorize = vi.fn(async () => true)
    const app = createApp({
      name: 'test',
      authenticate: async () => ({ subject: 'user-1', roles: ['admin'] }),
      authorize,
    })
    app.tool('secret', {
      description: 'Secret tool',
      auth: true,
      handler: () => ({ ok: true }),
    })

    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer token' },
    })
    await client.listTools()

    expect(authorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { phase: 'list' },
    )
  })
})

// =========================================================================
// Static resource auth
// =========================================================================

describe('static resource auth', () => {
  function createAuthApp() {
    const app = createApp({
      name: 'test',
      authenticate: async (req) => {
        const token = req.headers.get('authorization')?.replace('Bearer ', '')
        if (!token) throw new AuthError('No token', 401)
        if (token === 'admin-token') return { subject: 'admin', roles: ['admin'] }
        if (token === 'viewer-token') return { subject: 'viewer', roles: ['viewer'] }
        throw new AuthError('Invalid token', 401)
      },
    })

    // Public resource — no auth
    app.resource({
      uri: 'config://public',
      name: 'public_config',
      description: 'Public config',
      handler: () => ({ public: true }),
    })

    // Admin-only resource
    app.resource({
      uri: 'config://admin',
      name: 'admin_config',
      description: 'Admin config',
      auth: ['admin'],
      handler: () => ({ secret: 'admin-data' }),
    })

    // Any-authenticated resource
    app.resource({
      uri: 'config://private',
      name: 'private_config',
      description: 'Private config',
      auth: true,
      handler: () => ({ private: true }),
    })

    // Need a tool so MCP adapter registers
    app.tool('noop', {
      description: 'No-op',
      handler: () => ({}),
    })

    return app
  }

  it('admin can read admin resource', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer admin-token' },
    })
    const result = await client.readResource('config://admin')
    expect(result.text).toContain('admin-data')
  })

  it('viewer gets 401/403 reading admin resource', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer viewer-token' },
    })
    // Should throw because the MCP handler throws GraftError
    await expect(client.readResource('config://admin')).rejects.toThrow()
  })

  it('unauthenticated gets error reading admin resource', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app)
    await expect(client.readResource('config://admin')).rejects.toThrow()
  })

  it('public resource still works without auth', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app)
    const result = await client.readResource('config://public')
    expect(result.text).toContain('public')
  })

  it('unexpected static-resource auth provider failures surface as 500s', async () => {
    const app = createApp({
      name: 'test',
      authenticate: async () => { throw new Error('auth backend down') },
    })

    app.resource({
      uri: 'config://private',
      name: 'private_config',
      description: 'Private config',
      auth: true,
      handler: () => ({ private: true }),
    })

    app.tool('noop', {
      description: 'No-op',
      handler: () => ({}),
    })

    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer viewer-token' },
    })

    await expect(client.readResource('config://private')).rejects.toThrow(/Authentication provider error/)
  })

  it('any-authenticated user can read auth:true resource', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer viewer-token' },
    })
    const result = await client.readResource('config://private')
    expect(result.text).toContain('private')
  })

  it('resources/list hides auth-protected resources from unauthenticated clients', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app)
    const resources = await client.listResources()
    const uris = resources.map(r => r.uri)
    expect(uris).toContain('config://public')
    expect(uris).not.toContain('config://admin')
    expect(uris).not.toContain('config://private')
  })

  it('resources/list shows all resources to admin', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer admin-token' },
    })
    const resources = await client.listResources()
    const uris = resources.map(r => r.uri)
    expect(uris).toContain('config://public')
    expect(uris).toContain('config://admin')
    expect(uris).toContain('config://private')
  })

  it('resources/list shows auth:true resources to viewer but not admin-only', async () => {
    const app = createAuthApp()
    const client = createMcpTestClient(app, {
      headers: { authorization: 'Bearer viewer-token' },
    })
    const resources = await client.listResources()
    const uris = resources.map(r => r.uri)
    expect(uris).toContain('config://public')
    expect(uris).not.toContain('config://admin')
    expect(uris).toContain('config://private')
  })

  it('resource without auth is still public (no regression)', async () => {
    const app = createApp({ name: 'test' })
    app.resource({
      uri: 'data://items',
      name: 'items',
      description: 'Items list',
      handler: () => [{ id: 1 }],
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)
    const result = await client.readResource('data://items')
    expect(result.text).toContain('id')
  })

  it('resource with auth but no authenticate hook throws at build time', () => {
    const app = createApp({ name: 'test' })
    app.resource({
      uri: 'secret://data',
      name: 'secret',
      description: 'Secret data',
      auth: ['admin'],
      handler: () => ({ secret: true }),
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    expect(() => app.build()).toThrow(/authenticate/)
  })
})

// =========================================================================
// Rich MCP error messages
// =========================================================================

describe('rich MCP error messages', () => {
  it('prompts/get with missing required param includes field-level details', async () => {
    const app = createApp({ name: 'test' })
    app.prompt({
      name: 'greet',
      description: 'Greet someone',
      params: z.object({ orgName: z.string(), greeting: z.string().optional() }),
      handler: (params) => [{ role: 'user', content: `Hello ${params.orgName}` }],
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)

    try {
      await client.getPrompt('greet', {})
      expect.unreachable('Should have thrown')
    } catch (err: any) {
      // Error message should include field-level detail
      expect(err.message).toContain('orgName')
      // data should include structured details
      expect(err.data).toBeDefined()
      expect(err.data.details).toBeInstanceOf(Array)
      expect(err.data.details.length).toBeGreaterThan(0)
      expect(err.data.details[0]).toHaveProperty('path')
      expect(err.data.details[0]).toHaveProperty('message')
    }
  })

  it('prompts/get error includes data.status', async () => {
    const app = createApp({ name: 'test' })
    app.prompt({
      name: 'greet',
      description: 'Greet',
      params: z.object({ name: z.string() }),
      handler: (params) => [{ role: 'user', content: params.name }],
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)

    try {
      await client.getPrompt('greet', {})
      expect.unreachable('Should have thrown')
    } catch (err: any) {
      expect(err.data.status).toBe(400)
    }
  })

  it('resources/read for unknown URI has clean message (not doubled)', async () => {
    const app = createApp({ name: 'test' })
    app.resource({
      uri: 'data://exists',
      name: 'exists',
      description: 'Exists',
      handler: () => 'data',
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)

    try {
      await client.readResource('data://missing')
      expect.unreachable('Should have thrown')
    } catch (err: any) {
      // Should NOT have doubled prefix like "NOT_FOUND: Unknown resource: ..."
      expect(err.message).not.toMatch(/NOT_FOUND:/)
      expect(err.message).toContain('Unknown resource')
    }
  })

  it('test client error has .code and .data properties', async () => {
    const app = createApp({ name: 'test' })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)

    try {
      await client.getPrompt('nonexistent')
      expect.unreachable('Should have thrown')
    } catch (err: any) {
      expect(err.code).toBeDefined()
      expect(typeof err.code).toBe('number')
    }
  })

  it('protocol version mismatch returns proper JSON-RPC error', async () => {
    const app = createApp({ name: 'test' })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const handler = app.toFetch()

    // First do an initialize to get past the "skip on initialize" check
    // Then send a request with a bad version header
    const res = await handler(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '1999-01-01',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }))

    const body = await res.json() as any
    // Should be proper JSON-RPC format
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toContain('Unsupported MCP protocol version')
    expect(body.id).toBeNull()
  })

  it('multiple validation errors are joined in message', async () => {
    const app = createApp({ name: 'test' })
    app.prompt({
      name: 'multi',
      description: 'Multi-param',
      params: z.object({ orgName: z.string(), amount: z.number() }),
      handler: () => [{ role: 'user', content: 'test' }],
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)

    try {
      await client.getPrompt('multi', {})
      expect.unreachable('Should have thrown')
    } catch (err: any) {
      // Should mention both fields
      expect(err.message).toContain('orgName')
      expect(err.message).toContain('amount')
      expect(err.data.details.length).toBe(2)
    }
  })

  it('resource template with bad params preserves validation details', async () => {
    const app = createApp({ name: 'test' })
    app.resourceTemplate({
      uriTemplate: 'users://{userId}',
      name: 'user',
      description: 'Get user',
      params: z.object({ userId: z.string().uuid() }),
      handler: (params) => ({ id: params.userId }),
    })
    app.tool('noop', { description: 'No-op', handler: () => ({}) })

    const client = createMcpTestClient(app)

    try {
      await client.readResource('users://not-a-uuid')
      expect.unreachable('Should have thrown')
    } catch (err: any) {
      // The error should contain validation info, not just a generic status code
      expect(err.message).toContain('userId')
    }
  })
})
