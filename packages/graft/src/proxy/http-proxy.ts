import type { McpProxyFunction } from '../types.js'
import { createProxyFunction } from './utils.js'

/** Options for building an HTTP-backed proxy transport. */
export interface HttpProxyOptions {
  /** Target API base URL (e.g. "http://localhost:3000") */
  target: string
  /** Default headers to include on every proxied request (e.g. API keys) — overridable by callers */
  headers?: Record<string, string>
  /** Locked headers — always applied last, cannot be overridden (e.g., operator API key when caller must NOT control auth) */
  lockedHeaders?: Record<string, string>
  /** Set of allowed "METHOD /path" strings. If provided, only these routes can be proxied. */
  allowedRoutes?: Set<string>
  /** Override fetch implementation for tests or custom runtimes. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Create a proxy function that routes MCP tool calls to a remote HTTP API via fetch().
 */
export function createHttpProxy(options: HttpProxyOptions): McpProxyFunction {
  // Pre-parse target so we can preserve its pathname (e.g. /parse, /api/v1)
  const base = new URL(options.target)
  const basePath = base.pathname.replace(/\/+$/, '')  // strip trailing slashes
  const fetchImpl = options.fetchImpl ?? fetch

  return createProxyFunction({
    buildUrl: (path) => new URL(`${basePath}${path}`, base),
    dispatch: (req) => fetchImpl(req),
    defaultHeaders: options.headers,
    lockedHeaders: options.lockedHeaders,
    allowedRoutes: options.allowedRoutes,
  })
}
