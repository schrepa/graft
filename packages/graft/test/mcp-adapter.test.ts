import { afterEach, describe, expect, it, vi } from 'vitest'
import * as mcpSchemas from '@modelcontextprotocol/sdk/types.js'
import { createMcpAdapter } from '../src/mcp.js'
import { createToolPipeline, richResult } from '../src/pipeline.js'
import { ToolError } from '../src/errors.js'
import { validateManifest } from '../src/diagnostics.js'
import type { ToolDefinition, McpProxyFunction, ToolContext } from '../src/types.js'
import type { ToolPipeline, PipelineTool } from '../src/pipeline.js'
import { createDeferred } from './helpers/common.js'

class MockSdkServer {
  serverInfo: unknown
  options: unknown
  handlers = new Map<unknown, unknown>()
  connect = vi.fn(async () => {})
  close = vi.fn(async () => {})
  notification = vi.fn(async () => {})
  sendLoggingMessage = vi.fn(async () => {})
  constructor(serverInfo?: unknown, options?: unknown) {
    this.serverInfo = serverInfo
    this.options = options
  }
  setRequestHandler = vi.fn((schema: unknown, handler: unknown) => {
    this.handlers.set(schema, handler)
  })
}

const mockStdioServers: MockSdkServer[] = []

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class Server extends MockSdkServer {
    constructor(serverInfo?: unknown, options?: unknown) {
      super(serverInfo, options)
      mockStdioServers.push(this)
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class StdioServerTransport {},
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
  ListResourcesRequestSchema: Symbol('ListResourcesRequestSchema'),
  ListResourceTemplatesRequestSchema: Symbol('ListResourceTemplatesRequestSchema'),
  ReadResourceRequestSchema: Symbol('ReadResourceRequestSchema'),
  ListPromptsRequestSchema: Symbol('ListPromptsRequestSchema'),
  GetPromptRequestSchema: Symbol('GetPromptRequestSchema'),
}))

afterEach(() => {
  mockStdioServers.length = 0
})

/** Standard MCP headers required by the Streamable HTTP transport */
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

/** Build a simple set of test tools */
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

/** Build a test proxy that returns canned responses */
function testProxy(): McpProxyFunction {
  return async (method, path, args) => {
    if (method === 'GET' && path === '/items') {
      const items = [
        { id: '1', name: 'Widget' },
        { id: '2', name: 'Gadget' },
      ]
      const q = args.q as string | undefined
      const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q.toLowerCase())) : items
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

/** Inline proxy handler — wraps McpProxyFunction for pipeline use (replaces imported createProxyHandler) */
function inlineProxyHandler(
  proxy: McpProxyFunction,
  tool: ToolDefinition
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

/** Build a pipeline from tools + proxy */
function testPipeline(tools: ToolDefinition[], proxy?: McpProxyFunction): ToolPipeline {
  const p = proxy ?? testProxy()
  const pipelineTools: PipelineTool[] = tools.map(tool => ({
    name: tool.name,
    handler: inlineProxyHandler(p, tool),
  }))
  return createToolPipeline({ tools: pipelineTools })
}

function mcpRequest(adapter: ReturnType<typeof createMcpAdapter>, body: object): Promise<Response> {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  })
  return adapter.handleMcp(request)
}

function getRegisteredHandler<T>(
  server: MockSdkServer,
  schema: unknown,
): T {
  const handler = server.handlers.get(schema)
  if (typeof handler !== 'function') {
    throw new Error('Expected registered handler')
  }
  return handler as T
}

function getCustomRequestHandler<T>(
  server: MockSdkServer,
  method: string,
): T {
  for (const [schema, handler] of server.handlers.entries()) {
    if (
      schema !== null &&
      typeof schema === 'object' &&
      'safeParse' in schema &&
      typeof schema.safeParse === 'function' &&
      schema.safeParse({ jsonrpc: '2.0', id: 1, method, params: {} }).success
    ) {
      return handler as T
    }
  }

  throw new Error(`Expected registered custom handler for ${method}`)
}

