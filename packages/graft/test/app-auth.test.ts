import type { AuthResult } from '../src/types.js'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { authenticateNodeRequest, createApp } from '../src/app.js'
import { AuthError, GraftError } from '../src/errors.js'
import { createMcpTestClient } from '../src/testing.js'
import { bodyOf, statusOf } from './dispatch-outcome.js'

describe('authorize hook', () => {
  function createAuthApp(authorize: (tool: any, authResult: any, ctx: any) => boolean | Promise<boolean>) {
    return createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        const role = auth.replace('Bearer ', '')
        return { subject: 'user1', roles: [role] }
      },
      authorize,
    })
  }

  it('default behavior unchanged — no authorize, tool with auth roles hides from wrong role in tools/list', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new AuthError('No auth')
        return { subject: 'user1', roles: ['viewer'] }
      },
    })
    app.tool('admin_tool', { description: 'Admin only', auth: ['admin'], handler: () => ({}) })
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer viewer' } })
    const tools = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('public_tool')
    expect(names).not.toContain('admin_tool')
  })

  it('custom authorize filters tools/list — viewer cannot see admin tools', async () => {
    const app = createAuthApp((tool, authResult) => {
      if (tool.name === 'admin_tool') return authResult.roles?.includes('admin') ?? false
      return true
    })
    app.tool('admin_tool', { description: 'Admin only', auth: true, handler: () => ({}) })
    app.tool('viewer_tool', { description: 'Viewer tool', auth: true, handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer viewer' } })
    const tools = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('viewer_tool')
    expect(names).not.toContain('admin_tool')
  })

  it('custom authorize enforces on dispatch — viewer gets 403', async () => {
    const app = createAuthApp((tool, authResult) => {
      if (tool.name === 'admin_tool') return authResult.roles?.includes('admin') ?? false
      return true
    })
    app.tool('admin_tool', {
      description: 'Admin only',
      auth: true,
      sideEffects: true,
      params: z.object({ data: z.string() }),
      handler: ({ data }) => ({ data }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/admin-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer viewer',
      },
      body: JSON.stringify({ data: 'test' }),
    }))
    expect(res.status).toBe(403)
  })

  it('visibility and enforcement use same hook — viewer cannot see AND cannot call', async () => {
    const authorizeFn = (tool: any, authResult: any) => {
      if (tool.name === 'admin_tool') return authResult.roles?.includes('admin') ?? false
      return true
    }
    const app = createAuthApp(authorizeFn)
    app.tool('admin_tool', {
      description: 'Admin only',
      auth: true,
      sideEffects: true,
      params: z.object({ data: z.string() }),
      handler: ({ data }) => ({ data }),
    })
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer viewer' } })
    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).not.toContain('admin_tool')

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/admin-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer viewer',
      },
      body: JSON.stringify({ data: 'test' }),
    }))
    expect(res.status).toBe(403)
  })

  it('public tools always visible — authorize not called for public tools', async () => {
    let authorizeCalled = false
    const app = createAuthApp(() => {
      authorizeCalled = true
      return false
    })
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })

    const client = createMcpTestClient(app, { headers: { authorization: 'Bearer viewer' } })
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('public_tool')
    expect(authorizeCalled).toBe(false)
  })

  it('unauthenticated callers see only public tools — authorize not called', async () => {
    let authorizeCalled = false
    const app = createAuthApp(() => {
      authorizeCalled = true
      return true
    })
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })
    app.tool('admin_tool', { description: 'Admin', auth: true, handler: () => ({}) })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('public_tool')
    expect(authorizeCalled).toBe(false)
  })

  it('async authorize works', async () => {
    vi.useFakeTimers()
    const app = createAuthApp(async (tool, authResult) => {
      await new Promise(resolve => setTimeout(resolve, 1))
      if (tool.name === 'admin_tool') return authResult.roles?.includes('admin') ?? false
      return true
    })
    app.tool('admin_tool', { description: 'Admin only', auth: true, handler: () => ({}) })
    app.tool('viewer_tool', { description: 'Viewer tool', auth: true, handler: () => ({}) })

    const adminClient = createMcpTestClient(app, { headers: { authorization: 'Bearer admin' } })
    const adminToolsPromise = adminClient.listTools()
    await vi.runAllTimersAsync()
    const adminTools = await adminToolsPromise
    expect(adminTools.map((t) => t.name)).toContain('admin_tool')
    expect(adminTools.map((t) => t.name)).toContain('viewer_tool')

    const viewerClient = createMcpTestClient(app, { headers: { authorization: 'Bearer viewer' } })
    const viewerToolsPromise = viewerClient.listTools()
    await vi.runAllTimersAsync()
    const viewerTools = await viewerToolsPromise
    expect(viewerTools.map((t) => t.name)).toContain('viewer_tool')
    expect(viewerTools.map((t) => t.name)).not.toContain('admin_tool')
    vi.useRealTimers()
  })

  it('admin with custom authorize sees and calls admin_tool successfully', async () => {
    const app = createAuthApp((tool, authResult) => {
      if (tool.name === 'admin_tool') return authResult.roles?.includes('admin') ?? false
      return true
    })
    app.tool('admin_tool', {
      description: 'Admin only',
      auth: true,
      sideEffects: true,
      params: z.object({ data: z.string() }),
      handler: ({ data }) => ({ result: data }),
    })

    const result = await app.dispatch('admin_tool', { data: 'hello' }, { headers: { authorization: 'Bearer admin' } })
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as { result: string }).result).toBe('hello')
  })
})

