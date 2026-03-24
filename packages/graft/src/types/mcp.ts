import type { HttpMethod } from '../http-method.js'
import type { AuthResult, ToolMeta } from './auth.js'
import type { ContextIngredients, ToolContext } from './context.js'
import type { DispatchSuccess } from './dispatch.js'
import type {
  JsonSchema,
  ParameterLocation,
  ParameterLocationEntry,
  ToolDefinition,
} from './tool-definition.js'

/** Context passed to custom MCP method handlers registered through `configureServer`. */
export interface McpHandlerContext {
  /** Headers forwarded from the active transport request, when available. */
  headers?: Record<string, string>
  /** Transport-specific progress and log callbacks, when available. */
  contextIngredients?: ContextIngredients
  /** AbortSignal from the active transport request. */
  signal?: AbortSignal
}

/** Static resource exposed via MCP resources/list and optionally HTTP GET */
export interface ResourceDefinition {
  uri: string
  name: string
  title?: string
  description: string
  mimeType?: string
}

/** URI-templated resource for dynamic resource resolution */
export interface ResourceTemplateDefinition {
  uriTemplate: string
  name: string
  title?: string
  description: string
  mimeType?: string
  /** JSON Schema for template parameters */
  params: JsonSchema | null
}

/** Context passed to resource handlers when reading resource content. */
export interface ResourceReadContext {
  /** Headers forwarded from the current transport, when available. */
  headers?: Record<string, string>
  /** AbortSignal for the active MCP or HTTP request. */
  signal?: AbortSignal
}

/** Async function that reads a resource by URI and returns its content */
export type ResourceHandler =
  (uri: string, options?: ResourceReadContext) => Promise<{ content: unknown; mimeType?: string }>

/** Reusable prompt template exposed via MCP prompts/list */
export interface PromptDefinition {
  name: string
  title?: string
  description: string
  /** JSON Schema for prompt arguments */
  params: JsonSchema | null
}

/** A single message in a prompt template response */
export interface PromptMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Context passed to prompt handlers when resolving prompt content. */
export interface PromptResolveContext {
  /** AbortSignal for the active MCP or HTTP request. */
  signal?: AbortSignal
}

/** Async function that resolves a prompt by name and returns messages */
export type PromptHandler =
  (name: string, args: Record<string, unknown>, ctx?: PromptResolveContext) => Promise<PromptMessage[]>

/** Frozen manifest snapshot of all registered entities */
export interface Manifest {
  tools: ToolDefinition[]
  resources: ResourceDefinition[]
  resourceTemplates: ResourceTemplateDefinition[]
  prompts: PromptDefinition[]
}

/** Context passed to the configureServer hook */
export interface ConfigureServerContext {
  /** Register or override a Graft-served MCP request handler. Custom request methods work over both HTTP and stdio. */
  setHandler(
    method: string,
    handler: (params: Record<string, unknown>, ctx: McpHandlerContext) => Promise<unknown>,
  ): void
  /** Merge additional capabilities into the initialize response */
  addCapabilities(capabilities: Record<string, unknown>): void
  /** Frozen manifest snapshot */
  manifest: Manifest
}

/** Hook called once at MCP adapter creation with the raw MCP Server instance */
export type ConfigureServerHook = (ctx: ConfigureServerContext) => void | Promise<void>

/** MCP tool definition shape passed to the transform hook */
export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema & { type: 'object' }
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  icons?: Array<{ url: string; mediaType?: string }>
  [key: string]: unknown
}

/** MCP tool call result shape passed to the transform hook */
export interface McpToolResult {
  content: Array<{ type: string; [key: string]: unknown }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  [key: string]: unknown
}

/** Hook to modify each tool definition in tools/list */
export type TransformToolDefinitionHook = (
  def: McpToolDefinition,
  ctx: { tool: ToolDefinition }
) => McpToolDefinition | Promise<McpToolDefinition>

/** Hook to modify each tool call result in tools/call. MCP-only — not invoked for HTTP tool routes. */
export type TransformToolResultHook = (
  result: McpToolResult,
  ctx: { tool: ToolDefinition; dispatchSuccess: DispatchSuccess; args: Record<string, unknown> }
) => McpToolResult | Promise<McpToolResult>

/** Context passed to the authorize hook */
export interface AuthorizeContext {
  /** Whether this is a list-time filter or a call-time enforcement */
  phase: 'list' | 'call'
  /** Tool call arguments — only present during 'call' phase */
  params?: Record<string, unknown>
}

/** Authorization predicate — called after authentication succeeds.
 *  Return true to allow access, false to deny (403). */
export type AuthorizeHook<TAuth extends AuthResult = AuthResult> = (
  tool: ToolMeta,
  authResult: TAuth,
  context: AuthorizeContext,
) => boolean | Promise<boolean>

/** Middleware function for tool calls — wraps execution with before/after logic */
export type ToolCallMiddleware<TAuth extends AuthResult = AuthResult> = (
  ctx: ToolContext<TAuth>,
  next: () => Promise<unknown>
) => Promise<unknown>

/** Function that proxies an MCP tool call to the HTTP handler */
export interface McpProxyFunction {
  (method: HttpMethod, path: string, args: Record<string, unknown>, context?: {
    headers?: Record<string, string | string[] | undefined>
    parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
    toolContext?: ToolContext
  }): Promise<{
    status: number
    headers: Record<string, string>
    body: unknown
  }>
}

/** Result of validation checks */
export interface ValidationResult {
  valid: boolean
  errors: ValidationMessage[]
  warnings: ValidationMessage[]
  infos: ValidationMessage[]
}

/** A single validation error or warning message */
export interface ValidationMessage {
  tool: string
  message: string
}
