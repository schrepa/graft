import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadProxyConfig as readProxyConfig, configToToolDefinitions } from '../src/proxy/config.js'
import { buildProxyApp } from '../src/cli-shared.js'

let tmpDir: string

function loadProxyConfig(
  filePath: string,
  options?: { env?: Readonly<Record<string, string | undefined>> },
) {
  return readProxyConfig(filePath, { env: options?.env ?? process.env })
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'graft-proxy-test-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadProxyConfig', () => {
  it('loads a YAML config file', async () => {
    const configPath = join(tmpDir, 'graft.proxy.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
name: my-api
tools:
  - method: GET
    path: /items
    description: List items
    parameters:
      type: object
      properties:
        q: { type: string, description: Search query }
  - method: POST
    path: /entries
    description: Create an entry
    parameters:
      type: object
      properties:
        itemIds: { type: array, items: { type: string } }
      required: [itemIds]
`)
    const config = await loadProxyConfig(configPath)
    expect(config.target).toBe('http://localhost:3000')
    expect(config.name).toBe('my-api')
    expect(config.tools).toHaveLength(2)
    expect(config.tools[0].method).toBe('GET')
    expect(config.tools[0].path).toBe('/items')
    expect(config.tools[0].description).toBe('List items')
    expect(config.tools[1].method).toBe('POST')
  })

  it('loads a JSON config file', async () => {
    const configPath = join(tmpDir, 'graft.proxy.json')
    writeFileSync(configPath, JSON.stringify({
      target: 'http://localhost:8080',
      tools: [
        { method: 'GET', path: '/items', description: 'List items' },
      ],
    }))
    const config = await loadProxyConfig(configPath)
    expect(config.target).toBe('http://localhost:8080')
    expect(config.tools).toHaveLength(1)
  })

  it('expands environment variables in headers', async () => {
    vi.stubEnv('TEST_API_KEY', 'my-secret-key')
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
headers:
  X-Api-Key: \${TEST_API_KEY}
  X-Static: static-value
tools:
  - method: GET
    path: /items
    description: List items
`)
    const config = await loadProxyConfig(configPath)
    expect(config.headers).toBeDefined()
    expect(config.headers!['X-Api-Key']).toBe('my-secret-key')
    expect(config.headers!['X-Static']).toBe('static-value')
  })

  it('uses an explicit env map for header expansion', async () => {
    vi.stubEnv('TEST_API_KEY', 'ambient-secret')
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
headers:
  X-Api-Key: \${TEST_API_KEY}
tools:
  - method: GET
    path: /items
    description: List items
`)
    const config = await loadProxyConfig(configPath, {
      env: { TEST_API_KEY: 'injected-secret' },
    })

    expect(config.headers).toBeDefined()
    expect(config.headers!['X-Api-Key']).toBe('injected-secret')
  })

  it('does not fall back to ambient process.env when an explicit env map is provided', async () => {
    process.env.GRAFT_PROXY_CONFIG_TEST = 'ambient-secret'
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
headers:
  X-Api-Key: \${GRAFT_PROXY_CONFIG_TEST}
tools:
  - method: GET
    path: /items
    description: List items
`)

    await expect(loadProxyConfig(configPath, { env: {} })).rejects.toThrow(
      'Missing environment variable(s): GRAFT_PROXY_CONFIG_TEST',
    )

    delete process.env.GRAFT_PROXY_CONFIG_TEST
  })

  it('throws on missing env vars', async () => {
    vi.stubEnv('MISSING_VAR', '')
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
headers:
  X-Key: \${MISSING_VAR}
tools:
  - method: GET
    path: /items
    description: List items
`)
    vi.unstubAllEnvs()
    await expect(loadProxyConfig(configPath)).rejects.toThrow('Missing environment variable(s): MISSING_VAR')
  })

  it('throws on missing target', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
tools:
  - method: GET
    path: /items
    description: List items
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow('target')
  })

  it('throws on missing tools array', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow('tools')
  })

  it('throws descriptive error for malformed JSON', async () => {
    const configPath = join(tmpDir, 'bad.json')
    writeFileSync(configPath, '{ "target": "http://localhost", }')
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/Invalid JSON/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(configPath)
  })

  it('includes the config path when the file cannot be read', async () => {
    const missingPath = join(tmpDir, 'missing-config.yaml')
    await expect(loadProxyConfig(missingPath)).rejects.toThrow(missingPath)
    await expect(loadProxyConfig(missingPath)).rejects.toThrow(/Failed to read proxy config/)
  })

  it('throws indexed error when tool missing method', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - path: /items
    description: List items
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]\.method/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/is required/)
  })

  it('throws indexed error when tool missing path', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    description: List items
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]\.path/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/is required/)
  })

  it('throws indexed error when tool missing description', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]\.description/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/is required/)
  })

  it('throws on invalid auth config', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: POST
    path: /items
    description: Create item
    auth:
      roles: [admin, 42]
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]\.auth\.roles/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/array of strings/)
  })

  it('throws on non-string header values', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
headers:
  X-Retry-Count: 3
tools:
  - method: GET
    path: /items
    description: List items
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/headers\.X-Retry-Count/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/must be a string/)
  })

  it('throws on invalid parameterLocations config', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
    description: List items
    parameterLocations:
      if_match:
        in: headers
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/parameterLocations\.if_match\.in/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/path, query, header, or body/)
  })

  it('throws when parameterLocations.name is used for body params', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: POST
    path: /items
    description: Create item
    parameterLocations:
      payload:
        in: body
        name: data
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/parameterLocations\.payload\.name/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/only supported for query or header/)
  })

  it('throws when parameterLocations.name is used for path params', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items/:id
    description: Get item
    parameterLocations:
      id:
        in: path
        name: itemId
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/parameterLocations\.id\.name/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/only supported for query or header/)
  })

  it('throws on invalid example args config', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
    description: List items
    examples:
      - name: bad
        args: nope
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/examples\[0\].args/)
  })

  it('throws on non-string tags', async () => {
    const configPath = join(tmpDir, 'config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
    description: List items
    tags: [items, 42]
`)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/tools\[0\]\.tags/)
    await expect(loadProxyConfig(configPath)).rejects.toThrow(/array of strings/)
  })
})

