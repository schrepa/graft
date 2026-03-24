/**
 * MCP Server Card generator — /.well-known/mcp.json
 * Pure function over the frozen Manifest.
 */

import type { Manifest } from './types.js'
import { CURRENT_MCP_PROTOCOL_VERSION } from './mcp/protocol-version.js'
import { GRAFT_VERSION } from './version.js'

/**
 * Inputs for generating an MCP server card document.
 */
export interface McpCardOptions {
  name?: string
  version?: string
  description?: string
  baseUrl: string
  mcpPath?: string
  manifest: Manifest
}

/**
 * Shape of the generated `/.well-known/mcp.json` server card.
 */
export interface McpCardDocument {
  mcp_version: string
  server_name: string
  server_version: string
  description?: string
  endpoints: {
    streamable_http: {
      url: string
    }
  }
  capabilities: {
    tools: boolean
    resources: boolean
    prompts: boolean
  }
}

/**
 * Generate the `/.well-known/mcp.json` document for a built app.
 *
 * @param options Public server metadata and manifest snapshot.
 * @returns A JSON-serializable MCP server card.
 * @example
 * generateMcpCard({ baseUrl: 'https://api.example.com', manifest })
 */
export function generateMcpCard(options: McpCardOptions): McpCardDocument {
  const {
    name = 'graft',
    version = GRAFT_VERSION,
    description,
    baseUrl,
    mcpPath = '/mcp',
    manifest,
  } = options

  const base = baseUrl.replace(/\/$/, '')

  return {
    mcp_version: CURRENT_MCP_PROTOCOL_VERSION,
    server_name: name,
    server_version: version,
    ...(description ? { description } : {}),
    endpoints: {
      streamable_http: { url: `${base}${mcpPath}` },
    },
    capabilities: {
      tools: manifest.tools.length > 0,
      resources: manifest.resources.length > 0 || manifest.resourceTemplates.length > 0,
      prompts: manifest.prompts.length > 0,
    },
  }
}
