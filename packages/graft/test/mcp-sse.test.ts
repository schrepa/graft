/**
 * SSE Streaming Test Suite
 *
 * Verifies that tools/call returns SSE responses when the client sends
 * Accept: text/event-stream, and that progress/log notifications appear
 * in the stream before the final JSON-RPC result.
 */

import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { z } from 'zod'

// =========================================================================
// Helpers
// =========================================================================

function createTestApp() {
  const app = createApp({ name: 'sse-test', version: '1.0.0' })

  app.tool('fast', {
    description: 'Returns immediately',
    params: z.object({ x: z.number() }),
    handler: ({ x }) => ({ doubled: x * 2 }),
  })

  app.tool('with_progress', {
    description: 'Reports progress',
    params: z.object({ steps: z.number() }),
    handler: async ({ steps }, ctx) => {
      for (let i = 1; i <= steps; i++) {
        ctx.reportProgress(i, steps)
      }
      return { completed: steps }
    },
  })

  app.tool('with_logs', {
    description: 'Logs messages',
    handler: async (_params, ctx) => {
      ctx.log.info('Starting work')
      ctx.log.warn('Almost done')
      return { ok: true }
    },
  })

  app.tool('with_both', {
    description: 'Progress and logs',
    handler: async (_params, ctx) => {
      ctx.reportProgress(1, 3)
      ctx.log.info('Step 1 done')
      ctx.reportProgress(2, 3)
      ctx.log.info('Step 2 done')
      ctx.reportProgress(3, 3)
      return { done: true }
    },
  })

  app.tool('throws', {
    description: 'Throws an error',
    handler: () => { throw new Error('boom') },
  })

  return app
}

async function parseSSE(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter(chunk => chunk.includes('event: message'))
    .map(chunk => {
      const dataLine = chunk.split('\n').find(l => l.startsWith('data: '))!
      return JSON.parse(dataLine.slice(6))
    })
}

function sseRequest(body: unknown): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  })
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// =========================================================================
// Tests
// =========================================================================