describe('configToToolDefinitions', () => {
  it('converts config tools to ToolDefinition array', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [
        {
          method: 'GET',
          path: '/items',
          description: 'List items',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string' } },
          },
        },
        {
          method: 'POST',
          path: '/entries',
          description: 'Create an entry',
          name: 'create_entry',
          tags: ['entries'],
          parameters: {
            type: 'object',
            properties: { itemIds: { type: 'array' } },
            required: ['itemIds'],
          },
        },
      ],
    })

    expect(tools).toHaveLength(2)

    expect(tools[0].method).toBe('GET')
    expect(tools[0].path).toBe('/items')
    expect(tools[0].description).toBe('List items')
    expect(tools[0].inputSchema).toEqual({
      type: 'object',
      properties: { q: { type: 'string' } },
    })

    expect(tools[1].method).toBe('POST')
    expect(tools[1].name).toBe('create_entry')
    expect(tools[1].tags).toEqual(['entries'])
    expect(tools[1].inputSchema).toEqual({
      type: 'object',
      properties: { itemIds: { type: 'array' } },
      required: ['itemIds'],
    })
  })

  it('uppercases method', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [{ method: 'get', path: '/items', description: 'Items' }],
    })
    expect(tools[0].method).toBe('GET')
  })

  it('sets inputSchema to null when no parameters', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [{ method: 'GET', path: '/items', description: 'Items' }],
    })
    expect(tools[0].inputSchema).toBeNull()
  })

  it('threads parameterLocations through to ToolDefinition', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [{
        method: 'GET',
        path: '/items',
        description: 'Items',
        parameterLocations: { if_match: { in: 'header', name: 'If-Match' } },
      }],
    })
    expect(tools[0].parameterLocations).toEqual({ if_match: { in: 'header', name: 'If-Match' } })
  })

  it('threads outputSchema through to ToolDefinition', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [{
        method: 'GET',
        path: '/items',
        description: 'Items',
        outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      }],
    })
    expect(tools[0].outputSchema).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('threads auth through to ToolDefinition', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [{
        method: 'POST',
        path: '/entries',
        description: 'Create entry',
        auth: { roles: ['admin'] },
      }],
    })
    expect(tools[0].auth).toEqual({ roles: ['admin'] })
  })

  it('threads examples through to ToolDefinition', () => {
    const tools = configToToolDefinitions({
      target: 'http://localhost:3000',
      tools: [{
        method: 'GET',
        path: '/items',
        description: 'Items',
        examples: [{ name: 'Search', args: { q: 'widget' }, description: 'Search for widgets' }],
      }],
    })
    expect(tools[0].examples).toHaveLength(1)
    expect(tools[0].examples[0].args).toEqual({ q: 'widget' })
  })
})

