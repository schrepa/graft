/**
 * MCP Parity Test Suite
 *
 * Verifies that buildMethodHandlers() + handleJsonRpc() produces identical
 * results for all MCP methods. Since both HTTP and stdio now share
 * buildMethodHandlers() as the single source of MCP method logic, this suite
 * validates the JSON-RPC dispatch layer routes correctly and formats responses
 * identically.
 */

import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'
import { createMcpTestClient } from '../src/testing.js'
import { z } from 'zod'
import { buildMethodHandlers } from '../src/mcp.js'
import type { ToolDefinition } from '../src/types.js'
import { createToolPipeline } from '../src/pipeline.js'
import type { PipelineTool } from '../src/pipeline.js'
import { parseJsonText } from './helpers/common.js'

// =========================================================================
// Shared test app — used by both direct handler and JSON-RPC paths
// =========================================================================

function createTestApp() {
  const app = createApp({ name: 'parity-test', version: '1.0.0' })

  app.tool('greet', {
    description: 'Greet someone',
    params: z.object({ name: z.string() }),
    handler: ({ name }) => ({ message: `Hello, ${name}!` }),
  })

  app.tool('add', {
    description: 'Add two numbers',
    params: z.object({ a: z.number(), b: z.number() }),
    handler: ({ a, b }) => ({ sum: a + b }),
  })

  app.tool('no_params', {
    description: 'A tool with no params',
    handler: () => ({ ok: true }),
  })

  app.resource({
    uri: 'info://version',
    name: 'version',
    description: 'App version',
    handler: () => ({ version: '1.0.0' }),
  })

  app.resourceTemplate({
    uriTemplate: 'user://{id}',
    name: 'user',
    description: 'Get user by ID',
    params: z.object({ id: z.string() }),
    handler: ({ id }) => ({ id, name: `User ${id}` }),
  })

  app.prompt({
    name: 'summarize',
    description: 'Summarize text',
    params: z.object({ text: z.string() }),
    handler: ({ text }) => [{ role: 'user' as const, content: `Summarize: ${text}` }],
  })

  return app
}

// =========================================================================
// Direct handler path — calls buildMethodHandlers() handlers directly
// =========================================================================

