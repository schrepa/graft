import { describe, it, expect } from 'vitest'
import { createMcpAdapter } from '../src/mcp.js'
import type { ToolPipeline } from '../src/pipeline.js'
import type { ToolDefinition, ResourceDefinition, PromptDefinition } from '../src/types.js'

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

function mcpRequest(adapter: ReturnType<typeof createMcpAdapter>, body: object): Promise<Response> {
  return adapter.handleMcp(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  }))
}

function initRequest(adapter: ReturnType<typeof createMcpAdapter>) {
  return mcpRequest(adapter, {
    jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
  })
}

const testTool: ToolDefinition = {
  method: 'GET', path: '/items', name: 'search_items', description: 'Search',
  inputSchema: null, sideEffects: false, examples: [], tags: [],
}

const noopPipeline: ToolPipeline = {
  dispatch: async () => ({ requestId: 'noop', ok: true, value: {} }),
  dispatchResource: async () => ({ requestId: 'noop', ok: true, value: {} }),
  dispatchFromRequest: async () => ({ requestId: 'noop', ok: true, value: {} }),
  dispatchResourceFromRequest: async () => ({ requestId: 'noop', ok: true, value: {} }),
}

describe('resources in mcp adapter', () => {
  it('registers resources in registry', () => {
    const resources: ResourceDefinition[] = [
      { uri: 'data://status', name: 'current_status', description: 'Current status' },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, resources })
    expect(adapter.getManifest().resources).toHaveLength(1)
    expect((adapter.getManifest().resources.length > 0 || adapter.getManifest().resourceTemplates.length > 0)).toBe(true)
  })

  it('lists resources via MCP', async () => {
    const resources: ResourceDefinition[] = [
      { uri: 'data://status', name: 'current_status', description: 'Current status', mimeType: 'application/json' },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, resources })
    await initRequest(adapter)

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'resources/list', params: {},
    })
    const body = await res.json() as any
    expect(body.result.resources).toHaveLength(1)
    expect(body.result.resources[0].uri).toBe('data://status')
    expect(body.result.resources[0].mimeType).toBe('application/json')
  })

  it('reads a resource via MCP', async () => {
    const resources: ResourceDefinition[] = [
      { uri: 'data://status', name: 'current_status', description: 'Current status' },
    ]

    const adapter = createMcpAdapter({
      tools: [testTool],
      pipeline: noopPipeline,
      resources,
      resourceHandler: async (uri) => {
        if (uri === 'data://status') {
          return { content: [{ name: 'Alpha', value: 42 }] }
        }
        throw new Error(`Unknown resource: ${uri}`)
      },
    })

    await initRequest(adapter)

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'data://status' },
    })
    const body = await res.json() as any
    expect(body.result.contents).toHaveLength(1)
    const content = JSON.parse(body.result.contents[0].text)
    expect(content).toEqual([{ name: 'Alpha', value: 42 }])
  })

  it('includes resources in agent.json', async () => {
    const resources: ResourceDefinition[] = [
      { uri: 'data://status', name: 'current_status', description: 'Current status' },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, resources })
    const res = adapter.handleAgentJson('http://localhost:3000')
    const json = await res.json() as any
    expect(json.resources).toHaveLength(1)
    expect(json.resources[0].uri).toBe('data://status')
  })

  it('declares resources capability in MCP initialize', async () => {
    const resources: ResourceDefinition[] = [
      { uri: 'data://status', name: 'current_status', description: 'Current status' },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, resources })
    const res = await initRequest(adapter)
    const body = await res.json() as any
    expect(body.result.capabilities.resources).toBeDefined()
  })

  it('does not declare resources capability when no resources', async () => {
    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline })
    const res = await initRequest(adapter)
    const body = await res.json() as any
    expect(body.result.capabilities.resources).toBeUndefined()
  })
})

describe('prompts in mcp adapter', () => {
  it('registers prompts in registry', () => {
    const prompts: PromptDefinition[] = [
      { name: 'suggest', description: 'Generate recommendations', params: null },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, prompts })
    expect(adapter.getManifest().prompts).toHaveLength(1)
    expect((adapter.getManifest().prompts.length > 0)).toBe(true)
  })

  it('lists prompts via MCP', async () => {
    const prompts: PromptDefinition[] = [
      {
        name: 'suggest',
        description: 'Generate recommendations',
        params: {
          type: 'object',
          properties: {
            preferences: { type: 'string', description: 'User preferences' },
          },
          required: ['preferences'],
        },
      },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, prompts })
    await initRequest(adapter)

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'prompts/list', params: {},
    })
    const body = await res.json() as any
    expect(body.result.prompts).toHaveLength(1)
    expect(body.result.prompts[0].name).toBe('suggest')
    expect(body.result.prompts[0].arguments).toHaveLength(1)
    expect(body.result.prompts[0].arguments[0].name).toBe('preferences')
    expect(body.result.prompts[0].arguments[0].required).toBe(true)
  })

  it('gets a prompt via MCP', async () => {
    const prompts: PromptDefinition[] = [
      { name: 'suggest', description: 'Generate recommendations', params: null },
    ]

    const adapter = createMcpAdapter({
      tools: [testTool],
      pipeline: noopPipeline,
      prompts,
      promptHandler: async (name, args) => {
        if (name === 'suggest') {
          return [{ role: 'user', content: `Generate recommendations for ${args.preferences ?? 'anyone'}` }]
        }
        throw new Error(`Unknown prompt: ${name}`)
      },
    })

    await initRequest(adapter)

    const res = await mcpRequest(adapter, {
      jsonrpc: '2.0', id: 1, method: 'prompts/get',
      params: { name: 'suggest', arguments: { preferences: 'vegan' } },
    })
    const body = await res.json() as any
    expect(body.result.messages).toHaveLength(1)
    expect(body.result.messages[0].role).toBe('user')
    expect(body.result.messages[0].content.text).toContain('vegan')
  })

  it('declares prompts capability in MCP initialize', async () => {
    const prompts: PromptDefinition[] = [
      { name: 'suggest', description: 'Generate recommendations', params: null },
    ]

    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline, prompts })
    const res = await initRequest(adapter)
    const body = await res.json() as any
    expect(body.result.capabilities.prompts).toBeDefined()
  })

  it('does not declare prompts capability when no prompts', async () => {
    const adapter = createMcpAdapter({ tools: [testTool], pipeline: noopPipeline })
    const res = await initRequest(adapter)
    const body = await res.json() as any
    expect(body.result.capabilities.prompts).toBeUndefined()
  })
})
