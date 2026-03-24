import type {
  AuthResult,
  OnDispatchErrorHook,
  OnDispatchSuccessHook,
  ToolCallMiddleware,
} from '../types.js'
import type { HttpMethodInput } from '../http-method.js'
import { createDiscoveryCache, type DiscoveryCache } from '../http/discovery-cache.js'
import { parseHttpMethod } from '../http-method.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type {
  Exposure,
  ExplicitRoute,
  InternalTool,
  StoredPrompt,
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import { GraftError } from '../errors.js'
import {
  buildInternalTool,
  buildStoredPrompt,
  buildStoredResource,
  buildStoredResourceTemplate,
  resolveExposure,
} from '../tool-builder/config.js'
import { compileToolBatch } from '../tool-builder/compile-batch.js'
import type {
  MiddlewareOptions,
  PromptConfig,
  ResourceConfig,
  ResourceTemplateConfig,
  SharedToolOptions,
  ToolConfig,
  WebhookConfig,
} from './types.js'
import type {
  DefinedTool,
  JsonSchemaToolConfig,
  NoSchemaToolConfig,
  ZodToolConfig,
} from '../tool-builder/config.js'

/**
 * Middleware registration stored on the app before runtime assembly.
 */
export interface StoredMiddleware<TAuth extends AuthResult = AuthResult> {
  fn: ToolCallMiddleware<TAuth>
  filter?: MiddlewareOptions['filter']
}

/**
 * Immutable snapshot of the app registry used during build-time assembly.
 */
export interface AppRegistrySnapshot<TAuth extends AuthResult = AuthResult> {
  readonly tools: readonly InternalTool<TAuth>[]
  readonly storedResources: readonly StoredResource[]
  readonly storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[]
  readonly storedPrompts: readonly StoredPrompt<ObjectParamsSchema>[]
  readonly explicitRoutes: readonly ExplicitRoute[]
  readonly middlewares: readonly StoredMiddleware<TAuth>[]
  readonly onErrorHooks: readonly OnDispatchErrorHook[]
  readonly onSuccessHooks: readonly OnDispatchSuccessHook[]
  discoveryCache: DiscoveryCache
}

function applyExposure<T extends { exposeMcp: boolean; exposeHttp: boolean }>(
  target: T,
  expose: Exposure | undefined,
  defaultExpose: 'both' | 'mcp' = 'both',
): void {
  const resolved = resolveExposure(expose, defaultExpose)
  target.exposeMcp = resolved.exposeMcp
  target.exposeHttp = resolved.exposeHttp
}

function requireToolConfig<TAuth extends AuthResult>(
  name: string,
  config: ToolConfig<ObjectParamsSchema, TAuth> | undefined,
): ToolConfig<ObjectParamsSchema, TAuth> {
  if (config) return config
  throw new GraftError(`Tool "${name}" requires a configuration object.`, 500)
}

function toExplicitRouteResponse(result: unknown): Response {
  if (result instanceof Response) return result
  if (result === undefined) {
    return new Response(null, { status: 204 })
  }
  return Response.json(result)
}

/**
 * Mutable registration state owned by `App` until `build()` freezes the runtime.
 */
export class AppRegistry<TAuth extends AuthResult = AuthResult> {
  private locked = false
  private readonly tools_: InternalTool<TAuth>[] = []
  private readonly storedResources: StoredResource[] = []
  private readonly storedResourceTemplates: StoredResourceTemplate<ObjectParamsSchema, TAuth>[] = []
  private readonly storedPrompts: StoredPrompt<ObjectParamsSchema>[] = []
  private readonly explicitRoutes: ExplicitRoute[] = []
  private readonly middlewares: StoredMiddleware<TAuth>[] = []
  private readonly onErrorHooks: OnDispatchErrorHook[] = []
  private readonly onSuccessHooks: OnDispatchSuccessHook[] = []
  readonly discoveryCache = createDiscoveryCache()

  lock(): void {
    this.locked = true
  }

