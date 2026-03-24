import { describe, expect, it, vi } from 'vitest'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { AuthError } from '../src/errors.js'
import type { ToolMeta } from '../src/types.js'
import { bodyOf, statusOf } from './dispatch-outcome.js'

function simpleTool(overrides: Partial<PipelineTool> = {}): PipelineTool {
  return {
    name: 'greet',
    handler: async (args) => ({ message: `Hello, ${(args as any).name}!` }),
    ...overrides,
  }
}

describe('pipeline auth', () => {
  it('skips auth when tool has no auth config', async () => {
    const pipeline = createToolPipeline({
      tools: [simpleTool()],
    })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(statusOf(result)).toBe(200)
  })

  it('accepts pre-resolved authResult from entry point', async () => {
    let ctxAuth: unknown
    const tool = simpleTool({
      auth: {},
      handler: async (_args, ctx) => { ctxAuth = ctx.meta.auth; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool] })

    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'user-1' },
    })
    expect(statusOf(result)).toBe(200)
    expect(ctxAuth).toEqual({ subject: 'user-1' })
  })

  it('returns 401 when auth required but no authResult provided', async () => {
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(401)
  })

  it('returns 403 when auth present but wrong roles', async () => {
    const tool = simpleTool({ auth: { roles: ['admin'] } })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {}, {
      authResult: { subject: 'user-1', roles: ['viewer'] },
    })
    expect(statusOf(result)).toBe(403)
  })

  it('succeeds with correct roles', async () => {
    const tool = simpleTool({ auth: { roles: ['admin'] } })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'admin-1', roles: ['admin'] },
    })
    expect(statusOf(result)).toBe(200)
  })

  it('uses auth from pre-resolved authResult', async () => {
    const tool = simpleTool({
      auth: {},
      handler: async (_args, ctx) => ({ user: ctx.meta.auth?.subject }),
    })
    const pipeline = createToolPipeline({ tools: [tool] })

    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'ctx-user' },
      transport: 'mcp',
    })
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as { user: string }).user).toBe('ctx-user')
  })
})

describe('pipeline authenticate', () => {
  it('calls authenticate when tool requires auth and no authResult provided', async () => {
    const authenticate = vi.fn(async () => ({ subject: 'user-1' }))
    const tool = simpleTool({
      auth: {},
      handler: async (_args, ctx) => ({ user: ctx.meta.auth?.subject }),
    })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })
    const result = await pipeline.dispatch('greet', { name: 'X' }, { headers: { authorization: 'Bearer token' } })
    expect(statusOf(result)).toBe(200)
    expect((bodyOf(result) as { user: string }).user).toBe('user-1')
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it('does NOT call authenticate for public tools', async () => {
    const authenticate = vi.fn(async () => ({ subject: 'user-1' }))
    const tool = simpleTool()
    const pipeline = createToolPipeline({ tools: [tool], authenticate })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(statusOf(result)).toBe(200)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('does NOT call authenticate when authResult already provided', async () => {
    const authenticate = vi.fn(async () => ({ subject: 'should-not-be-used' }))
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })
    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'pre-resolved' },
    })
    expect(statusOf(result)).toBe(200)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('does NOT call authenticate when authResult already provided via dispatch options', async () => {
    const authenticate = vi.fn(async () => ({ subject: 'should-not-be-used' }))
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })

    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'ctx-user' },
      transport: 'mcp',
    })
    expect(statusOf(result)).toBe(200)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('wraps generic errors from authenticate as 500 (not 401)', async () => {
    const authenticate = vi.fn(async () => { throw new TypeError('Cannot read property') })
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(500)
    expect((bodyOf(result) as { error: string }).error).toBe('Authentication provider error: Cannot read property')
  })

  it('rethrows GraftError from authenticate unchanged', async () => {
    const authenticate = vi.fn(async () => { throw new AuthError('Token expired', 401) })
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(401)
    expect((bodyOf(result) as { error: string }).error).toBe('Token expired')
  })

  it('populates authResult on context after authenticate', async () => {
    let ctxAuth: unknown
    const authenticate = vi.fn(async () => ({ subject: 'auth-user', roles: ['admin'] }))
    const tool = simpleTool({
      auth: {},
      handler: async (_args, ctx) => { ctxAuth = ctx.meta.auth; return {} },
    })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })
    await pipeline.dispatch('greet', { name: 'X' })
    expect(ctxAuth).toEqual({ subject: 'auth-user', roles: ['admin'] })
  })

  it('uses opts.request when provided (HTTP path)', async () => {
    let receivedRequest: Request | undefined
    const authenticate = vi.fn(async (request: Request) => {
      receivedRequest = request
      return { subject: 'user-1' }
    })
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })

    const httpRequest = new Request('http://example.com/greet', {
      headers: { authorization: 'Bearer real-token' },
    })
    await pipeline.dispatch('greet', { name: 'X' }, { request: httpRequest })
    expect(receivedRequest).toBe(httpRequest)
  })

  it('falls back to synthetic request from headers when no request (MCP path)', async () => {
    let receivedRequest: Request | undefined
    const authenticate = vi.fn(async (request: Request) => {
      receivedRequest = request
      return { subject: 'user-1' }
    })
    const tool = simpleTool({ auth: {} })
    const pipeline = createToolPipeline({ tools: [tool], authenticate })

    await pipeline.dispatch('greet', { name: 'X' }, { headers: { authorization: 'Bearer syn-token' } })
    expect(receivedRequest).toBeDefined()
    expect(receivedRequest?.headers.get('authorization')).toBe('Bearer syn-token')
    expect(receivedRequest?.url).toBe('http://localhost/')
  })
})

