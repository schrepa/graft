import type { Manifest } from './types.js'
import type { AgentJsonDocument } from './mcp/agent-json.js'
import type { McpCardDocument } from './mcp-card.js'
import type { OpenApiDocument } from './openapi-gen.js'

/**
 * Per-endpoint override for discovery routes.
 *
 * - `undefined` uses the built-in generator.
 * - `false` disables the endpoint.
 * - `string` serves static file content from the given path.
 * - `function` generates content from the frozen manifest.
 */
export type DiscoveryEndpoint<T = string> =
  | false
  | string
  | ((manifest: Manifest) => T)

/**
 * Options for the auto-served discovery endpoints mounted by Graft.
 */
export interface DiscoveryOptions {
  /** GET `/openapi.json` */
  openapi?: DiscoveryEndpoint<OpenApiDocument>
  /** GET `/.well-known/agent.json` */
  agentJson?: DiscoveryEndpoint<AgentJsonDocument>
  /** GET `/.well-known/mcp.json` */
  mcpCard?: DiscoveryEndpoint<McpCardDocument>
  /** GET `/llms.txt` */
  llmsTxt?: DiscoveryEndpoint
  /** GET `/llms-full.txt` */
  llmsFullTxt?: DiscoveryEndpoint
  /** GET `/docs` */
  docs?: DiscoveryEndpoint
}
