/**
 * Auth characterization tests — pin existing auth behavior before refactoring.
 * These test the MCP auth filtering sites plus buildResourceHandler enforcement.
 */
import { z } from 'zod'
import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import { buildResourceHandler, buildStoredResource } from '../src/tool-builder.js'
import { createToolPipeline } from '../src/pipeline.js'
import { AuthError } from '../src/errors.js'
import type { AuthResult, ToolContext, ToolMeta } from '../src/types.js'

// =========================================================================
// Shared fixtures
// =========================================================================

function makeAuthenticator() {
  return async (request: Request) => {
    const token = request.headers.get('authorization')
    if (token === 'Bearer admin-token') return { subject: 'admin-1', roles: ['admin'] }
    if (token === 'Bearer user-token') return { subject: 'user-1', roles: ['user'] }
    throw new AuthError('Invalid token', 401)
  }
}

function buildAppWithAuthToolsAndResources(opts?: {
  authorize?: (tool: any, authResult: any, context: any) => boolean | Promise<boolean>
}) {
  const app = createApp({
    name: 'test-app',
    authenticate: makeAuthenticator(),
    authorize: opts?.authorize,
  })
  app.tool('admin_tool', { description: 'Admin only', auth: ['admin'], handler: () => ({ admin: true }) })
  app.tool('user_tool', { description: 'User or admin', auth: ['user', 'admin'], handler: () => ({ user: true }) })
  app.tool('public_tool', { description: 'Public', handler: () => ({ public: true }) })
  app.resource({ uri: 'data://secret', name: 'secret', description: 'Auth resource', auth: true, handler: () => ({ secret: 'data' }) })
  app.resource({ uri: 'data://public', name: 'public', description: 'Public resource', handler: () => ({ public: 'data' }) })
  app.resource({ uri: 'data://admin-only', name: 'admin-only', description: 'Admin resource', auth: ['admin'], handler: () => ({ admin: 'data' }) })
  app.resourceTemplate({
    uriTemplate: 'config://private/{id}',
    name: 'private-template',
    description: 'Authenticated template',
    params: z.object({ id: z.string() }),
    auth: true,
    handler: ({ id }) => ({ id, private: true }),
  })
  app.resourceTemplate({
    uriTemplate: 'config://public/{id}',
    name: 'public-template',
    description: 'Public template',
    params: z.object({ id: z.string() }),
    handler: ({ id }) => ({ id, public: true }),
  })
  app.resourceTemplate({
    uriTemplate: 'config://admin/{id}',
    name: 'admin-template',
    description: 'Admin template',
    params: z.object({ id: z.string() }),
    auth: ['admin'],
    handler: ({ id }) => ({ id, admin: true }),
  })
  return app
}

// =========================================================================
// tools/list auth filtering
// =========================================================================

describe('tools/list auth filtering', () => {
  it('no headers → public tools visible, auth tools hidden', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(['public_tool'])
  })

  it('valid auth headers → all authorized tools visible', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const tools = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(['admin_tool', 'user_tool', 'public_tool'])
  })

  it('valid auth headers, role mismatch → auth tool hidden, public tool visible', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer user-token' } })
    const tools = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(['user_tool', 'public_tool'])
  })

  it('auth hook throws → only public tools visible', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer bad-token' } })
    const tools = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(['public_tool'])
  })

  it('with custom authorize hook → authorize predicate controls visibility', async () => {
    const app = buildAppWithAuthToolsAndResources({
      authorize: (tool, _authResult, _ctx) => tool.name !== 'admin_tool',
    })
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const tools = await client.listTools()
    // authorize returns false for admin_tool → hidden
    expect(tools.map(t => t.name)).toEqual(['user_tool', 'public_tool'])
  })
})

// =========================================================================
// resources/list auth filtering
// =========================================================================

describe('resources/list auth filtering', () => {
  it('no headers → public resources visible, auth resources hidden', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app)
    const resources = await client.listResources()
    expect(resources.map(r => r.name)).toEqual(['public'])
  })

  it('valid auth headers → all authorized resources visible', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const resources = await client.listResources()
    expect(resources.map(r => r.name)).toEqual(['secret', 'public', 'admin-only'])
  })

  it('valid auth headers, role mismatch → role-restricted resource hidden', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer user-token' } })
    const resources = await client.listResources()
    // user-token has roles: ['user'], admin-only requires ['admin'] → hidden
    // secret has auth: true (any role) → visible
    expect(resources.map(r => r.name)).toEqual(['secret', 'public'])
  })

  it('auth hook throws → only public resources visible', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer bad-token' } })
    const resources = await client.listResources()
    expect(resources.map(r => r.name)).toEqual(['public'])
  })

  it('with custom authorize hook → authorize predicate controls resource visibility', async () => {
    const app = buildAppWithAuthToolsAndResources({
      authorize: (tool, _authResult, _ctx) => tool.name !== 'admin-only',
    })
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const resources = await client.listResources()
    expect(resources.map(r => r.name)).toEqual(['secret', 'public'])
  })
})

