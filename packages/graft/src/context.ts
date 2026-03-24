import type { AuthResult, ToolContext, RequestMeta, LogLevel, Logger } from './types.js'

/** Inputs used to build a `ToolContext` for one dispatch. */
export interface CreateContextOptions<TAuth extends AuthResult = AuthResult> {
  meta: RequestMeta<TAuth>
  /** Parsed tool parameters — exposed on ctx.params for middleware */
  params: Record<string, unknown>
  /** Transport-specific log sink (e.g. MCP notification). Called after the logger. */
  onLog?: (level: LogLevel, message: string, data?: Record<string, unknown>) => void
  onProgress?: (progress: number, total?: number) => void
  /** Application-level logger. Always called for every log call. Default: console. */
  logger?: Logger
  /** AbortSignal from the caller — forwarded to ToolContext for cancellation */
  signal?: AbortSignal
}

/** Create a ToolContext for a single tool invocation */
export function createToolContext<TAuth extends AuthResult = AuthResult>(
  options: CreateContextOptions<TAuth>,
): ToolContext<TAuth> {
  const { meta, params, onLog, onProgress, logger = console } = options
  const state: Record<PropertyKey, unknown> = {}

  const makeLogger = (level: LogLevel) =>
    (message: string, data?: Record<string, unknown>) => {
      // Always call the configured logger
      if (data !== undefined) {
        logger[level](message, data)
      } else {
        logger[level](message)
      }
      // Also call transport-specific sink (e.g. MCP notification)
      if (onLog) {
        onLog(level, message, data)
      }
    }

  return {
    meta,
    params,
    log: {
      debug: makeLogger('debug'),
      info: makeLogger('info'),
      warn: makeLogger('warn'),
      error: makeLogger('error'),
    },
    reportProgress: (progress: number, total?: number) => {
      if (onProgress) {
        onProgress(progress, total)
      }
    },
    state,
    response: { headers: {} },
    signal: options.signal,
  }
}
