import { deriveSideEffects, deriveToolName } from '../../derivation.js'
import { parseHttpMethod } from '../../http-method.js'
import type { ToolDefinition } from '../../types.js'
import { extractPathParams, mergePathParams } from '../schema.js'
import type { ProxyConfig } from './shared.js'

/**
 * Convert a `ProxyConfig` into serializable tool definitions for registration.
 *
 * @param config Parsed proxy config document.
 * @returns Tool definitions ready for runtime registration.
 */
export function configToToolDefinitions(config: ProxyConfig): ToolDefinition[] {
  return config.tools.map((tool): ToolDefinition => {
    const method = parseHttpMethod(tool.method, `Tool "${tool.name ?? tool.path}" method`)
    const baseSchema = tool.parameters ?? null
    const inputSchema = mergePathParams(baseSchema, extractPathParams(tool.path))

    return {
      name: tool.name ?? deriveToolName(method, tool.path),
      description: tool.description,
      method,
      path: tool.path,
      inputSchema,
      outputSchema: tool.outputSchema,
      sideEffects: deriveSideEffects(method),
      examples: tool.examples ?? [],
      tags: tool.tags ?? [],
      auth: tool.auth,
      parameterLocations: tool.parameterLocations,
    }
  })
}