describe('buildProxyApp', () => {
  it('rejects malformed --header values', async () => {
    const configPath = join(tmpDir, 'graft.proxy.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
    description: List items
`)

    await expect(buildProxyApp({
      config: configPath,
      header: ['Authorization'],
      lockedHeader: [],
    })).rejects.toThrow('Invalid header "Authorization". Use NAME=value.')
  })

  it('rejects malformed --locked-header values', async () => {
    const configPath = join(tmpDir, 'graft.proxy.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
    description: List items
`)

    await expect(buildProxyApp({
      config: configPath,
      header: [],
      lockedHeader: ['X-Api-Key'],
    })).rejects.toThrow('Invalid header "X-Api-Key". Use NAME=value.')
  })
})

describe('loadProxyConfig with $ref/definitions', () => {
  it('resolves $ref in parameters using definitions', async () => {
    const configPath = join(tmpDir, 'ref-config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
definitions:
  PaginationParams:
    type: object
    properties:
      page: { type: integer }
      limit: { type: integer }
tools:
  - method: GET
    path: /items
    description: List items
    parameters:
      type: object
      properties:
        q: { type: string }
        pagination:
          $ref: '#/definitions/PaginationParams'
`)
    const config = await loadProxyConfig(configPath)
    const params = config.tools[0].parameters as any
    expect(params.properties.pagination.type).toBe('object')
    expect(params.properties.pagination.properties.page.type).toBe('integer')
  })

  it('resolves $ref in outputSchema using definitions', async () => {
    const configPath = join(tmpDir, 'ref-output-config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
definitions:
  Item:
    type: object
    properties:
      id: { type: string }
      name: { type: string }
tools:
  - method: GET
    path: /items/:id
    description: Get item
    outputSchema:
      $ref: '#/definitions/Item'
`)
    const config = await loadProxyConfig(configPath)
    const output = config.tools[0].outputSchema as any
    expect(output.type).toBe('object')
    expect(output.properties.id.type).toBe('string')
  })

  it('loads parameterLocations from YAML', async () => {
    const configPath = join(tmpDir, 'param-loc-config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: GET
    path: /items
    description: Items
    parameterLocations:
      if_match:
        in: header
        name: If-Match
      accept:
        in: header
`)
    const config = await loadProxyConfig(configPath)
    expect(config.tools[0].parameterLocations).toEqual({
      if_match: { in: 'header', name: 'If-Match' },
      accept: { in: 'header' },
    })
  })

  it('loads auth and examples from YAML', async () => {
    const configPath = join(tmpDir, 'auth-config.yaml')
    writeFileSync(configPath, `
target: http://localhost:3000
tools:
  - method: POST
    path: /entries
    description: Create entry
    auth:
      roles: [admin]
    examples:
      - name: Example entry
        args:
          itemId: item-1
        description: Create item 1
`)
    const config = await loadProxyConfig(configPath)
    expect(config.tools[0].auth).toEqual({ roles: ['admin'] })
    expect(config.tools[0].examples).toHaveLength(1)
    expect(config.tools[0].examples![0].args).toEqual({ itemId: 'item-1' })
  })
})
