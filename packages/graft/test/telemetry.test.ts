import { describe, it, expect, afterEach, vi } from 'vitest'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { TOOL_CALL_CHANNEL, toolCallChannel } from '../src/telemetry.js'
import type { ToolCallRecord } from '../src/telemetry.js'
import { ToolError } from '../src/errors.js'
import { Collector } from '../src/telemetry/collector.js'
import { statusOf } from './dispatch-outcome.js'

// =========================================================================
// Helpers
// =========================================================================

function simpleTool(overrides: Partial<PipelineTool> = {}): PipelineTool {
  return {
    name: 'greet',
    handler: async (args) => ({ message: `Hello, ${(args as any).name}!` }),
    ...overrides,
  }
}

// Collect records from the channel
function createRecorder() {
  const records: ToolCallRecord[] = []
  const handler = (message: unknown) => { records.push(message as ToolCallRecord) }
  subscribe(TOOL_CALL_CHANNEL, handler)
  return { records, cleanup: () => unsubscribe(TOOL_CALL_CHANNEL, handler) }
}

function createRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    kind: 'tool',
    tool: 'greet',
    callId: 'call-1',
    transport: 'http',
    timestamp: 0,
    durationMs: 10,
    status: 'ok',
    ...overrides,
  }
}

// =========================================================================
// Telemetry emission
// =========================================================================

describe('telemetry emission', () => {
  let cleanup: () => void

  afterEach(() => {
    cleanup?.()
  })

  it('emits record with correct shape on successful tool call', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    await pipeline.dispatch('greet', { name: 'World' })

    expect(records).toHaveLength(1)
    const r = records[0]
    expect(r.tool).toBe('greet')
    expect(r.callId).toEqual(expect.any(String))
    expect(r.transport).toBe('http')
    expect(r.timestamp).toEqual(expect.any(Number))
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
    expect(r.status).toBe('ok')
    expect(r.error).toBeUndefined()
  })

  it('emits record with error details on failed tool call', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const tool = simpleTool({
      handler: () => { throw new ToolError('Not found', 404) },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})

    expect(records).toHaveLength(1)
    const r = records[0]
    expect(r.status).toBe('error')
    expect(r.error).toEqual({
      type: 'ToolError',
      message: 'Not found',
      statusCode: 404,
    })
  })

  it('emits error record for unknown tool (404)', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    await pipeline.dispatch('nonexistent', {})

    expect(records).toHaveLength(1)
    const r = records[0]
    expect(r.tool).toBe('nonexistent')
    expect(r.status).toBe('error')
    expect(r.error?.statusCode).toBe(404)
  })

  it('uses requestId as callId when provided', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    await pipeline.dispatch('greet', { name: 'X' }, { requestId: 'req-42' })

    expect(records[0].callId).toBe('req-42')
  })

  it('reads transport from dispatch options', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    await pipeline.dispatch('greet', { name: 'X' }, { transport: 'mcp' })

    expect(records[0].transport).toBe('mcp')
  })

  it('includes subject from authResult', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const tool = simpleTool({ auth: true })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', { name: 'X' }, {
      authResult: { subject: 'user-42' },
    })

    expect(records[0].subject).toBe('user-42')
  })

  it('omits subject when no auth', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    await pipeline.dispatch('greet', { name: 'X' })

    expect(records[0].subject).toBeUndefined()
  })

  it('generic errors get type=Error and statusCode=500', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const tool = simpleTool({
      handler: () => { throw new Error('boom') },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    await pipeline.dispatch('greet', {})

    expect(records[0].error).toEqual({
      type: 'Error',
      message: 'boom',
      statusCode: 500,
    })
  })

  it('durationMs reflects actual execution time', async () => {
    const { records, cleanup: c } = createRecorder()
    cleanup = c

    const tool = simpleTool({
      handler: async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return { ok: true }
      },
    })
    const pipeline = createToolPipeline({ tools: [tool] })
    vi.useFakeTimers()
    try {
      const dispatchPromise = pipeline.dispatch('greet', {})
      await vi.advanceTimersByTimeAsync(50)
      await dispatchPromise
    } finally {
      vi.useRealTimers()
    }

    expect(records[0].durationMs).toBeGreaterThanOrEqual(50)
    expect(records[0].durationMs).toBeLessThan(100)
  })

  it('does not emit when no subscribers', async () => {
    // No recorder created — no subscribers
    const pipeline = createToolPipeline({ tools: [simpleTool()] })
    // Should not throw even with no subscribers
    const result = await pipeline.dispatch('greet', { name: 'X' })
    expect(statusOf(result)).toBe(200)
    // Nothing to assert about records — just verifying no crash
    cleanup = () => {} // noop for afterEach
  })
})

describe('Collector', () => {
  it('returns immutable snapshots and honors limit=0', () => {
    const collector = new Collector()
    collector.start()
    try {
      toolCallChannel.publish(createRecord({
        error: {
          type: 'Error',
          message: 'boom',
          statusCode: 500,
        },
        status: 'error',
      }))
    } finally {
      collector.stop()
    }

    expect(collector.getRecords({ limit: 0 })).toEqual([])

    const snapshot = collector.getRecords()
    snapshot.pop()
    expect(collector.getRecords()).toHaveLength(1)

    snapshot[0] = createRecord({ tool: 'mutated' })
    const fresh = collector.getRecords()
    expect(fresh[0]?.tool).toBe('greet')

    if (fresh[0]?.error === undefined) {
      throw new Error('Expected error payload')
    }

    fresh[0].error.message = 'changed'
    expect(collector.getRecords()[0]?.error?.message).toBe('boom')
  })

  it('filters snapshots by tool and status', () => {
    const collector = new Collector()
    collector.start()
    try {
      toolCallChannel.publish(createRecord({ callId: 'call-1', tool: 'greet', status: 'ok' }))
      toolCallChannel.publish(createRecord({ callId: 'call-2', tool: 'search', status: 'error' }))
      toolCallChannel.publish(createRecord({ callId: 'call-3', tool: 'search', status: 'ok' }))
    } finally {
      collector.stop()
    }

    expect(collector.getRecords({ tool: 'search' }).map((record) => record.callId)).toEqual(['call-2', 'call-3'])
    expect(collector.getRecords({ status: 'error' }).map((record) => record.callId)).toEqual(['call-2'])
  })
})
