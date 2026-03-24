/**
 * llms.txt / llms-full.txt renderers.
 * Pure functions over the frozen Manifest — no side effects.
 */

import type { Manifest } from './types.js'
import type { ToolDefinition, ToolExample, JsonSchema } from './types.js'
import { normalizeAuth } from './auth.js'

/** Optional metadata used when rendering `llms.txt` documents. */
export interface LlmsTxtOptions {
  name?: string
  description?: string
}

// =========================================================================
// Compact: /llms.txt
// =========================================================================

/** Render compact sections (tools, resources, resource templates, prompts) */
function renderCompactSections(manifest: Manifest): string[] {
  return [
    ...renderCompactToolsSection(manifest.tools),
    ...renderCompactResourcesSection(manifest),
    ...renderCompactPromptsSection(manifest),
  ]
}

/**
 * Render the compact `llms.txt` document for a manifest.
 *
 * @param manifest Frozen manifest returned by `mcp.getManifest()`.
 * @param options Optional display metadata for the rendered document.
 * @returns A newline-terminated compact `llms.txt` document.
 */
export function generateLlmsTxt(manifest: Manifest, options?: LlmsTxtOptions): string {
  const lines: string[] = []
  const name = options?.name ?? 'Graft Server'

  lines.push(`# ${name}`)
  lines.push('')
  if (options?.description) {
    lines.push(`> ${options.description}`)
    lines.push('')
  }

  lines.push(...renderCompactSections(manifest))

  return lines.join('\n').trimEnd() + '\n'
}

function formatToolCompact(t: ToolDefinition): string {
  const marker = t.deprecated
    ? ` [DEPRECATED${typeof t.deprecated === 'string' ? `: ${t.deprecated}` : ''}]`
    : ''
  return `- **${t.name}**${marker}: ${t.description}`
}

// =========================================================================
// Full: /llms-full.txt
// =========================================================================

/** Render full tools section */
function renderFullTools(manifest: Manifest): string[] {
  if (manifest.tools.length === 0) return []
  const lines: string[] = ['## Tools', '']
  const { tagged, untagged } = groupByTag(manifest.tools)

  for (const t of untagged) {
    lines.push(formatToolFull(t))
    lines.push('')
  }

  for (const [tag, tools] of tagged) {
    lines.push(`### ${tag}`)
    lines.push('')
    for (const t of tools) {
      lines.push(formatToolFull(t))
      lines.push('')
    }
  }
  return lines
}

/** Render full resources and prompts sections */
function renderFullResourcesAndPrompts(manifest: Manifest): string[] {
  const lines: string[] = []

  if (manifest.resources.length > 0 || manifest.resourceTemplates.length > 0) {
    lines.push('## Resources')
    lines.push('')
    for (const r of manifest.resources) {
      lines.push(...formatResourceSection(
        r.name,
        r.description,
        [`- **URI**: \`${r.uri}\``, ...(r.mimeType ? [`- **Type**: ${r.mimeType}`] : [])],
      ))
    }
    for (const rt of manifest.resourceTemplates) {
      const details = [`- **URI Template**: \`${rt.uriTemplate}\``, ...(rt.mimeType ? [`- **Type**: ${rt.mimeType}`] : [])]
      lines.push(...formatResourceSection(rt.name, rt.description, details, rt.params))
    }
  }

  if (manifest.prompts.length > 0) {
    lines.push('## Prompts', '')
    for (const p of manifest.prompts) {
      lines.push(...formatResourceSection(p.name, p.description, [], p.params))
    }
  }

  return lines
}

/** Render full sections (tools, resources, resource templates, prompts) */
function renderFullSections(manifest: Manifest): string[] {
  return [
    ...renderFullTools(manifest),
    ...renderFullResourcesAndPrompts(manifest),
  ]
}

/**
 * Render the expanded `llms-full.txt` document for a manifest.
 *
 * @param manifest Frozen manifest returned by `mcp.getManifest()`.
 * @param options Optional display metadata for the rendered document.
 * @returns A newline-terminated detailed `llms-full.txt` document.
 */
export function generateLlmsFullTxt(manifest: Manifest, options?: LlmsTxtOptions): string {
  const lines: string[] = []
  const name = options?.name ?? 'Graft Server'

  lines.push(`# ${name}`)
  lines.push('')
  if (options?.description) {
    lines.push(`> ${options.description}`)
    lines.push('')
  }

  lines.push(...renderFullSections(manifest))

  return lines.join('\n').trimEnd() + '\n'
}

/** Build the metadata line fragments for a tool */
function buildToolMetaLine(t: ToolDefinition): string[] {
  const meta: string[] = []
  if (t.method && t.path) meta.push(`**${t.method}** \`${t.path}\``)
  if (t.sideEffects) meta.push('**Side effects**: yes')

  const auth = normalizeAuth(t.auth)
  if (auth) {
    const roles = auth.roles?.length ? ` (roles: ${auth.roles.join(', ')})` : ''
    meta.push(`**Auth**: required${roles}`)
  }

  if (t.deprecated) {
    const msg = typeof t.deprecated === 'string' ? `: ${t.deprecated}` : ''
    meta.push(`**Deprecated**${msg}`)
  }

  return meta
}

