import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DispatchOutcome } from '../types.js'
import type { McpAdapter } from '../mcp/shared.js'
import type { BuildResult } from '../app/types.js'
import { isPlainRecord, toPlainRecord } from '../object-schema.js'

interface AppModule {
  default?: unknown
  mcp?: unknown
  engine?: unknown
}

function hasMethod(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'function'
}

/**
 * Minimal app surface required by CLI helpers that need to build and dispatch example calls.
 */
export interface ExampleTestableApp {
  build(): BuildResult
  dispatch(
    name: string,
    args?: Record<string, unknown>,
    opts?: { headers?: Record<string, string> },
  ): Promise<DispatchOutcome>
}

function isExampleTestableApp(value: unknown): value is ExampleTestableApp {
  return isPlainRecord(value) && hasMethod(value, 'build') && hasMethod(value, 'dispatch')
}

/**
 * Result of loading a user entry module or synthesized proxy app.
 */
export interface LoadResult {
  mcp: McpAdapter
  fetch?: (request: Request) => Promise<Response>
  app?: ExampleTestableApp
}

function resolveEntryPath(entryPath: string): string {
  const absolutePath = resolve(process.cwd(), entryPath)
  if (!existsSync(absolutePath)) {
    throw new Error(`Entry file not found: ${absolutePath}`)
  }
  return absolutePath
}

function needsTsxRegistration(entryPath: string): boolean {
  return entryPath.endsWith('.ts') || entryPath.endsWith('.tsx')
}

async function registerTsxIfNeeded(entryPath: string): Promise<void> {
  if (!needsTsxRegistration(entryPath)) return
  try {
    const tsx = await import('tsx/esm/api')
    tsx.register()
  } catch (error) {
    throw new Error(
      'Failed to register tsx for a TypeScript entry file.\n' +
      'Install it with: npm install -D tsx',
      { cause: error instanceof Error ? error : undefined },
    )
  }
}

async function importAppModule(absolutePath: string): Promise<AppModule> {
  const moduleValue = await import(absolutePath)
  const record = toPlainRecord(moduleValue)
  return {
    default: record?.default,
    mcp: record?.mcp,
    engine: record?.engine,
  }
}

function loadBuildableApp(mod: AppModule): LoadResult | undefined {
  const app = mod.default
  if (!isExampleTestableApp(app)) return undefined
  const { mcp, fetch } = app.build()
  return { mcp, fetch, app }
}

function isMcpAdapter(value: unknown): value is McpAdapter {
  return isPlainRecord(value)
    && hasMethod(value, 'handleMcp')
    && hasMethod(value, 'connectStdio')
    && hasMethod(value, 'getManifest')
}

/**
 * Duck-type check for an McpAdapter object.
 */
export function findMcpAdapter(value: unknown): McpAdapter | undefined {
  return isMcpAdapter(value) ? value : undefined
}

function loadAdapterExport(mod: AppModule): LoadResult | undefined {
  const defaultExport = toPlainRecord(mod.default)
  const mcp =
    findMcpAdapter(mod.mcp) ??
    findMcpAdapter(mod.engine) ??
    findMcpAdapter(defaultExport?.mcp) ??
    findMcpAdapter(defaultExport?.engine) ??
    findMcpAdapter(mod.default)

  return mcp ? { mcp } : undefined
}

function missingAppExportError(entryPath: string): Error {
  return new Error(
    `No app or MCP adapter found in ${entryPath}.\n` +
    'Export a greenfield app:\n\n' +
    '  const app = createApp({ name: "my-app" })\n' +
    '  export default app\n',
  )
}

/**
 * Load a greenfield app or integration MCP adapter from a user's entry file.
 *
 * @param entryPath Relative or absolute path to the user entry module.
 * @returns The discovered MCP adapter plus optional app/fetch exports.
 * @throws {Error} When the entry file is missing or exports no compatible app/adapter.
 * @example
 * const loaded = await loadApp('./src/app.ts')
 * await loaded.mcp.connectStdio()
 */
export async function loadApp(entryPath: string): Promise<LoadResult> {
  const absolutePath = resolveEntryPath(entryPath)
  await registerTsxIfNeeded(absolutePath)

  const mod = await importAppModule(absolutePath)
  const app = loadBuildableApp(mod)
  if (app) return app

  const adapter = loadAdapterExport(mod)
  if (adapter) return adapter

  throw missingAppExportError(entryPath)
}
