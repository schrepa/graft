import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoadResult } from '../src/cli/entry-loader.js'
import { startInternalStudioServer } from '../src/cli/commands/shared.js'
import { canListenOnLoopback } from './test-server.js'

const describeLoopback = await canListenOnLoopback() ? describe : describe.skip

describeLoopback('startInternalStudioServer', () => {
  let started: Awaited<ReturnType<typeof startInternalStudioServer>> | undefined

  afterEach(async () => {
    vi.restoreAllMocks()
    if (started) {
      await started.handle.close().catch(() => {})
      started = undefined
    }
  })

  it('binds a loopback port and derives agent.json from the bound address', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const mcp = {
      handleMcp: vi.fn(async () => Response.json({ ok: true })),
      handleAgentJson: vi.fn(async (baseUrl: string) => Response.json({ url: baseUrl })),
      close: vi.fn().mockResolvedValue(undefined),
      getManifest: () => ({ tools: [], resources: [], resourceTemplates: [], prompts: [] }),
    }
    const runtime: LoadResult = { mcp: mcp as never }

    started = await startInternalStudioServer(runtime)
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

    const bridgeResponse = await fetch(new Request(started.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))
    expect(bridgeResponse.status).toBe(200)

    const baseUrl = started.url.replace(/\/mcp$/, '')
    const agentResponse = await fetch(new Request(`${baseUrl}/.well-known/agent.json`))
    expect(await agentResponse.json()).toEqual({ url: baseUrl })

    expect(mcp.handleMcp).toHaveBeenCalledOnce()
    expect(mcp.handleAgentJson).toHaveBeenCalledWith(baseUrl)
  })
})
