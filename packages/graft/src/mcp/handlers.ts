import type { AuthResult } from '../types.js'
import type { ToolPipeline } from '../pipeline/types.js'
import {
  type BuildMethodHandlersResult,
  type McpHandlerOptions,
  type McpMethodHandler,
  type McpServerData,
} from './shared.js'
import { buildCapabilities, registerCoreHandlers, supportsPrompts, supportsResources } from './handlers/core.js'
import { registerPromptHandlers } from './handlers/prompts.js'
import { registerResourceHandlers } from './handlers/resources.js'

/**
 * Build the MCP method handler table shared by HTTP JSON-RPC and stdio transports.
 *
 * @param data Manifest and lookup tables used to service MCP methods.
 * @param pipeline Tool execution pipeline for `tools/call`.
 * @param options Auth, transform, and resource/prompt hooks.
 * @param serverInfo Server metadata returned by `initialize`.
 * @returns The handler map plus derived MCP capabilities.
 * @throws {GraftError} When required params are missing or malformed.
 */
export function buildMethodHandlers<TAuth extends AuthResult = AuthResult>(
  data: McpServerData,
  pipeline: ToolPipeline,
  options: McpHandlerOptions<TAuth>,
  serverInfo: { name: string; version: string },
): BuildMethodHandlersResult {
  const handlers = new Map<string, McpMethodHandler>()
  const capabilities = buildCapabilities(data.manifest)

  registerCoreHandlers(handlers, data, pipeline, options, serverInfo, capabilities)

  if (supportsResources(data.manifest)) {
    registerResourceHandlers(handlers, data.manifest, options)
  }

  if (supportsPrompts(data.manifest)) {
    registerPromptHandlers(handlers, data, options)
  }

  return { handlers, capabilities }
}