function formatToolFull(t: ToolDefinition): string {
  const lines: string[] = []
  const heading = t.title ? `#### ${t.name} — ${t.title}` : `#### ${t.name}`
  lines.push(heading)
  lines.push('')
  lines.push(t.description)
  lines.push('')

  const meta = buildToolMetaLine(t)
  if (meta.length > 0) {
    lines.push(meta.join(' | '))
    lines.push('')
  }

  // Parameters
  if (t.inputSchema) {
    const params = formatParams(t.inputSchema)
    if (params.length > 0) {
      lines.push('**Parameters:**')
      lines.push(...params)
      lines.push('')
    }
  }

  // Output
  if (t.outputSchema) {
    const params = formatParams(t.outputSchema)
    if (params.length > 0) {
      lines.push('**Returns:**')
      lines.push(...params)
      lines.push('')
    }
  }

  // Examples
  if (t.examples.length > 0) {
    for (const ex of t.examples) {
      lines.push(formatExample(ex))
    }
  }

  return lines.join('\n').trimEnd()
}

function formatResourceSection(
  name: string,
  description: string,
  details: string[],
  paramsSchema?: JsonSchema | null,
): string[] {
  const lines = [`### ${name}`, '', description, ...details]
  appendParamsSection(lines, paramsSchema)
  lines.push('')
  return lines
}

function appendParamsSection(lines: string[], paramsSchema?: JsonSchema | null): void {
  if (!paramsSchema) return
  const params = formatParams(paramsSchema)
  if (params.length === 0) return
  lines.push('', '**Parameters:**', ...params)
}

function formatParams(schema: JsonSchema): string[] {
  const properties = schema.properties
  if (!properties) return []

  const required = new Set<string>(schema.required ?? [])
  const lines: string[] = []
  for (const [name, prop] of Object.entries(properties)) {
    const type = prop.type ?? 'any'
    const req = required.has(name) ? ', required' : ''
    const desc = prop.description ? `: ${prop.description}` : ''
    lines.push(`- \`${name}\` (${type}${req})${desc}`)
  }
  return lines
}

function formatExample(ex: ToolExample): string {
  const lines: string[] = []
  const label = ex.name
    ? (ex.description ? `**Example "${ex.name}"**: ${ex.description}` : `**Example "${ex.name}"**`)
    : (ex.description ? `**Example**: ${ex.description}` : '**Example**')
  lines.push(label)
  lines.push('')
  lines.push('**Input**')
  lines.push('```json')
  lines.push(JSON.stringify(ex.args, null, 2))
  lines.push('```')
  if (ex.result !== undefined) {
    lines.push('')
    lines.push('**Output**')
    lines.push('```json')
    lines.push(JSON.stringify(ex.result, null, 2))
    lines.push('```')
  }
  return lines.join('\n')
}

function renderCompactToolsSection(tools: ToolDefinition[]): string[] {
  if (tools.length === 0) return []

  const lines = ['## Tools', '']
  const { tagged, untagged } = groupByTag(tools)

  for (const tool of untagged) {
    lines.push(formatToolCompact(tool))
  }
  for (const [tag, taggedTools] of tagged) {
    lines.push('', `### ${tag}`, '')
    for (const tool of taggedTools) {
      lines.push(formatToolCompact(tool))
    }
  }

  lines.push('')
  return lines
}

function renderCompactResourcesSection(manifest: Manifest): string[] {
  if (manifest.resources.length === 0 && manifest.resourceTemplates.length === 0) {
    return []
  }

  const lines = ['## Resources', '']
  for (const resource of manifest.resources) {
    lines.push(`- **${resource.name}**: ${resource.description}`)
  }
  for (const resourceTemplate of manifest.resourceTemplates) {
    lines.push(`- **${resourceTemplate.name}** \`${resourceTemplate.uriTemplate}\`: ${resourceTemplate.description}`)
  }
  lines.push('')
  return lines
}

function renderCompactPromptsSection(manifest: Manifest): string[] {
  if (manifest.prompts.length === 0) return []

  const lines = ['## Prompts', '']
  for (const prompt of manifest.prompts) {
    lines.push(`- **${prompt.name}**: ${prompt.description}`)
  }
  lines.push('')
  return lines
}

// =========================================================================
// Helpers
// =========================================================================

function groupByTag(tools: ToolDefinition[]): {
  tagged: Map<string, ToolDefinition[]>
  untagged: ToolDefinition[]
} {
  const tagged = new Map<string, ToolDefinition[]>()
  const untagged: ToolDefinition[] = []

  for (const t of tools) {
    if (t.tags.length === 0) {
      untagged.push(t)
      continue
    }

    const tag = t.tags[0]
    const existing = tagged.get(tag)
    if (existing) {
      existing.push(t)
      continue
    }
    tagged.set(tag, [t])
  }

  return { tagged, untagged }
}