describe('createMcpAdapter', () => {
  it('registers tools into the registry', () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    expect(adapter.getManifest().tools.length).toBe(3)
    expect(adapter.getManifest().tools.find(t => t.name === 'search_items')).toBeDefined()
    expect(adapter.getManifest().tools.find(t => t.name === 'get_item')).toBeDefined()
    expect(adapter.getManifest().tools.find(t => t.name === 'create_item')).toBeDefined()
  })
})

describe('handleMcp', () => {
  it('responds to MCP initialize', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('graft')
  })

  it('lists tools via MCP', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })

    // Initialize first
    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.tools).toHaveLength(3)
    const names = body.result.tools.map((t: any) => t.name)
    expect(names).toContain('search_items')
    expect(names).toContain('get_item')
    expect(names).toContain('create_item')
  })

  it('tools/list includes annotations with readOnlyHint, destructiveHint, and idempotentHint', async () => {
    const tools: ToolDefinition[] = [
      { method: 'GET', path: '/items', name: 'search_items', description: 'Search', inputSchema: null, sideEffects: false, examples: [], tags: [] },
      { method: 'POST', path: '/items', name: 'create_item', description: 'Create', inputSchema: null, sideEffects: true, examples: [], tags: [] },
      { method: 'DELETE', path: '/items/:id', name: 'delete_item', description: 'Delete', inputSchema: null, sideEffects: true, examples: [], tags: [] },
      { method: 'PUT', path: '/items/:id', name: 'update_item', description: 'Update', inputSchema: null, sideEffects: true, examples: [], tags: [] },
      { method: 'PATCH', path: '/items/:id', name: 'patch_item', description: 'Patch', inputSchema: null, sideEffects: true, examples: [], tags: [] },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    const body = await res.json() as any
    const toolsList = body.result.tools

    const get = toolsList.find((t: any) => t.name === 'search_items')
    expect(get.annotations.readOnlyHint).toBe(true)
    expect(get.annotations.destructiveHint).toBe(false)
    expect(get.annotations.idempotentHint).toBe(true)

    const post = toolsList.find((t: any) => t.name === 'create_item')
    expect(post.annotations.readOnlyHint).toBe(false)
    expect(post.annotations.destructiveHint).toBe(true)  // sideEffects:true → destructiveHint:true (safe default)
    expect(post.annotations.idempotentHint).toBe(false)

    const del = toolsList.find((t: any) => t.name === 'delete_item')
    expect(del.annotations.readOnlyHint).toBe(false)
    expect(del.annotations.destructiveHint).toBe(true)
    expect(del.annotations.idempotentHint).toBe(true)

    const put = toolsList.find((t: any) => t.name === 'update_item')
    expect(put.annotations.idempotentHint).toBe(true)

    const patch = toolsList.find((t: any) => t.name === 'patch_item')
    expect(patch.annotations.idempotentHint).toBe(false)
  })

  it('greenfield tool without method derives idempotentHint from sideEffects', async () => {
    const tools: ToolDefinition[] = [
      { name: 'read_data', description: 'Read', inputSchema: null, sideEffects: false, examples: [], tags: [] },
      { name: 'write_data', description: 'Write', inputSchema: null, sideEffects: true, examples: [], tags: [] },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    const body = await res.json() as any
    const toolsList = body.result.tools

    const read = toolsList.find((t: any) => t.name === 'read_data')
    expect(read.annotations.idempotentHint).toBe(true)

    const write = toolsList.find((t: any) => t.name === 'write_data')
    expect(write.annotations.idempotentHint).toBe(false)
  })

  it('tools/list includes x-auth-required annotation for auth: true', async () => {
    const tools: ToolDefinition[] = [
      { method: 'POST', path: '/entries', name: 'create_entry', description: 'Create entry', inputSchema: null, sideEffects: true, examples: [], tags: [], auth: true },
      { method: 'GET', path: '/items', name: 'search_items', description: 'Search items', inputSchema: null, sideEffects: false, examples: [], tags: [] },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    const body = await res.json() as any
    const toolsList = body.result.tools

    const entry = toolsList.find((t: any) => t.name === 'create_entry')
    expect(entry.annotations['x-auth-required']).toBe(true)
    expect(entry.annotations['x-auth-roles']).toBeUndefined()

    const items = toolsList.find((t: any) => t.name === 'search_items')
    expect(items.annotations['x-auth-required']).toBeUndefined()
  })

  it('tools/list includes x-auth-roles annotation when roles are specified', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'DELETE',
        path: '/users/:id',
        name: 'delete_user',
        description: 'Delete user',
        inputSchema: null,
        sideEffects: true,
        examples: [],
        tags: [],
        auth: { roles: ['admin'] },
      },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    const body = await res.json() as any
    const toolsList = body.result.tools

    const deleteUser = toolsList.find((t: any) => t.name === 'delete_user')
    expect(deleteUser.annotations['x-auth-required']).toBe(true)
    expect(deleteUser.annotations['x-auth-roles']).toEqual(['admin'])
    expect(deleteUser.annotations.destructiveHint).toBe(true)
  })

  it('calls a GET tool via MCP', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'search_items', arguments: { q: 'widget' } },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.content).toHaveLength(1)
    const content = JSON.parse(body.result.content[0].text)
    expect(content).toHaveLength(1)
    expect(content[0].name).toBe('Widget')
  })

  it('calls a GET-with-params tool via MCP', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_item', arguments: { id: '1' } },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    const content = JSON.parse(body.result.content[0].text)
    expect(content.id).toBe('1')
    expect(content.name).toBe('Widget')
  })

  it('calls a POST tool via MCP', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'create_item', arguments: { name: 'New Item', price: 14.99 } },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    const content = JSON.parse(body.result.content[0].text)
    expect(content.name).toBe('New Item')
    expect(content.price).toBe(14.99)
    expect(content.id).toBe('3')
  })

  it('returns error for unknown tool', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.isError).toBe(true)
  })

  it('handles 404 response as tool error', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'get_item', arguments: { id: 'missing' } },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.isError).toBe(true)
  })
})