  snapshot(): AppRegistrySnapshot<TAuth> {
    return {
      tools: [...this.tools_],
      storedResources: [...this.storedResources],
      storedResourceTemplates: [...this.storedResourceTemplates],
      storedPrompts: [...this.storedPrompts],
      explicitRoutes: [...this.explicitRoutes],
      middlewares: [...this.middlewares],
      onErrorHooks: [...this.onErrorHooks],
      onSuccessHooks: [...this.onSuccessHooks],
      discoveryCache: this.discoveryCache,
    }
  }

  private assertMutable(): void {
    if (this.locked) {
      throw new GraftError(
        'Cannot modify app after build() has been called. Register all tools, resources, and prompts before calling build().',
        500,
      )
    }
  }

  private registerBuiltTool(tool: InternalTool<TAuth>, expose?: Exposure): void {
    if (this.tools_.some((existing) => existing.name === tool.name)) {
      throw new GraftError(
        `Tool name "${tool.name}" is already registered. Tool names must be unique across all expose modes.`,
        500,
      )
    }

    applyExposure(tool, expose)
    this.tools_.push(tool)
  }

  tool(defined: DefinedTool): void
  tool<S extends ObjectParamsSchema>(name: string, config: ZodToolConfig<S, TAuth>): void
  tool(name: string, config: JsonSchemaToolConfig<TAuth>): void
  tool(name: string, config: NoSchemaToolConfig<TAuth>): void
  tool(
    nameOrDefined: string | DefinedTool,
    config?: ToolConfig<ObjectParamsSchema, TAuth>,
  ): void {
    this.registerTool(nameOrDefined, config)
  }

  registerTool(
    nameOrDefined: string | DefinedTool,
    config?: ToolConfig<ObjectParamsSchema, TAuth>,
  ): void {
    this.assertMutable()
    const [name, cfg] = typeof nameOrDefined === 'string'
      ? [nameOrDefined, requireToolConfig(nameOrDefined, config)]
      : [nameOrDefined.name, nameOrDefined.config]
    const tool = buildInternalTool(name, cfg)
    this.registerBuiltTool(tool, cfg.expose)
  }

  tools(
    map: Record<string, ToolConfig<ObjectParamsSchema, TAuth>>,
    shared?: SharedToolOptions,
  ): void {
    this.assertMutable()
    for (const { tool, expose } of compileToolBatch(map, shared)) {
      this.registerBuiltTool(tool, expose)
    }
  }

  resource(config: ResourceConfig): void {
    this.assertMutable()
    const stored = buildStoredResource(config)
    applyExposure(stored, config.expose)
    this.storedResources.push(stored)
  }

  resourceTemplate<S extends ObjectParamsSchema>(config: ResourceTemplateConfig<S, TAuth>): void {
    this.assertMutable()
    const stored = buildStoredResourceTemplate(config)
    applyExposure(stored, config.expose)
    this.storedResourceTemplates.push(stored)
  }

  prompt<S extends ObjectParamsSchema>(config: PromptConfig<S>): void {
    this.assertMutable()
    const stored = buildStoredPrompt(config)
    applyExposure(stored, config.expose, 'mcp')
    this.storedPrompts.push(stored)
  }

  route(
    method: HttpMethodInput,
    path: string,
    handler: (request: Request) => unknown | Promise<unknown>,
  ): void {
    this.assertMutable()
    this.explicitRoutes.push({
      method: parseHttpMethod(method, `Route "${path}" method`),
      path,
      handler: async (request: Request) => {
        const result = await handler(request)
        return toExplicitRouteResponse(result)
      },
    })
  }

  webhook(name: string, config: WebhookConfig<TAuth>): void {
    this.tool(name, {
      description: config.description,
      auth: config.auth,
      expose: 'http',
      http: { method: config.method ?? 'POST', path: config.path },
      handler: config.handler,
    })
  }

  use(middleware: ToolCallMiddleware<TAuth>, options?: MiddlewareOptions): void {
    this.assertMutable()
    this.middlewares.push({ fn: middleware, filter: options?.filter })
  }

  onError(hook: OnDispatchErrorHook): void {
    this.assertMutable()
    this.onErrorHooks.push(hook)
  }

  onSuccess(hook: OnDispatchSuccessHook): void {
    this.assertMutable()
    this.onSuccessHooks.push(hook)
  }
}
