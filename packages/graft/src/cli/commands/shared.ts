import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ServerHandle } from '../../server/types.js'
import type { McpAdapter } from '../../mcp/shared.js'
import { buildProxyApp } from '../proxy-app.js'
import { loadApp, type LoadResult } from '../entry-loader.js'

/**
 * CLI inputs accepted by the `graft studio` command family.
 */
export interface StudioOptions {
  url?: string
  entry?: string
  openapi?: string
  config?: string
  target?: string
  header?: string[]
  lockedHeader?: string[]
  openapiTimeoutMs?: number
}

/**
 * Parse a positive integer CLI option expressed in milliseconds.
 *
 * @param value Raw CLI option value.
 * @returns The parsed timeout in milliseconds.
 * @throws {Error} When the value is not a positive integer.
 */
export function parseTimeoutMsOption(value: string): number {
  const timeoutMs = Number.parseInt(value, 10)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeout "${value}". Use a positive integer in milliseconds.`)
  }
  return timeoutMs
}

/**
 * Decide whether studio should synthesize a proxy app instead of loading an entry module.
 *
 * @param options CLI options for the studio command.
 * @returns `true` when proxy inputs are present or `graft.proxy.yaml` exists.
 */
export function shouldLoadProxyApp(options: StudioOptions): boolean {
  return Boolean(
    options.openapi ||
    options.config ||
    (!options.url && existsSync(resolve(process.cwd(), 'graft.proxy.yaml'))),
  )
}

/**
 * Resolve the runtime that studio should serve.
 *
 * @param options CLI options for the studio command.
 * @returns The loaded app/proxy runtime, or `undefined` when studio should connect to a URL directly.
 * @throws {Error} When the requested entry or proxy configuration is invalid.
 */
export async function resolveStudioRuntime(options: StudioOptions): Promise<LoadResult | undefined> {
  if (options.entry) return loadApp(options.entry)
  if (shouldLoadProxyApp(options)) return buildProxyApp(options)
  return undefined
}

/**
 * Internal helper server plus its bound MCP URL.
 */
export interface StartedStudioServer {
  url: string
  handle: ServerHandle
}

/**
 * Create the fetch handler used by the internal helper server.
 *
 * @param mcp MCP adapter backing the studio session.
 * @param getBaseUrl Callback returning the current helper-server base URL.
 * @param fetchHandler Optional app fetch handler. When omitted, the helper serves only MCP + agent.json.
 * @returns A fetch handler suitable for `startServer()`.
 */
export function createMcpBridgeFetch(
  mcp: McpAdapter,
  getBaseUrl: () => string,
  fetchHandler?: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  if (fetchHandler) return fetchHandler

  return async (request: Request) => {
    const url = new URL(request.url)
    if (url.pathname === '/mcp' && request.method === 'POST') return mcp.handleMcp(request)
    if (url.pathname === '/.well-known/agent.json' && request.method === 'GET') {
      return mcp.handleAgentJson(getBaseUrl())
    }
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

/**
 * Start a local helper server for the inspector and return its MCP endpoint URL plus handle.
 *
 * @param result Loaded runtime from an app entry or proxy config.
 * @returns The local Streamable HTTP MCP URL plus the running helper server handle.
 * @throws {Error} When the helper server fails to start.
 */
export async function startInternalStudioServer(result: LoadResult): Promise<StartedStudioServer> {
  const { startServer } = await import('../../server/lifecycle.js')

  let baseUrl = 'http://127.0.0.1:0'
  const fetch = createMcpBridgeFetch(result.mcp, () => baseUrl, result.fetch)
  const handle = await startServer({
    mcp: result.mcp,
    host: '127.0.0.1',
    port: 0,
    fetch,
    installSignalHandlers: false,
  })

  const address = handle.server.address()
  if (!address || typeof address === 'string') {
    await handle.close()
    throw new Error('Failed to determine studio helper server address')
  }

  baseUrl = `http://127.0.0.1:${address.port}`
  return { url: `${baseUrl}/mcp`, handle }
}

/**
 * Translate CLI header flags into MCP Inspector arguments.
 *
 * @param mcpUrl MCP endpoint URL that inspector should connect to.
 * @param headerPairs Repeated `key=value` header arguments from the CLI.
 * @returns Spawn arguments for `npx @modelcontextprotocol/inspector`.
 */
export function buildInspectorArgs(mcpUrl: string, headerPairs: string[]): string[] {
  const inspectorArgs = [
    '@modelcontextprotocol/inspector',
    '--url', mcpUrl,
    '--transport', 'streamable-http',
  ]

  for (const pair of headerPairs) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex <= 0) continue
    inspectorArgs.push('--header', `${pair.slice(0, separatorIndex)}: ${pair.slice(separatorIndex + 1)}`)
  }

  return inspectorArgs
}

/**
 * Launch the MCP Inspector child process and mirror its exit code.
 *
 * @param inspectorArgs Arguments previously built by `buildInspectorArgs()`.
 * @returns Resolves to the inspector exit code, or rejects on spawn failure.
 */
export async function launchInspector(inspectorArgs: string[]): Promise<number> {
  const { spawn } = await import('node:child_process')
  return await new Promise((resolve, reject) => {
    const child = spawn('npx', inspectorArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', (error) => {
      reject(new Error(
        `[graft] Failed to launch MCP Inspector: ${error.message}\n  Install it with: npm install -g @modelcontextprotocol/inspector`,
        { cause: error },
      ))
    })

    child.on('close', (code) => {
      resolve(code ?? 0)
    })
  })
}