describe('handleMcp origin validation', () => {
  it('rejects disallowed origins', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      allowedOrigins: ['https://allowed.com'],
    })

    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        'Origin': 'https://evil.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } },
      }),
    })

    const res = await adapter.handleMcp(request)
    expect(res.status).toBe(403)
  })

  it('allows permitted origins', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      allowedOrigins: ['https://allowed.com'],
    })

    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        'Origin': 'https://allowed.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } },
      }),
    })

    const res = await adapter.handleMcp(request)
    expect(res.status).toBe(200)
  })

  it('allows requests with no Origin header', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      allowedOrigins: ['https://allowed.com'],
    })

    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } },
      }),
    })

    const res = await adapter.handleMcp(request)
    expect(res.status).toBe(200)
  })
})

describe('handleAgentJson', () => {
  it('returns discovery document', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const res = adapter.handleAgentJson('http://localhost:3000')

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.capabilities.mcp.url).toContain('/mcp')
    expect(body.tools).toHaveLength(3)
  })
})

describe('tools with inputSchema', () => {
  it('tools have correct inputSchema from JSON Schema', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET',
        path: '/items',
        name: 'search_items',
        description: 'Search items',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query' },
          },
        },
        sideEffects: false,
        examples: [],
        tags: [],
      },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })
    const tool = adapter.getManifest().tools.find(t => t.name === 'search_items')!
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query' },
      },
    })
  })
})

describe('path parameter injection', () => {
  it('tools with path params have correct inputSchema', () => {
    const tools: ToolDefinition[] = [{
      method: 'GET',
      path: '/items/:id',
      name: 'get_item',
      description: 'Get item',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Path parameter: id' },
        },
        required: ['id'],
      },
      sideEffects: false,
      examples: [],
      tags: [],
    }]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })
    const tool = adapter.getManifest().tools.find(t => t.name === 'get_item')!
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Path parameter: id' },
      },
      required: ['id'],
    })
  })

  it('stores tools with null inputSchema for routes without params', () => {
    const tools: ToolDefinition[] = [{
      method: 'GET',
      path: '/items',
      name: 'search_items',
      description: 'Search items',
      inputSchema: null,
      sideEffects: false,
      examples: [],
      tags: [],
    }]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })
    const tool = adapter.getManifest().tools.find(t => t.name === 'search_items')!
    expect(tool.inputSchema).toBeNull()
  })
})

