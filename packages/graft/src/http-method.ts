/**
 * Supported HTTP methods for generated and explicit Graft routes.
 */
export const HTTP_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const

/**
 * Canonical uppercase HTTP method accepted by Graft internals.
 */
export type HttpMethod = typeof HTTP_METHODS[number]

/**
 * Public-facing method input accepted by user config.
 */
export type HttpMethodInput = HttpMethod | Lowercase<HttpMethod>

const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS)

function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHOD_SET.has(value)
}

/**
 * Normalize a user-provided HTTP method to the canonical uppercase union.
 *
 * @param value User-provided HTTP method.
 * @param label Error context when the value is invalid.
 * @returns Canonical uppercase HTTP method.
 * @throws {Error} When the value is not one of Graft's supported methods.
 */
export function parseHttpMethod(value: string, label = 'HTTP method'): HttpMethod {
  const normalized = value.toUpperCase()
  if (isHttpMethod(normalized)) return normalized
  throw new Error(`${label}: unsupported value "${value}"`)
}

/**
 * Whether a method is treated as read-only by Graft.
 */
export function hasSideEffects(method: HttpMethod): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

/**
 * Whether request arguments for this method should come from the query string.
 */
export function usesQueryParametersForMethod(method: HttpMethod): boolean {
  return method === 'GET' || method === 'HEAD'
}

/**
 * Whether the method is idempotent for MCP annotation hints.
 */
export function isIdempotentHttpMethod(method: HttpMethod): boolean {
  return (
    method === 'GET' ||
    method === 'HEAD' ||
    method === 'PUT' ||
    method === 'DELETE' ||
    method === 'OPTIONS'
  )
}
