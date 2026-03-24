import type {
  AuthResult,
  AuthorizeHook,
  ContextIngredients,
  DispatchEvent,
  DispatchOutcome,
  JsonSchema,
  Logger,
  OnDispatchErrorHook,
  OnDispatchSuccessHook,
  ToolAuth,
  ToolCallMiddleware,
  ToolContext,
  ToolMeta,
} from '../types.js'

export type { ContextIngredients } from '../types.js'

/**
 * A tool registered with the dispatch pipeline.
 */
export interface PipelineTool<
  TAuth extends AuthResult = AuthResult,
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string
  auth?: ToolAuth
  validate?(rawArgs: Record<string, unknown>): TParams
  inputSchema?: JsonSchema | null
  handler(args: TParams, ctx: ToolContext<TAuth>): unknown | Promise<unknown>
  middleware?: ToolCallMiddleware<TAuth>
  meta?: ToolMeta
}

/**
 * Generic dispatchable entry implemented by tools and resource templates.
 */
export interface Dispatchable<
  TAuth extends AuthResult = AuthResult,
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  kind: 'tool' | 'resource'
  name: string
  auth?: ToolAuth
  validate?(args: Record<string, unknown>): TParams
  handler(parsed: TParams, ctx: ToolContext<TAuth>): unknown | Promise<unknown>
  middleware?: ToolCallMiddleware<TAuth>
  meta: ToolMeta
  sideEffects: boolean
  tags: string[]
}

/**
 * Inputs required to build a tool/resource dispatch pipeline.
 */
export interface CreatePipelineOptions<TAuth extends AuthResult = AuthResult> {
  tools: readonly PipelineTool<TAuth>[]
  resources?: readonly Dispatchable<TAuth>[]
  middleware?: ToolCallMiddleware<TAuth>
  logger?: Logger
  authenticate?: (request: Request) => TAuth | Promise<TAuth>
  authorize?: AuthorizeHook<TAuth>
  onError?: readonly OnDispatchErrorHook[]
  onSuccess?: readonly OnDispatchSuccessHook[]
}

/**
 * Per-dispatch options supplied by transports and tests.
 */
export interface DispatchOptions<TAuth extends AuthResult = AuthResult> {
  authResult?: TAuth
  headers?: Record<string, string>
  requestId?: string
  signal?: AbortSignal
  request?: Request
  transport?: 'http' | 'mcp' | 'stdio'
  contextIngredients?: ContextIngredients
}

/**
 * Public interface exposed by the dispatch pipeline.
 */
export interface ToolPipeline<TAuth extends AuthResult = AuthResult> {
  dispatch(toolName: string, rawArgs: Record<string, unknown>, options?: DispatchOptions<TAuth>): Promise<DispatchOutcome>
  dispatchResource(name: string, rawArgs: Record<string, unknown>, options?: DispatchOptions<TAuth>): Promise<DispatchOutcome>
  dispatchFromRequest(toolName: string, rawArgs: Record<string, unknown>, request: Request): Promise<DispatchOutcome>
  dispatchResourceFromRequest(name: string, rawArgs: Record<string, unknown>, request: Request): Promise<DispatchOutcome>
}

/**
 * Buffered dispatch events attached to a dispatch outcome.
 */
export type BufferedDispatchEvents = {
  events: DispatchEvent[]
  eventsDropped?: number
}