describe('manifest validation', () => {
  it('validation passes when all tools have explicit names', () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const result = validateManifest(adapter.getManifest())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

describe('error mapping', () => {
  it('maps 400 to VALIDATION_ERROR', async () => {
    const proxy: McpProxyFunction = async () => ({
      status: 400,
      headers: {},
      body: { error: 'Bad request' },
    })

    const tools: ToolDefinition[] = [{
      method: 'POST', path: '/items', name: 'create_item', description: 'Create item',
      inputSchema: null, sideEffects: true, examples: [], tags: [],
    }]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'create_item', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.isError).toBe(true)
    const content = JSON.parse(body.result.content[0].text)
    expect(content.error).toBe('VALIDATION_ERROR')
    expect(content.status).toBe(400)
  })

  it('maps 401 to UNAUTHORIZED', async () => {
    const proxy: McpProxyFunction = async () => ({
      status: 401,
      headers: {},
      body: { error: 'Unauthorized' },
    })

    const tools: ToolDefinition[] = [{
      method: 'GET', path: '/secure', name: 'get_secure', description: 'Secure endpoint',
      inputSchema: null, sideEffects: false, examples: [], tags: [],
    }]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_secure', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.isError).toBe(true)
    const content = JSON.parse(body.result.content[0].text)
    expect(content.error).toBe('UNAUTHORIZED')
  })

  it('maps 500 to INTERNAL_ERROR', async () => {
    const proxy: McpProxyFunction = async () => ({
      status: 500,
      headers: {},
      body: { error: 'Server error' },
    })

    const tools: ToolDefinition[] = [{
      method: 'GET', path: '/broken', name: 'get_broken', description: 'Broken endpoint',
      inputSchema: null, sideEffects: false, examples: [], tags: [],
    }]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_broken', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.isError).toBe(true)
    const content = JSON.parse(body.result.content[0].text)
    expect(content.error).toBe('INTERNAL_ERROR')
    expect(content.status).toBe(500)
  })

})

describe('configureServer hook', () => {
  it('receives setHandler, addCapabilities, and manifest', async () => {
    let receivedSetHandler: any = null
    let receivedAddCapabilities: any = null
    let receivedManifest: any = null

    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer({ setHandler, addCapabilities, manifest }) {
        receivedSetHandler = setHandler
        receivedAddCapabilities = addCapabilities
        receivedManifest = manifest
      },
    })

    // configureServer runs synchronously at adapter creation for HTTP
    expect(typeof receivedSetHandler).toBe('function')
    expect(typeof receivedAddCapabilities).toBe('function')
    expect(receivedManifest).not.toBeNull()
    expect(receivedManifest.tools.length).toBe(3)

    await adapter.close()
  })

  it('persistent server: tools/list and tools/call work across multiple requests', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer() {
        // no-op, just enable persistent mode
      },
    })

    // First request: initialize
    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    // Second request: tools/list
    const listRes = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    })
    const listBody = await listRes.json() as any
    expect(listBody.result.tools).toHaveLength(3)

    // Third request: tools/call
    const callRes = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'search_items', arguments: { q: 'widget' } },
    })
    const callBody = await callRes.json() as any
    const content = JSON.parse(callBody.result.content[0].text)
    expect(content).toHaveLength(1)
    expect(content[0].name).toBe('Widget')

    await adapter.close()
  })

  it('passes request headers and signal to custom handlers', async () => {
    let seenHeaders: Record<string, string> | undefined
    let seenSignal: AbortSignal | undefined
    const requestId = 'req-123'

    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer({ setHandler }) {
        setHandler('custom.echo', async (_params, ctx) => {
          seenHeaders = ctx.headers
          seenSignal = ctx.signal
          return { ok: true }
        })
      },
    })

    const ac = new AbortController()
    const res = await adapter.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'custom.echo',
        params: {},
      }),
      signal: ac.signal,
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result).toEqual({ ok: true })
    expect(seenHeaders?.['x-request-id']).toBe(requestId)
    expect(seenSignal).toBeDefined()
    expect(seenSignal?.aborted).toBe(false)

    ac.abort()
    expect(seenSignal?.aborted).toBe(true)

    await adapter.close()
  })

  it('can register custom resource handler via configureServer', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer({ setHandler, addCapabilities }) {
        addCapabilities({ resources: {} })
        setHandler('resources/list', async () => ({
          resources: [
            { uri: 'test://resource', name: 'Test Resource', mimeType: 'text/plain' },
          ],
        }))
      },
    })

    // Initialize
    const initRes = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })
    const initBody = await initRes.json() as any
    expect(initBody.result.capabilities.resources).toBeDefined()

    // List resources
    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 2, method: 'resources/list', params: {},
    })
    const body = await res.json() as any
    expect(body.result.resources).toHaveLength(1)
    expect(body.result.resources[0].uri).toBe('test://resource')

    await adapter.close()
  })

  it('close() cleans up persistent server', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer() {},
    })

    // Should not throw
    await adapter.close()
    // Second close is a no-op
    await adapter.close()
  })

  it('close() is a no-op when configureServer is not provided', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    // Should not throw
    await adapter.close()
  })

  it('handles concurrent MCP requests without racing (no persistent server)', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })

    // Fire multiple concurrent requests — each creates its own server
    const requests = Array.from({ length: 5 }, (_, i) =>
      mcpRequest(adapter, {
        jsonrpc: '2.0', id: i + 1, method: 'tools/call',
        params: { name: 'search_items', arguments: { q: 'widget' } },
      })
    )

    const responses = await Promise.all(requests)
    for (const res of responses) {
      expect(res.status).toBe(200)
      const body = await res.json() as any
      const content = JSON.parse(body.result.content[0].text)
      expect(content).toHaveLength(1)
      expect(content[0].name).toBe('Widget')
    }
  })

  it('handles concurrent MCP requests with configureServer hook', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer() {
        // Hook is applied to each fresh server
      },
    })

    const requests = Array.from({ length: 5 }, (_, i) =>
      mcpRequest(adapter, {
        jsonrpc: '2.0', id: i + 1, method: 'tools/call',
        params: { name: 'search_items', arguments: { q: 'widget' } },
      })
    )

    const responses = await Promise.all(requests)
    for (const res of responses) {
      expect(res.status).toBe(200)
      const body = await res.json() as any
      const content = JSON.parse(body.result.content[0].text)
      expect(content).toHaveLength(1)
      expect(content[0].name).toBe('Widget')
    }

    await adapter.close()
  })
})

