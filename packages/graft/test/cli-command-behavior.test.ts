import { afterEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import type { LoadResult } from '../src/cli/entry-loader.js'

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
  process.exitCode = undefined
})

describe('CLI command behavior', () => {
  it('serve --stdio keeps stdout free of boot logs', async () => {
    const mcp = {
      connectStdio: vi.fn().mockResolvedValue(undefined),
      getManifest: () => ({
        tools: [
          {
            name: 'search_items',
            description: 'Search items',
            method: 'GET',
            path: '/items',
            inputSchema: null,
            sideEffects: false,
            examples: [],
            tags: [],
          },
        ],
        resources: [],
        resourceTemplates: [],
        prompts: [],
      }),
    }
    const runtime: LoadResult = { mcp: mcp as never }

    vi.doMock('../src/cli/proxy-app.js', () => ({
      buildProxyApp: vi.fn(async () => runtime),
      collect,
    }))
    vi.doMock('../src/cli/entry-loader.js', () => ({
      loadApp: vi.fn(async () => runtime),
    }))

    const { registerServeCommand } = await import('../src/cli/commands/serve.js')
    const program = new Command()
    program.exitOverride()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    registerServeCommand(program)
    await program.parseAsync(['serve', '--stdio'], { from: 'user' })

    expect(mcp.connectStdio).toHaveBeenCalledOnce()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('studio closes the helper server after the inspector exits', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const started = {
      url: 'http://127.0.0.1:4444/mcp',
      handle: {
        close,
        server: {} as never,
        shutdownSignal: new AbortController().signal,
      },
    }
    const buildInspectorArgs = vi.fn(() => ['@modelcontextprotocol/inspector'])
    const launchInspector = vi.fn().mockResolvedValue(0)
    const resolveStudioRuntime = vi.fn().mockResolvedValue({ mcp: {} })
    const startInternalStudioServer = vi.fn().mockResolvedValue(started)

    vi.doMock('../src/cli/commands/shared.js', () => ({
      buildInspectorArgs,
      launchInspector,
      parseTimeoutMsOption: (value: string) => Number.parseInt(value, 10),
      resolveStudioRuntime,
      startInternalStudioServer,
    }))
    vi.doMock('../src/cli/proxy-app.js', () => ({ collect }))

    const { registerStudioCommand } = await import('../src/cli/commands/studio.js')
    const program = new Command()
    program.exitOverride()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    registerStudioCommand(program)
    await program.parseAsync(['studio'], { from: 'user' })

    expect(startInternalStudioServer).toHaveBeenCalledOnce()
    expect(buildInspectorArgs).toHaveBeenCalledWith(started.url, [])
    expect(launchInspector).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
