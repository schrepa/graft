import { describe, expect, it } from 'vitest'
import { createMcpAdapter } from '../src/mcp.js'
import { createToolPipeline, richResult } from '../src/pipeline.js'
import { ToolError } from '../src/errors.js'
import type { ToolDefinition, McpProxyFunction, ToolContext } from '../src/types.js'
import type { ToolPipeline, PipelineTool } from '../src/pipeline.js'

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

function testTools(): ToolDefinition[] {
  return [
    {
      method: 'GET',
      path: '/items',
      name: 'search_items',
      description: 'Search all items',
      inputSchema: null,
      sideEffects: false,
      examples: [],
      tags: [],
    },
    {
      method: 'GET',
      path: '/items/:id',
      name: 'get_item',
      description: 'Get a specific item by ID',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Path parameter: id' } }, required: ['id'] },
      sideEffects: false,
      examples: [],
      tags: [],
    },
    {
      method: 'POST',
      path: '/items',
      name: 'create_item',
      description: 'Create a new item',
      inputSchema: null,
      sideEffects: true,
      examples: [],
      tags: [],
    },
  ]
}

function testProxy(): McpProxyFunction {
  return async (method, path, args) => {
    if (method === 'GET' && path === '/items') {
      const items = [
        { id: '1', name: 'Widget' },
        { id: '2', name: 'Gadget' },
      ]
      const q = args.q as string | undefined
      const filtered = q ? items.filter((item) => item.name.toLowerCase().includes(q.toLowerCase())) : items
      return { status: 200, headers: {}, body: filtered }
    }
    if (method === 'GET' && path === '/items/:id') {
      if (args.id === '1') {
        return { status: 200, headers: {}, body: { id: '1', name: 'Widget' } }
      }
      return { status: 404, headers: {}, body: { error: 'Not found' } }
    }
    if (method === 'POST' && path === '/items') {
      return { status: 201, headers: {}, body: { id: '3', ...args } }
    }
    return { status: 404, headers: {}, body: { error: 'Not found' } }
  }
}

function inlineProxyHandler(
  proxy: McpProxyFunction,
  tool: ToolDefinition,
): (args: unknown, ctx: ToolContext) => Promise<unknown> {
  const method = tool.method ?? 'GET'
  const path = tool.path ?? '/'
  return async (args, ctx) => {
    const headers: Record<string, string | string[] | undefined> = ctx.meta.headers ?? {}
    const result = await proxy(method, path, args as Record<string, unknown>, {
      headers,
      parameterLocations: tool.parameterLocations,
      toolContext: ctx,
    })
    if (result.status >= 400) {
      throw new ToolError(
        typeof result.body === 'object' && result.body !== null && 'error' in result.body
          ? String((result.body as Record<string, unknown>).error)
          : `Proxy error: ${result.status}`,
        result.status,
        { headers: result.headers },
      )
    }

    const contentType = (result.headers['content-type'] ?? '').split(';')[0].trim()
    if (contentType && !contentType.includes('application/json')) {
      return richResult(result.body, contentType)
    }
    return result.body
  }
}

function testPipeline(tools: ToolDefinition[], proxy?: McpProxyFunction): ToolPipeline {
  const activeProxy = proxy ?? testProxy()
  const pipelineTools: PipelineTool[] = tools.map((tool) => ({
    name: tool.name,
    handler: inlineProxyHandler(activeProxy, tool),
  }))
  return createToolPipeline({ tools: pipelineTools })
}

function mcpRequest(adapter: ReturnType<typeof createMcpAdapter>, body: object): Promise<Response> {
  return adapter.handleMcp(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  }))
}

