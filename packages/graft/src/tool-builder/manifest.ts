import type { AuthResult, ToolDefinition } from '../types.js'
import type { Exposure, InternalTool } from '../registry.js'

/** Resolve the expose option into MCP and HTTP booleans. */
export function resolveExposure(
  expose?: Exposure,
  defaultExpose: 'both' | 'mcp' = 'both',
): { exposeMcp: boolean; exposeHttp: boolean } {
  const effective = expose ?? defaultExpose
  return {
    exposeMcp: effective !== 'http',
    exposeHttp: effective !== 'mcp',
  }
}

/** Convert an internal runtime tool back into its serializable manifest form. */
export function toDefinition<TAuth extends AuthResult = AuthResult>(tool: InternalTool<TAuth>): ToolDefinition {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    method: tool.httpMethod,
    path: tool.httpPath,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    sideEffects: tool.sideEffects,
    examples: tool.examples,
    tags: tool.tags,
    auth: tool.auth,
    parameterLocations: tool.parameterLocations,
    deprecated: tool.deprecated,
    annotations: tool.annotations,
  }
}
