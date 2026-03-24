import type {
  AuthResult,
  AuthorizeHook,
  ConfigureServerHook,
  Logger,
  OnDispatchErrorHook,
  OnDispatchSuccessHook,
  PromptHandler,
  ToolCallMiddleware,
  ToolMeta,
  TransformToolDefinitionHook,
  TransformToolResultHook,
} from '../types.js'
import type { ToolPipeline } from '../pipeline/types.js'
import type { McpAdapter } from '../mcp/shared.js'
import type {
  InternalTool,
  StoredPrompt,
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import type { ObjectParamsSchema } from '../object-schema.js'

/**
 * Middleware collection used while building the runtime pipeline.
 */
export interface RuntimeMiddleware<TAuth extends AuthResult = AuthResult> {
  onToolCall?: ToolCallMiddleware<TAuth>
  scoped: ReadonlyArray<{ fn: ToolCallMiddleware<TAuth>; filter?: (tool: ToolMeta) => boolean }>
}

/**
 * Inputs required to assemble the dispatch pipeline, MCP adapter, and prompt handler.
 */
export interface BuildRuntimeInput<TAuth extends AuthResult = AuthResult> {
  tools: readonly InternalTool<TAuth>[]
  storedResources: readonly StoredResource[]
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[]
  storedPrompts: readonly StoredPrompt<ObjectParamsSchema>[]
  options: {
    name: string
    version?: string
    description?: string
    authenticate?: (request: Request) => TAuth | Promise<TAuth>
    authorize?: AuthorizeHook<TAuth>
    logger?: Logger
    configureServer?: ConfigureServerHook
    transformToolDefinition?: TransformToolDefinitionHook
    transformToolResult?: TransformToolResultHook
  }
  middleware?: RuntimeMiddleware<TAuth>
  onError?: readonly OnDispatchErrorHook[]
  onSuccess?: readonly OnDispatchSuccessHook[]
}

/**
 * Runtime artifacts returned by `buildRuntime`.
 */
export interface BuildRuntimeResult {
  pipeline: ToolPipeline
  mcp: McpAdapter
  promptHandler?: PromptHandler
}
