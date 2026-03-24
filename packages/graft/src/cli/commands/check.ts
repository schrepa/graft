import type { Command } from 'commander'
import type { McpAdapter } from '../../mcp/shared.js'
import { loadApp } from '../entry-loader.js'
import { buildProxyApp } from '../proxy-app.js'
import { parseTimeoutMsOption } from './shared.js'

async function loadManifestSource(options: {
  entry?: string
  openapi?: string
  config?: string
  openapiTimeoutMs?: number
}): Promise<McpAdapter> {
  if (options.entry) {
    const result = await loadApp(options.entry)
    return result.mcp
  }

  const result = await buildProxyApp(options)
  return result.mcp
}

/**
 * Register the `check` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerCheckCommand(new Command())
 */
export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Validate tool definitions')
    .option('-e, --entry <path>', 'Path to app entry file (e.g. src/app.ts)')
    .option('--openapi <path>', 'Path to OpenAPI spec')
    .option('--openapi-timeout-ms <ms>', 'Timeout for fetching remote OpenAPI specs', parseTimeoutMsOption)
    .option('--config <path>', 'Path to graft.proxy.yaml')
    .action(async (options) => {
      const mcp = await loadManifestSource(options)
      const { validateManifest, formatValidation } = await import('../../diagnostics.js')
      const manifest = mcp.getManifest()

      console.log(`Found ${manifest.tools.length} tool(s):`)
      for (const tool of manifest.tools) {
        console.log(`  ${tool.name} (${tool.method} ${tool.path})`)
      }
      console.log('')

      const result = validateManifest(manifest)
      console.log(formatValidation(result))
      process.exitCode = result.valid ? 0 : 1
    })
}
