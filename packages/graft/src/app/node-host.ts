import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DiscoveryOptions } from '../discovery.js'
import type { DiscoveryCache } from '../http/discovery-cache.js'
import { createDiscoveryCache } from '../http/discovery-cache.js'
import type { ServeOptions, ServerHandle } from '../server/types.js'
import type { Logger } from '../types.js'
import { Collector } from '../telemetry/collector.js'
import type { BuildAppResult } from './build.js'
import { preloadDiscoveryFiles } from '../http/mount-routes.js'
import { createNodeRequestHandler } from '../server/request-handler.js'

async function startBuiltAppServer(
  built: BuildAppResult,
  options: ServeOptions,
): Promise<NodeHostServeResult> {
  const collector = new Collector()
  collector.start()

  const { startServer } = await import('../server/lifecycle.js')
  const { onShutdown, port = 3000, ...serverOptions } = options
  try {
    const handle = await startServer({
      ...serverOptions,
      mcp: built.mcp,
      fetch: built.fetch,
      port,
      onShutdown: async () => {
        collector.stop()
        await onShutdown?.()
      },
    })

    return { handle, collector }
  } catch (error) {
    collector.stop()
    throw error
  }
}

/**
 * Options for the Node.js request handler returned by `NodeHost.toNodeHandler()`.
 */
export interface NodeHostHandlerOptions {
  maxBodySize?: number
}

/**
 * Options for constructing a reusable Node.js transport adapter around a built app.
 */
export interface CreateNodeHostOptions {
  build: () => BuildAppResult
  discovery?: DiscoveryOptions
  discoveryCache?: DiscoveryCache
  onStart?: () => void | Promise<void>
  onShutdown?: () => void | Promise<void>
  logger?: Logger
}

/**
 * Result returned by `NodeHost.serve()`.
 */
export interface NodeHostServeResult {
  handle: ServerHandle
  collector: Collector
}

/**
 * Node.js transport adapter for a built app.
 */
export interface NodeHost {
  toNodeHandler(
    options?: NodeHostHandlerOptions,
  ): (req: IncomingMessage, res: ServerResponse) => void
  serve(options?: ServeOptions): Promise<NodeHostServeResult>
}

/**
 * Create a reusable Node.js transport adapter for a built app.
 *
 * @param options Build callback plus discovery and lifecycle defaults.
 * @returns A Node transport with request-handler and standalone-server helpers.
 * @example
 * const host = createNodeHost({ build: () => app.build() })
 * const server = http.createServer(host.toNodeHandler())
 */
export function createNodeHost(options: CreateNodeHostOptions): NodeHost {
  const discoveryCache = options.discoveryCache ?? createDiscoveryCache()

  return {
    toNodeHandler(handlerOptions = {}) {
      const { fetch } = options.build()
      const handleNodeRequest = createNodeRequestHandler({
        fetch,
        maxBodySize: handlerOptions.maxBodySize,
        logger: options.logger,
      })

      return (req, res) => {
        handleNodeRequest(req, res).catch((error) => {
          options.logger?.error?.('[graft] Unhandled node request error:', error)

          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
            return
          }

          res.end()
        })
      }
    },

    async serve(serveOptions = {}) {
      await preloadDiscoveryFiles(options.discovery, discoveryCache)
      return startBuiltAppServer(options.build(), {
        ...serveOptions,
        onStart: serveOptions.onStart ?? options.onStart,
        onShutdown: serveOptions.onShutdown ?? options.onShutdown,
        logger: serveOptions.logger ?? options.logger,
      })
    },
  }
}