describe('pipeline authorize hook', () => {
  const toolMeta: ToolMeta = {
    kind: 'tool', name: 'greet', tags: [], auth: true, sideEffects: false,
  }

  it('authorize hook blocks dispatch with 403', async () => {
    const authorize = vi.fn(async () => false)
    const tool = simpleTool({
      auth: true,
      meta: toolMeta,
      handler: async () => ({ ok: true }),
    })
    const pipeline = createToolPipeline({ tools: [tool], authorize })
    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'user-1', roles: ['viewer'] },
    })
    expect(statusOf(result)).toBe(403)
    expect((bodyOf(result) as { error: string }).error).toContain('Forbidden')
    expect(authorize).toHaveBeenCalledOnce()
  })

  it('authorize hook allows dispatch', async () => {
    const authorize = vi.fn(async () => true)
    const tool = simpleTool({
      auth: true,
      meta: toolMeta,
      handler: async () => ({ ok: true }),
    })
    const pipeline = createToolPipeline({ tools: [tool], authorize })
    const result = await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'admin-1', roles: ['admin'] },
    })
    expect(statusOf(result)).toBe(200)
    expect(authorize).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledWith(toolMeta, { subject: 'admin-1', roles: ['admin'] }, { phase: 'call', params: { name: 'X' } })
  })

  it('authorize not called for public tools', async () => {
    const authorize = vi.fn(async () => false)
    const tool = simpleTool({
      handler: async () => ({ ok: true }),
    })
    const pipeline = createToolPipeline({ tools: [tool], authorize })
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(statusOf(result)).toBe(200)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('authorize not called when no authResult — 401 takes precedence', async () => {
    const authorize = vi.fn(async () => true)
    const tool = simpleTool({
      auth: true,
      meta: toolMeta,
    })
    const pipeline = createToolPipeline({ tools: [tool], authorize })
    const result = await pipeline.dispatch('greet', {})
    expect(statusOf(result)).toBe(401)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('falls back to default role check when no authorize hook', async () => {
    const tool = simpleTool({
      auth: { roles: ['admin'] },
      meta: { kind: 'tool', name: 'greet', tags: [], auth: { roles: ['admin'] }, sideEffects: false },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    const result = await pipeline.dispatch('greet', {}, {
      authResult: { subject: 'user-1', roles: ['viewer'] },
    })
    expect(statusOf(result)).toBe(403)
    expect((bodyOf(result) as { error: string }).error).toContain('insufficient roles')
  })
})
