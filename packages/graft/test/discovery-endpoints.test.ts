/**
 * Tests for auto-served discovery endpoints:
 * /llms.txt, /llms-full.txt, /.well-known/mcp.json, /docs, enhanced /health
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { z } from 'zod'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createApp } from '../src/app.js'
import { generateLlmsTxt, generateLlmsFullTxt } from '../src/llms-txt.js'
import { generateMcpCard } from '../src/mcp-card.js'
import { generateDocsHtml } from '../src/docs.js'
import type { DiscoveryOptions } from '../src/app.js'
import type { Manifest } from '../src/mcp.js'

// =========================================================================
// Helpers
// =========================================================================

function emptyManifest(): Manifest {
  return { tools: [], resources: [], resourceTemplates: [], prompts: [] }
}

function richManifest(): Manifest {
  return {
    tools: [
      {
        name: 'search',
        description: 'Search items',
        method: 'GET',
        path: '/search',
        inputSchema: {
          properties: { q: { type: 'string', description: 'Search query' } },
          required: ['q'],
        },
        sideEffects: false,
        examples: [{ name: 'basic', args: { q: 'widgets' }, result: [{ id: '1', name: 'Widget' }], description: 'Find widgets' }],
        tags: ['items'],
      },
      {
        name: 'create_item',
        description: 'Create a new item',
        method: 'POST',
        path: '/items',
        inputSchema: {
          properties: { name: { type: 'string', description: 'Item name' } },
          required: ['name'],
        },
        outputSchema: { properties: { id: { type: 'string' }, name: { type: 'string' } } },
        sideEffects: true,
        examples: [{ name: 'create', args: { name: 'Gadget' }, result: { id: '2', name: 'Gadget' } }],
        tags: ['items'],
        auth: true,
      },
      {
        name: 'health_check',
        description: 'Check system health',
        inputSchema: null,
        sideEffects: false,
        examples: [],
        tags: [],
        deprecated: 'Use GET /health instead',
      },
    ],
    resources: [
      { uri: 'config://app', name: 'app-config', description: 'App configuration', mimeType: 'application/json' },
    ],
    resourceTemplates: [
      { uriTemplate: 'file:///{path}', name: 'file', description: 'Read a file', mimeType: 'text/plain', params: null },
    ],
    prompts: [
      { name: 'summarize', description: 'Summarize text', params: { properties: { text: { type: 'string', description: 'Text to summarize' } }, required: ['text'] } },
    ],
  }
}

// =========================================================================
// generateLlmsTxt
// =========================================================================

describe('generateLlmsTxt', () => {
  it('renders empty manifest', () => {
    const txt = generateLlmsTxt(emptyManifest(), { name: 'Test' })
    expect(txt).toContain('# Test')
    expect(txt).not.toContain('## Tools')
  })

  it('includes server description', () => {
    const txt = generateLlmsTxt(emptyManifest(), { name: 'Test', description: 'A great server' })
    expect(txt).toContain('> A great server')
  })

  it('lists tools grouped by tag', () => {
    const txt = generateLlmsTxt(richManifest())
    // Tagged tools under ### items
    expect(txt).toContain('### items')
    expect(txt).toContain('**search**')
    expect(txt).toContain('**create_item**')
    // Untagged tool without a tag header
    expect(txt).toContain('**health_check**')
  })

  it('marks deprecated tools', () => {
    const txt = generateLlmsTxt(richManifest())
    expect(txt).toContain('[DEPRECATED: Use GET /health instead]')
  })

  it('lists resources', () => {
    const txt = generateLlmsTxt(richManifest())
    expect(txt).toContain('## Resources')
    expect(txt).toContain('**app-config**')
  })

  it('lists resource templates', () => {
    const txt = generateLlmsTxt(richManifest())
    expect(txt).toContain('**file**')
    expect(txt).toContain('`file:///{path}`')
  })

  it('lists prompts', () => {
    const txt = generateLlmsTxt(richManifest())
    expect(txt).toContain('## Prompts')
    expect(txt).toContain('**summarize**')
  })
})

// =========================================================================
// generateLlmsFullTxt
// =========================================================================

describe('generateLlmsFullTxt', () => {
  it('renders empty manifest', () => {
    const txt = generateLlmsFullTxt(emptyManifest(), { name: 'Test' })
    expect(txt).toContain('# Test')
    expect(txt).not.toContain('## Tools')
  })

  it('includes parameter details', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('`q` (string, required): Search query')
  })

  it('includes method and path', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('**GET** `/search`')
    expect(txt).toContain('**POST** `/items`')
  })

  it('includes auth info', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('**Auth**: required')
  })

  it('includes side effects marker', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('**Side effects**: yes')
  })

  it('includes deprecated marker with message', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('**Deprecated**: Use GET /health instead')
  })

  it('includes examples with args and results', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('**Example "basic"**: Find widgets')
    expect(txt).toContain('"q": "widgets"')
    expect(txt).toContain('**Output**')
  })

  it('keeps fenced json example blocks valid JSON', () => {
    const txt = generateLlmsFullTxt(richManifest())
    const blocks = [...txt.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1])
    for (const block of blocks) {
      expect(() => JSON.parse(block)).not.toThrow()
    }
  })

  it('includes output schema details', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('**Returns:**')
    expect(txt).toContain('`id` (string)')
  })

  it('includes prompt parameter details', () => {
    const txt = generateLlmsFullTxt(richManifest())
    expect(txt).toContain('`text` (string, required): Text to summarize')
  })
})

// =========================================================================
// generateMcpCard
// =========================================================================

describe('generateMcpCard', () => {
  it('generates valid MCP server card', () => {
    const card = generateMcpCard({
      name: 'my-server',
      version: '1.0.0',
      description: 'Test server',
      baseUrl: 'https://example.com',
      manifest: richManifest(),
    })

    expect(card.mcp_version).toBe('2025-11-25')
    expect(card.server_name).toBe('my-server')
    expect(card.server_version).toBe('1.0.0')
    expect(card.description).toBe('Test server')
    expect((card.endpoints as any).streamable_http.url).toBe('https://example.com/mcp')
  })

  it('derives capabilities from manifest', () => {
    const card = generateMcpCard({
      baseUrl: 'http://localhost:3000',
      manifest: richManifest(),
    })

    const caps = card.capabilities as any
    expect(caps.tools).toBe(true)
    expect(caps.resources).toBe(true)
    expect(caps.prompts).toBe(true)
  })

  it('capabilities false for empty manifest', () => {
    const card = generateMcpCard({
      baseUrl: 'http://localhost:3000',
      manifest: emptyManifest(),
    })

    const caps = card.capabilities as any
    expect(caps.tools).toBe(false)
    expect(caps.resources).toBe(false)
    expect(caps.prompts).toBe(false)
  })

  it('strips trailing slash from baseUrl', () => {
    const card = generateMcpCard({
      baseUrl: 'https://example.com/',
      manifest: emptyManifest(),
    })
    expect((card.endpoints as any).streamable_http.url).toBe('https://example.com/mcp')
  })

  it('omits description when not provided', () => {
    const card = generateMcpCard({
      baseUrl: 'http://localhost:3000',
      manifest: emptyManifest(),
    })
    expect(card.description).toBeUndefined()
  })
})

// =========================================================================
// generateDocsHtml
// =========================================================================

describe('generateDocsHtml', () => {
  it('generates HTML with Scalar script', () => {
    const html = generateDocsHtml({ name: 'My API' })
    expect(html).toContain('<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">')
    expect(html).toContain("Scalar.createApiReference('#app'")
  })

  it('includes spec URL', () => {
    const html = generateDocsHtml()
    expect(html).toContain("url: '/openapi.json'")
  })

  it('includes server name in title', () => {
    const html = generateDocsHtml({ name: 'My API' })
    expect(html).toContain('<title>My API — API Reference</title>')
  })

  it('escapes HTML in name', () => {
    const html = generateDocsHtml({ name: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('accepts custom spec URL', () => {
    const html = generateDocsHtml({ specUrl: '/api/spec.json' })
    expect(html).toContain("url: '/api/spec.json'")
  })
})

// =========================================================================
// Integration — routes served by the app
// =========================================================================

describe('auto-served discovery endpoints (integration)', () => {
  function buildTestApp() {
    const app = createApp({ name: 'test-server', version: '2.0.0', description: 'A test API' })
    app.tool('greet', {
      description: 'Greet someone',
      params: z.object({ name: z.string() }),
      tags: ['social'],
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })
    return app
  }

  it('GET /llms.txt returns text/plain', async () => {
    const { fetch } = buildTestApp().build()
    const res = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('# test-server')
    expect(text).toContain('**greet**')
  })

  it('GET /llms-full.txt returns text/plain with details', async () => {
    const { fetch } = buildTestApp().build()
    const res = await fetch(new Request('http://localhost:3000/llms-full.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('# test-server')
    expect(text).toContain('`name` (string, required)')
  })

  it('GET /.well-known/mcp.json returns valid server card', async () => {
    const { fetch } = buildTestApp().build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/mcp.json'))
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.server_name).toBe('test-server')
    expect(json.server_version).toBe('2.0.0')
    expect(json.description).toBe('A test API')
    expect(json.capabilities.tools).toBe(true)
    expect(json.endpoints.streamable_http.url).toBe('http://localhost:3000/mcp')
  })

  it('GET /docs returns text/html with Scalar', async () => {
    const { fetch } = buildTestApp().build()
    const res = await fetch(new Request('http://localhost:3000/docs'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('Scalar.createApiReference')
    expect(html).toContain('test-server')
  })

  it('GET /health returns expanded info', async () => {
    const { fetch } = buildTestApp().build()
    const res = await fetch(new Request('http://localhost:3000/health'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.name).toBe('test-server')
    expect(body.version).toBe('2.0.0')
    expect(body.tools).toBe(1)
    expect(body.mcp).toBe('2025-11-25')
    expect(typeof body.uptime).toBe('number')
  })

  it('new endpoints are reserved — tool collision throws', () => {
    const app = createApp({ name: 'test' })
    app.tool('llms', {
      description: 'Conflicts with llms.txt',
      http: { method: 'GET', path: '/llms.txt' },
      handler: () => 'bad',
    })
    expect(() => app.build()).toThrow('conflicts with a reserved framework route')
  })
})

// =========================================================================
// Configurable discovery endpoints
// =========================================================================

describe('configurable discovery endpoints', () => {
  function createAppWith(discovery: DiscoveryOptions) {
    const app = createApp({ name: 'test-server', version: '1.0.0', description: 'Test', discovery })
    app.tool('greet', {
      description: 'Greet someone',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })
    return app
  }

  function buildAppWith(discovery: DiscoveryOptions) {
    return createAppWith(discovery).build()
  }

  // --- Disable (false) ---

  it('discovery.llmsTxt: false → GET /llms.txt returns 404', async () => {
    const { fetch } = buildAppWith({ llmsTxt: false })
    const res = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(res.status).toBe(404)
  })

  it('discovery.llmsFullTxt: false → GET /llms-full.txt returns 404', async () => {
    const { fetch } = buildAppWith({ llmsFullTxt: false })
    const res = await fetch(new Request('http://localhost:3000/llms-full.txt'))
    expect(res.status).toBe(404)
  })

  it('discovery.docs: false → GET /docs returns 404', async () => {
    const { fetch } = buildAppWith({ docs: false })
    const res = await fetch(new Request('http://localhost:3000/docs'))
    expect(res.status).toBe(404)
  })

  it('discovery.openapi: false → GET /openapi.json returns 404', async () => {
    const { fetch } = buildAppWith({ openapi: false })
    const res = await fetch(new Request('http://localhost:3000/openapi.json'))
    expect(res.status).toBe(404)
  })

  it('discovery.mcpCard: false → GET /.well-known/mcp.json returns 404', async () => {
    const { fetch } = buildAppWith({ mcpCard: false })
    const res = await fetch(new Request('http://localhost:3000/.well-known/mcp.json'))
    expect(res.status).toBe(404)
  })

  it('discovery.agentJson: false → GET /.well-known/agent.json returns 404', async () => {
    const { fetch } = buildAppWith({ agentJson: false })
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    expect(res.status).toBe(404)
  })

  // --- Disabled endpoint is NOT reserved ---

  it('disabled endpoint path is not reserved — tool with that path builds fine', () => {
    const app = createApp({ name: 'test', discovery: { llmsTxt: false } })
    app.tool('llms', {
      description: 'Custom tool at llms.txt path',
      http: { method: 'GET', path: '/llms.txt' },
      handler: () => 'ok',
    })
    expect(() => app.build()).not.toThrow()
  })

  // --- Custom generator (function) ---

  it('discovery.llmsTxt: function → serves custom content', async () => {
    const { fetch } = buildAppWith({
      llmsTxt: (manifest) => `# Custom\n${manifest.tools.length} tools`,
    })
    const res = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toBe('# Custom\n1 tools')
  })

  it('discovery.openapi: function → serves custom JSON', async () => {
    const { fetch } = buildAppWith({
      openapi: (manifest) => ({
        openapi: '3.1.0',
        info: {
          title: 'Custom',
          version: '1.0.0',
          description: `${manifest.tools.length} tools`,
        },
        paths: {},
      }),
    })
    const res = await fetch(new Request('http://localhost:3000/openapi.json'))
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.openapi).toBe('3.1.0')
    expect(json.info.title).toBe('Custom')
    expect(json.info.description).toBe('1 tools')
  })

  // --- File path (string) ---

  let tempDir: string
  let tmpFile: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graft-discovery-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    tmpFile = undefined
  })

  it('discovery.llmsTxt: file path → serves file content', async () => {
    tmpFile = path.join(tempDir, 'llms.txt')
    fs.writeFileSync(tmpFile, '# Static LLMs\nServed from file')

    const { fetch } = buildAppWith({ llmsTxt: tmpFile })
    const res = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toBe('# Static LLMs\nServed from file')
  })

  it('discovery.llmsTxt: file path → caches content after first request', async () => {
    tmpFile = path.join(tempDir, 'llms-cache.txt')
    fs.writeFileSync(tmpFile, '# Initial content')

    const { fetch } = buildAppWith({ llmsTxt: tmpFile })
    const first = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(await first.text()).toBe('# Initial content')

    fs.writeFileSync(tmpFile, '# Updated content')

    const second = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(await second.text()).toBe('# Initial content')
  })

  it('file-backed discovery caches are isolated per app instance', async () => {
    tmpFile = path.join(tempDir, 'llms-isolated.txt')
    fs.writeFileSync(tmpFile, '# First app content')

    const firstApp = buildAppWith({ llmsTxt: tmpFile })
    const firstResponse = await firstApp.fetch(new Request('http://localhost:3000/llms.txt'))
    expect(await firstResponse.text()).toBe('# First app content')

    fs.writeFileSync(tmpFile, '# Second app content')

    const firstAppCachedResponse = await firstApp.fetch(new Request('http://localhost:3000/llms.txt'))
    expect(await firstAppCachedResponse.text()).toBe('# First app content')

    const secondApp = buildAppWith({ llmsTxt: tmpFile })
    const secondResponse = await secondApp.fetch(new Request('http://localhost:3000/llms.txt'))
    expect(await secondResponse.text()).toBe('# Second app content')
  })

  it('discovery.openapi: file path → serves parsed JSON file', async () => {
    tmpFile = path.join(tempDir, 'openapi.json')
    fs.writeFileSync(tmpFile, JSON.stringify({ openapi: '3.1.0', info: { title: 'Static' } }))

    const { fetch } = buildAppWith({ openapi: tmpFile })
    const res = await fetch(new Request('http://localhost:3000/openapi.json'))
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.openapi).toBe('3.1.0')
    expect(json.info.title).toBe('Static')
  })

  it('discovery.llmsTxt: missing file path → build stays lazy and route returns 500', async () => {
    tmpFile = path.join(tempDir, 'missing.txt')
    const { fetch } = buildAppWith({ llmsTxt: tmpFile })
    const res = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/Failed to read discovery content/),
    })
  })

  it('discovery.openapi: invalid JSON file path → build stays lazy and route returns 500', async () => {
    tmpFile = path.join(tempDir, 'bad-openapi.json')
    fs.writeFileSync(tmpFile, '{ invalid json }')

    const { fetch } = buildAppWith({ openapi: tmpFile })
    const res = await fetch(new Request('http://localhost:3000/openapi.json'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/Failed to parse discovery JSON/),
    })
  })

  it('file-backed discovery endpoints recover after an initial read failure', async () => {
    tmpFile = path.join(tempDir, 'recover.txt')

    const { fetch } = buildAppWith({ llmsTxt: tmpFile })

    const first = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(first.status).toBe(500)

    fs.writeFileSync(tmpFile, 'recovered')

    const second = await fetch(new Request('http://localhost:3000/llms.txt'))
    expect(second.status).toBe(200)
    expect(await second.text()).toBe('recovered')
  })

  it('file-backed discovery endpoints fail during serve() preflight', async () => {
    tmpFile = path.join(tempDir, 'bad-preflight.json')
    fs.writeFileSync(tmpFile, '{ invalid json }')

    const app = createAppWith({ openapi: tmpFile })
    await expect(app.serve({ port: 0, host: '127.0.0.1' })).rejects.toThrow(/Failed to parse discovery JSON/)
  })

  // --- Default (no discovery option) → all endpoints work as before ---

  it('no discovery option → all endpoints still work', async () => {
    const app = createApp({ name: 'test-server', version: '1.0.0' })
    app.tool('greet', { description: 'Hi', handler: () => 'hi' })
    const { fetch } = app.build()

    const endpoints = [
      '/llms.txt', '/llms-full.txt', '/docs',
      '/openapi.json', '/.well-known/mcp.json', '/.well-known/agent.json',
    ]
    for (const ep of endpoints) {
      const res = await fetch(new Request(`http://localhost:3000${ep}`))
      expect(res.status, `Expected 200 for ${ep}`).toBe(200)
    }
  })
})

// =========================================================================
// apiUrl — pointer fields in discovery docs use explicit URL, not request host
// =========================================================================

describe('apiUrl', () => {
  function buildApp(apiUrl?: string) {
    const app = createApp({ name: 'my-api', version: '1.0.0', description: 'Test', apiUrl })
    app.tool('greet', {
      description: 'Greet someone',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })
    return app.build()
  }

  it('without apiUrl — URLs derived from request host', async () => {
    const { fetch } = buildApp()
    // Simulate request arriving at the backend's own host
    const res = await fetch(new Request('http://localhost:3000/.well-known/mcp.json'))
    const json = await res.json() as any
    expect(json.endpoints.streamable_http.url).toBe('http://localhost:3000/mcp')
  })

  it('with apiUrl — mcp.json endpoint URL uses apiUrl regardless of request host', async () => {
    const { fetch } = buildApp('http://localhost:3000')
    // Request arrives via frontend proxy (host is 3001), but apiUrl pins it to 3000
    const res = await fetch(new Request('http://localhost:3001/.well-known/mcp.json'))
    const json = await res.json() as any
    expect(json.endpoints.streamable_http.url).toBe('http://localhost:3000/mcp')
  })

  it('with apiUrl — agent.json url field uses apiUrl', async () => {
    const { fetch } = buildApp('http://localhost:3000')
    const res = await fetch(new Request('http://localhost:3001/.well-known/agent.json'))
    const json = await res.json() as any
    expect(json.url).toContain('localhost:3000')
  })

  it('with apiUrl — openapi.json servers[0].url uses apiUrl', async () => {
    const { fetch } = buildApp('http://localhost:3000')
    const res = await fetch(new Request('http://localhost:3001/openapi.json'))
    const json = await res.json() as any
    expect(json.servers[0].url).toBe('http://localhost:3000')
  })

  it('strips trailing slash from apiUrl', async () => {
    const { fetch } = buildApp('http://localhost:3000/')
    const res = await fetch(new Request('http://localhost:3001/.well-known/mcp.json'))
    const json = await res.json() as any
    expect(json.endpoints.streamable_http.url).toBe('http://localhost:3000/mcp')
  })
})
