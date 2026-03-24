/**
 * HTTP layer public surface.
 * Internal implementation lives under ./http/ to keep routing, parsing,
 * and response concerns separate without changing public imports.
 */

export { extractHeaders } from './headers.js'
export { coerceScalar, deserializeQuery, parseJsonBody } from './http/query.js'
export { toHttpResponse, errorResponse } from './http/responses.js'
export { Router, type RouterOptions } from './http/router.js'
export { mountRoutes, preloadDiscoveryFiles, type MountRoutesInput } from './http/mount-routes.js'
