import type {
  AuthResult,
  AuthorizeHook,
  ConfigureServerHook,
  Logger,
  OnDispatchErrorHook,
  OnDispatchSuccessHook,
  ToolCallMiddleware,
  TransformToolDefinitionHook,
  TransformToolResultHook,
} from '../types.js'
import type { DiscoveryOptions } from '../discovery.js'
import type { McpAdapter } from '../mcp/shared.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type {
  ExplicitRoute,
  InternalTool,
  StoredPrompt,
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import { validateManifest, formatValidation } from '../diagnostics.js'
import { Router } from '../http/router.js'
import type { DiscoveryCache } from '../http/discovery-cache.js'
import { mountRoutePlan } from '../http/mount-routes.js'
import { buildRoutePlan } from '../http/route-plan.js'
import { buildRuntime, type BuildRuntimeResult, type RuntimeMiddleware } from '../runtime.js'
import { GraftError } from '../errors.js'

/**
 * Public build output exposed by `App.build()`.
 */
export interface BuildAppResult {
  mcp: McpAdapter
  fetch: (request: Request) => Promise<Response>
}

/**
 * Internal inputs required to assemble an immutable app runtime.
 */
export interface BuildAppInput<TAuth extends AuthResult = AuthResult> {
  tools: readonly InternalTool<TAuth>[]
  storedResources: readonly StoredResource[]
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[]
  storedPrompts: readonly StoredPrompt<ObjectParamsSchema>[]
  explicitRoutes: readonly ExplicitRoute[]
  discoveryCache: DiscoveryCache
  options: {
    name: string
    version?: string
    description?: string
    apiUrl?: string
    configureServer?: ConfigureServerHook
    transformToolDefinition?: TransformToolDefinitionHook
    transformToolResult?: TransformToolResultHook
    authenticate?: (request: Request) => TAuth | Promise<TAuth>
    authorize?: AuthorizeHook<TAuth>
    onToolCall?: ToolCallMiddleware<TAuth>
    cors?: false | { origin?: string | string[] }
    logger?: Logger
    healthCheck?: boolean | { path?: string }
    discovery?: DiscoveryOptions
  }
  middleware: RuntimeMiddleware<TAuth>
  onError?: readonly OnDispatchErrorHook[]
  onSuccess?: readonly OnDispatchSuccessHook[]
}

/**
 * Build the immutable runtime and public fetch adapter for a configured app.
 *
 * @param input Registered tools, resources, prompts, routes, and runtime hooks.
 * @returns Internal runtime state plus the public `BuildAppResult`.
 * @throws {GraftError} When manifest validation fails.
 * @example
 * const { built } = buildAppRuntime(input)
 * const response = await built.fetch(new Request('http://localhost/health'))
 */
export function buildAppRuntime<TAuth extends AuthResult = AuthResult>(
  input: BuildAppInput<TAuth>,
): { runtime: BuildRuntimeResult; built: BuildAppResult } {
  const runtime = buildRuntime<TAuth>({
    tools: input.tools,
    storedResources: input.storedResources,
    storedResourceTemplates: input.storedResourceTemplates,
    storedPrompts: input.storedPrompts,
    options: {
      name: input.options.name,
      version: input.options.version,
      description: input.options.description,
      authenticate: input.options.authenticate,
      authorize: input.options.authorize,
      logger: input.options.logger,
      configureServer: input.options.configureServer,
      transformToolDefinition: input.options.transformToolDefinition,
      transformToolResult: input.options.transformToolResult,
    },
    middleware: input.middleware,
    onError: input.onError,
    onSuccess: input.onSuccess,
  })

  const validation = validateManifest(runtime.mcp.getManifest())
  if (!validation.valid) {
    throw new GraftError(formatValidation(validation), 500)
  }

  const logger = input.options.logger ?? console
  for (const warning of validation.warnings) {
    logger.warn(`[graft] ${warning.tool}: ${warning.message}`)
  }
  for (const info of validation.infos) {
    logger.info(`[graft] ${info.tool}: ${info.message}`)
  }

  const router = new Router({ cors: input.options.cors, logger: input.options.logger })
  const routePlan = buildRoutePlan({
    router,
    mcp: runtime.mcp,
    pipeline: runtime.pipeline,
    tools: input.tools,
    storedResources: input.storedResources,
    storedResourceTemplates: input.storedResourceTemplates,
    storedPrompts: input.storedPrompts,
    explicitRoutes: input.explicitRoutes,
    promptHandler: runtime.promptHandler,
    healthCheck: input.options.healthCheck,
    appName: input.options.name,
    appVersion: input.options.version,
    appDescription: input.options.description,
    apiUrl: input.options.apiUrl,
    discovery: input.options.discovery,
    discoveryCache: input.discoveryCache,
  })
  mountRoutePlan(routePlan)

  return {
    runtime,
    built: {
      mcp: runtime.mcp,
      fetch: router.fetch.bind(router),
    },
  }
}