// =========================================================================
// resources/templates/list auth filtering
// =========================================================================

describe('resources/templates/list auth filtering', () => {
  it('no headers → public templates visible, auth templates hidden', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app)
    const templates = await client.listResourceTemplates()
    expect(templates.map(t => t.name)).toEqual(['public-template'])
  })

  it('valid auth headers → all authorized templates visible', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const templates = await client.listResourceTemplates()
    expect(templates.map(t => t.name)).toEqual(['private-template', 'public-template', 'admin-template'])
  })

  it('valid auth headers, role mismatch → role-restricted template hidden', async () => {
    const app = buildAppWithAuthToolsAndResources()
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer user-token' } })
    const templates = await client.listResourceTemplates()
    expect(templates.map(t => t.name)).toEqual(['private-template', 'public-template'])
  })

  it('with custom authorize hook → authorize predicate controls template visibility', async () => {
    const app = buildAppWithAuthToolsAndResources({
      authorize: (tool, _authResult, _ctx) => tool.name !== 'admin-template',
    })
    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const templates = await client.listResourceTemplates()
    expect(templates.map(t => t.name)).toEqual(['private-template', 'public-template'])
  })
})

// =========================================================================
// buildResourceHandler auth (access control — throws, doesn't filter)
// =========================================================================

describe('buildResourceHandler auth', () => {
  function makeMeta(name: string, auth: ToolMeta['auth']): ToolMeta {
    return { kind: 'resource', name, tags: [], auth, sideEffects: false }
  }

  function makePipeline(
    storedResources: Array<ReturnType<typeof buildStoredResource>>,
    authenticate?: (request: Request) => AuthResult | Promise<AuthResult>,
  ) {
    return createToolPipeline({
      tools: [],
      resources: storedResources.map(({ config }) => ({
        kind: 'resource' as const,
        name: config.name,
        auth: config.auth,
        handler: (_parsed: unknown, ctx: ToolContext) => config.handler({
          headers: ctx.meta.headers,
          signal: ctx.signal,
        }),
        meta: makeMeta(config.name, config.auth),
        sideEffects: false,
        tags: [],
      })),
      authenticate,
    })
  }

  it('no auth configured, public resource → returns content', async () => {
    const stored = buildStoredResource({ uri: 'data://pub', name: 'pub', description: 'Public', handler: () => ({ data: 42 }) })
    const handler = buildResourceHandler([stored], [], makePipeline([stored]))!
    const result = await handler('data://pub')
    expect(result.content).toEqual({ data: 42 })
  })

  it('auth configured, valid auth → returns content', async () => {
    const stored = buildStoredResource({ uri: 'data://sec', name: 'sec', description: 'Secret', auth: true, handler: () => ({ secret: 'value' }) })
    const handler = buildResourceHandler([stored], [], makePipeline([stored], async () => ({ subject: 'user-1', roles: ['admin'] })))!
    const result = await handler('data://sec', { headers: { authorization: 'Bearer token' } })
    expect(result.content).toEqual({ secret: 'value' })
  })

  it('auth configured, auth throws → surfaces a 500 with provider context', async () => {
    const stored = buildStoredResource({ uri: 'data://sec', name: 'sec', description: 'Secret', auth: true, handler: () => ({ secret: 'value' }) })
    const handler = buildResourceHandler([stored], [], makePipeline([stored], async () => { throw new Error('bad token') }))!
    await expect(handler('data://sec', { headers: { authorization: 'Bearer bad' } }))
      .rejects.toThrow(expect.objectContaining({
        message: 'Authentication provider error: bad token',
        statusCode: 500,
      }))
  })

  it('auth configured, role mismatch → throws AuthError 403', async () => {
    const stored = buildStoredResource({ uri: 'data://admin', name: 'admin', description: 'Admin', auth: ['admin'], handler: () => ({ admin: true }) })
    const handler = buildResourceHandler([stored], [], makePipeline([stored], async () => ({ subject: 'user-1', roles: ['user'] })))!
    await expect(handler('data://admin', { headers: { authorization: 'Bearer user' } }))
      .rejects.toThrow(expect.objectContaining({
        message: 'Forbidden: insufficient roles',
        statusCode: 403,
      }))
    await expect(handler('data://admin', { headers: { authorization: 'Bearer user' } }))
      .rejects.toBeInstanceOf(AuthError)
  })

  it('auth required but no authenticate hook → throws AuthError 401 "Unauthorized"', async () => {
    const stored = buildStoredResource({ uri: 'data://sec', name: 'sec', description: 'Secret', auth: true, handler: () => ({ secret: 'value' }) })
    const handler = buildResourceHandler([stored], [], makePipeline([stored]))!
    await expect(handler('data://sec'))
      .rejects.toThrow(expect.objectContaining({
        message: 'Unauthorized: authentication required',
        statusCode: 401,
      }))
    await expect(handler('data://sec'))
      .rejects.toBeInstanceOf(AuthError)
  })
})
