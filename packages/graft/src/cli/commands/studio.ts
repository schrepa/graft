import type { Command } from 'commander'
import { collect } from '../proxy-app.js'
import {
  buildInspectorArgs,
  launchInspector,
  parseTimeoutMsOption,
  resolveStudioRuntime,
  startInternalStudioServer,
} from './shared.js'

/**
 * Register the `studio` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerStudioCommand(new Command())
 */
export function registerStudioCommand(program: Command): void {
  program
    .command('studio')
    .description('Open MCP Inspector to browse and test tools')
    .option('--url <url>', 'MCP endpoint URL to connect to')
    .option('-e, --entry <path>', 'Path to app entry file (e.g. src/app.ts)')
    .option('--openapi <path>', 'OpenAPI spec for proxy mode')
    .option('--openapi-timeout-ms <ms>', 'Timeout for fetching remote OpenAPI specs', parseTimeoutMsOption)
    .option('--config <path>', 'Config file for proxy mode')
    .option('--target <url>', 'Target API URL for proxy mode')
    .option('--header <k=v>', 'Header forwarded to MCP server (repeatable)', collect, [])
    .option('--locked-header <k=v>', 'Locked header (repeatable)', collect, [])
    .action(async (options) => {
      const runtime = await resolveStudioRuntime(options)
      const started = runtime ? await startInternalStudioServer(runtime) : undefined

      try {
        const mcpUrl = started?.url ?? (options.url ?? 'http://localhost:3000/mcp')
        const inspectorArgs = buildInspectorArgs(
          mcpUrl,
          [...(options.header ?? []), ...(options.lockedHeader ?? [])],
        )

        console.log('')
        console.log('  Launching MCP Inspector...')
        console.log(`  Connected to: ${mcpUrl}`)
        console.log('')

        process.exitCode = await launchInspector(inspectorArgs)
      } finally {
        await started?.handle.close()
      }
    })
}
