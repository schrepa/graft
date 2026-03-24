import { describe, it, expect } from 'vitest'
import { createMcpAdapter } from '../src/mcp.js'
import { createToolPipeline } from '../src/pipeline.js'
import { validateManifest } from '../src/diagnostics.js'
import type { ToolDefinition } from '../src/types.js'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    method: 'GET',
    path: '/items',
    name: 'search_items',
    description: 'Search items',
    inputSchema: null,
    sideEffects: false,
    examples: [],
    tags: [],
    ...overrides,
  }
}

const noopPipeline = createToolPipeline({ tools: [] })

describe('tool registration via createMcpAdapter', () => {
  it('registers a tool with explicit name', () => {
    const adapter = createMcpAdapter({ tools: [makeTool()], pipeline: noopPipeline })
    const manifest = adapter.getManifest()

    expect(manifest.tools).toHaveLength(1)
    expect(manifest.tools[0].name).toBe('search_items')
    expect(manifest.tools[0].description).toBe('Search items')
    expect(manifest.tools[0].method).toBe('GET')
    expect(manifest.tools[0].path).toBe('/items')
  })

  it('stores tool names exactly as registered', () => {
    const adapter = createMcpAdapter({
      tools: [makeTool({ name: 'get_items' })],
      pipeline: noopPipeline,
    })

    const tools = adapter.getManifest().tools
    expect(tools[0].name).toBe('get_items')
  })

  it('uses custom name', () => {
    const adapter = createMcpAdapter({
      tools: [makeTool({ name: 'my_custom_tool' })],
      pipeline: noopPipeline,
    })

    const tool = adapter.getManifest().tools.find(t => t.name === 'my_custom_tool')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('my_custom_tool')
  })

  it('throws on name collision', () => {
    expect(() => {
      createMcpAdapter({
        tools: [makeTool({ path: '/items' }), makeTool({ path: '/items' })],
        pipeline: noopPipeline,
      })
    }).toThrow(/collision/)
  })

  it('stores auth: true and passes it through', () => {
    const adapter = createMcpAdapter({
      tools: [makeTool({ name: 'secure_items', auth: true })],
      pipeline: noopPipeline,
    })

    const tool = adapter.getManifest().tools.find(t => t.name === 'secure_items')!
    expect(tool.auth).toBe(true)
  })

  it('stores auth with roles and passes it through', () => {
    const adapter = createMcpAdapter({
      tools: [makeTool({ name: 'admin_items', auth: { roles: ['admin'] } })],
      pipeline: noopPipeline,
    })

    const tool = adapter.getManifest().tools.find(t => t.name === 'admin_items')!
    expect(tool.auth).toEqual({ roles: ['admin'] })
  })
})

describe('validateManifest', () => {
  it('validates missing descriptions', () => {
    const result = validateManifest({ tools: [makeTool({ description: '' })] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('Missing description'))).toBe(true)
  })

  it('warns about POST without schema', () => {
    const result = validateManifest({
      tools: [makeTool({ method: 'POST', name: 'create_item', description: 'Create item', sideEffects: true })],
    })
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toContain('no input schema')
  })

  it('warns when parameterLocations references non-existent param', () => {
    const result = validateManifest({
      tools: [makeTool({
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        parameterLocations: { name: { in: 'query' }, ghost: { in: 'header' } },
      })],
    })
    expect(result.warnings.some(w => w.message.includes('"ghost"') && w.message.includes('not in inputSchema'))).toBe(true)
  })

  it('does not warn for parameterLocations that match path params', () => {
    const result = validateManifest({
      tools: [makeTool({
        path: '/items/:id',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        parameterLocations: { id: { in: 'path' }, name: { in: 'query' } },
      })],
    })
    const locWarnings = result.warnings.filter(w => w.message.includes('parameterLocations'))
    expect(locWarnings).toHaveLength(0)
  })

  it('suggests adding examples when none are provided', () => {
    const result = validateManifest({ tools: [makeTool()] })
    expect(result.valid).toBe(true)
    expect(result.infos).toHaveLength(1)
    expect(result.infos[0].tool).toBe('search_items')
    expect(result.infos[0].message).toContain('No examples')
  })

  it('does not suggest examples when they are provided', () => {
    const result = validateManifest({
      tools: [makeTool({
        examples: [{ args: { q: 'shoes' }, description: 'Search for shoes' }],
      })],
    })
    expect(result.infos).toHaveLength(0)
  })
})

describe('Resource registration', () => {
  it('throws on URI collision', () => {
    expect(() => {
      createMcpAdapter({
        tools: [makeTool()],
        pipeline: noopPipeline,
        resources: [
          { uri: 'data://status', name: 'status', description: 'Status' },
          { uri: 'data://status', name: 'status_v2', description: 'Status v2' },
        ],
      })
    }).toThrow(/collision/)
  })
})

describe('Resource template registration', () => {
  it('throws on URI template collision', () => {
    expect(() => {
      createMcpAdapter({
        tools: [makeTool()],
        pipeline: noopPipeline,
        resourceTemplates: [
          { uriTemplate: 'items://{id}', name: 'item', description: 'Item', params: null },
          { uriTemplate: 'items://{id}', name: 'item_v2', description: 'Item v2', params: null },
        ],
      })
    }).toThrow(/collision/)
  })
})

describe('Prompt registration', () => {
  it('throws on name collision', () => {
    expect(() => {
      createMcpAdapter({
        tools: [makeTool()],
        pipeline: noopPipeline,
        prompts: [
          { name: 'suggest', description: 'Suggest', params: null },
          { name: 'suggest', description: 'Suggest v2', params: null },
        ],
      })
    }).toThrow(/collision/)
  })
})