describe('transformToolDefinition hook', () => {
  it('adds outputSchema to a specific tool', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      transformToolDefinition(def) {
        if (def.name === 'search_items') {
          return {
            ...def,
            outputSchema: {
              type: 'object',
              properties: { items: { type: 'array' } },
            },
          }
        }
        return def
      },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })
    const body = await res.json() as any
    const search = body.result.tools.find((t: any) => t.name === 'search_items')
    expect(search.outputSchema).toEqual({
      type: 'object',
      properties: { items: { type: 'array' } },
    })

    // Other tools unaffected
    const getItem = body.result.tools.find((t: any) => t.name === 'get_item')
    expect(getItem.outputSchema).toBeUndefined()
  })

  it('adds icons, title, and custom annotations', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      transformToolDefinition(def) {
        return {
          ...def,
          title: `Tool: ${def.name}`,
          icons: [{ url: 'https://example.com/icon.png', mediaType: 'image/png' }],
          annotations: {
            ...def.annotations,
            idempotentHint: true,
            openWorldHint: false,
          },
        }
      },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })
    const body = await res.json() as any
    const tool = body.result.tools[0]
    expect(tool.title).toBe(`Tool: ${tool.name}`)
    expect(tool.icons).toEqual([{ url: 'https://example.com/icon.png', mediaType: 'image/png' }])
    expect(tool.annotations.idempotentHint).toBe(true)
    expect(tool.annotations.openWorldHint).toBe(false)
  })

  it('receives the tool definition in context', async () => {
    let receivedTool: any = null
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      transformToolDefinition(def, ctx) {
        if (def.name === 'create_item') {
          receivedTool = ctx.tool
        }
        return def
      },
    })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    expect(receivedTool).not.toBeNull()
    expect(receivedTool.method).toBe('POST')
    expect(receivedTool.path).toBe('/items')
  })

  it('runs transformToolDefinition sequentially in tool order', async () => {
    const tools = testTools()
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0

    const adapter = createMcpAdapter({
      tools,
      pipeline: testPipeline(tools),
      async transformToolDefinition(def) {
        order.push(`start:${def.name}`)
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        order.push(`end:${def.name}`)
        inFlight--
        return def
      },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    expect(res.status).toBe(200)
    expect(maxInFlight).toBe(1)
    expect(order).toEqual(
      tools.flatMap((tool) => [`start:${tool.name}`, `end:${tool.name}`]),
    )
  })

  it('no behavior change when not provided', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })
    const body = await res.json() as any
    expect(body.result.tools).toHaveLength(3)
    // No extra fields
    expect(body.result.tools[0].outputSchema).toBeUndefined()
    expect(body.result.tools[0].icons).toBeUndefined()
  })
})

