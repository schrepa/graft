import type { HttpMethod } from '../http-method.js'
import { usesQueryParametersForMethod } from '../http-method.js'
import { getParameterLocationWireName } from '../parameter-location.js'
import type { ParameterLocation, ParameterLocationEntry } from '../types.js'

/**
 * Structured HTTP request pieces derived from flat tool arguments.
 */
export interface ProxyRequestParts {
  /** Path with `:params` filled in */
  resolvedPath: string
  /** Args routed to the query string */
  queryArgs: Record<string, unknown>
  /** Args routed to the request body */
  bodyArgs: Record<string, unknown>
  /** Args routed to headers */
  headerArgs: Record<string, string>
}

function extractPathParams(
  path: string,
  args: Record<string, unknown>,
): { resolvedPath: string; remainingArgs: Record<string, unknown> } {
  const remainingArgs = { ...args }
  let resolvedPath = path

  for (const segment of path.split('/')) {
    if (!segment.startsWith(':')) continue
    const paramName = segment.slice(1)
    if (!(paramName in remainingArgs)) continue

    resolvedPath = resolvedPath.replace(
      segment,
      encodeURIComponent(String(remainingArgs[paramName])),
    )
    delete remainingArgs[paramName]
  }

  return { resolvedPath, remainingArgs }
}

function routeExplicitArgs(
  args: Record<string, unknown>,
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>,
): {
  remainingArgs: Record<string, unknown>
  headerArgs: Record<string, string>
  explicitQueryArgs: Record<string, unknown>
  explicitBodyArgs: Record<string, unknown>
} {
  const remainingArgs = { ...args }
  const headerArgs: Record<string, string> = {}
  const explicitQueryArgs: Record<string, unknown> = {}
  const explicitBodyArgs: Record<string, unknown> = {}

  if (!parameterLocations) {
    return { remainingArgs, headerArgs, explicitQueryArgs, explicitBodyArgs }
  }

  for (const [argName, loc] of Object.entries(parameterLocations)) {
    if (!(argName in remainingArgs)) continue

    if ((typeof loc === 'string' ? loc : loc.in) === 'header') {
      headerArgs[getParameterLocationWireName(argName, loc)] = String(remainingArgs[argName])
      delete remainingArgs[argName]
      continue
    }

    if ((typeof loc === 'string' ? loc : loc.in) === 'query') {
      explicitQueryArgs[getParameterLocationWireName(argName, loc)] = remainingArgs[argName]
      delete remainingArgs[argName]
      continue
    }

    if ((typeof loc === 'string' ? loc : loc.in) === 'body') {
      explicitBodyArgs[argName] = remainingArgs[argName]
      delete remainingArgs[argName]
    }
  }

  return { remainingArgs, headerArgs, explicitQueryArgs, explicitBodyArgs }
}

function finalizeProxyRequest(
  method: HttpMethod,
  resolvedPath: string,
  remaining: Record<string, unknown>,
  routed: {
    headerArgs: Record<string, string>
    explicitQueryArgs: Record<string, unknown>
    explicitBodyArgs: Record<string, unknown>
  },
): ProxyRequestParts {
  if (usesQueryParametersForMethod(method)) {
    return {
      resolvedPath,
      queryArgs: { ...remaining, ...routed.explicitQueryArgs },
      bodyArgs: routed.explicitBodyArgs,
      headerArgs: routed.headerArgs,
    }
  }

  return {
    resolvedPath,
    queryArgs: routed.explicitQueryArgs,
    bodyArgs: { ...remaining, ...routed.explicitBodyArgs },
    headerArgs: routed.headerArgs,
  }
}

/**
 * Route flat tool arguments into structured HTTP request parts.
 *
 * @param method Target HTTP method.
 * @param path Target path template.
 * @param args Flat tool arguments.
 * @param parameterLocations Optional explicit routing hints per argument.
 * @returns Structured request parts ready for proxy dispatch.
 */
export function buildProxyRequest(
  method: HttpMethod,
  path: string,
  args: Record<string, unknown>,
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>,
): ProxyRequestParts {
  const { resolvedPath, remainingArgs: argsWithoutPathParams } = extractPathParams(path, args)
  const routed = routeExplicitArgs(argsWithoutPathParams, parameterLocations)
  return finalizeProxyRequest(method, resolvedPath, routed.remainingArgs, routed)
}
