import { extractHeaders } from '../../headers.js'
import type {
  AuthResult,
  DispatchOutcome,
  ToolAuth,
  ToolCallMiddleware,
  ToolContext,
  ToolMeta,
} from '../../types.js'
import type { ToolCallRecord } from '../../telemetry.js'
import type {
  ContextIngredients,
  CreatePipelineOptions,
  DispatchOptions,
} from '../types.js'

/** Dispatch options normalized into a transport-agnostic execution shape. */
export interface NormalizedOptions<TAuth extends AuthResult = AuthResult> {
  requestId: string
  headers: Record<string, string>
  signal: AbortSignal | undefined
  transport: 'http' | 'mcp' | 'stdio'
  authResult: TAuth | undefined
  contextIngredients: ContextIngredients | undefined
  request: Request | undefined
}

/**
 * Normalized dispatch entry consumed by the execution engine.
 */
export interface EntryShape<TAuth extends AuthResult> {
  name: string
  auth?: ToolAuth
  validate?: (args: Record<string, unknown>) => Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolContext<TAuth>) => unknown | Promise<unknown>
  middleware?: ToolCallMiddleware<TAuth>
  meta?: ToolMeta
}

/**
 * Shared executor signature used by the public pipeline facade.
 */
export type DispatchExecutor<TAuth extends AuthResult> = (
  entry: EntryShape<TAuth>,
  kind: 'tool' | 'resource',
  entryName: string,
  rawArgs: Record<string, unknown>,
  opts?: DispatchOptions<TAuth>,
) => Promise<DispatchOutcome>

/** Shared runtime dependencies extracted from `CreatePipelineOptions`. */
export interface ExecutionDeps<TAuth extends AuthResult = AuthResult> {
  composedMiddleware: ToolCallMiddleware<TAuth> | undefined
  logger: CreatePipelineOptions<TAuth>['logger']
  pipelineLogger: NonNullable<CreatePipelineOptions<TAuth>['logger']>
  authenticate: CreatePipelineOptions<TAuth>['authenticate']
  authorize: CreatePipelineOptions<TAuth>['authorize']
  onError: CreatePipelineOptions<TAuth>['onError']
  onSuccess: CreatePipelineOptions<TAuth>['onSuccess']
}

/** Full execution result returned by the internal dispatch engine. */
export interface ExecutionResult<TAuth extends AuthResult> {
  dispatchOutcome: DispatchOutcome
  telemetryStatus: 'ok' | 'error'
  telemetryError?: ToolCallRecord['error']
  authResult?: TAuth
  ctx?: ToolContext<TAuth>
  caughtError?: unknown
}

function resolveRequestId(opts?: DispatchOptions): string {
  return opts?.requestId ?? crypto.randomUUID()
}

function resolveHeaders(
  opts: DispatchOptions | undefined,
  request: Request | undefined,
): Record<string, string> {
  if (opts?.headers) return opts.headers
  return request ? extractHeaders(request) : {}
}

function resolveSignal(
  opts: DispatchOptions | undefined,
  request: Request | undefined,
): AbortSignal | undefined {
  return opts?.signal ?? request?.signal
}

/** Normalize dispatch options into the internal execution shape. */
export function normalizeOptions<TAuth extends AuthResult = AuthResult>(
  opts?: DispatchOptions<TAuth>,
): NormalizedOptions<TAuth> {
  const request = opts?.request
  return {
    requestId: resolveRequestId(opts),
    headers: resolveHeaders(opts, request),
    signal: resolveSignal(opts, request),
    transport: opts?.transport ?? 'http',
    authResult: opts?.authResult,
    contextIngredients: opts?.contextIngredients,
    request,
  }
}

/** Extract reusable execution dependencies from pipeline creation options. */
export function createExecutionDeps<TAuth extends AuthResult>(
  options: CreatePipelineOptions<TAuth>,
): ExecutionDeps<TAuth> {
  return {
    composedMiddleware: options.middleware,
    logger: options.logger,
    pipelineLogger: options.logger ?? console,
    authenticate: options.authenticate,
    authorize: options.authorize,
    onError: options.onError,
    onSuccess: options.onSuccess,
  }
}
