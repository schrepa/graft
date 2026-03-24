import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { Logger } from '../types.js'
import { DEFAULT_MAX_BODY_SIZE, DEFAULT_SHUTDOWN_TIMEOUT_MS } from './constants.js'
import { createNodeRequestHandler, writeJsonResponse } from './request-handler.js'
import type { CleanupFn, ServerHandle, ServerOptions } from './types.js'

interface ServerState {
  inFlight: number
  draining: boolean
  shutdownPromise?: Promise<void>
}

async function runHook(
  hook: (() => void | Promise<void>) | undefined,
  label: string,
): Promise<void> {
  if (!hook) return
  try {
    await hook()
  } catch (err) {
    throw new Error(
      `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
}

async function bestEffort(
  logger: Logger,
  label: string,
  work: (() => void | Promise<void>) | undefined,
  level: 'warn' | 'error' = 'warn',
): Promise<void> {
  if (!work) return
  try {
    await work()
  } catch (error) {
    logger[level](`[graft] ${label} failed:`, error)
  }
}

function createRequestListener(
  state: ServerState,
  options: {
    port: number
    maxBodySize: number
    fetchHandler: (request: Request) => Promise<Response>
    requestAbortSignal: AbortSignal
    logger: Logger
  },
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const handleNodeRequest = createNodeRequestHandler({
    port: options.port,
    maxBodySize: options.maxBodySize,
    shutdownSignal: options.requestAbortSignal,
    fetch: options.fetchHandler,
    logger: options.logger,
  })

  return async (req, res) => {
    if (state.draining) {
      writeJsonResponse(res, 503, { error: 'Server is shutting down' })
      return
    }

    state.inFlight++
    try {
      await handleNodeRequest(req, res)
    } finally {
      state.inFlight--
    }
  }
}

async function resolveHttpServerCleanup(
  configureHttpServer: ServerOptions['configureHttpServer'],
  server: Server,
  shutdownSignal: AbortSignal,
): Promise<CleanupFn | undefined> {
  if (!configureHttpServer) return undefined
  try {
    const result = await configureHttpServer(server, shutdownSignal)
    return typeof result === 'function' ? result : undefined
  } catch (err) {
    throw new Error(
      `configureHttpServer hook failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
}

function createServerClosedPromise(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
}

async function cleanupHttpServer(
  logger: Logger,
  httpServerCleanup?: CleanupFn,
): Promise<void> {
  await bestEffort(
    logger,
    'configureHttpServer cleanup',
    httpServerCleanup ? () => httpServerCleanup() : undefined,
    'error',
  )
}

async function finalizeServerResources(
  logger: Logger,
  onShutdown: (() => void | Promise<void>) | undefined,
  mcp: ServerOptions['mcp'],
): Promise<void> {
  await bestEffort(logger, 'onShutdown hook', onShutdown)
  await bestEffort(logger, 'mcp.close()', () => mcp.close())
}

function registerProcessSignalHandlers(
  installSignalHandlers: boolean,
  shutdown: () => Promise<void>,
  logger: Logger,
): () => void {
  if (!installSignalHandlers) return () => {}

  const onSignal = () => {
    shutdown().catch((error) => logger.error('[graft] Shutdown error:', error))
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  return () => {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}

function logServerStarted(
  logger: Logger,
  host: string,
  port: number,
  mcp: ServerOptions['mcp'],
): void {
  logger.info('')
  logger.info(`  Graft listening on http://${host}:${port}`)
  logger.info(`  MCP endpoint:  POST http://${host}:${port}/mcp`)
  logger.info(`  Discovery:     GET  http://${host}:${port}/.well-known/agent.json`)
  const manifest = mcp.getManifest()
  logger.info(`  Tools:         ${manifest.tools.length} registered`)
  if (manifest.resources.length > 0 || manifest.resourceTemplates.length > 0) {
    logger.info(`  Resources:     ${manifest.resources.length} registered`)
  }
  if (manifest.prompts.length > 0) {
    logger.info(`  Prompts:       ${manifest.prompts.length} registered`)
  }
  logger.info('')
  logger.info('  Run `graft studio` to browse and test tools.')
  logger.info('')
}

async function drainInFlightRequests(
  inFlight: () => number,
  shutdownTimeout: number,
): Promise<boolean> {
  const deadline = Date.now() + shutdownTimeout
  while (inFlight() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return inFlight() === 0
}

/**
 * Start a standalone Node.js HTTP server around a Web Standard fetch handler.
 *
 * @param options Server configuration, lifecycle hooks, and transport settings.
 * @returns A handle that exposes the underlying server and graceful shutdown controls.
 * @throws {Error} When startup hooks fail or the server cannot begin listening.
 * @example
 * const handle = await startServer({ mcp, fetch: app.toFetch(), port: 3000 })
 * await handle.close()
 */
export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const {
    mcp,
    port = 3001,
    host = '127.0.0.1',
    fetch: fetchHandler,
    installSignalHandlers = true,
    maxBodySize = DEFAULT_MAX_BODY_SIZE,
    shutdownTimeoutMs = options.shutdownTimeoutMs ?? options.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    logger = console,
  } = options

  const state: ServerState = { inFlight: 0, draining: false }
  const shutdownController = new AbortController()
  const requestAbortController = new AbortController()
  const server = createServer(createRequestListener(state, {
    port,
    maxBodySize,
    fetchHandler,
    requestAbortSignal: requestAbortController.signal,
    logger,
  }))

  let httpServerCleanup: CleanupFn | undefined
  try {
    await runHook(options.onStart, 'onStart hook')
    httpServerCleanup = await resolveHttpServerCleanup(
      options.configureHttpServer,
      server,
      shutdownController.signal,
    )
  } catch (error) {
    await cleanupHttpServer(logger, httpServerCleanup)
    await finalizeServerResources(
      logger,
      options.onShutdown,
      mcp,
    )
    throw error
  }

  const shutdown = (): Promise<void> => {
    if (state.shutdownPromise) return state.shutdownPromise

    state.shutdownPromise = (async () => {
      state.draining = true
      detachSignalHandlers()

      const serverClosed = createServerClosedPromise(server)
      server.closeIdleConnections()

      shutdownController.abort()

      const drained = await drainInFlightRequests(
        () => state.inFlight,
        shutdownTimeoutMs,
      )
      if (!drained) {
        logger.warn(`[graft] Shutdown timeout: force-closing ${state.inFlight} connection(s)`)
        requestAbortController.abort()
        server.closeAllConnections()
      }

      await serverClosed
      await cleanupHttpServer(logger, httpServerCleanup)
      await finalizeServerResources(
        logger,
        options.onShutdown,
        mcp,
      )
    })()

    return state.shutdownPromise
  }
  const detachSignalHandlers = registerProcessSignalHandlers(
    installSignalHandlers,
    shutdown,
    logger,
  )

  return new Promise<ServerHandle>((resolve, reject) => {
    const onListenError = async (err: Error) => {
      detachSignalHandlers()
      shutdownController.abort()
      await cleanupHttpServer(logger, httpServerCleanup)
      await finalizeServerResources(
        logger,
        options.onShutdown,
        mcp,
      )
      reject(err)
    }

    server.once('error', onListenError)
    server.listen({ port, host }, () => {
      server.removeListener('error', onListenError)
      const address = server.address()
      const boundPort = typeof address === 'object' && address ? address.port : port
      logServerStarted(logger, host, boundPort, mcp)
      resolve({
        server,
        shutdownSignal: shutdownController.signal,
        close: shutdown,
      })
    })
  })
}
