import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { runCli } from '../src/cli-main.js'
import { generateMcpCard } from '../src/mcp-card.js'
import { generateOpenApiSpec } from '../src/openapi-gen.js'
import { GRAFT_VERSION } from '../src/version.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shared version metadata', () => {
  it('reuses GRAFT_VERSION across generated runtime surfaces', async () => {
    const spec = generateOpenApiSpec([])
    expect(spec.info.version).toBe(GRAFT_VERSION)

    const card = generateMcpCard({
      baseUrl: 'https://example.com',
      manifest: { tools: [], resources: [], resourceTemplates: [], prompts: [] },
    })
    expect(card.server_version).toBe(GRAFT_VERSION)

    const app = createApp({ name: 'test-app' })
    const healthResponse = await app.toFetch()(new Request('http://localhost/health'))
    const health = await healthResponse.json() as { version: string }
    expect(health.version).toBe(GRAFT_VERSION)

    const initializeResponse = await app.build().mcp.handleMcp(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    }))
    const initializeBody = await initializeResponse.json() as {
      result: { serverInfo: { version: string } }
    }
    expect(initializeBody.result.serverInfo.version).toBe(GRAFT_VERSION)
  })

  it('prints GRAFT_VERSION for the CLI --version flag', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write)

    expect(await runCli(['--version'])).toBe(0)

    const output = writeSpy.mock.calls
      .map(([chunk]) => typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      .join('')

    expect(output).toContain(GRAFT_VERSION)
  })
})
