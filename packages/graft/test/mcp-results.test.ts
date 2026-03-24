import { describe, expect, it } from 'vitest'
import { dispatchToolCall } from '../src/mcp/results.js'
import { createToolPipeline, richResult } from '../src/pipeline.js'
import type { ToolDefinition } from '../src/types.js'

function toolDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    method: 'GET',
    path: '/problem',
    name: 'problem',
    description: 'Problem details',
    inputSchema: null,
    sideEffects: false,
    examples: [],
    tags: [],
    ...overrides,
  }
}

describe('dispatchToolCall', () => {
  it('treats application/problem+json rich results as JSON text content', async () => {
    const tool = toolDefinition()
    const pipeline = createToolPipeline({
      tools: [{
        name: tool.name,
        handler: () => richResult({ title: 'Conflict' }, 'application/problem+json'),
      }],
    })

    const result = await dispatchToolCall(
      tool.name,
      {},
      pipeline,
      { toolMap: new Map([[tool.name, tool]]) },
      {},
    )

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0]).not.toHaveProperty('mimeType')
    expect(JSON.parse(String(result.content[0].text))).toEqual({ title: 'Conflict' })
  })
})
