import { describe, expect, it } from 'vitest'
import {
  buildLogNotification,
  buildProgressNotification,
  dispatchSSE,
  isRecoverableSseStreamError,
} from '../src/mcp/sse.js'
import type { McpMethodContext } from '../src/mcp/shared.js'

function parseSseMessages(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.includes('event: message'))
    .map((chunk) => {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))
      return JSON.parse(dataLine!.slice(6))
    })
}

describe('mcp SSE helpers', () => {
  it('builds progress notifications with optional totals', () => {
    expect(buildProgressNotification('token-1', 2, 5)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 2, total: 5 },
    })
  })

  it('builds log notifications and remaps warn to warning', () => {
    expect(buildLogNotification('warn', 'Almost done', { scope: 'test' })).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        level: 'warning',
        data: 'Almost done',
        logger: { scope: 'test' },
      },
    })
  })

  it('classifies recoverable stream errors', () => {
    expect(isRecoverableSseStreamError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isRecoverableSseStreamError(new Error('stream already closed'))).toBe(true)
    expect(isRecoverableSseStreamError(new Error('boom'))).toBe(false)
  })

  it('streams progress and log notifications before the final result', async () => {
    const ctx: McpMethodContext = { headers: {} }
    const response = dispatchSSE({
      handler: async (_params, handlerCtx) => {
        handlerCtx.contextIngredients?.onProgress?.(1, 2)
        handlerCtx.contextIngredients?.onLog?.('info', 'step one')
        handlerCtx.contextIngredients?.onProgress?.(2, 2)
        return { ok: true }
      },
      params: { _meta: { progressToken: 'token-1' } },
      ctx,
      id: 7,
      formatError: (error, id) => ({
        jsonrpc: '2.0',
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
        id,
      }),
    })

    expect(response.headers.get('content-type')).toBe('text/event-stream')

    const events = parseSseMessages(await response.text())
    expect(events).toHaveLength(4)
    expect(events[0]).toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 1, total: 2 },
    })
    expect(events[1]).toMatchObject({
      method: 'notifications/message',
      params: { level: 'info', data: 'step one' },
    })
    expect(events[2]).toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 2, total: 2 },
    })
    expect(events[3]).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: { ok: true },
    })
  })
})
