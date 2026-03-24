import type { Command } from 'commander'
import { loadApp, type LoadResult } from '../entry-loader.js'
import { buildProxyApp, collect } from '../proxy-app.js'
import { parseTimeoutMsOption } from './shared.js'
import { resolveDefaultServePort } from '../serve-defaults.js'
import { createMcpBridgeFetch } from './shared.js'
import { Collector } from '../../telemetry/collector.js'

async function resolveServeRuntime(options: {
  entry?: string
  openapi?: string
  config?: string
  target?: string
  header?: string[]
  lockedHeader?: string[]
  openapiTimeoutMs?: number
}): Promise<LoadResult> {
  if (options.entry) return loadApp(options.entry)
  return buildProxyApp(options)
}

/**
 * Register the `serve` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerServeCommand(new Command())
 */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the MCP server')
    .option('-e, --entry <path>', 'Path to app entry file (e.g. src/app.ts)')
    .option('--openapi <path>', 'Path or URL to OpenAPI spec (YAML or JSON)')
    .option('--openapi-timeout-ms <ms>', 'Timeout for fetching remote OpenAPI specs', parseTimeoutMsOption)
    .option('--config <path>', 'Path to graft.proxy.yaml')
    .option('--target <url>', 'Target API URL (overrides config)')
    .option('-p, --port <port>', 'Port to listen on')
    .option('--stdio', 'Use stdio transport for MCP (for Claude Desktop, etc.)')
    .option('--header <k=v>', 'Default header — overridable by callers (repeatable)', collect, [])
    .option('--locked-header <k=v>', 'Locked header — cannot be overridden by callers (repeatable)', collect, [])
    .action(async (options) => {
      const result = await resolveServeRuntime(options)
      const { mcp } = result

      const { validateManifest, formatValidation } = await import('../../diagnostics.js')
      const manifest = mcp.getManifest()
      const validation = validateManifest(manifest)
      if (!validation.valid) {
        console.error(formatValidation(validation))
        process.exitCode = 1
        return
      }

      if (options.stdio) {
        await mcp.connectStdio()
        return
      }

      console.log(`Registered ${manifest.tools.length} tool(s):`)
      for (const tool of manifest.tools) {
        console.log(`  ${tool.name} (${tool.method} ${tool.path})`)
      }

      const collector = new Collector()
      collector.start()

      const { startServer } = await import('../../server/lifecycle.js')
      const port = parseInt(
        options.port ?? String(resolveDefaultServePort({ entry: options.entry })),
        10,
      )
      const fetch = createMcpBridgeFetch(
        mcp,
        () => `http://127.0.0.1:${port}`,
        result.fetch,
      )

      try {
        await startServer({
          mcp,
          port,
          fetch,
          onShutdown: () => {
            collector.stop()
          },
        })
      } catch (error) {
        collector.stop()
        throw error
      }
    })
}
