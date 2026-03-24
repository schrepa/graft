import { createMcpAdapter } from './mcp/adapter.js'
import { createToolPipeline } from './pipeline/core.js'
import type { ToolPipeline } from './pipeline/types.js'
import { toDefinition } from './tool-builder/config.js'
import { buildPromptHandler, buildResourceHandler } from './tool-builder/runtime.js'
import type { AuthResult } from './types.js'
import { validateAuthConfig } from './runtime/auth.js'
import { buildToolDispatchables } from './runtime/middleware.js'
import { buildResourceDispatchables, collectResourceAuthMaps } from './runtime/resources.js'
import type { BuildRuntimeInput, BuildRuntimeResult } from './runtime/types.js'

export type {
  BuildRuntimeInput,
  BuildRuntimeResult,
  RuntimeMiddleware,
} from './runtime/types.js'

/** Build the dispatch pipeline used by HTTP routes and standalone runtime assembly. */
export function buildDispatchPipeline<TAuth extends AuthResult = AuthResult>(
  input: BuildRuntimeInput<TAuth>,
): ToolPipeline {
  const { tools, storedResources, storedResourceTemplates, options, middleware } = input

  validateAuthConfig(tools, storedResources, storedResourceTemplates, options.authenticate)

  const toolDispatchables = buildToolDispatchables(tools, middleware)
  const resourceDispatchables = buildResourceDispatchables(
    storedResources,
    storedResourceTemplates,
    middleware,
  )

  return createToolPipeline({
    tools: toolDispatchables,
    resources: resourceDispatchables,
    logger: options.logger,
    authenticate: options.authenticate,
    authorize: options.authorize,
    onError: input.onError,
    onSuccess: input.onSuccess,
  })
}

/**
 * Build the immutable runtime state for a configured app.
 *
 * @param input Registered tools, resources, prompts, and runtime hooks.
 * @returns The dispatch pipeline, MCP adapter, and optional prompt handler.
 * @throws {import('./errors.js').GraftError} When auth requirements are invalid for the registered app.
 */
export function buildRuntime<TAuth extends AuthResult = AuthResult>(
  input: BuildRuntimeInput<TAuth>,
): BuildRuntimeResult {
  const { tools, storedResources, storedResourceTemplates, storedPrompts, options } = input
  const pipeline = buildDispatchPipeline(input)

  const resourceHandler = buildResourceHandler(storedResources, storedResourceTemplates, pipeline)
  const promptHandler = buildPromptHandler(storedPrompts)
  const { resourceAuth, resourceTemplateAuth } = collectResourceAuthMaps(
    storedResources,
    storedResourceTemplates,
  )

  const mcp = createMcpAdapter({
    tools: tools.filter((tool) => tool.exposeMcp).map(toDefinition),
    pipeline,
    serverName: options.name,
    serverVersion: options.version,
    serverDescription: options.description,
    configureServer: options.configureServer,
    transformToolDefinition: options.transformToolDefinition,
    transformToolResult: options.transformToolResult,
    resources: storedResources.filter((resource) => resource.exposeMcp).map((resource) => resource.definition),
    resourceTemplates: storedResourceTemplates
      .filter((template) => template.exposeMcp)
      .map((template) => template.definition),
    prompts: storedPrompts.filter((prompt) => prompt.exposeMcp).map((prompt) => prompt.definition),
    resourceHandler,
    resourceAuth: resourceAuth.size > 0 ? resourceAuth : undefined,
    resourceTemplateAuth: resourceTemplateAuth.size > 0 ? resourceTemplateAuth : undefined,
    promptHandler,
    authenticate: options.authenticate,
    authorize: options.authorize,
    logger: options.logger,
  })

  return { pipeline, mcp, promptHandler }
}
