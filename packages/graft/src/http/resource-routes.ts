import { GraftError } from '../errors.js'
import type { ToolPipeline } from '../pipeline/types.js'
import { toRouteKey, type RouteKey } from './route-key.js'
import { toHttpResponse } from './responses.js'
import type { ResourceRoutePlan, ResourceTemplateRoutePlan } from './route-plan.js'
import type { Router } from './router.js'

function readTemplateParams(
  request: Request,
  pathParams: Record<string, string>,
): Record<string, unknown> {
  const url = new URL(request.url)
  const rawParams: Record<string, unknown> = {}

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    rawParams[key] = values.length > 1 ? values : values[0]
  }

  Object.assign(rawParams, pathParams)
  return rawParams
}

/**
 * Mount static resource routes.
 */
export function mountResourceRoutes(
  router: Router,
  resourceRoutes: readonly ResourceRoutePlan[],
  pipeline: ToolPipeline,
  reserved: Set<RouteKey>,
): void {
  for (const resource of resourceRoutes) {
    const routeKey = toRouteKey('GET', resource.path)
    if (reserved.has(routeKey)) {
      throw new GraftError(resource.conflictMessage, 500)
    }

    router.add('GET', resource.path, async (request: Request) => {
      const result = await pipeline.dispatchResourceFromRequest(resource.name, {}, request)
      return toHttpResponse(result)
    })
  }
}

/**
 * Mount resource-template routes.
 */
export function mountResourceTemplateRoutes(
  router: Router,
  resourceTemplateRoutes: readonly ResourceTemplateRoutePlan[],
  pipeline: ToolPipeline,
  reserved: Set<RouteKey>,
): void {
  for (const resource of resourceTemplateRoutes) {
    const routeKey = toRouteKey('GET', resource.path)
    if (reserved.has(routeKey)) {
      throw new GraftError(resource.conflictMessage, 500)
    }

    router.add('GET', resource.path, async (request: Request, pathParams) => {
      const result = await pipeline.dispatchResourceFromRequest(
        resource.name,
        readTemplateParams(request, pathParams),
        request,
      )
      return toHttpResponse(result)
    })
  }
}
