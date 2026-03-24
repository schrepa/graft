import type {
  AuthResult,
  Manifest,
  McpToolDefinition,
  ToolMeta,
} from '../../types.js'
import { filterByAuth } from '../../auth.js'
import type { ToolPipeline } from '../../pipeline/types.js'
import { resolveAnnotations } from '../annotations.js'
import { SUPPORTED_MCP_PROTOCOL_VERSIONS } from '../protocol-version.js'
import {
  asCallToolParams,
  asInitializeParams,
  type McpHandlerOptions,
  type McpMethodContext,
  type McpMethodHandler,
  type McpServerData,
} from '../shared.js'
import { dispatchToolCall, mcpError, type FormatContext } from '../results.js'

function buildToolListMeta(tool: Manifest['tools'][number]): ToolMeta {
  return {
    kind: 'tool',
    name: tool.name,
    tags: tool.tags,
    auth: tool.auth,
    sideEffects: tool.sideEffects,
  }
}

async function handleToolsList<TAuth extends AuthResult = AuthResult>(
  manifest: Manifest,
  options: McpHandlerOptions<TAuth>,
  ctx: McpMethodContext,
): Promise<{ tools: McpToolDefinition[] }> {
  let tools = manifest.tools
  const authorize = options.authorize

  if (options.authenticate) {
    tools = await filterByAuth(tools, (tool) => tool.auth, {
      headers: ctx.headers,
      authenticate: options.authenticate,
      authorize: authorize
        ? (tool, authResult) =>
            authorize(buildToolListMeta(tool), authResult, { phase: 'list' })
        : undefined,
    })
  }

  const baseDefs: McpToolDefinition[] = tools.map((tool) => {
    const definition: McpToolDefinition = {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        ...tool.inputSchema,
        type: 'object' as const,
        properties: tool.inputSchema?.properties ?? {},
      },
      annotations: resolveAnnotations(tool),
    }

    if (tool.title) definition.title = tool.title
    if (tool.outputSchema) definition.outputSchema = { type: 'object', ...tool.outputSchema }
    if (tool.parameterLocations && Object.keys(tool.parameterLocations).length > 0) {
      definition.parameterLocations = tool.parameterLocations
    }

    return definition
  })

  if (!options.transformToolDefinition) {
    return { tools: baseDefs }
  }

  const transformed: McpToolDefinition[] = []
  for (const [index, definition] of baseDefs.entries()) {
    transformed.push(
      await options.transformToolDefinition(definition, { tool: tools[index] }),
    )
  }
  return { tools: transformed }
}

/** Check whether the manifest exposes any MCP resources. */
export function supportsResources(manifest: Manifest): boolean {
  return manifest.resources.length > 0 || manifest.resourceTemplates.length > 0
}

/** Check whether the manifest exposes any MCP prompts. */
export function supportsPrompts(manifest: Manifest): boolean {
  return manifest.prompts.length > 0
}

/** Build the MCP initialize capabilities block for the current manifest. */
export function buildCapabilities(manifest: Manifest): Record<string, unknown> {
  return {
    tools: {},
    ...(supportsResources(manifest) ? { resources: {} } : {}),
    ...(supportsPrompts(manifest) ? { prompts: {} } : {}),
    logging: {},
  }
}

/** Register the core MCP method handlers on the shared handler map. */
export function registerCoreHandlers<TAuth extends AuthResult = AuthResult>(
  handlers: Map<string, McpMethodHandler>,
  data: McpServerData,
  pipeline: ToolPipeline,
  options: McpHandlerOptions<TAuth>,
  serverInfo: { name: string; version: string },
  capabilities: Record<string, unknown>,
): void {
  handlers.set('initialize', async (params) => {
    const { protocolVersion: clientVersion } = asInitializeParams(params)
    const negotiated =
      SUPPORTED_MCP_PROTOCOL_VERSIONS.find((version) => version <= clientVersion)
      ?? SUPPORTED_MCP_PROTOCOL_VERSIONS[SUPPORTED_MCP_PROTOCOL_VERSIONS.length - 1]

    return {
      protocolVersion: negotiated,
      capabilities,
      serverInfo,
    }
  })

  handlers.set('notifications/initialized', async () => undefined)
  handlers.set('ping', async () => ({}))
  handlers.set('logging/setLevel', async () => ({}))
  handlers.set('tools/list', async (_params, ctx) => handleToolsList(data.manifest, options, ctx))

  const formatContext: FormatContext = {
    toolMap: data.toolMap,
    transformToolResult: options.transformToolResult,
  }

  handlers.set('tools/call', async (params, ctx) => {
    const { name: toolName, arguments: args = {} } = asCallToolParams(params)

    if (!data.toolMap.has(toolName)) {
      return mcpError('NOT_FOUND', { message: `Unknown tool: ${toolName}` })
    }

    return dispatchToolCall(toolName, args, pipeline, formatContext, {
      headers: ctx.headers,
      signal: ctx.signal,
      contextIngredients: ctx.contextIngredients,
    })
  })
}
