import { readFile } from 'node:fs/promises'
import type { DiscoveryOptions } from '../discovery.js'
import { GraftError } from '../errors.js'
import { isPlainRecord } from '../object-schema.js'

/**
 * Per-app cache for file-backed discovery endpoints.
 */
export interface DiscoveryCache {
  text: Map<string, Promise<string>>
  json: Map<string, Promise<Record<string, unknown>>>
}

/**
 * Create an isolated discovery cache for one app instance.
 */
export function createDiscoveryCache(): DiscoveryCache {
  return {
    text: new Map<string, Promise<string>>(),
    json: new Map<string, Promise<Record<string, unknown>>>(),
  }
}

function getDiscoveryCacheKey(path: string, endpointPath: string): string {
  return `${endpointPath}:${path}`
}

function cacheAsync<T>(
  cache: Map<string, Promise<T>>,
  cacheKey: string,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const pending = load().catch((error) => {
    cache.delete(cacheKey)
    throw error
  })
  cache.set(cacheKey, pending)
  return pending
}

async function loadTextDiscoveryFile(path: string, endpointPath: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8')
  } catch (error) {
    throw new GraftError(
      `Failed to read discovery content for ${endpointPath}: ${error instanceof Error ? error.message : String(error)}`,
      500,
    )
  }
}

async function loadJsonDiscoveryFile(path: string, endpointPath: string): Promise<Record<string, unknown>> {
  const content = await loadTextDiscoveryFile(path, endpointPath)
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isPlainRecord(parsed)) {
      throw new Error('expected a JSON object')
    }
    return parsed
  } catch (error) {
    throw new GraftError(
      `Failed to parse discovery JSON for ${endpointPath}: ${error instanceof Error ? error.message : String(error)}`,
      500,
    )
  }
}

/**
 * Read a text discovery file through the per-app cache.
 */
export function readCachedTextDiscoveryFile(
  cache: DiscoveryCache,
  path: string,
  endpointPath: string,
): Promise<string> {
  const cacheKey = getDiscoveryCacheKey(path, endpointPath)
  return cacheAsync(cache.text, cacheKey, () => loadTextDiscoveryFile(path, endpointPath))
}

/**
 * Read a JSON discovery file through the per-app cache.
 */
export function readCachedJsonDiscoveryFile(
  cache: DiscoveryCache,
  path: string,
  endpointPath: string,
): Promise<Record<string, unknown>> {
  const cacheKey = getDiscoveryCacheKey(path, endpointPath)
  return cacheAsync(cache.json, cacheKey, () => loadJsonDiscoveryFile(path, endpointPath))
}

/**
 * Preload file-backed discovery endpoints so startup fails early on invalid files.
 */
export async function preloadDiscoveryFiles(
  discovery?: DiscoveryOptions,
  cache: DiscoveryCache = createDiscoveryCache(),
): Promise<void> {
  if (!discovery) return

  const loads: Promise<unknown>[] = []
  if (typeof discovery.llmsTxt === 'string') {
    loads.push(readCachedTextDiscoveryFile(cache, discovery.llmsTxt, '/llms.txt'))
  }
  if (typeof discovery.llmsFullTxt === 'string') {
    loads.push(readCachedTextDiscoveryFile(cache, discovery.llmsFullTxt, '/llms-full.txt'))
  }
  if (typeof discovery.docs === 'string') {
    loads.push(readCachedTextDiscoveryFile(cache, discovery.docs, '/docs'))
  }
  if (typeof discovery.agentJson === 'string') {
    loads.push(readCachedJsonDiscoveryFile(cache, discovery.agentJson, '/.well-known/agent.json'))
  }
  if (typeof discovery.mcpCard === 'string') {
    loads.push(readCachedJsonDiscoveryFile(cache, discovery.mcpCard, '/.well-known/mcp.json'))
  }
  if (typeof discovery.openapi === 'string') {
    loads.push(readCachedJsonDiscoveryFile(cache, discovery.openapi, '/openapi.json'))
  }

  await Promise.all(loads)
}
