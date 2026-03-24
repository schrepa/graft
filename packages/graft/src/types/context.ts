import type { AuthResult, ToolMeta } from './auth.js'

/** Log levels for structured logging via the context object */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Transport-specific callbacks injected into a dispatch or MCP handler context. */
export interface ContextIngredients {
  onLog?: (level: LogLevel, message: string, data?: Record<string, unknown>) => void
  onProgress?: (progress: number, total?: number) => void
}

/** Console-compatible logger interface. Pass a custom implementation to AppOptions. */
export interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

/** Metadata about the current request */
export interface RequestMeta<TAuth extends AuthResult = AuthResult> {
  /** Unique request/call ID (from MCP request or generated) */
  requestId: string
  /** Transport type: 'http' | 'mcp' | 'stdio' */
  transport: 'http' | 'mcp' | 'stdio'
  /** The tool being called */
  toolName: string
  /** Authenticated user info (populated by authenticate hook) */
  auth?: TAuth
  /** Forwarded request headers (from MCP transport or HTTP request) */
  headers?: Record<string, string>
  /** Tool definition metadata — populated by the pipeline before middleware runs */
  tool?: ToolMeta
}

/** Mutable response context — middleware can set headers and override status */
export interface ResponseContext {
  /** Response headers to merge into the HTTP response */
  headers: Record<string, string>
  /** Override the default 200 status (only applied on success) */
  status?: number
}

/** Context object injected into tool/resource/prompt handlers */
export interface ToolContext<TAuth extends AuthResult = AuthResult> {
  /** Request metadata */
  meta: RequestMeta<TAuth>
  /** Parsed tool parameters — available to middleware before the handler runs */
  params: Record<string, unknown>
  /** Structured logging — messages are collected and can be forwarded to the client */
  log: {
    debug: (message: string, data?: Record<string, unknown>) => void
    info: (message: string, data?: Record<string, unknown>) => void
    warn: (message: string, data?: Record<string, unknown>) => void
    error: (message: string, data?: Record<string, unknown>) => void
  }
  /** Report progress for long-running operations (0..total) */
  reportProgress: (progress: number, total?: number) => void
  /** Mutable key-value bag for middleware → handler data passing */
  state: Record<PropertyKey, unknown>
  /** Mutable response context — middleware can set headers, override status */
  response: ResponseContext
  /** AbortSignal — fires when the caller disconnects or cancels.
   *  Handlers should check this and abort long-running work. */
  signal?: AbortSignal
}
