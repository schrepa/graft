import type {
  AuthResult,
  Manifest,
  PromptDefinition,
  ToolDefinition,
} from '../types.js'
import type { McpAdapterOptions } from './shared.js'

function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj)
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  }
  return obj
}

function buildCheckedMap<T>(
  items: T[],
  keyFn: (item: T) => string,
  errorFn: (key: string, item: T) => string,
): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const key = keyFn(item)
    if (map.has(key)) throw new Error(errorFn(key, item))
    map.set(key, item)
  }
  return map
}

function findCollidingTool(
  tools: ToolDefinition[],
  key: string,
  current: ToolDefinition,
): ToolDefinition {
  const existing = tools.find((tool) => tool.name === key && tool !== current)
  return existing ?? current
}

function toManifestTool(tool: ToolDefinition): ToolDefinition {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    ...(tool.method ? { method: tool.method } : {}),
    ...(tool.path ? { path: tool.path } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    sideEffects: tool.sideEffects,
    examples: [...tool.examples],
    tags: [...tool.tags],
    ...(tool.auth !== undefined ? { auth: tool.auth } : {}),
    ...(tool.parameterLocations ? { parameterLocations: tool.parameterLocations } : {}),
    ...(tool.deprecated !== undefined ? { deprecated: tool.deprecated } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  }
}

/**
 * Build collision-checked lookup maps and the immutable manifest exposed by the MCP adapter.
 *
 * @param options Registered tools, resources, templates, and prompts.
 * @returns Lookup maps plus the frozen manifest used by transport handlers.
 * @throws {Error} When duplicate names or URIs are registered.
 */
export function buildCollisionMaps<TAuth extends AuthResult = AuthResult>(
  options: McpAdapterOptions<TAuth>,
): {
  toolMap: Map<string, ToolDefinition>
  manifest: Manifest
  promptMap: Map<string, PromptDefinition>
} {
  const tools = options.tools.map(toManifestTool)
  const toolMap = buildCheckedMap(
    tools,
    (tool) => tool.name,
    (key, tool) => {
      const existing = findCollidingTool(tools, key, tool)
      return `Tool name collision: "${key}" is registered for both `
        + `${existing.method ?? '?'} ${existing.path ?? '?'} and ${tool.method ?? '?'} ${tool.path ?? '?'}. `
        + `Use tool({ name: '...' }) to provide a unique name.`
    },
  )

  const resourceMap = buildCheckedMap(
    options.resources ?? [],
    (resource) => resource.uri,
    (key) => `Resource URI collision: "${key}" is already registered.`,
  )

  const resourceTemplateMap = buildCheckedMap(
    options.resourceTemplates ?? [],
    (template) => template.uriTemplate,
    (key) => `Resource template collision: "${key}" is already registered.`,
  )

  const promptMap = buildCheckedMap(
    options.prompts ?? [],
    (prompt) => prompt.name,
    (key) => `Prompt name collision: "${key}" is already registered.`,
  )

  const manifest: Manifest = deepFreeze({
    tools: Array.from(toolMap.values()),
    resources: Array.from(resourceMap.values()),
    resourceTemplates: Array.from(resourceTemplateMap.values()),
    prompts: Array.from(promptMap.values()),
  })

  return { toolMap, manifest, promptMap }
}
