import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDefaultServePort } from './serve-defaults.js'
import { isPlainRecord } from '../object-schema.js'

/**
 * One Claude Desktop MCP server entry.
 */
export interface ClaudeDesktopServerConfig {
  command?: string
  args?: string[]
  cwd?: string
  url?: string
}

/**
 * Claude Desktop configuration file shape.
 */
export interface ClaudeDesktopConfig {
  mcpServers?: Record<string, ClaudeDesktopServerConfig>
}

/**
 * User-facing install options accepted by `graft install`.
 */
export interface ClaudeDesktopInstallOptions {
  entry?: string
  port?: string
  stdio?: boolean
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isClaudeDesktopServerConfig(value: unknown): value is ClaudeDesktopServerConfig {
  if (!isPlainRecord(value)) return false
  if (value.command !== undefined && typeof value.command !== 'string') return false
  if (value.args !== undefined && !isStringArray(value.args)) return false
  if (value.cwd !== undefined && typeof value.cwd !== 'string') return false
  if (value.url !== undefined && typeof value.url !== 'string') return false
  return true
}

function isClaudeDesktopServerMap(
  value: unknown,
): value is Record<string, ClaudeDesktopServerConfig> {
  return isPlainRecord(value) && Object.values(value).every(isClaudeDesktopServerConfig)
}

function isClaudeDesktopConfig(value: unknown): value is ClaudeDesktopConfig {
  if (!isPlainRecord(value)) return false
  return value.mcpServers === undefined || isClaudeDesktopServerMap(value.mcpServers)
}

/**
 * Resolve the Claude Desktop configuration directory for the current platform.
 *
 * @returns The platform-specific Claude Desktop config directory.
 */
export function resolveClaudeConfigDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude')
  }
  return join(homedir(), '.config', 'claude')
}

/**
 * Read Claude Desktop config from disk.
 *
 * @param configPath Absolute path to `claude_desktop_config.json`.
 * @returns The parsed config, or an empty config when the file does not exist.
 * @throws {Error} When the file exists but contains invalid JSON or an invalid shape.
 */
export function readClaudeDesktopConfig(configPath: string): ClaudeDesktopConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!isClaudeDesktopConfig(parsed)) {
      throw new Error('Expected a top-level object with an optional mcpServers map')
    }
    return parsed
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return {}
    }
    throw new Error(
      `Failed to read Claude Desktop config at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

/**
 * Return the mutable MCP server record, creating it when missing.
 *
 * @param config Parsed Claude Desktop config object.
 * @returns The mutable `mcpServers` record.
 * @throws {Error} When the existing `mcpServers` field has an invalid shape.
 */
export function ensureClaudeServers(
  config: ClaudeDesktopConfig,
): Record<string, ClaudeDesktopServerConfig> {
  if (config.mcpServers === undefined) {
    config.mcpServers = {}
    return config.mcpServers
  }
  if (!isPlainRecord(config.mcpServers)) {
    throw new Error('Invalid Claude Desktop config: "mcpServers" must be an object')
  }
  if (!isClaudeDesktopServerMap(config.mcpServers)) {
    throw new Error('Invalid Claude Desktop config: "mcpServers" entries must be objects')
  }
  return config.mcpServers
}

/**
 * Build the Claude Desktop server entry for either stdio or streamable HTTP.
 *
 * @param opts Install options from the CLI.
 * @returns A Claude Desktop server config entry for the chosen transport.
 */
export function buildClaudeServerConfig(
  opts: ClaudeDesktopInstallOptions,
): ClaudeDesktopServerConfig {
  if (opts.stdio ?? false) {
    const args = ['graft', 'serve', '--stdio']
    if (opts.entry) args.push('--entry', opts.entry)
    return {
      command: 'npx',
      args,
      cwd: process.cwd(),
    }
  }

  const port = opts.port ?? String(resolveDefaultServePort({ entry: opts.entry }))
  return { url: `http://localhost:${port}/mcp` }
}
