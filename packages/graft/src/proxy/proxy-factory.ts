import type { HttpMethod } from '../http-method.js'
import { ToolError } from '../errors.js'
import { toRouteKey } from '../http/route-key.js'
import { isJsonMediaType, normalizeMediaType } from '../media-type.js'
import { isPlainRecord } from '../object-schema.js'
import { richResult } from '../pipeline/rich-result.js'
import type {
  McpProxyFunction,
  ParameterLocation,
  ParameterLocationEntry,
  ToolContext,
} from '../types.js'
import { buildProxyRequest } from './request-parts.js'
import { parseProxyResponse } from './response-parser.js'

/**
 * Strategy inputs for constructing a proxy function.
 */
export interface ProxyFactoryOptions {
  buildUrl: (resolvedPath: string) => URL
  dispatch: (request: Request) => Promise<Response>
  /** Fallback headers — overridable by caller and parameter-location args */
  defaultHeaders?: Record<string, string>
  /** Locked headers — always applied last, cannot be overridden */
  lockedHeaders?: Record<string, string>
  allowedRoutes?: Set<string>
}

const PROXY_ERROR_KEYS = ['message', 'error', 'title'] as const

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function readProxyErrorField(body: unknown): string | undefined {
  if (!isPlainRecord(body)) return undefined

  for (const key of PROXY_ERROR_KEYS) {
    const value = nonEmptyString(body[key])
    if (value) return value
  }
}

function resolveProxyErrorMessage(status: number, body: unknown): string {
  return nonEmptyString(body) ?? readProxyErrorField(body) ?? `Proxy error: ${status}`
}

function assignHeaderValue(
  merged: Record<string, string>,
  key: string,
  value: string | string[] | undefined,
): void {
  if (value === undefined) return
  merged[key.toLowerCase()] = String(value)
}

function mergeProxyHeaders(
  defaultHeaders: Record<string, string> | undefined,
  callerHeaders: Record<string, string | string[] | undefined> | undefined,
  headerArgs: Record<string, string>,
  lockedHeaders: Record<string, string> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {}

  if (defaultHeaders) {
    for (const [key, value] of Object.entries(defaultHeaders)) {
      merged[key.toLowerCase()] = value
    }
  }

  if (callerHeaders) {
    for (const [key, value] of Object.entries(callerHeaders)) {
      assignHeaderValue(merged, key, value)
    }
  }

  for (const [key, value] of Object.entries(headerArgs)) {
    merged[key.toLowerCase()] = value
  }

  if (lockedHeaders) {
    for (const [key, value] of Object.entries(lockedHeaders)) {
      merged[key.toLowerCase()] = value
    }
  }

  return merged
}

function applyQueryParam(url: URL, key: string, value: unknown): void {
  if (value == null) return

  if (!Array.isArray(value)) {
    url.searchParams.set(key, String(value))
    return
  }

  for (const item of value) {
    url.searchParams.append(key, String(item))
  }
}

function applyQueryParams(url: URL, queryArgs: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(queryArgs)) {
    applyQueryParam(url, key, value)
  }
}

/**
 * Create a handler function that wraps an `McpProxyFunction` for pipeline use.
 *
 * @param proxy Low-level proxy function.
 * @param tool Tool transport metadata.
 * @returns A pipeline-compatible handler.
 */
export function createProxyHandler(
  proxy: McpProxyFunction,
  tool: {
    method?: HttpMethod
    path?: string
    parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
  },
): (args: unknown, ctx: ToolContext) => Promise<unknown> {
  const method = tool.method ?? 'GET'
  const path = tool.path ?? '/'

  return async (args, ctx) => {
    const headers: Record<string, string | string[] | undefined> = ctx.meta.headers ?? {}
    const normalizedArgs = isPlainRecord(args) ? args : {}

    const result = await proxy(method, path, normalizedArgs, {
      headers,
      parameterLocations: tool.parameterLocations,
      toolContext: ctx,
    })

    if (result.status >= 400) {
      throw new ToolError(
        resolveProxyErrorMessage(result.status, result.body),
        result.status,
        { headers: result.headers },
      )
    }

    const contentType = normalizeMediaType(result.headers['content-type'])
    if (contentType && !isJsonMediaType(contentType)) {
      return richResult(result.body, contentType)
    }

    return result.body
  }
}

/**
 * Create a proxy function from strategy options.
 *
 * @param opts Strategy functions and header policy for the proxy.
 * @returns A proxy implementation compatible with the MCP adapter.
 */
export function createProxyFunction(opts: ProxyFactoryOptions): McpProxyFunction {
  return async (method, path, args, context) => {
    if (opts.allowedRoutes) {
      const routeKey = toRouteKey(method, path)
      if (!opts.allowedRoutes.has(routeKey)) {
        return {
          status: 403,
          headers: {},
          body: { error: 'FORBIDDEN', message: `Route ${routeKey} is not a registered tool` },
        }
      }
    }

    const { resolvedPath, queryArgs, bodyArgs, headerArgs } = buildProxyRequest(
      method,
      path,
      args,
      context?.parameterLocations,
    )
    const url = opts.buildUrl(resolvedPath)
    const requestHeaders = mergeProxyHeaders(
      opts.defaultHeaders,
      context?.headers,
      headerArgs,
      opts.lockedHeaders,
    )

    applyQueryParams(url, queryArgs)

    const init: RequestInit = {
      method,
      headers: requestHeaders,
      signal: context?.toolContext?.signal,
    }

    if (Object.keys(bodyArgs).length > 0) {
      init.body = JSON.stringify(bodyArgs)
      if (!requestHeaders['content-type']) {
        requestHeaders['content-type'] = 'application/json'
      }
    }

    const response = await opts.dispatch(new Request(url.toString(), init))
    return parseProxyResponse(response)
  }
}
