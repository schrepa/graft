/**
 * Shared header utilities — used by pipeline, mcp, and http layers.
 */

/** Headers to strip when forwarding from HTTP/MCP requests */
export const SKIP_HEADERS = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'accept'])

/** Flatten header values (string | string[] | undefined) → string, keys lowercased */
export function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
  }
  return flat
}

/** Extract relevant headers from HTTP request, skipping hop-by-hop headers */
export function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((v, k) => {
    if (!SKIP_HEADERS.has(k)) {
      headers[k] = v
    }
  })
  return headers
}

/** Build a Request from forwarded headers (used by MCP path to resolve auth) */
export function buildSyntheticRequest(headers: Record<string, string | string[] | undefined>): Request {
  const h = new Headers()
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) h.set(k, String(v))
  }
  return new Request('http://localhost', { headers: h })
}
