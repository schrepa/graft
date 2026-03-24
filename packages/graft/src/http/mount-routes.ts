import type { AuthResult, PromptHandler } from '../types.js'
import type { McpAdapter } from '../mcp/shared.js'
import type { ToolPipeline } from '../pipeline/types.js'
import type { DiscoveryOptions } from '../discovery.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type {
  ExplicitRoute,
  InternalTool,
  StoredPrompt,
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import { GraftError } from '../errors.js'
import {
  createDiscoveryCache,
  preloadDiscoveryFiles as preloadDiscoveryFilesWithCache,
  type DiscoveryCache,
} from './discovery-cache.js'
import {
  buildRoutePlan,
  type BuildRoutePlanInput,
  type RouteMountPlan,
} from './route-plan.js'
import { mountDiscoveryRoutes, mountHealthRoute, mountMcpTransportRoute } from './discovery-routes.js'
import { mountPromptRoutes } from './prompt-routes.js'
import { toRouteKey, type RouteKey } from './route-key.js'
import { mountResourceRoutes, mountResourceTemplateRoutes } from './resource-routes.js'
import { mountToolRoutes } from './tool-routes.js'
import type { Router } from './router.js'

/**
 * Legacy input shape for mounting routes directly from runtime state.
 *
 * Prefer building a `RouteMountPlan` first so the HTTP layer only receives
 * transport-ready route metadata.
 */
export interface MountRoutesInput<TAuth extends AuthResult = AuthResult> {
  router: Router
  mcp: McpAdapter
  pipeline: ToolPipeline
  tools: readonly InternalTool<TAuth>[]
  storedResources: readonly StoredResource[]
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[]
  storedPrompts: readonly StoredPrompt<ObjectParamsSchema>[]
  explicitRoutes: readonly ExplicitRoute[]
  promptHandler?: PromptHandler
  healthCheck?: boolean | { path?: string }
  appName?: string
  appVersion?: string
  appDescription?: string
  apiUrl?: string
  discovery?: DiscoveryOptions
  discoveryCache?: DiscoveryCache
}

function buildRoutePlanFromLegacyInput<TAuth extends AuthResult = AuthResult>(
  input: MountRoutesInput<TAuth>,
): RouteMountPlan<TAuth> {
  const planInput: BuildRoutePlanInput<TAuth> = {
    ...input,
    discoveryCache: input.discoveryCache ?? createDiscoveryCache(),
  }
  return buildRoutePlan(planInput)
}

function mountExplicitRoutes(
  router: Router,
  explicitRoutes: readonly ExplicitRoute[],
  reserved: Set<RouteKey>,
): void {
  for (const route of explicitRoutes) {
    const routeKey = toRouteKey(route.method, route.path)
    if (reserved.has(routeKey)) {
      throw new GraftError(
        `Explicit route ${routeKey} conflicts with a reserved framework route.`,
        500,
      )
    }

    router.add(route.method, route.path, route.handler)
  }
}

/**
 * Mount a pre-built transport-ready route plan.
 */
export function mountRoutePlan<TAuth extends AuthResult = AuthResult>(
  plan: RouteMountPlan<TAuth>,
): void {
  const reserved = new Set<RouteKey>()

  mountHealthRoute(plan, reserved)
  mountMcpTransportRoute(plan, reserved)
  mountDiscoveryRoutes(plan, reserved)
  mountToolRoutes(plan.router, plan.toolRoutes, plan.pipeline, reserved)
  mountResourceRoutes(plan.router, plan.resourceRoutes, plan.pipeline, reserved)
  mountResourceTemplateRoutes(plan.router, plan.resourceTemplateRoutes, plan.pipeline, reserved)
  mountPromptRoutes(plan.router, plan.promptRoutes, plan.promptHandler, reserved)
  mountExplicitRoutes(plan.router, plan.explicitRoutes, reserved)
}

/**
 * Mount routes directly from runtime state.
 *
 * This remains as a compatibility wrapper around `buildRoutePlan()` and
 * `mountRoutePlan()`.
 */
export function mountRoutes<TAuth extends AuthResult = AuthResult>(
  input: MountRoutesInput<TAuth>,
): void {
  mountRoutePlan(buildRoutePlanFromLegacyInput(input))
}

/**
 * Preload file-backed discovery endpoints so startup fails early on bad files.
 */
export async function preloadDiscoveryFiles(
  discovery?: DiscoveryOptions,
  cache?: DiscoveryCache,
): Promise<void> {
  await preloadDiscoveryFilesWithCache(discovery, cache)
}
