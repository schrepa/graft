import { describe, it, expect } from 'vitest'
import { validateManifest } from '../src/diagnostics.js'
import { createHttpProxy } from '../src/proxy/http-proxy.js'
import { parseOpenApiSpec } from '../src/proxy/openapi.js'
import { configToToolDefinitions } from '../src/proxy/config.js'
import type { HttpMethod } from '../src/http-method.js'
import type { ToolDefinition } from '../src/types.js'

const TARGET = 'https://testservice.example.test'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getToolRoute(tool: ToolDefinition): { method: HttpMethod; path: string } {
  if (!tool.method || !tool.path) {
    throw new Error(`Tool "${tool.name}" is missing an HTTP route`)
  }
  return { method: tool.method, path: tool.path }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const parsed = await request.json()
  if (isRecord(parsed)) {
    return parsed
  }
  return {}
}

function createTestFetchDouble(): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/items') {
      const q = url.searchParams.get('q')
      const items = [
        { id: '1', name: 'Alpha', category: 'active' },
        { id: '2', name: 'Beta', category: 'archived' },
      ]
      const filtered = q
        ? items.filter((item) => item.name.toLowerCase().includes(q.toLowerCase()))
        : items
      return Response.json(filtered)
    }

    if (request.method === 'GET' && /^\/items\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2]
      if (id === '1') {
        return Response.json({ id: '1', name: 'Alpha', category: 'active' })
      }
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    if (request.method === 'POST' && url.pathname === '/entries') {
      const parsed = await readJsonObject(request)
      return Response.json({ id: 'entry-1', ...parsed }, { status: 201 })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

describe('proxy integration', () => {
  const fetchImpl = createTestFetchDouble()

  describe('integration: OpenAPI -> registry -> proxy -> target API', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            summary: 'List items',
            operationId: 'listItems',
            tags: ['catalog'],
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
            ],
          },
        },
        '/items/{id}': {
          get: {
            summary: 'Get item details',
            operationId: 'getItem',
            tags: ['catalog'],
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
          },
        },
        '/entries': {
          post: {
            summary: 'Create an entry',
            operationId: 'createEntry',
            tags: ['entries'],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      itemIds: { type: 'array', items: { type: 'string' } },
                      priority: { type: 'number' },
                    },
                    required: ['itemIds', 'priority'],
                  },
                },
              },
            },
          },
        },
      },
    }

    function buildToolsAndProxy() {
      const tools = parseOpenApiSpec(spec)
      const toolMap = new Map<string, ToolDefinition>()
      for (const tool of tools) toolMap.set(tool.name, tool)

      const allowedRoutes = new Set(
        tools.flatMap((tool) => (tool.method && tool.path ? [`${tool.method} ${tool.path}`] : [])),
      )

      const proxy = createHttpProxy({
        target: TARGET,
        allowedRoutes,
        fetchImpl,
      })

      return { tools, toolMap, proxy }
    }

    it('registers tools from OpenAPI spec', () => {
      const { tools } = buildToolsAndProxy()
      expect(tools).toHaveLength(3)

      const names = tools.map((tool) => tool.name)
      expect(names).toContain('listItems')
      expect(names).toContain('getItem')
      expect(names).toContain('createEntry')
    })

    it('tools have correct inputSchema from OpenAPI', () => {
      const { toolMap } = buildToolsAndProxy()

      expect(toolMap.get('listItems')?.inputSchema).toEqual({
        type: 'object',
        properties: { q: { type: 'string', description: 'Search query' } },
      })

      expect(toolMap.get('getItem')?.inputSchema).toEqual({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      })

      expect(toolMap.get('createEntry')?.inputSchema).toEqual({
        type: 'object',
        properties: {
          itemIds: { type: 'array', items: { type: 'string' } },
          priority: { type: 'number' },
        },
        required: ['itemIds', 'priority'],
      })
    })

    it('proxies a GET tool call to the target API', async () => {
      const { toolMap, proxy } = buildToolsAndProxy()
      const route = getToolRoute(toolMap.get('listItems')!)
      const result = await proxy(route.method, route.path, { q: 'Alpha' })

      expect(result.status).toBe(200)
      expect(result.body).toEqual([
        { id: '1', name: 'Alpha', category: 'active' },
      ])
    })

    it('proxies a GET-with-params tool call', async () => {
      const { toolMap, proxy } = buildToolsAndProxy()
      const route = getToolRoute(toolMap.get('getItem')!)
      const result = await proxy(route.method, route.path, { id: '1' })

      expect(result.status).toBe(200)
      expect(result.body).toEqual({ id: '1', name: 'Alpha', category: 'active' })
    })

    it('proxies a POST tool call', async () => {
      const { toolMap, proxy } = buildToolsAndProxy()
      const route = getToolRoute(toolMap.get('createEntry')!)
      const result = await proxy(route.method, route.path, {
        itemIds: ['1'],
        priority: 5,
      })

      expect(result.status).toBe(201)
      expect(result.body).toEqual({
        id: 'entry-1',
        itemIds: ['1'],
        priority: 5,
      })
    })

    it('handles 404 from target API', async () => {
      const { toolMap, proxy } = buildToolsAndProxy()
      const route = getToolRoute(toolMap.get('getItem')!)
      const result = await proxy(route.method, route.path, { id: 'missing' })

      expect(result.status).toBe(404)
    })
  })

  describe('integration: config -> registry -> proxy -> target API', () => {
    function buildToolsAndProxy() {
      const tools = configToToolDefinitions({
        target: TARGET,
        tools: [
          {
            method: 'GET',
            path: '/items',
            name: 'list_items',
            description: 'List items',
            parameters: {
              type: 'object',
              properties: { q: { type: 'string', description: 'Search query' } },
            },
          },
          {
            method: 'GET',
            path: '/items/:id',
            name: 'get_item',
            description: 'Get item details',
            parameters: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          },
          {
            method: 'POST',
            path: '/entries',
            name: 'create_entry',
            description: 'Create an entry',
            parameters: {
              type: 'object',
              properties: {
                itemIds: { type: 'array', items: { type: 'string' } },
                priority: { type: 'number' },
              },
              required: ['itemIds', 'priority'],
            },
          },
        ],
      })

      const toolMap = new Map<string, ToolDefinition>()
      for (const tool of tools) toolMap.set(tool.name, tool)

      const allowedRoutes = new Set(
        tools.flatMap((tool) => (tool.method && tool.path ? [`${tool.method} ${tool.path}`] : [])),
      )

      const proxy = createHttpProxy({
        target: TARGET,
        allowedRoutes,
        fetchImpl,
      })

      return { tools, toolMap, proxy }
    }

    it('registers tools from config', () => {
      const { tools, toolMap } = buildToolsAndProxy()
      expect(tools).toHaveLength(3)
      expect(toolMap.get('create_entry')).toBeDefined()
      expect(toolMap.get('list_items')).toBeDefined()
      expect(toolMap.get('get_item')).toBeDefined()
    })

    it('proxies config-defined tools to target API', async () => {
      const { toolMap, proxy } = buildToolsAndProxy()
      const route = getToolRoute(toolMap.get('list_items')!)
      const result = await proxy(route.method, route.path, {})

      expect(result.status).toBe(200)
      expect(result.body).toHaveLength(2)
    })

    it('validation passes for valid config', () => {
      const { tools } = buildToolsAndProxy()
      const result = validateManifest({ tools })
      expect(result.valid).toBe(true)
    })
  })
})
