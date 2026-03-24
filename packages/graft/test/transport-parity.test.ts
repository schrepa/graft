import { describe, it, expect } from 'vitest'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { statusOf } from './dispatch-outcome.js'

describe('transport parity', () => {
  it('result.requestId is always present and a valid UUID string', async () => {
    const tool: PipelineTool = {
      name: 'ping',
      handler: async () => 'pong',
    }
    const pipeline = createToolPipeline({ tools: [tool] })

    // Success case
    const ok = await pipeline.dispatch('ping', {})
    expect(ok.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    // Error case (unknown tool)
    const err = await pipeline.dispatch('nonexistent', {})
    expect(err.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('MCP HTTP tools/call handler sees ctx.signal when request has signal', async () => {
    const signalSeen: boolean[] = []
    const tool: PipelineTool = {
      name: 'check-signal',
      handler: async (_args, ctx) => {
        signalSeen.push(ctx.signal !== undefined)
        return { ok: true }
      },
    }
    const pipeline = createToolPipeline({ tools: [tool] })

    // Simulating what dispatchSingle does: passing request.signal through
    const request = new Request('http://localhost/mcp', { method: 'POST' })
    const result = await pipeline.dispatch('check-signal', {}, {
      transport: 'mcp',
      signal: request.signal,
      headers: {},
    })

    expect(statusOf(result)).toBe(200)
    expect(signalSeen[0]).toBe(true)
  })

  it('dispatchFromRequest gives handler a signal', async () => {
    let hasSignal = false
    const tool: PipelineTool = {
      name: 'sig-test',
      handler: async (_args, ctx) => {
        hasSignal = ctx.signal !== undefined
        return { ok: true }
      },
    }
    const pipeline = createToolPipeline({ tools: [tool] })
    const request = new Request('http://localhost/test')

    await pipeline.dispatchFromRequest('sig-test', {}, request)
    expect(hasSignal).toBe(true)
  })

  it('dispatchResourceFromRequest gives handler a signal', async () => {
    let hasSignal = false
    const resource = {
      kind: 'resource' as const,
      name: 'res',
      handler: async (_args: unknown, ctx: any) => {
        hasSignal = ctx.signal !== undefined
        return { content: 'data' }
      },
      meta: { kind: 'resource' as const, name: 'res', tags: [], sideEffects: false },
      sideEffects: false,
      tags: [],
    }
    const pipeline = createToolPipeline({ tools: [], resources: [resource] })
    const request = new Request('http://localhost/res')

    await pipeline.dispatchResourceFromRequest('res', {}, request)
    expect(hasSignal).toBe(true)
  })
})
