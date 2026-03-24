import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import { AuthError, GraftError } from '../src/errors.js'
import { filterByAuth } from '../src/auth.js'
import type { ToolAuth, AuthResult } from '../src/types.js'

describe('authenticate hook', () => {
  it('build() throws when tool requires auth but no authenticate hook', () => {
    const app = createApp({ name: 'test-app' })
    app.tool('secret_tool', {
      description: 'Requires auth',
      auth: true,
      handler: () => ({ secret: 'data' }),
    })

    expect(() => app.build()).toThrow('requires auth but no authenticate hook')
  })

  it('auth enforcement works with authenticate hook on HTTP', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: async (request) => {
        const token = request.headers.get('authorization')
        if (token === 'Bearer valid-token') {
          return { subject: 'user-1', roles: ['admin'] }
        }
        throw new AuthError('Invalid token', 401)
      },
    })
    app.tool('secret_tool', {
      description: 'Requires auth',
      auth: true,
      handler: () => ({ secret: 'data' }),
    })

    const { fetch } = app.build()

    // Without auth header → 401
    const res1 = await fetch(new Request('http://localhost:3000/secret-tool'))
    expect(res1.status).toBe(401)

    // With valid auth header → 200
    const res2 = await fetch(new Request('http://localhost:3000/secret-tool', {
      headers: { 'Authorization': 'Bearer valid-token' },
    }))
    expect(res2.status).toBe(200)
    const body = await res2.json() as any
    expect(body.secret).toBe('data')
  })

  it('auth enforcement checks roles', async () => {
    const app = createApp({
      name: 'test-app',
      authenticate: async (request) => {
        const token = request.headers.get('authorization')
        if (token === 'Bearer admin-token') {
          return { subject: 'admin-1', roles: ['admin'] }
        }
        if (token === 'Bearer user-token') {
          return { subject: 'user-1', roles: ['user'] }
        }
        throw new AuthError('Invalid token', 401)
      },
    })
    app.tool('admin_tool', {
      description: 'Admin only',
      auth: ['admin'],
      handler: () => ({ admin: true }),
    })

    const { fetch } = app.build()

    // User with admin role → 200
    const res1 = await fetch(new Request('http://localhost:3000/admin-tool', {
      headers: { 'Authorization': 'Bearer admin-token' },
    }))
    expect(res1.status).toBe(200)

    // User without admin role → 403
    const res2 = await fetch(new Request('http://localhost:3000/admin-tool', {
      headers: { 'Authorization': 'Bearer user-token' },
    }))
    expect(res2.status).toBe(403)
  })

  it('non-auth tool skips authentication even with hook', async () => {
    const authCalls: string[] = []
    const app = createApp({
      name: 'test-app',
      authenticate: async () => {
        authCalls.push('called')
        return { subject: 'user-1' }
      },
    })
    app.tool('public_tool', {
      description: 'No auth required',
      // no auth property
      handler: () => ({ public: true }),
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/public-tool'))
    expect(res.status).toBe(200)
    expect(authCalls).toEqual([])  // authenticate not called for tools without auth
  })

  it('auth result is available on context', async () => {
    let contextAuth: unknown

    const app = createApp({
      name: 'test-app',
      authenticate: async () => ({ subject: 'user-1', roles: ['admin'] }),
    })
    app.tool('check_auth', {
      description: 'Check auth context',
      auth: true,
      handler: (_, ctx) => {
        contextAuth = ctx.meta.auth
        return { ok: true }
      },
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/check-auth'))
    expect(res.status).toBe(200)
    expect(contextAuth).toEqual({ subject: 'user-1', roles: ['admin'] })
  })
})

describe('auth: string[] shorthand', () => {
  function makeAuthenticator() {
    return async (request: Request) => {
      const token = request.headers.get('authorization')
      if (token === 'Bearer admin-token') return { subject: 'admin-1', roles: ['admin'] }
      if (token === 'Bearer user-token') return { subject: 'user-1', roles: ['user'] }
      if (token === 'Bearer viewer-token') return { subject: 'viewer-1', roles: ['viewer'] }
      throw new AuthError('Invalid token', 401)
    }
  }

  it('auth: ["admin"] — no auth → 401, wrong role → 403, right role → 200', async () => {
    const app = createApp({ name: 'test-app', authenticate: makeAuthenticator() })
    app.tool('admin_only', {
      description: 'Admin only',
      auth: ['admin'],
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()

    // No auth → 401
    const res1 = await fetch(new Request('http://localhost:3000/admin-only'))
    expect(res1.status).toBe(401)

    // Wrong role → 403
    const res2 = await fetch(new Request('http://localhost:3000/admin-only', {
      headers: { 'Authorization': 'Bearer user-token' },
    }))
    expect(res2.status).toBe(403)

    // Right role → 200
    const res3 = await fetch(new Request('http://localhost:3000/admin-only', {
      headers: { 'Authorization': 'Bearer admin-token' },
    }))
    expect(res3.status).toBe(200)
  })

  it('auth: { roles: [...] } explicit form works identically', async () => {
    const app = createApp({ name: 'test-app', authenticate: makeAuthenticator() })
    app.tool('admin_only', {
      description: 'Admin only',
      auth: { roles: ['admin'] },
      handler: () => ({ ok: true }),
    })

    const { fetch } = app.build()

    const res1 = await fetch(new Request('http://localhost:3000/admin-only'))
    expect(res1.status).toBe(401)

    const res2 = await fetch(new Request('http://localhost:3000/admin-only', {
      headers: { 'Authorization': 'Bearer user-token' },
    }))
    expect(res2.status).toBe(403)

    const res3 = await fetch(new Request('http://localhost:3000/admin-only', {
      headers: { 'Authorization': 'Bearer admin-token' },
    }))
    expect(res3.status).toBe(200)
  })

  it('string[] shorthand filters tools/list by role via MCP', async () => {
    const app = createApp({ name: 'test-app', authenticate: makeAuthenticator() })
    app.tool('admin_tool', { description: 'Admin', auth: ['admin'], handler: () => ({}) })
    app.tool('user_tool', { description: 'User', auth: ['user', 'admin'], handler: () => ({}) })
    app.tool('public_tool', { description: 'Public', handler: () => ({}) })

    const adminClient = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
    const userClient = createMcpTestClient(app, { headers: { authorization: 'Bearer user-token' } })
    const viewerClient = createMcpTestClient(app, { headers: { authorization: 'Bearer viewer-token' } })

    const adminTools = await adminClient.listTools()
    const userTools = await userClient.listTools()
    const viewerTools = await viewerClient.listTools()

    expect(adminTools.map(t => t.name)).toEqual(['admin_tool', 'user_tool', 'public_tool'])
    expect(userTools.map(t => t.name)).toEqual(['user_tool', 'public_tool'])
    expect(viewerTools.map(t => t.name)).toEqual(['public_tool'])
  })

  it('rejects auth: [] (empty roles array)', () => {
    const app = createApp({ name: 'test-app', authenticate: makeAuthenticator() })
    expect(() => app.tool('bad_tool', {
      description: 'Bad',
      auth: [],
      handler: () => ({}),
    })).toThrow('empty roles array')
  })
})

describe('filterByAuth', () => {
  interface Item { name: string; auth?: ToolAuth }

  const publicItem: Item = { name: 'public' }
  const authItem: Item = { name: 'auth', auth: true }
  const adminItem: Item = { name: 'admin', auth: ['admin'] }
  const items = [publicItem, authItem, adminItem]

  const goodAuth = async () => ({ subject: 'user-1', roles: ['admin'] } as AuthResult)
  const userAuth = async () => ({ subject: 'user-1', roles: ['user'] } as AuthResult)
  const failAuth = async (): Promise<AuthResult> => { throw new Error('bad') }

  it('no headers → returns only public items', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      authenticate: goodAuth,
    })
    expect(result.map(i => i.name)).toEqual(['public'])
  })

  it('empty headers → returns only public items', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      headers: {},
      authenticate: goodAuth,
    })
    expect(result.map(i => i.name)).toEqual(['public'])
  })

  it('headers + successful auth → filters by roles', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      headers: { authorization: 'Bearer token' },
      authenticate: goodAuth,
    })
    expect(result.map(i => i.name)).toEqual(['public', 'auth', 'admin'])
  })

  it('headers + unexpected auth failure surfaces a 500', async () => {
    try {
      await filterByAuth(items, i => i.auth, {
        headers: { authorization: 'Bearer bad' },
        authenticate: failAuth,
      })
      expect.unreachable('should have thrown')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GraftError)
      if (!(error instanceof GraftError)) {
        throw error
      }
      expect(error.message).toBe('Failed to evaluate auth visibility: bad')
      expect(error.cause).toBeInstanceOf(Error)
    }
  })

  it('headers + auth returns null → returns only public items', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      headers: { authorization: 'Bearer token' },
      authenticate: (async () => null) as any,
    })
    expect(result.map(i => i.name)).toEqual(['public'])
  })

  it('with authorize predicate → uses predicate instead of role check', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      headers: { authorization: 'Bearer token' },
      authenticate: goodAuth,
      authorize: (item, _authResult) => item.name !== 'admin',
    })
    expect(result.map(i => i.name)).toEqual(['public', 'auth'])
  })

  it('public items still pass through for expected auth failures', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      headers: { authorization: 'Bearer token' },
      authenticate: async () => { throw new AuthError('bad token', 401) },
    })
    expect(result).toContain(publicItem)
  })

  it('mixed public/auth items with partial role match', async () => {
    const result = await filterByAuth(items, i => i.auth, {
      headers: { authorization: 'Bearer token' },
      authenticate: userAuth,
    })
    // user has role 'user', adminItem requires 'admin' → excluded
    expect(result.map(i => i.name)).toEqual(['public', 'auth'])
  })
})
