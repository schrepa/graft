import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Logger, McpProxyFunction, ToolDefinition } from '../types.js'
import { toRouteKey } from '../http/route-key.js'
import type { BuildResult } from '../app/types.js'
import { toPlainRecord } from '../object-schema.js'
import { readOpenApiInput } from '../openapi-input.js'
import type { ExampleTestableApp } from './entry-loader.js'

/**
 * CLI options for building a proxy app from OpenAPI or config input.
 */
export interface ProxyAppOpts {
  openapi?: string
  config?: string
  target?: string
  header?: string[]
  lockedHeader?: string[]
  openapiTimeoutMs?: number
}

interface ResolvedProxySource {
  tools: ToolDefinition[]
  target: string
  serverName: string
  defaultHeaders: Record<string, string>
}

function hasHttpRoute(
  tool: ToolDefinition,
): tool is ToolDefinition & { method: NonNullable<ToolDefinition['method']>; path: string } {
  return tool.method !== undefined && tool.path !== undefined
}

/**
 * Collect repeatable options into an array.
 */
export function collect(value: string, prev: string[]): string[] {
  return [...prev, value]
}

function parseHeaderPairs(pairs: string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      throw new Error(`Invalid header "${pair}". Use NAME=value.`)
    }
    headers[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return headers
}

async function readOpenApiSpec(openapi: string, timeoutMs?: number): Promise<string> {
  return readOpenApiInput(openapi, { timeoutMs })
}

async function inferTargetFromSpec(specInput: string): Promise<string | undefined> {
  const parsed = specInput.trim().startsWith('{')
    ? JSON.parse(specInput)
    : (await import('yaml')).parse(specInput)
  const spec = toPlainRecord(parsed)
  const firstServer = Array.isArray(spec?.servers) ? spec.servers[0] : undefined
  const serverRecord = toPlainRecord(firstServer)

  return typeof serverRecord?.url === 'string' ? serverRecord.url : undefined
}

async function loadOpenApiTools(
  opts: ProxyAppOpts,
  logger: Pick<Logger, 'info'> = console,
): Promise<{
  tools: ToolDefinition[]
  target: string
  serverName: string
}> {
  const { parseOpenApiSpec } = await import('../proxy/openapi.js')
  const openapi = opts.openapi
  if (!openapi) {
    throw new Error('Missing OpenAPI input. Use --openapi to specify a spec path or URL.')
  }

  const specInput = await readOpenApiSpec(openapi, opts.openapiTimeoutMs)
  const tools = parseOpenApiSpec(specInput)
  const target = opts.target ?? await inferTargetFromSpec(specInput)

  if (!target) {
    throw new Error('No --target specified and no servers found in OpenAPI spec.')
  }

  if (!opts.target) {
    logger.info(`[graft] Using server URL from spec: ${target}`)
  }

  return { tools, target, serverName: 'graft' }
}

async function loadConfigTools(opts: ProxyAppOpts): Promise<{
  tools: ToolDefinition[]
  target: string | undefined
  serverName: string
  extraHeaders: Record<string, string>
}> {
  const { loadProxyConfig, configToToolDefinitions } = await import('../proxy/config.js')

  const configPath = opts.config
    ? resolve(process.cwd(), opts.config)
    : resolve(process.cwd(), 'graft.proxy.yaml')

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n` +
      'Use --entry, --openapi, or --config to specify a source, or create graft.proxy.yaml',
    )
  }

  const config = await loadProxyConfig(configPath, { env: process.env })
  const tools = configToToolDefinitions(config)
  const target = opts.target ?? config.target
  const serverName = config.name ?? 'graft'
  const extraHeaders = config.headers ?? {}

  return { tools, target, serverName, extraHeaders }
}

async function resolveProxySource(
  opts: ProxyAppOpts,
  logger: Pick<Logger, 'info'> = console,
): Promise<ResolvedProxySource> {
  const cliHeaders = parseHeaderPairs(opts.header ?? [])

  if (opts.openapi) {
    const loaded = await loadOpenApiTools(opts, logger)
    return {
      tools: loaded.tools,
      target: loaded.target,
      serverName: loaded.serverName,
      defaultHeaders: cliHeaders,
    }
  }

  const loaded = await loadConfigTools(opts)
  if (!loaded.target) {
    throw new Error('No target URL resolved. Use --target to specify the target API URL.')
  }

  return {
    tools: loaded.tools,
    target: loaded.target,
    serverName: loaded.serverName,
    defaultHeaders: { ...loaded.extraHeaders, ...cliHeaders },
  }
}

function buildAllowedRoutes(tools: readonly ToolDefinition[]): Set<string> {
  return new Set(
    tools
      .filter(hasHttpRoute)
      .map((tool) => toRouteKey(tool.method, tool.path)),
  )
}

async function createProxyApp(
  serverName: string,
  tools: readonly ToolDefinition[],
  proxy: McpProxyFunction,
): Promise<ExampleTestableApp> {
  const { createApp } = await import('../app/builder.js')
  const { createProxyHandler } = await import('../proxy/utils.js')
  const app = createApp({ name: serverName })

  for (const tool of tools) {
    app.tool(tool.name, {
      description: tool.description,
      handler: createProxyHandler(proxy, tool),
      inputSchema: tool.inputSchema,
      auth: tool.auth,
      tags: tool.tags,
      sideEffects: tool.sideEffects,
      parameterLocations: tool.parameterLocations,
      http: { method: tool.method, path: tool.path },
      expose: 'mcp',
    })
  }

  return app
}

/**
 * Build a proxy app from OpenAPI or `graft.proxy.yaml` configuration.
 *
 * @param opts CLI-derived proxy configuration.
 * @returns The built app plus its MCP adapter and fetch handler.
 * @throws {Error} When no target URL or input source can be resolved.
 * @example
 * const built = await buildProxyApp({ config: 'graft.proxy.yaml', header: [], lockedHeader: [] })
 * const response = await built.fetch(new Request('http://localhost/health'))
 */
export async function buildProxyApp(
  opts: ProxyAppOpts,
): Promise<BuildResult & { app: ExampleTestableApp }> {
  const { createHttpProxy } = await import('../proxy/http-proxy.js')
  const source = await resolveProxySource(opts)
  const lockedHeaders = parseHeaderPairs(opts.lockedHeader ?? [])

  const httpProxy = createHttpProxy({
    target: source.target,
    headers: source.defaultHeaders,
    lockedHeaders: Object.keys(lockedHeaders).length > 0 ? lockedHeaders : undefined,
    allowedRoutes: buildAllowedRoutes(source.tools),
  })

  const app = await createProxyApp(source.serverName, source.tools, httpProxy)
  return { ...app.build(), app }
}
