import type { Command } from 'commander'
import { collect } from '../proxy-app.js'
import { parseTimeoutMsOption } from './shared.js'
import { resolveDefaultServePort } from '../serve-defaults.js'

/**
 * Register the `dev` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerDevCommand(new Command())
 */
export function registerDevCommand(program: Command): void {
  program
    .command('dev')
    .description('Start dev server with auto-restart on file changes')
    .option('-e, --entry <path>', 'Path to app entry file (e.g. src/app.ts)')
    .option('--openapi <path>', 'Path or URL to OpenAPI spec')
    .option('--openapi-timeout-ms <ms>', 'Timeout for fetching remote OpenAPI specs', parseTimeoutMsOption)
    .option('--config <path>', 'Path to graft.proxy.yaml')
    .option('--target <url>', 'Target API URL')
    .option('-p, --port <port>', 'Port to listen on')
    .option('--watch <dir>', 'Directory to watch (default: src)')
    .option('--header <k=v>', 'Default header (repeatable)', collect, [])
    .option('--locked-header <k=v>', 'Locked header (repeatable)', collect, [])
    .action(async (options) => {
      const { startDevServer } = await import('../../dev-server.js')
      await startDevServer({
        entry: options.entry,
        openapi: options.openapi,
        openapiTimeoutMs: options.openapiTimeoutMs,
        config: options.config,
        target: options.target,
        port: parseInt(
          options.port ?? String(resolveDefaultServePort({ entry: options.entry })),
          10,
        ),
        watchDir: options.watch,
        header: options.header,
        lockedHeader: options.lockedHeader,
      })
    })
}
