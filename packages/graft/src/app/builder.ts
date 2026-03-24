import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  AuthResult,
  DispatchOutcome,
  OnDispatchErrorHook,
  OnDispatchSuccessHook,
  ToolCallMiddleware,
} from '../types.js'
import type { ServeOptions, ServerHandle } from '../server/types.js'
import type { NodeHost } from './node-host.js'
import { GraftError } from '../errors.js'
import type { BuildRuntimeInput, BuildRuntimeResult } from '../runtime.js'
import { buildDispatchPipeline } from '../runtime.js'
import type { Collector } from '../telemetry/collector.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type { HttpMethodInput } from '../http-method.js'
import type {
  AppOptions,
  BuildResult,
  MiddlewareOptions,
  PromptConfig,
  ResourceConfig,
  ResourceTemplateConfig,
  RouteDescriptor,
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
import { buildAppRuntime, type BuildAppInput } from './build.js'
import { createNodeHost } from './node-host.js'
import { buildRouteDescriptors } from './route-descriptors.js'
import { AppRegistry, type AppRegistrySnapshot } from './registry-state.js'

/**
 * Public application builder and runtime facade for tools, resources, prompts, and HTTP serving.
 *
 * `App` owns registration-time validation and freezes into a transport-ready
 * runtime when `build()` or `serve()` is called.
 *
 * @example
 * const app = createApp({ name: 'my-service' })
 * app.tool('ping', { description: 'Health check', handler: () => 'pong' })
 */
export class App<TAuth extends AuthResult = AuthResult> {
  private readonly options: AppOptions<TAuth>
  private readonly registry: AppRegistry<TAuth>
  private built: BuildResult | null = null
  private runtime: BuildRuntimeResult | null = null
  private _collector: Collector | null = null

  constructor(options: AppOptions<TAuth>) {
    this.options = options
    this.registry = new AppRegistry<TAuth>()
  }

  /**
   * Telemetry collector created by `serve()`, when available.
   */
  get collector(): Collector | null {
    return this._collector
  }

  /**
   * Authenticate a web `Request` using the app's configured authenticate hook.
   *
   * @param request Request to authenticate.
   * @returns The auth result produced by the app hook.
   * @throws {GraftError} When no authenticate hook is configured or the hook fails.
   */
  async authenticate(request: Request): Promise<TAuth> {
    if (!this.options.authenticate) {
      throw new GraftError('No authenticate hook configured', 500)
    }

    try {
      return await this.options.authenticate(request)
    } catch (error) {
      if (error instanceof GraftError) throw error
      throw new GraftError(
        `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        undefined,
        { cause: error },
      )
    }
  }

  /**
   * Register a tool definition.
   */
  tool(defined: DefinedTool): this
  tool<S extends ObjectParamsSchema>(name: string, config: ZodToolConfig<S, TAuth>): this
  tool(name: string, config: JsonSchemaToolConfig<TAuth>): this
  tool(name: string, config: NoSchemaToolConfig<TAuth>): this
  tool(
    nameOrDefined: string | DefinedTool,
    config?: ToolConfig<ObjectParamsSchema, TAuth>,
  ): this {
    this.registry.registerTool(nameOrDefined, config)
    return this
  }

  /**
   * Register multiple tools from an object map.
   */
  tools(
    map: Record<string, ToolConfig<ObjectParamsSchema, TAuth>>,
    shared?: SharedToolOptions,
  ): this {
    this.registry.tools(map, shared)
    return this
  }

  /**
   * Register a static resource.
   */
  resource(config: ResourceConfig): this {
    this.registry.resource(config)
    return this
  }

  /**
   * Register a URI-templated resource.
   */
  resourceTemplate<S extends ObjectParamsSchema>(config: ResourceTemplateConfig<S, TAuth>): this {
    this.registry.resourceTemplate(config)
    return this
  }

  /**
   * Register a reusable prompt.
   */
  prompt<S extends ObjectParamsSchema>(config: PromptConfig<S>): this {
    this.registry.prompt(config)
    return this
  }

  /**
   * Register an explicit HTTP route that is not exposed as an MCP tool.
   */
  route(
    method: HttpMethodInput,
    path: string,
    handler: (request: Request) => unknown | Promise<unknown>,
  ): this {
    this.registry.route(method, path, handler)
    return this
  }

  /**
   * Register an HTTP-only webhook that still flows through the tool pipeline.
   */
  webhook(name: string, config: WebhookConfig<TAuth>): this {
    this.registry.webhook(name, config)
    return this
  }

  /**
   * Add middleware to the dispatch stack.
   */
  use(middleware: ToolCallMiddleware<TAuth>, options?: MiddlewareOptions): this {
    this.registry.use(middleware, options)
    return this
  }

  /**
   * Register an error lifecycle hook.
   */
  onError(hook: OnDispatchErrorHook): this {
    this.registry.onError(hook)
    return this
  }

  /**
   * Register a success lifecycle hook.
   */
  onSuccess(hook: OnDispatchSuccessHook): this {
    this.registry.onSuccess(hook)
    return this
  }

  /**
   * Build the immutable runtime artifacts for this app.
   *
   * @returns The MCP adapter plus the generated fetch handler for this app.
   * @throws {GraftError} When manifest validation fails during build.
   * @example
   * const { mcp, fetch } = app.build()
   */
  build(): BuildResult {
    if (this.built) return this.built

    this.registry.lock()
    const snapshot = this.registry.snapshot()
    const { runtime, built } = buildAppRuntime<TAuth>(this.createBuildInput(snapshot))

    this.runtime = runtime
    this.built = built
    return built
  }

  /**
   * Return the generated HTTP route descriptors for external framework mounting.
   *
   * @returns The transport-ready HTTP routes generated for the current app state.
   * @example
   * const routes = app.routes()
   */
  routes(): RouteDescriptor[] {
    const snapshot = this.registry.snapshot()
    const pipeline = this.runtime?.pipeline ?? buildDispatchPipeline(this.createRuntimeInput(snapshot))
    return buildRouteDescriptors(snapshot.tools, pipeline)
  }

  /**
   * Dispatch a tool call programmatically.
   *
   * @param name Registered tool name.
   * @param args Tool arguments to dispatch.
   * @param opts Optional transport headers forwarded into the tool context.
   * @returns The normalized dispatch outcome for the tool call.
   * @example
   * const result = await app.dispatch('greet', { name: 'Ada' })
   */
  async dispatch(
    name: string,
    args: Record<string, unknown> = {},
    opts?: { headers?: Record<string, string> },
  ): Promise<DispatchOutcome> {
    const { pipeline } = this.ensureRuntime()
    return pipeline.dispatch(name, args, { headers: opts?.headers })
  }

  /**
   * Build and return a web-standard fetch handler.
   *
   * @returns A fetch-compatible request handler for all generated HTTP routes.
   * @example
   * const fetch = app.toFetch()
   */
  toFetch(): (request: Request) => Promise<Response> {
    const { fetch } = this.build()
    return fetch
  }

  /**
   * Build a reusable Node.js transport adapter.
   *
   * @returns A Node host that can create handlers or start a standalone server.
   * @example
   * const host = app.node()
   */
  node(): NodeHost {
    return createNodeHost({
      build: () => this.build(),
      discovery: this.options.discovery,
      discoveryCache: this.registry.discoveryCache,
      onStart: this.options.onStart,
      onShutdown: this.options.onShutdown,
      logger: this.options.logger,
    })
  }

  /**
   * Build and return a Node.js request handler.
   *
   * @param options Optional body-size limits for the created request handler.
   * @returns A handler suitable for `http.createServer()`.
   * @example
   * const server = createServer(app.toNodeHandler({ maxBodySize: 1_000_000 }))
   */
  toNodeHandler(options?: { maxBodySize?: number }): (
    req: IncomingMessage,
    res: ServerResponse,
  ) => void {
    return this.node().toNodeHandler(options)
  }

  /**
   * Start a standalone Node.js HTTP server for this app.
   *
   * @param options Listener binding, logging, request-size, and graceful-shutdown options.
   * @returns A handle that can be used to observe and shut down the server.
   * @throws {Error} When startup hooks fail or the listener cannot be created.
   * @example
   * const handle = await app.serve({ port: 3000, maxBodySize: 2_000_000 })
   * await handle.close()
   */
  async serve(options: ServeOptions = {}): Promise<ServerHandle> {
    const { handle, collector } = await this.node().serve(options)
    this._collector = collector
    return handle
  }

  private ensureRuntime(): BuildRuntimeResult {
    if (!this.runtime) this.build()
    if (!this.runtime) {
      throw new GraftError('Runtime initialization failed.', 500)
    }
    return this.runtime
  }

  private createRuntimeInput(snapshot: AppRegistrySnapshot<TAuth>): BuildRuntimeInput<TAuth> {
    return {
      tools: snapshot.tools,
      storedResources: snapshot.storedResources,
      storedResourceTemplates: snapshot.storedResourceTemplates,
      storedPrompts: snapshot.storedPrompts,
      options: {
        name: this.options.name,
        version: this.options.version,
        description: this.options.description,
        authenticate: this.options.authenticate,
        authorize: this.options.authorize,
        logger: this.options.logger,
        configureServer: this.options.configureServer,
        transformToolDefinition: this.options.transformToolDefinition,
        transformToolResult: this.options.transformToolResult,
      },
      middleware: {
        onToolCall: this.options.onToolCall,
        scoped: snapshot.middlewares,
      },
      onError: snapshot.onErrorHooks.length > 0 ? snapshot.onErrorHooks : undefined,
      onSuccess: snapshot.onSuccessHooks.length > 0 ? snapshot.onSuccessHooks : undefined,
    }
  }

  private createBuildInput(snapshot: AppRegistrySnapshot<TAuth>): BuildAppInput<TAuth> {
    const runtimeInput = this.createRuntimeInput(snapshot)
    return {
      tools: runtimeInput.tools,
      storedResources: runtimeInput.storedResources,
      storedResourceTemplates: runtimeInput.storedResourceTemplates,
      storedPrompts: runtimeInput.storedPrompts,
      explicitRoutes: snapshot.explicitRoutes,
      discoveryCache: snapshot.discoveryCache,
      middleware: runtimeInput.middleware ?? { scoped: [] },
      onError: runtimeInput.onError,
      onSuccess: runtimeInput.onSuccess,
      options: {
        ...runtimeInput.options,
        apiUrl: this.options.apiUrl,
        onToolCall: this.options.onToolCall,
        cors: this.options.cors,
        healthCheck: this.options.healthCheck,
        discovery: this.options.discovery,
      },
    }
  }
}

/**
 * Create a new Graft application builder.
 *
 * @param options Application metadata, auth hooks, middleware, and transport settings.
 * @returns A mutable app builder that becomes immutable after `build()`.
 */
export function createApp<TAuth extends AuthResult = AuthResult>(options: AppOptions<TAuth>): App<TAuth> {
  return new App(options)
}
