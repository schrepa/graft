import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Command } from 'commander'
import {
  buildClaudeServerConfig,
  ensureClaudeServers,
  readClaudeDesktopConfig,
  resolveClaudeConfigDir,
} from '../claude-desktop.js'

/**
 * Register the `install` subcommand on a Commander program.
 *
 * @param program Commander instance to extend.
 * @example
 * registerInstallCommand(new Command())
 */
export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Add this project to Claude Desktop config for MCP')
    .option('-e, --entry <path>', 'Path to app entry file (e.g. src/app.ts)')
    .option('--name <name>', 'Display name in Claude Desktop (default: directory name)')
    .option('--port <port>', 'Port the server runs on (used for HTTP URL)')
    .option('--stdio', 'Configure as stdio transport (default: streamable-http)')
    .action(async (options) => {
      const name = options.name ?? basename(process.cwd())
      const isStdio = options.stdio ?? false
      const configDir = resolveClaudeConfigDir()
      const configPath = join(configDir, 'claude_desktop_config.json')
      const config = readClaudeDesktopConfig(configPath)
      const servers = ensureClaudeServers(config)
      servers[name] = buildClaudeServerConfig(options)

      mkdirSync(configDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

      console.log('')
      console.log(`  Installed "${name}" to Claude Desktop config`)
      console.log(`  Config: ${configPath}`)
      if (isStdio) {
        console.log('  Transport: stdio')
      } else {
        console.log(`  URL: ${servers[name].url}`)
      }
      console.log('')
      console.log('  Restart Claude Desktop to pick up the change.')
      console.log('')
    })
}