describe('transformToolResult hook', () => {
  it('adds structuredContent alongside text', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      transformToolResult(result) {
        return {
          ...result,
          structuredContent: { summary: 'transformed' },
        }
      },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_items', arguments: {} },
    })
    const body = await res.json() as any
    expect(body.result.structuredContent).toEqual({ summary: 'transformed' })
    // Original content still present
    expect(body.result.content).toHaveLength(1)
  })

  it('adds content annotations (audience, priority)', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      transformToolResult(result) {
        return {
          ...result,
          content: result.content.map(c => ({
            ...c,
            annotations: { audience: ['user'], priority: 0.8 },
          })),
        }
      },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_items', arguments: {} },
    })
    const body = await res.json() as any
    expect(body.result.content[0].annotations).toEqual({
      audience: ['user'],
      priority: 0.8,
    })
  })

  it('receives correct dispatchSuccess context', async () => {
    let receivedCtx: any = null

    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      transformToolResult(result, ctx) {
        receivedCtx = ctx
        return result
      },
    })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_items', arguments: { q: 'widget' } },
    })

    expect(receivedCtx).not.toBeNull()
    expect(receivedCtx.dispatchSuccess.response?.statusCode ?? 200).toBe(200)
    expect(receivedCtx.dispatchSuccess.value).toBeDefined()
    expect(receivedCtx.args).toEqual({ q: 'widget' })
    expect(receivedCtx.tool.name).toBe('search_items')
  })

  it('no behavior change when not provided', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_items', arguments: { q: 'widget' } },
    })
    const body = await res.json() as any
    expect(body.result.content).toHaveLength(1)
    expect(body.result.structuredContent).toBeUndefined()
  })
})

