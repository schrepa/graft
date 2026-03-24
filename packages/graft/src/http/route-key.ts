import type { HttpMethod } from '../http-method.js'

/**
 * Canonical route-key format used by internal HTTP routing helpers.
 */
export type RouteKey = `${HttpMethod} ${string}`

/** Join a method and path into the canonical route-key format. */
export function toRouteKey(method: HttpMethod, path: string): RouteKey
export function toRouteKey(method: string, path: string): string
export function toRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}
