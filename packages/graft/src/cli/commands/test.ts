import type { Command } from 'commander'
import { loadApp } from '../entry-loader.js'
import { buildProxyApp } from '../proxy-app.js'
import { parseTimeoutMsOption } from './shared.js'

/**
 * Register the `test` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerTestCommand(new Command())
 */
export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description('Run tool examples as smoke tests')
    .option('-e, --entry <path>', 'Path to app entry file')
    .option('--openapi <path>', 'Path to OpenAPI spec')
    .option('--openapi-timeout-ms <ms>', 'Timeout for fetching remote OpenAPI specs', parseTimeoutMsOption)
    .option('--config <path>', 'Path to graft.proxy.yaml')
    .option('-t, --tool <name>', 'Only test a specific tool')
    .action(async (options) => {
      const result = options.entry ? await loadApp(options.entry) : await buildProxyApp(options)
      if (!result.app) {
        throw new Error('Test requires an App instance. Use -e with a greenfield app.')
      }

      const { runExampleTests, formatTestSummary } = await import('../../test-runner.js')
      const summary = await runExampleTests(result.app, options.tool)
      console.log(formatTestSummary(summary))
      process.exitCode = summary.failed > 0 ? 1 : 0
    })
}
