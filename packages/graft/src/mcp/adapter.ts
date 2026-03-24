import type { AuthResult, Logger } from '../types.js'
import { isPlainRecord } from '../object-schema.js'
import { generateAgentJson } from './agent-json.js'
import { buildMethodHandlers } from './handlers.js'
import { isSupportedMcpProtocolVersion } from './protocol-version.js'
import {
  type BuildMethodHandlersResult,
  type McpAdapter,
  type McpAdapterOptions,
  type McpHandlerOptions,
  type McpMethodHandler,
  type McpServerData,
} from './shared.js'
import { buildCollisionMaps } from './adapter-manifest.js'
import { createStdioController } from './adapter-stdio.js'
import { handleJsonRpc, readJsonRpcBody } from './transport.js'
import { GRAFT_VERSION } from '../version.js'

function getJsonRpcMethod(body: unknown): string | undefined {
  if (!isPlainRecord(body)) return undefined
  const method = body.method
  return typeof method === 'string' ? method : undefined
}

function createInitPromise(
  configureServer: McpAdapterOptions['configureServer'],
  state: BuildMethodHandlersResult,
  manifest: McpServerData['manifest'],
): Promise<BuildMethodHandlersResult> {
  if (!configureServer) return Promise.resolve(state)

  const hookContext = {
    setHandler(method: string, handler: McpMethodHandler) {
      state.handlers.set(method, handler)
    },
    addCapabilities(extraCapabilities: Record<string, unknown>) {
      Object.assign(state.capabilities, extraCapabilities)
    },
    manifest,
  }

  return Promise.resolve(configureServer(hookContext)).then(() => state)
}

function createAgentJsonHandler(options: {
  manifest: McpServerData['manifest']
  mcpPath: string
  serverName: string
  serverDescription?: string
}): (baseUrl: string) => Response {
  return (baseUrl: string) => Response.json(
    generateAgentJson(options.manifest, {
      url: baseUrl,
      name: options.serverName,
      description: options.serverDescription,
      mcpPath: options.mcpPath,
    }),
  )
}

function createMcpHttpHandler(options: {
  initializedState: Promise<BuildMethodHandlersResult>
  allowedOrigins?: string[]
  logger?: Logger
}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const state = await options.initializedState

    if (request.method === 'GET' || request.method === 'DELETE') {
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    }

    if (options.allowedOrigins) {
      const origin = request.headers.get('origin')
      if (origin && !options.allowedOrigins.includes(origin)) {
        return Response.json({ error: 'Origin not allowed' }, { status: 403 })
      }
    }

    const bodyOrResponse = await readJsonRpcBody(request)
    if (bodyOrResponse instanceof Response) return bodyOrResponse
    const body = bodyOrResponse

    const isInitialize = getJsonRpcMethod(body) === 'initialize'
    if (!isInitialize) {
      const versionHeader = request.headers.get('mcp-protocol-version')
      if (versionHeader && !isSupportedMcpProtocolVersion(versionHeader)) {
        return Response.json(
          {
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Unsupported MCP protocol version' },
            id: null,
          },
          { status: 200 },
        )
      }
    }

    return handleJsonRpc(state.handlers, request, body, options.logger)
  }
}

/**
 * Create an MCP adapter that exposes the manifest over HTTP JSON-RPC, SSE, and stdio.
 *
 * @param options Transport, auth, discovery, and manifest configuration.
 * @returns An adapter with HTTP handlers, stdio integration, and graceful shutdown.
 * @throws {Error} When `configureServer` fails during initialization.
 * @example
 * const adapter = createMcpAdapter({ tools, pipeline })
 * const response = await adapter.handleMcp(request)
 */
export function createMcpAdapter<TAuth extends AuthResult = AuthResult>(
  options: McpAdapterOptions<TAuth>,
): McpAdapter {
  const {
    pipeline,
    serverName = 'graft',
    serverVersion = GRAFT_VERSION,
    serverDescription,
    allowedOrigins,
    mcpPath = '/mcp',
    configureServer,
    transformToolDefinition,
    transformToolResult,
    resourceHandler,
    resourceAuth,
    resourceTemplateAuth,
    promptHandler,
    authenticate,
    authorize,
    logger,
  } = options

  const { toolMap, manifest, promptMap } = buildCollisionMaps(options)
  const data: McpServerData = { manifest, toolMap, promptMap }
  const mcpOptions: McpHandlerOptions<TAuth> = {
    serverName,
    serverVersion,
    transformToolDefinition,
    transformToolResult,
    resourceHandler,
    promptHandler,
    authenticate,
    authorize,
    resourceAuth,
    resourceTemplateAuth,
    logger,
  }
  const serverInfo = { name: serverName, version: serverVersion }
  const state = buildMethodHandlers(data, pipeline, mcpOptions, serverInfo)

  const initializedState = createInitPromise(configureServer, state, manifest)
  const handleAgentJson = createAgentJsonHandler({
    manifest,
    mcpPath,
    serverName,
    serverDescription,
  })
  const handleMcp = createMcpHttpHandler({
    initializedState,
    allowedOrigins,
    logger,
  })
  const stdio = createStdioController({
    initializedState,
    toolCount: toolMap.size,
    logger,
    serverName,
    serverVersion,
  })

  return {
    handleMcp,
    handleAgentJson,
    connectStdio: stdio.connect,
    close: stdio.close,
    getManifest: () => manifest,
    sendToolListChanged: stdio.sendToolListChanged,
    sendResourceListChanged: stdio.sendResourceListChanged,
    sendPromptListChanged: stdio.sendPromptListChanged,
  }
}
