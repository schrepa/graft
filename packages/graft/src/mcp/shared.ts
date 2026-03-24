import type {
  ToolAuth,
  ConfigureServerHook,
  TransformToolDefinitionHook,
  TransformToolResultHook,
  ToolDefinition,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ResourceHandler,
  PromptDefinition,
  PromptHandler,
  AuthResult,
  AuthorizeHook,
  Logger,
  Manifest,
  McpHandlerContext,
} from '../types.js'
import type { ToolPipeline } from '../pipeline/types.js'
import { GraftError } from '../errors.js'
import { toPlainRecord } from '../object-schema.js'

/**
 * Context passed to each MCP method handler.
 */
export type McpMethodContext = McpHandlerContext

/**
 * A single MCP method handler.
 */
export type McpMethodHandler = (
  params: Record<string, unknown>,
  ctx: McpMethodContext,
) => Promise<unknown>

interface CallToolParams {
  name: string
  arguments?: Record<string, unknown>
  _meta?: { progressToken?: unknown }
}

interface ReadResourceParams {
  uri: string
}

interface GetPromptParams {
  name: string
  arguments?: Record<string, unknown>
}

interface InitializeParams {
  protocolVersion: string
}

/**
 * Parse `tools/call` params into the shape used by the MCP adapters.
 *
 * @param params Raw JSON-RPC params object.
 * @returns Normalized call-tool params with object-only arguments.
 * @throws {GraftError} When the required `name` param is missing.
 */
export function asCallToolParams(params: Record<string, unknown>): CallToolParams {
  const name = params.name
  if (typeof name !== 'string') throw new GraftError('Missing required param: name', 400)
  const argumentsRecord = toPlainRecord(params.arguments)
  const meta = toPlainRecord(params._meta)

  return {
    name,
    arguments: argumentsRecord ?? {},
    _meta: meta ? { progressToken: meta.progressToken } : undefined,
  }
}

/**
 * Parse `resources/read` params into the required read-resource shape.
 *
 * @param params Raw JSON-RPC params object.
 * @returns Normalized read-resource params.
 * @throws {GraftError} When the required `uri` param is missing.
 */
export function asReadResourceParams(params: Record<string, unknown>): ReadResourceParams {
  const uri = params.uri
  if (typeof uri !== 'string') throw new GraftError('Missing required param: uri', 400)
  return { uri }
}

/**
 * Parse `prompts/get` params into the shape used by the prompt handler.
 *
 * @param params Raw JSON-RPC params object.
 * @returns Normalized prompt params with object-only arguments.
 * @throws {GraftError} When the required `name` param is missing.
 */
export function asGetPromptParams(params: Record<string, unknown>): GetPromptParams {
  const name = params.name
  if (typeof name !== 'string') throw new GraftError('Missing required param: name', 400)
  return {
    name,
    arguments: toPlainRecord(params.arguments) ?? {},
  }
}

/**
 * Parse `initialize` params into the required initialize shape.
 *
 * @param params Raw JSON-RPC params object.
 * @returns Normalized initialize params.
 * @throws {GraftError} When the required `protocolVersion` param is missing.
 */
export function asInitializeParams(params: Record<string, unknown>): InitializeParams {
  const protocolVersion = params.protocolVersion
  if (typeof protocolVersion !== 'string') {
    throw new GraftError('Missing required param: protocolVersion', 400)
  }
  return { protocolVersion }
}

/**
 * Extra metadata passed by the MCP SDK alongside transport requests.
 */
export interface SdkRequestExtra {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> }
  signal?: AbortSignal
}

/**
 * MCP-specific auth, transform, and resource/prompt hooks shared across transports.
 */
export interface McpHandlerOptions<TAuth extends AuthResult = AuthResult> {
  serverName?: string
  serverVersion?: string
  transformToolDefinition?: TransformToolDefinitionHook
  transformToolResult?: TransformToolResultHook
  resourceHandler?: ResourceHandler
  promptHandler?: PromptHandler
  authenticate?: (request: Request) => TAuth | Promise<TAuth>
  authorize?: AuthorizeHook<TAuth>
  /** Auth requirements for static resources, keyed by URI. */
  resourceAuth?: Map<string, ToolAuth>
  /** Auth requirements for resource templates, keyed by name. */
  resourceTemplateAuth?: Map<string, ToolAuth>
  logger?: Logger
}

/**
 * Frozen manifest and lookup tables shared while building MCP method handlers.
 */
export interface McpServerData {
  manifest: Manifest
  toolMap: Map<string, ToolDefinition>
  promptMap: Map<string, PromptDefinition>
}

/**
 * Result of assembling the transport-agnostic MCP method-handler map.
 */
export interface BuildMethodHandlersResult {
  handlers: Map<string, McpMethodHandler>
  capabilities: Record<string, unknown>
}

/**
 * Options for constructing an MCP adapter.
 */
export interface McpAdapterOptions<TAuth extends AuthResult = AuthResult> {
  tools: ToolDefinition[]
  pipeline: ToolPipeline
  serverName?: string
  serverVersion?: string
  serverDescription?: string
  mcpPath?: string
  allowedOrigins?: string[]
  configureServer?: ConfigureServerHook
  transformToolDefinition?: TransformToolDefinitionHook
  transformToolResult?: TransformToolResultHook
  resources?: ResourceDefinition[]
  resourceTemplates?: ResourceTemplateDefinition[]
  resourceHandler?: ResourceHandler
  /** Auth requirements for static resources, keyed by URI. */
  resourceAuth?: Map<string, ToolAuth>
  /** Auth requirements for resource templates, keyed by name. */
  resourceTemplateAuth?: Map<string, ToolAuth>
  prompts?: PromptDefinition[]
  promptHandler?: PromptHandler
  authenticate?: (request: Request) => TAuth | Promise<TAuth>
  authorize?: AuthorizeHook<TAuth>
  logger?: Logger
}

/**
 * Transport-agnostic MCP adapter for HTTP JSON-RPC and stdio clients.
 */
export interface McpAdapter {
  /** Handle an MCP JSON-RPC request over HTTP. */
  handleMcp(request: Request): Promise<Response>
  /** Return the `agent.json` discovery document. */
  handleAgentJson(baseUrl: string): Response
  /** Start stdio MCP transport in Node.js. */
  connectStdio(): Promise<void>
  /** Clean up persistent transport resources. */
  close(): Promise<void>
  /** Return a frozen manifest of all registered entities. */
  getManifest(): Manifest
  /** Notify connected stdio clients that the tool list has changed. */
  sendToolListChanged(): Promise<void>
  /** Notify connected stdio clients that the resource list has changed. */
  sendResourceListChanged(): Promise<void>
  /** Notify connected stdio clients that the prompt list has changed. */
  sendPromptListChanged(): Promise<void>
}

/**
 * Coerce unknown JSON-RPC params into an object record.
 *
 * @param params Raw params value from a transport.
 * @returns The object record when present, otherwise an empty record.
 */
export function toParamRecord(params: unknown): Record<string, unknown> {
  return toPlainRecord(params) ?? {}
}