describe('outputSchema', () => {
  it('includes outputSchema in tools/list when present', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET',
        path: '/items/:id',
        name: 'get_item',
        description: 'Get item',
        inputSchema: null,
        outputSchema: { properties: { id: { type: 'string' }, name: { type: 'string' } } },
        sideEffects: false,
        examples: [],
        tags: [],
      },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    const body = await res.json() as any
    const tool = body.result.tools[0]
    expect(tool.outputSchema).toBeDefined()
    expect(tool.outputSchema.type).toBe('object')
    expect(tool.outputSchema.properties.id).toEqual({ type: 'string' })
  })

  it('omits outputSchema from tools/list when not present', async () => {
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
      },
    ]

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/list', params: {},
    })

    const body = await res.json() as any
    expect(body.result.tools[0].outputSchema).toBeUndefined()
  })

  it('includes structuredContent when outputSchema is defined and body is object', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET',
        path: '/items',
        name: 'search_items',
        description: 'Search items',
        inputSchema: null,
        outputSchema: { properties: { items: { type: 'array' } } },
        sideEffects: false,
        examples: [],
        tags: [],
      },
    ]

    const proxy: McpProxyFunction = async () => ({
      status: 200,
      headers: {},
      body: { items: [{ id: '1' }] },
    })

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_items', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.structuredContent).toEqual({ items: [{ id: '1' }] })
  })

  it('does not include structuredContent when outputSchema is absent', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'search_items', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.structuredContent).toBeUndefined()
  })

  it('does not include structuredContent when outputSchema returns an array body', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET',
        path: '/items',
        name: 'list_items',
        description: 'List items',
        inputSchema: null,
        outputSchema: { type: 'array', items: { type: 'object' } },
        sideEffects: false,
        examples: [],
        tags: [],
      },
    ]

    const proxy: McpProxyFunction = async () => ({
      status: 200,
      headers: {},
      body: [{ id: '1' }],
    })

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'list_items', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.structuredContent).toBeUndefined()
    expect(body.result.content[0].text).toContain('"id": "1"')
  })
})

describe('binary content', () => {
  it('returns ImageContent for image responses', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET', path: '/avatar', name: 'get_avatar', description: 'Get avatar',
        inputSchema: null, sideEffects: false, examples: [], tags: [],
      },
    ]

    const proxy: McpProxyFunction = async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: 'iVBORw0KGgo=',
    })

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_avatar', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.content[0].type).toBe('image')
    expect(body.result.content[0].mimeType).toBe('image/png')
    expect(body.result.content[0].data).toBe('iVBORw0KGgo=')
  })

  it('base64-encodes Uint8Array image responses', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET', path: '/avatar', name: 'get_avatar_bytes', description: 'Get avatar bytes',
        inputSchema: null, sideEffects: false, examples: [], tags: [],
      },
    ]

    const proxy: McpProxyFunction = async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    })

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_avatar_bytes', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.content[0].type).toBe('image')
    expect(body.result.content[0].data).toBe('iVBORw0KGgo=')
  })

  it('returns AudioContent for audio responses', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET', path: '/audio', name: 'get_audio', description: 'Get audio',
        inputSchema: null, sideEffects: false, examples: [], tags: [],
      },
    ]

    const proxy: McpProxyFunction = async () => ({
      status: 200,
      headers: { 'content-type': 'audio/wav' },
      body: 'UklGRg==',
    })

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_audio', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.content[0].type).toBe('audio')
    expect(body.result.content[0].mimeType).toBe('audio/wav')
    expect(body.result.content[0].data).toBe('UklGRg==')
  })

  it('base64-encodes ArrayBuffer audio responses', async () => {
    const tools: ToolDefinition[] = [
      {
        method: 'GET', path: '/audio', name: 'get_audio_buffer', description: 'Get audio buffer',
        inputSchema: null, sideEffects: false, examples: [], tags: [],
      },
    ]

    const proxy: McpProxyFunction = async () => ({
      status: 200,
      headers: { 'content-type': 'audio/wav' },
      body: Uint8Array.from([0x52, 0x49, 0x46, 0x46]).buffer,
    })

    const adapter = createMcpAdapter({ tools, pipeline: testPipeline(tools, proxy) })

    await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
    })

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_audio_buffer', arguments: {} },
    })

    const body = await res.json() as any
    expect(body.result.content[0].type).toBe('audio')
    expect(body.result.content[0].data).toBe('UklGRg==')
  })
})

