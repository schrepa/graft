import type { Server } from 'node:http'
import type { McpAdapter } from '../mcp/shared.js'
import type { Logger } from '../types.js'

/** Cleanup callback returned by server configuration hooks. */
export type CleanupFn = () => void | Promise<void>

/**
 * Options for running a standalone Node.js HTTP server around a built app.
 *
 * Use this when you want Graft to own the Node listener lifecycle, signal
 * handling, and graceful shutdown behavior for a built app fetch handler.
 */
export interface ServerOptions {
  mcp: McpAdapter
  port?: number
  /** Interface to bind. Default: 127.0.0.1. Use 0.0.0.0 for external access. */
  host?: string
  /** Web Standard fetch handler — all requests go through this handler */
  fetch: (request: Request) => Promise<Response>
  /** Called before the server starts listening */
  onStart?: () => void | Promise<void>
  /** Called when the server is shutting down */
  onShutdown?: () => void | Promise<void>
  /** Install process-level SIGINT/SIGTERM handlers. Default: true. Disable in embedded hosts. */
  installSignalHandlers?: boolean
  /** Called after server creation and onStart, before listen.
   *  Use to attach upgrade handlers (e.g. WebSocket), custom listeners, etc.
   *  Resources initialized in onStart (DB pools, caches) are available.
   *  Node-only — only applies to app.serve().
   *
   *  Optionally return a cleanup function — it will be awaited during shutdown,
   *  making handle.close() wait for WebSocket cleanup to finish. */
  configureHttpServer?: (
    server: Server,
    shutdownSignal: AbortSignal,
  ) => void | CleanupFn | Promise<void | CleanupFn>
  /** Max request body size in bytes. Default: 1MB (1_048_576). */
  maxBodySize?: number
  /** Milliseconds to wait for in-flight requests to complete during shutdown. Default: 10_000. */
  shutdownTimeoutMs?: number
  /** @deprecated Use shutdownTimeoutMs. Milliseconds to wait for in-flight requests during shutdown. */
  shutdownTimeout?: number
  /** Custom logger. Default: console. */
  logger?: Logger
}

/**
 * Standalone server options accepted by high-level app helpers.
 *
 * This is the public subset of `ServerOptions` that callers can control when
 * Graft provides the MCP adapter and fetch handler internally.
 */
export type ServeOptions = Omit<ServerOptions, 'mcp' | 'fetch'>

/**
 * Handle returned by `startServer()` for graceful shutdown and low-level access.
 *
 * The handle exposes the underlying Node server for advanced integrations while
 * still providing a single `close()` entrypoint for orderly shutdown.
 */
export interface ServerHandle {
  /** The underlying Node.js HTTP server */
  server: Server
  /** Fires when the server begins graceful shutdown */
  shutdownSignal: AbortSignal
  /** Trigger graceful shutdown — resolves when shutdown is complete */
  close: () => Promise<void>
}

/**
 * Shared Node.js request-handler options for adapters that bridge to the web `fetch` handler.
 *
 * Prefer this when embedding Graft inside an existing Node server instead of
 * letting `startServer()` create and manage the listener for you.
 */
export interface NodeRequestHandlerOptions {
  /** Web Standard fetch handler — all requests go through this handler. */
  fetch: (request: Request) => Promise<Response>
  /** Port used when synthesizing fallback hosts for incoming requests. */
  port?: number
  /** Max request body size in bytes. Defaults to 1MB. */
  maxBodySize?: number
  /** Optional abort signal for actively served requests during shutdown. */
  shutdownSignal?: AbortSignal
  /** Custom logger. Defaults to `console`. */
  logger?: Logger
}