function createDirectHandlers() {
  const tools: ToolDefinition[] = [
    { name: 'greet', description: 'Greet someone', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, sideEffects: false, examples: [], tags: [] },
    { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }, sideEffects: false, examples: [], tags: [] },
    { name: 'no_params', description: 'A tool with no params', inputSchema: null, sideEffects: false, examples: [], tags: [] },
  ]

  const pipelineTools: PipelineTool[] = [
    { name: 'greet', handler: (p: any) => ({ message: `Hello, ${p.name}!` }) },
    { name: 'add', handler: (p: any) => ({ sum: p.a + p.b }) },
    { name: 'no_params', handler: () => ({ ok: true }) },
  ]

  const toolMap = new Map(tools.map(t => [t.name, t]))
  const promptMap = new Map([['summarize', { name: 'summarize', description: 'Summarize text', params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }]])
  const pipeline = createToolPipeline({ tools: pipelineTools })

  const manifest = {
    tools,
    resources: [{ uri: 'info://version', name: 'version', description: 'App version' }],
    resourceTemplates: [{ uriTemplate: 'user://{id}', name: 'user', description: 'Get user by ID', params: null }],
    prompts: [{ name: 'summarize', description: 'Summarize text', params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
  }

  return buildMethodHandlers(
    { manifest, toolMap, promptMap },
    pipeline,
    {
      resourceHandler: async (uri) => {
        if (uri === 'info://version') return { content: { version: '1.0.0' } }
        throw new Error(`Unknown: ${uri}`)
      },
      promptHandler: async (name, args) => {
        if (name === 'summarize') return [{ role: 'user' as const, content: `Summarize: ${(args as any).text}` }]
        throw new Error(`Unknown: ${name}`)
      },
    },
    { name: 'parity-test', version: '1.0.0' },
  )
}

// =========================================================================
// Parity tests — compare direct handler results with JSON-RPC responses
// =========================================================================

describe('MCP parity: direct handlers vs JSON-RPC', () => {
  const { handlers } = createDirectHandlers()
  const app = createTestApp()
  const client = createMcpTestClient(app)

  it('tools/list returns same tool set via both paths', async () => {
    // Direct handler
    const direct = await handlers.get('tools/list')!({}, {}) as any

    // JSON-RPC via test client
    const jsonRpc = await client.listTools()

    expect(direct.tools).toHaveLength(jsonRpc.length)
    for (const directTool of direct.tools) {
      const match = jsonRpc.find((t: any) => t.name === directTool.name)
      expect(match).toBeDefined()
      expect(match!.description).toBe(directTool.description)
    }
  })

  it('tools/call returns same result via both paths', async () => {
    // Direct handler
    const direct = await handlers.get('tools/call')!({ name: 'greet', arguments: { name: 'World' } }, {}) as any
    const directText = JSON.parse(direct.content[0].text)

    // JSON-RPC via test client
    const jsonRpc = await client.callTool('greet', { name: 'World' })

    expect(directText).toEqual(jsonRpc)
  })

  it('tools/call with no-params tool returns same result', async () => {
    const direct = await handlers.get('tools/call')!({ name: 'no_params', arguments: {} }, {}) as any
    const directText = JSON.parse(direct.content[0].text)

    const jsonRpc = await client.callTool('no_params', {})

    expect(directText).toEqual(jsonRpc)
  })

  it('tools/call unknown tool returns error via both paths', async () => {
    const direct = await handlers.get('tools/call')!({ name: 'nonexistent', arguments: {} }, {}) as any
    expect(direct.isError).toBe(true)

    const jsonRpc = await client.callTool('nonexistent', {}) as any
    expect(jsonRpc.error).toBeDefined()
  })

  it('resources/list returns same resources via both paths', async () => {
    const direct = await handlers.get('resources/list')!({}, {}) as any

    const jsonRpc = await client.listResources()

    expect(direct.resources).toHaveLength(jsonRpc.length)
    expect(direct.resources[0].uri).toBe(jsonRpc[0].uri)
  })

  it('resources/read returns same content via both paths', async () => {
    const direct = await handlers.get('resources/read')!({ uri: 'info://version' }, {}) as any

    const jsonRpc = await client.readResource('info://version')

    expect(direct.contents[0].uri).toBe(jsonRpc.uri)
    // Both return version info as text
    const directContent = JSON.parse(direct.contents[0].text)
    const jsonRpcContent = parseJsonText(jsonRpc.text)
    expect(directContent).toEqual(jsonRpcContent)
  })

  it('prompts/list returns same prompts via both paths', async () => {
    const direct = await handlers.get('prompts/list')!({}, {}) as any

    const jsonRpc = await client.listPrompts()

    expect(direct.prompts).toHaveLength(jsonRpc.length)
    expect(direct.prompts[0].name).toBe(jsonRpc[0].name)
  })

  it('prompts/get returns same messages via both paths', async () => {
    const direct = await handlers.get('prompts/get')!({ name: 'summarize', arguments: { text: 'hello' } }, {}) as any

    const jsonRpc = await client.getPrompt('summarize', { text: 'hello' })

    expect(direct.messages).toHaveLength(jsonRpc.messages.length)
    expect(direct.messages[0].content.text).toBe((jsonRpc.messages[0].content as any).text)
  })

  it('initialize returns capabilities and server info', async () => {
    const direct = await handlers.get('initialize')!({
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    }, {}) as any

    expect(direct.protocolVersion).toBe('2025-03-26')
    expect(direct.serverInfo.name).toBe('parity-test')
    expect(direct.capabilities.tools).toBeDefined()
  })

  it('ping returns empty object', async () => {
    const direct = await handlers.get('ping')!({}, {})
    expect(direct).toEqual({})
  })

  it('notifications/initialized returns undefined', async () => {
    const direct = await handlers.get('notifications/initialized')!({}, {})
    expect(direct).toBeUndefined()
  })
})

// =========================================================================
// JSON-RPC dispatch edge cases
// =========================================================================

describe('JSON-RPC dispatch', () => {
  const app = createTestApp()
  const fetch = app.toFetch()

  async function rawMcpPost(body: unknown) {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    }))
    return res.json() as any
  }

  it('returns parse error for invalid JSON', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: 'not json',
    }))
    const body = await res.json() as any
    expect(body.error.code).toBe(-32700)
  })

  it('returns invalid request for missing jsonrpc field', async () => {
    const body = await rawMcpPost({ method: 'ping', id: 1 })
    expect(body.error.code).toBe(-32600)
  })

  it('returns method not found for unknown method', async () => {
    const body = await rawMcpPost({ jsonrpc: '2.0', method: 'nonexistent', id: 1 })
    expect(body.error.code).toBe(-32601)
  })

  it('handles notification (no id) silently', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    }))
    expect(res.status).toBe(202)
  })

  it('rejects batch requests per MCP Streamable HTTP spec', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', method: 'ping', id: 1 },
        { jsonrpc: '2.0', method: 'ping', id: 2 },
      ]),
    }))
    const body = await res.json() as any
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toContain('Batch')
  })

  it('rejects batch notifications per MCP Streamable HTTP spec', async () => {
    const res = await fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      ]),
    }))
    const body = await res.json() as any
    expect(body.error.code).toBe(-32600)
  })

  it('protocol version negotiation picks supported version', async () => {
    const body = await rawMcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    })
    expect(body.result.protocolVersion).toBe('2025-03-26')
  })

  it('protocol version negotiation falls back for older client', async () => {
    const body = await rawMcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    })
    expect(body.result.protocolVersion).toBe('2024-11-05')
  })

  it('negotiates 2025-11-25 when client supports it', async () => {
    const body = await rawMcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    })
    expect(body.result.protocolVersion).toBe('2025-11-25')
  })

  it('negotiates 2025-11-25 for future client versions', async () => {
    const body = await rawMcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2026-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    })
    expect(body.result.protocolVersion).toBe('2025-11-25')
  })

  it('capabilities include logging', async () => {
    const body = await rawMcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    })
    expect(body.result.capabilities.logging).toEqual({})
  })
})