describe('connectStdio', () => {
  it('awaits async configureServer before creating the stdio server', async () => {
    const deferred = createDeferred()

    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      async configureServer() {
        await deferred.promise
      },
    })

    const connectPromise = adapter.connectStdio()
    await Promise.resolve()
    await Promise.resolve()
    expect(mockStdioServers).toHaveLength(0)

    deferred.resolve()
    await connectPromise

    expect(mockStdioServers).toHaveLength(1)
    expect(mockStdioServers[0]?.connect).toHaveBeenCalledTimes(1)
  })

  it('passes configureServer capabilities into stdio server construction', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer({ addCapabilities }) {
        addCapabilities({ resources: {} })
      },
    })

    await adapter.connectStdio()

    expect(mockStdioServers[0]?.options).toEqual({
      capabilities: expect.objectContaining({
        tools: {},
        logging: {},
        resources: {},
      }),
    })
  })

  it('uses configureServer overrides for built-in stdio handlers', async () => {
    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer({ setHandler }) {
        setHandler('tools/list', async () => ({
          tools: [
            { name: 'override_tool', description: 'Only tool', inputSchema: {} },
          ],
        }))
      },
    })

    await adapter.connectStdio()

    const server = mockStdioServers[0]
    expect(server).toBeDefined()

    const handler = getRegisteredHandler<
      (request: { params?: Record<string, unknown> }, extra?: unknown) => Promise<Record<string, unknown>>
    >(server!, mcpSchemas.ListToolsRequestSchema)

    await expect(handler({ params: {} })).resolves.toEqual({
      tools: [
        { name: 'override_tool', description: 'Only tool', inputSchema: {} },
      ],
    })
  })

  it('registers custom stdio request methods from configureServer', async () => {
    let seenHeaders: Record<string, string> | undefined
    let seenSignal: AbortSignal | undefined

    const adapter = createMcpAdapter({
      tools: testTools(),
      pipeline: testPipeline(testTools()),
      configureServer({ setHandler }) {
        setHandler('custom.echo', async (params, ctx) => {
          seenHeaders = ctx.headers
          seenSignal = ctx.signal
          ctx.contextIngredients?.onLog?.('info', 'custom log')
          ctx.contextIngredients?.onProgress?.(2, 5)
          return { echoed: params.message ?? null }
        })
      },
    })

    await adapter.connectStdio()

    const server = mockStdioServers[0]
    expect(server).toBeDefined()

    const handler = getCustomRequestHandler<
      (request: { params?: Record<string, unknown> }, extra?: unknown) => Promise<Record<string, unknown>>
    >(server!, 'custom.echo')

    const signal = new AbortController().signal
    await expect(handler(
      { params: { message: 'hi', _meta: { progressToken: 'token-1' } } },
      { requestInfo: { headers: { 'x-request-id': 'abc-123' } }, signal },
    )).resolves.toEqual({ echoed: 'hi' })

    expect(seenHeaders).toEqual({ 'x-request-id': 'abc-123' })
    expect(seenSignal).toBe(signal)
    expect(server?.sendLoggingMessage).toHaveBeenCalledWith({ level: 'info', data: 'custom log' })
    expect(server?.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'token-1', progress: 2, total: 5 },
    })
  })

  it('removes stdio signal handlers during close', async () => {
    const adapter = createMcpAdapter({ tools: testTools(), pipeline: testPipeline(testTools()) })
    const onceSpy = vi.spyOn(process, 'once')
    const removeListenerSpy = vi.spyOn(process, 'removeListener')
    const originalUnref = process.stdin.unref
    const unrefSpy = vi.fn()
    Object.defineProperty(process.stdin, 'unref', {
      configurable: true,
      value: unrefSpy,
    })

    try {
      await adapter.connectStdio()
      expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(onceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))

      await adapter.close()

      expect(removeListenerSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(removeListenerSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      expect(unrefSpy).toHaveBeenCalled()
      expect(mockStdioServers[0]?.close).toHaveBeenCalledTimes(1)
    } finally {
      onceSpy.mockRestore()
      removeListenerSpy.mockRestore()
      if (originalUnref) {
        Object.defineProperty(process.stdin, 'unref', {
          configurable: true,
          value: originalUnref,
        })
      } else {
        Reflect.deleteProperty(process.stdin, 'unref')
      }
    }
  })
})
