import { GraftError } from '../errors.js'
import { parseHttpMethod } from '../http-method.js'
import type { HttpMethod, HttpMethodInput } from '../http-method.js'
import type { Logger } from '../types.js'
import { toRouteKey } from './route-key.js'

type RouteHandler = (
  request: Request,
  pathParams: Record<string, string>,
) => Response | Promise<Response>

interface RouteMatch {
  handler: RouteHandler
  pathParams: Record<string, string>
}

/**
 * CORS and logging options for the in-process HTTP router.
 */
export interface RouterOptions {
  cors?: false | { origin?: string | string[] }
  logger?: Pick<Logger, 'warn' | 'error'>
}

/**
 * Minimal in-memory HTTP router used by the built app fetch handler.
 */
export class Router {
  private routes = new Map<string, RouteHandler>()
  private paramRoutes: Array<{
    method: HttpMethod
    pattern: RegExp
    paramNames: string[]
    handler: RouteHandler
  }> = []
  private corsOrigin: string | string[] | null
  private registeredMethods = new Set<HttpMethod>()
  private logger: Pick<Logger, 'warn' | 'error'>

  constructor(options?: RouterOptions) {
    this.corsOrigin = options?.cors === false ? null : (options?.cors?.origin ?? null)
    this.logger = options?.logger ?? console
  }

  private normalizePathname(pathname: string): string {
    return pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  }

  private matchParameterizedRoute(pathname: string, method: string): RouteMatch | undefined {
    for (const parameterizedRoute of this.paramRoutes) {
      if (parameterizedRoute.method !== method) continue
      const match = pathname.match(parameterizedRoute.pattern)
      if (!match) continue

      return {
        handler: parameterizedRoute.handler,
        pathParams: this.decodePathParams(parameterizedRoute.paramNames, match),
      }
    }
    return undefined
  }

  private decodePathParams(paramNames: string[], match: RegExpMatchArray): Record<string, string> {
    try {
      const params: Record<string, string> = {}
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]] = decodeURIComponent(match[i + 1])
      }
      return params
    } catch (error) {
      throw new GraftError('Invalid URL path encoding', 400, 'INVALID_PATH_ENCODING', {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  private async runRoute(match: RouteMatch | undefined, request: Request): Promise<Response> {
    if (!match) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    try {
      return await match.handler(request, match.pathParams)
    } catch (error) {
      if (error instanceof GraftError) {
        return Response.json({ error: error.message }, { status: error.statusCode })
      }
      this.logger.error('[graft] Unhandled route error:', error)
      return Response.json(
        { error: 'Internal server error' },
        { status: 500 },
      )
    }
  }

  add(method: HttpMethodInput, path: string, handler: RouteHandler): void {
    const normalizedMethod = parseHttpMethod(method, `Route "${path}" method`)
    if (path.includes(':')) {
      const paramNames: string[] = []
      const pattern = path.replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name)
        return '([^/]+)'
      })
      const regexSource = `^${pattern}$`

      if (this.paramRoutes.some((route) => route.method === normalizedMethod && route.pattern.source === regexSource)) {
        throw new GraftError(
          `Route collision: ${normalizedMethod} ${path} conflicts with an existing parameterized route.`,
          500,
        )
      }

      this.paramRoutes.push({
        method: normalizedMethod,
        pattern: new RegExp(regexSource),
        paramNames,
        handler,
      })
    } else {
      const routeKey = toRouteKey(normalizedMethod, path)
      if (this.routes.has(routeKey)) {
        throw new GraftError(
          `Route collision: ${routeKey} is already registered. Each HTTP route must be unique.`,
          500,
        )
      }

      this.routes.set(routeKey, handler)
    }

    this.registeredMethods.add(normalizedMethod)
  }

  async fetch(request: Request): Promise<Response> {
    const requestOrigin = request.headers.get('origin')
    const corsHeaders = this.buildCorsHeaders(requestOrigin)

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      const url = new URL(request.url)
      const pathname = this.normalizePathname(url.pathname)
      const routeKey = toRouteKey(request.method, pathname)
      const route = this.routes.get(routeKey)
      const match = route
        ? { handler: route, pathParams: {} }
        : this.matchParameterizedRoute(pathname, request.method.toUpperCase())
      const response = await this.runRoute(match, request)

      return this.mergeCorsHeaders(response, corsHeaders)
    } catch (error) {
      if (error instanceof GraftError) {
        return this.mergeCorsHeaders(
          Response.json({ error: error.message }, { status: error.statusCode }),
          corsHeaders,
        )
      }

      throw error
    }
  }

  private buildCorsHeaders(requestOrigin?: string | null): Record<string, string> {
    if (this.corsOrigin === null) return {}

    let origin: string
    if (Array.isArray(this.corsOrigin)) {
      if (requestOrigin && this.corsOrigin.includes(requestOrigin)) {
        origin = requestOrigin
      } else {
        return {}
      }
    } else {
      origin = this.corsOrigin
    }

    const methods = ['OPTIONS', ...this.registeredMethods].join(', ')

    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  }

  private mergeCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
    if (Object.keys(corsHeaders).length === 0) return response

    const mergedHeaders = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders)) {
      if (!mergedHeaders.has(key)) {
        mergedHeaders.set(key, value)
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders,
    })
  }
}
