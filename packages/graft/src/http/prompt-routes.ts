import type { PromptHandler } from '../types.js'
import { GraftError } from '../errors.js'
import { toRouteKey, type RouteKey } from './route-key.js'
import { errorResponse } from './responses.js'
import { parseJsonBody } from './query.js'
import type { PromptRoutePlan } from './route-plan.js'
import type { Router } from './router.js'

/**
 * Mount HTTP prompt routes.
 */
export function mountPromptRoutes(
  router: Router,
  promptRoutes: readonly PromptRoutePlan[],
  promptHandler: PromptHandler | undefined,
  reserved: Set<RouteKey>,
): void {
  if (!promptHandler) return

  for (const prompt of promptRoutes) {
    const routeKey = toRouteKey('POST', prompt.path)
    if (reserved.has(routeKey)) {
      throw new GraftError(prompt.conflictMessage, 500)
    }

    router.add('POST', prompt.path, async (request: Request) => {
      const requestId = crypto.randomUUID()
      try {
        const body = await parseJsonBody(request)
        const messages = await promptHandler(prompt.name, body, {
          signal: request.signal,
        })
        return Response.json({ messages }, { headers: { 'x-request-id': requestId } })
      } catch (error) {
        return errorResponse(error, requestId)
      }
    })
  }
}
