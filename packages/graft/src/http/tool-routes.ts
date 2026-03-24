import type { ToolPipeline } from '../pipeline/types.js'
import { GraftError } from '../errors.js'
import type { ToolRoutePlan } from './route-plan.js'
import { toRouteKey, type RouteKey } from './route-key.js'
import { dispatchHttpToolRequest } from './tool-dispatch.js'
import type { Router } from './router.js'

/**
 * Mount all HTTP-exposed tool routes.
 */
export function mountToolRoutes(
  router: Router,
  toolRoutes: readonly ToolRoutePlan[],
  pipeline: ToolPipeline,
  reserved: Set<RouteKey>,
): void {
  for (const tool of toolRoutes) {
    const routeKey = toRouteKey(tool.method, tool.path)
    if (reserved.has(routeKey)) {
      throw new GraftError(tool.conflictMessage, 500)
    }

    router.add(tool.method, tool.path, async (request: Request, pathParams) => {
      return dispatchHttpToolRequest({
        name: tool.name,
        httpMethod: tool.method,
        inputSchema: tool.inputSchema ?? null,
      }, pipeline, request, pathParams)
    })
  }
}
