import type { Manifest } from '../types.js'

/** Options for generating `/.well-known/agent.json`.
 *
 * @param name Optional server name override.
 * @param description Optional server description override.
 * @param url Public base URL of the deployed server.
 * @param mcpPath Optional MCP path appended to `url`. Defaults to `/mcp`.
 */
export interface AgentJsonOptions {
  name?: string
  description?: string
  url: string
  mcpPath?: string
}

type AgentJsonTool = Omit<
  Manifest['tools'][number],
  'parameterLocations' | 'annotations'
>

/** Public shape of the generated `agent.json` discovery document. */
export interface AgentJsonDocument {
  $schema: string
  schemaVersion: string
  name: string
  description: string
  url: string
  capabilities: {
    mcp: {
      url: string
      transport: 'streamable-http'
    }
  }
  tools: AgentJsonTool[]
  resources?: Manifest['resources']
  prompts?: Manifest['prompts']
}

/**
 * Generate a `.well-known/agent.json` discovery document.
 *
 * @param manifest Frozen manifest describing the registered tools, resources, and prompts.
 * @param options Public URL and optional presentation overrides for the generated document.
 * @returns A discovery document ready to serialize as JSON.
 */
export function generateAgentJson(
  manifest: Manifest,
  options: AgentJsonOptions,
): AgentJsonDocument {
  const mcpPath = options.mcpPath ?? '/mcp'
  const baseUrl = options.url.replace(/\/$/, '')

  const tools: AgentJsonTool[] = manifest.tools.map(
    ({ parameterLocations: _parameterLocations, annotations: _annotations, ...tool }) => tool,
  )

  const doc: AgentJsonDocument = {
    $schema: 'https://opentools.com/schema/agent.json',
    schemaVersion: '0.1.0',
    name: options.name ?? 'Graft Server',
    description: options.description ?? `API server with ${tools.length} tool(s) available via MCP`,
    url: baseUrl,
    capabilities: {
      mcp: {
        url: `${baseUrl}${mcpPath}`,
        transport: 'streamable-http',
      },
    },
    tools,
  }

  if (manifest.resources.length > 0) {
    doc.resources = manifest.resources
  }

  if (manifest.prompts.length > 0) {
    doc.prompts = manifest.prompts
  }

  return doc
}
