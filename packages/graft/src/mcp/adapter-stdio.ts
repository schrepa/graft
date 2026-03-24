import type { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js'
import type {
  Logger,
} from '../types.js'
import {
  type BuildMethodHandlersResult,
} from './shared.js'
import {
  installStdioSignalHandlers,
  registerBuiltInHandlers,
  registerCustomRequestHandlers,
  sendNotification,
} from './adapter-stdio-helpers.js'

interface StdioController {
  connect(): Promise<void>
  close(): Promise<void>
  sendToolListChanged(): Promise<void>
  sendResourceListChanged(): Promise<void>
  sendPromptListChanged(): Promise<void>
}

/**
 * Create the stdio-side MCP transport controller for a configured adapter.
 *
 * @param options Shared handlers, initialized capabilities, and runtime metadata for stdio wiring.
 * @returns Lifecycle controls for connecting, closing, and emitting list-changed notifications.
 */
export function createStdioController(options: {
  initializedState: Promise<BuildMethodHandlersResult>
  toolCount: number
  logger?: Logger
  serverName: string
  serverVersion: string
}): StdioController {
  let stdioServer: McpSdkServer | null = null
  let detachStdioSignalHandlers = () => {}

  async function cleanupStdio(): Promise<void> {
    detachStdioSignalHandlers()
    detachStdioSignalHandlers = () => {}

    if (stdioServer) {
      await stdioServer.close()
      stdioServer = null
    }

    process.stdin.unref?.()
  }

  async function connect(): Promise<void> {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js')
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
    const schemas = await import('@modelcontextprotocol/sdk/types.js')
    const state = await options.initializedState

    const stdioLogger: Logger = options.logger ?? console
    const log = (message: string, ...args: unknown[]) =>
      stdioLogger.info(`[${options.serverName}] ${message}`, ...args)
    log(`Registered ${options.toolCount} tool(s) for stdio transport`)

    const server = new Server(
      { name: options.serverName, version: options.serverVersion },
      { capabilities: state.capabilities },
    )

    registerBuiltInHandlers(server, schemas, state.handlers, stdioLogger, options.serverName)
    registerCustomRequestHandlers(server, state.handlers, stdioLogger, options.serverName)

    stdioServer = server
    const transport = new StdioServerTransport()
    await stdioServer.connect(transport)
    log('Stdio MCP transport ready — waiting for client messages on stdin')
    detachStdioSignalHandlers = installStdioSignalHandlers(cleanupStdio, stdioLogger, options.serverName)
  }

  return {
    connect,
    close: cleanupStdio,
    async sendToolListChanged() {
      await sendNotification(stdioServer, 'notifications/tools/list_changed')
    },
    async sendResourceListChanged() {
      await sendNotification(stdioServer, 'notifications/resources/list_changed')
    },
    async sendPromptListChanged() {
      await sendNotification(stdioServer, 'notifications/prompts/list_changed')
    },
  }
}
