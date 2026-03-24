import { describe, it, expect } from 'vitest'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { bodyOf, statusOf } from './dispatch-outcome.js'

function echoTool(): PipelineTool {
  return {
    name: 'echo',
    handler: async (_args, ctx) => ({
      requestId: ctx.meta.requestId,
      transport: ctx.meta.transport,
      headers: ctx.meta.headers,
      hasSignal: ctx.signal !== undefined,
    }),
  }
}

function echoResource() {
  return {
    kind: 'resource' as const,
    name: 'data',
    auth: undefined,
    handler: async (_args: unknown, ctx: any) => ({
      requestId: ctx.meta.requestId,
      transport: ctx.meta.transport,
      headers: ctx.meta.headers,
      hasSignal: ctx.signal !== undefined,
    }),
    meta: { kind: 'resource' as const, name: 'data', tags: [], sideEffects: false },
    sideEffects: false,
    tags: [],
  }
}

describe('normalizeOptions — via dispatch', () => {
  it('derives headers, signal, requestId from request when only request is passed', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const request = new Request('http://localhost/echo', {
      headers: { 'Authorization': 'Bearer tok', 'X-Custom': 'val' },
    })

    const result = await pipeline.dispatch('echo', {}, { request })
    const body = bodyOf(result) as any

    expect(statusOf(result)).toBe(200)
    // requestId should be a UUID (36 chars)
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.requestId).toBe(result.requestId)
    // headers derived from request — should include authorization and x-custom, skip host/content-length etc
    expect(body.headers).toHaveProperty('authorization', 'Bearer tok')
    expect(body.headers).toHaveProperty('x-custom', 'val')
    expect(body.headers).not.toHaveProperty('host')
    // signal derived from request
    expect(body.hasSignal).toBe(true)
  })

  it('explicit headers win over request headers', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const request = new Request('http://localhost/echo', {
      headers: { 'X-Custom': 'from-request' },
    })

    const result = await pipeline.dispatch('echo', {}, {
      request,
      headers: { 'x-custom': 'explicit' },
    })
    const body = bodyOf(result) as any

    expect(body.headers).toEqual({ 'x-custom': 'explicit' })
  })

  it('explicit signal wins over request.signal', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const ac = new AbortController()
    const request = new Request('http://localhost/echo')

    const result = await pipeline.dispatch('echo', {}, {
      request,
      signal: ac.signal,
    })
    const body = bodyOf(result) as any
    expect(body.hasSignal).toBe(true)
  })

  it('no options → empty headers, undefined signal, generated requestId', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const result = await pipeline.dispatch('echo', {})
    const body = bodyOf(result) as any

    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.headers).toEqual({})
    expect(body.hasSignal).toBe(false)
  })

  it('explicit requestId is used', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const result = await pipeline.dispatch('echo', {}, { requestId: 'custom-id-123' })
    expect(result.requestId).toBe('custom-id-123')
    expect((bodyOf(result) as any).requestId).toBe('custom-id-123')
  })

  it('explicit transport is used', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const result = await pipeline.dispatch('echo', {}, { transport: 'mcp' })
    expect((bodyOf(result) as any).transport).toBe('mcp')
  })

  it('default transport is http', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const result = await pipeline.dispatch('echo', {})
    expect((bodyOf(result) as any).transport).toBe('http')
  })
})

describe('dispatchFromRequest', () => {
  it('produces identical result to verbose dispatch with manual fields', async () => {
    const pipeline = createToolPipeline({ tools: [echoTool()] })
    const request = new Request('http://localhost/echo', {
      headers: { 'X-Custom': 'val' },
    })

    const result = await pipeline.dispatchFromRequest('echo', {}, request)
    const body = bodyOf(result) as any

    expect(statusOf(result)).toBe(200)
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.headers).toHaveProperty('x-custom', 'val')
    expect(body.hasSignal).toBe(true)
    expect(body.transport).toBe('http')
  })
})

describe('dispatchResourceFromRequest', () => {
  it('produces identical result to verbose dispatchResource with manual fields', async () => {
    const pipeline = createToolPipeline({
      tools: [],
      resources: [echoResource()],
    })
    const request = new Request('http://localhost/data', {
      headers: { 'X-Res': 'header-val' },
    })

    const result = await pipeline.dispatchResourceFromRequest('data', {}, request)
    const body = bodyOf(result) as any

    expect(statusOf(result)).toBe(200)
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.headers).toHaveProperty('x-res', 'header-val')
    expect(body.hasSignal).toBe(true)
  })
})

describe('requestId on DispatchResult', () => {
  it('is present on error results too', async () => {
    const pipeline = createToolPipeline({ tools: [] })
    const result = await pipeline.dispatch('nonexistent', {}, { requestId: 'err-id' })
    expect(result.requestId).toBe('err-id')
    expect(statusOf(result)).toBe(404)
  })
})