describe('SSE streaming for tools/call', () => {
  const app = createTestApp()
  const fetch = app.toFetch()

  it('returns SSE when client accepts text/event-stream', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'fast', arguments: { x: 5 } },
    }))

    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')

    const events = await parseSSE(res)
    // At least the final result event
    expect(events.length).toBeGreaterThanOrEqual(1)

    const last = events[events.length - 1]
    expect(last.jsonrpc).toBe('2.0')
    expect(last.id).toBe(1)
    expect(JSON.parse((last.result as any).content[0].text)).toEqual({ doubled: 10 })
  })

  it('returns JSON when client only accepts application/json', async () => {
    const res = await fetch(jsonRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'fast', arguments: { x: 5 } },
    }))

    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json() as any
    expect(body.jsonrpc).toBe('2.0')
    expect(JSON.parse(body.result.content[0].text)).toEqual({ doubled: 10 })
  })

  it('progress events appear in SSE stream', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'with_progress', arguments: { steps: 3 }, _meta: { progressToken: 1 } },
    }))

    const events = await parseSSE(res)
    const progressEvents = events.filter((e: any) => e.method === 'notifications/progress')
    expect(progressEvents.length).toBe(3)

    expect((progressEvents[0] as any).params.progress).toBe(1)
    expect((progressEvents[0] as any).params.total).toBe(3)
    expect((progressEvents[1] as any).params.progress).toBe(2)
    expect((progressEvents[2] as any).params.progress).toBe(3)

    // Final event has the result
    const last = events[events.length - 1]
    expect(last.id).toBe(1)
    expect(JSON.parse((last.result as any).content[0].text)).toEqual({ completed: 3 })
  })

  it('log events appear in SSE stream', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'with_logs', arguments: {} },
    }))

    const events = await parseSSE(res)
    const logEvents = events.filter((e: any) => e.method === 'notifications/message')
    expect(logEvents.length).toBe(2)

    expect((logEvents[0] as any).params.level).toBe('info')
    expect((logEvents[0] as any).params.data).toBe('Starting work')
    expect((logEvents[1] as any).params.level).toBe('warning')  // warn → warning
    expect((logEvents[1] as any).params.data).toBe('Almost done')

    const last = events[events.length - 1]
    expect(last.id).toBe(1)
  })

  it('mixed progress + logs + result in correct order', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'with_both', arguments: {}, _meta: { progressToken: 1 } },
    }))

    const events = await parseSSE(res)
    // 3 progress + 2 logs + 1 result = 6 events
    expect(events.length).toBe(6)

    // Notifications come before the final result
    const last = events[events.length - 1]
    expect(last.id).toBe(1)
    expect(last.result).toBeDefined()

    // All other events are notifications (no id)
    for (let i = 0; i < events.length - 1; i++) {
      expect(events[i].id).toBeUndefined()
      expect(events[i].method).toBeDefined()
    }
  })

  it('error in handler produces SSE error event', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'throws', arguments: {} },
    }))

    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const events = await parseSSE(res)
    const last = events[events.length - 1]
    expect(last.id).toBe(1)
    // The error is in the MCP result envelope (isError), not JSON-RPC error
    expect((last.result as any).isError).toBe(true)
  })

  it('tool with no progress produces single-event SSE', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'fast', arguments: { x: 1 } },
    }))

    const events = await parseSSE(res)
    expect(events.length).toBe(1)
    expect(events[0].id).toBe(1)
    expect(events[0].result).toBeDefined()
  })

  it('non-tools/call methods always return JSON even with SSE accept', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    }))

    // Should be JSON, not SSE
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json() as any
    expect(body.result.tools).toBeDefined()
  })

  it('ping returns JSON even with SSE accept', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'ping', params: {},
    }))

    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json() as any
    expect(body.result).toEqual({})
  })

  it('unknown tool returns SSE error via MCP envelope', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    }))

    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const events = await parseSSE(res)
    const last = events[events.length - 1]
    expect(last.id).toBe(1)
    expect((last.result as any).isError).toBe(true)
  })

  it('progress events include progressToken from _meta', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'with_progress', arguments: { steps: 2 }, _meta: { progressToken: 'tok-42' } },
    }))

    const events = await parseSSE(res)
    const progressEvents = events.filter((e: any) => e.method === 'notifications/progress')
    expect(progressEvents.length).toBe(2)
    expect((progressEvents[0] as any).params.progressToken).toBe('tok-42')
    expect((progressEvents[1] as any).params.progressToken).toBe('tok-42')
  })

  it('no progress events when _meta has no progressToken', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'with_progress', arguments: { steps: 2 } },
    }))

    const events = await parseSSE(res)
    const progressEvents = events.filter((e: any) => e.method === 'notifications/progress')
    expect(progressEvents.length).toBe(0)

    // But the result is still there
    const last = events[events.length - 1]
    expect(last.id).toBe(1)
    expect(JSON.parse((last.result as any).content[0].text)).toEqual({ completed: 2 })
  })

  it('SSE priming event present when MCP-Protocol-Version >= 2025-11-25', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'fast', arguments: { x: 1 } },
      }),
    }))

    const text = await res.text()
    // Priming event: "id: <uuid>\ndata: \n\n" before any "event: message" events
    const chunks = text.split('\n\n').filter(c => c.trim())
    // First chunk should be the priming event (has id: but no event: message)
    expect(chunks[0]).toMatch(/^id: /)
    expect(chunks[0]).toContain('data: ')
    expect(chunks[0]).not.toContain('event: message')
  })

  it('SSE priming event absent when MCP-Protocol-Version < 2025-11-25', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'fast', arguments: { x: 1 } },
      }),
    }))

    const text = await res.text()
    const chunks = text.split('\n\n').filter(c => c.trim())
    // No priming event — first chunk should be event: message
    expect(chunks[0]).toContain('event: message')
  })

  it('SSE priming event absent when no MCP-Protocol-Version header', async () => {
    const res = await fetch(sseRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'fast', arguments: { x: 1 } },
    }))

    const text = await res.text()
    const chunks = text.split('\n\n').filter(c => c.trim())
    // Default is 2025-03-26, no priming
    expect(chunks[0]).toContain('event: message')
  })

  it('Accept with both json and event-stream uses SSE for tools/call', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'fast', arguments: { x: 7 } },
      }),
    }))

    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const events = await parseSSE(res)
    expect(events.length).toBeGreaterThanOrEqual(1)
    const last = events[events.length - 1]
    expect(JSON.parse((last.result as any).content[0].text)).toEqual({ doubled: 14 })
  })
})