describe('typed AuthResult inference', () => {
  it('handler ctx.meta.auth has inferred custom fields from authenticate', async () => {
    let receivedAuth: unknown

    const app = createApp({
      name: 'test-app',
      authenticate: async () => ({ subject: 'u1', orgId: 'org-42' }),
    })
    app.tool('get_org', {
      description: 'Get org',
      auth: true,
      handler: (_params, ctx) => {
        receivedAuth = ctx.meta.auth
        return { orgId: ctx.meta.auth?.orgId }
      },
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/get-org'))
    expect(receivedAuth).toEqual({ subject: 'u1', orgId: 'org-42' })
  })

  it('authorize hook sees TAuth fields', async () => {
    let receivedOrgId: unknown

    const app = createApp({
      name: 'test-app',
      authenticate: async () => ({ subject: 'u1', orgId: 'org-99' }),
      authorize: (_tool, authResult) => {
        receivedOrgId = authResult.orgId
        return true
      },
    })
    app.tool('check_org', {
      description: 'Check org',
      auth: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/check-org'))
    expect(receivedOrgId).toBe('org-99')
  })

  it('middleware sees TAuth fields via app.use()', async () => {
    let middlewareOrgId: unknown

    const app = createApp({
      name: 'test-app',
      authenticate: async () => ({ subject: 'u1', orgId: 'org-77' }),
    })
    app.use(async (ctx, next) => {
      middlewareOrgId = ctx.meta.auth?.orgId
      return next()
    })
    app.tool('mw_test', {
      description: 'Middleware test',
      auth: true,
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()
    await fetch(new Request('http://localhost:3000/mw-test'))
    expect(middlewareOrgId).toBe('org-77')
  })

  it('default AuthResult when no authenticate (backward compat)', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('public_tool', {
      description: 'Public',
      handler: (_params, ctx) => ({ hasAuth: ctx.meta.auth !== undefined }),
    })

    const { mcp } = app.build()
    expect(mcp.getManifest().tools.length).toBe(1)
  })

  it('base AuthResult has no index signature (custom fields require augmentation or generics)', () => {
    const authResult = { subject: 'u1', roles: ['admin'] } satisfies AuthResult
    expect(authResult.subject).toBe('u1')
    expect(authResult.roles).toEqual(['admin'])
    expect((authResult as AuthResult & { orgId?: string }).orgId).toBeUndefined()
  })
})

describe('app.authenticate()', () => {
  it('delegates to configured authenticate hook', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: async (req) => {
        const token = req.headers.get('authorization')
        return { subject: token ?? 'anon' }
      },
    })
    app.tool('greet', { description: 'hi', handler: () => 'hi' })

    const request = new Request('http://localhost/test', {
      headers: { authorization: 'user-123' },
    })
    const auth = await app.authenticate(request)
    expect(auth.subject).toBe('user-123')
  })

  it('throws GraftError when no authenticate hook configured', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', { description: 'hi', handler: () => 'hi' })

    const request = new Request('http://localhost/test')
    await expect(app.authenticate(request)).rejects.toThrow('No authenticate hook configured')
  })

  it('wraps non-GraftError auth failures in GraftError(500)', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: () => { throw new TypeError('bad token') },
    })
    app.tool('greet', { description: 'hi', handler: () => 'hi' })

    const request = new Request('http://localhost/test')
    try {
      await app.authenticate(request)
      expect.unreachable('should have thrown')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GraftError)
      if (!(error instanceof GraftError)) {
        throw error
      }
      expect(error.statusCode).toBe(500)
      expect(error.message).toBe('Authentication failed: bad token')
      expect(error.cause).toBeInstanceOf(TypeError)
    }
  })

  it('re-throws GraftError from authenticate hook as-is', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: () => { throw new GraftError('Custom auth error', 403) },
    })
    app.tool('greet', { description: 'hi', handler: () => 'hi' })

    const request = new Request('http://localhost/test')
    try {
      await app.authenticate(request)
      expect.unreachable('should have thrown')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GraftError)
      if (!(error instanceof GraftError)) {
        throw error
      }
      expect(error.statusCode).toBe(403)
      expect(error.message).toBe('Custom auth error')
    }
  })

  it('authenticateNodeRequest() accepts IncomingMessage and delegates to authenticate hook', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: async (req) => {
        const token = req.headers.get('authorization')
        return { subject: token ?? 'anon' }
      },
    })
    app.tool('greet', { description: 'hi', handler: () => 'hi' })

    const incomingMessage = {
      method: 'GET',
      url: '/ws',
      headers: {
        host: 'localhost:3000',
        authorization: 'ws-user-42',
      },
      httpVersion: '1.1',
    }

    const auth = await authenticateNodeRequest(app, incomingMessage as never)
    expect(auth.subject).toBe('ws-user-42')
  })

  it('authenticateNodeRequest() throws on auth failure with IncomingMessage', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: (req) => {
        const auth = req.headers.get('authorization')
        if (!auth) throw new Error('No token')
        return { subject: auth }
      },
    })
    app.tool('greet', { description: 'hi', handler: () => 'hi' })

    const incomingMessage = {
      method: 'GET',
      url: '/ws',
      headers: {},
      httpVersion: '1.1',
    }

    await expect(authenticateNodeRequest(app, incomingMessage as never)).rejects.toThrow('No token')
  })
})