describe('MCP Streamable HTTP compliance', () => {
  it('GET /mcp returns 405 with Allow: POST header', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  it('DELETE /mcp returns 405 with Allow: POST header', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', { method: 'DELETE' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  it('rejects unsupported MCP-Protocol-Version with JSON-RPC error', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'MCP-Protocol-Version': '1999-01-01' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32600)
    expect(body.error.message).toContain('Unsupported MCP protocol version')
  })

  it('skips MCP-Protocol-Version validation on initialize', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.protocolVersion).toBeDefined()
  })

  it('proceeds when MCP-Protocol-Version header is absent (assumes 2025-03-26)', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.tools).toBeDefined()
  })

  it('accepts valid MCP-Protocol-Version header', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }))
    expect(res.status).toBe(200)
  })

  it('malformed JSON returns HTTP 200 + JSON-RPC -32700 (parse error parity)', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: 'not valid json!!!',
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32700)
    expect(body.id).toBeNull()
  })

  it.each([[], 'bad', 1])('rejects non-object params (%p) as invalid JSON-RPC', async (params) => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params,
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32600)
    expect(body.id).toBe(1)
  })

  it('rejects invalid JSON-RPC id shapes', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: { invalid: true },
      method: 'tools/list',
      params: {},
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.code).toBe(-32600)
    expect(body.id).toBeNull()
  })

  it('logging/setLevel handler returns success (no error)', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'logging/setLevel',
      params: { level: 'debug' },
    })
    const body = await res.json() as any
    expect(body.result).toBeDefined()
    expect(body.error).toBeUndefined()
  })

  it('capabilities include logging', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    })
    const body = await res.json() as any
    expect(body.result.capabilities.logging).toEqual({})
  })
})

describe('binary resource blob', () => {
  it('returns blob field for Uint8Array content', async () => {
    const binaryData = new Uint8Array([72, 101, 108, 108, 111])
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      resources: [{ uri: 'file://test.bin', name: 'binary', description: 'Binary file' }],
      resourceTemplates: [],
      resourceHandler: async () => ({ content: binaryData, mimeType: 'application/octet-stream' }),
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'file://test.bin' },
    })
    const body = await res.json() as any
    expect(body.result.contents[0].blob).toBe(Buffer.from(binaryData).toString('base64'))
    expect(body.result.contents[0].text).toBeUndefined()
    expect(body.result.contents[0].mimeType).toBe('application/octet-stream')
  })

  it('returns blob field for ArrayBuffer content', async () => {
    const buffer = new ArrayBuffer(5)
    new Uint8Array(buffer).set([72, 101, 108, 108, 111])
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      resources: [{ uri: 'file://test.bin', name: 'binary', description: 'Binary file' }],
      resourceTemplates: [],
      resourceHandler: async () => ({ content: buffer, mimeType: 'application/octet-stream' }),
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'file://test.bin' },
    })
    const body = await res.json() as any
    expect(body.result.contents[0].blob).toBeDefined()
    expect(body.result.contents[0].text).toBeUndefined()
  })

  it('returns text field for string content (unchanged)', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      resources: [{ uri: 'file://test.txt', name: 'text', description: 'Text file' }],
      resourceTemplates: [],
      resourceHandler: async () => ({ content: 'hello world' }),
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'file://test.txt' },
    })
    const body = await res.json() as any
    expect(body.result.contents[0].text).toBe('hello world')
    expect(body.result.contents[0].blob).toBeUndefined()
  })
})

describe('parameterLocations', () => {
  it('passes parameterLocations through proxy context', async () => {
    let receivedContext: any = null

    const tools: ToolDefinition[] = [
      {
        method: 'GET',
        path: '/items',
        name: 'search_items',
        description: 'Search items',
        inputSchema: null,
        sideEffects: false,
        examples: [],
        tags: [],
        parameterLocations: { if_match: { in: 'header', name: 'If-Match' } },
      },
    ]

    const proxy: McpProxyFunction = async (_method, _path, _args, context) => {
      receivedContext = context
      return { status: 200, headers: {}, body: [] }
    }

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    await mcpRequest(adapter, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_items', arguments: { if_match: 'abc' } },
    })

    expect(receivedContext).not.toBeNull()
    expect(receivedContext.parameterLocations).toEqual({ if_match: { in: 'header', name: 'If-Match' } })
  })
})
