import type { Manifest, ToolDefinition, ValidationResult, ValidationMessage } from './types.js'
import { hasSideEffects } from './http-method.js'

/**
 * Minimal manifest shape required for tool validation.
 */
export type ManifestToolSet = Pick<Manifest, 'tools'>

/** Check parameterLocations references exist in inputSchema */
function validateParameterLocations(tool: ToolDefinition): ValidationMessage[] {
  if (!tool.parameterLocations || !tool.inputSchema) return []
  const warnings: ValidationMessage[] = []
  const schemaProps = tool.inputSchema.properties ?? {}
  for (const paramName of Object.keys(tool.parameterLocations)) {
    if (paramName in schemaProps) continue
    if (tool.path?.includes(`:${paramName}`)) continue
    warnings.push({
      tool: tool.name,
      message: `parameterLocations references "${paramName}" but it is not in inputSchema.properties`,
    })
  }
  return warnings
}

/** Validate a single tool and return categorized messages */
function validateTool(tool: ToolDefinition): {
  errors: ValidationMessage[]
  warnings: ValidationMessage[]
  infos: ValidationMessage[]
} {
  const errors: ValidationMessage[] = []
  const warnings: ValidationMessage[] = []
  const infos: ValidationMessage[] = []

  if (!tool.description || tool.description.trim().length === 0) {
    errors.push({ tool: tool.name, message: 'Missing description' })
  } else if (tool.description.length > 1024) {
    warnings.push({ tool: tool.name, message: 'Description exceeds 1024 characters — may be truncated by some MCP clients' })
  }

  if (tool.method && hasSideEffects(tool.method) && !tool.inputSchema) {
    warnings.push({ tool: tool.name, message: `${tool.method} route has no input schema — tool arguments will be empty` })
  }

  warnings.push(...validateParameterLocations(tool))

  if (tool.examples.length === 0) {
    infos.push({ tool: tool.name, message: 'No examples — adding 2-3 examples improves LLM tool-calling accuracy' })
  }

  return { errors, warnings, infos }
}

/**
 * Validate all tools in a manifest and return errors, warnings, and informational messages.
 *
 * @param manifest Manifest-like object containing the tool list to validate.
 * @returns Validation summary grouped by severity.
 */
export function validateManifest(manifest: ManifestToolSet): ValidationResult {
  const errors: ValidationMessage[] = []
  const warnings: ValidationMessage[] = []
  const infos: ValidationMessage[] = []

  for (const tool of manifest.tools) {
    const result = validateTool(tool)
    errors.push(...result.errors)
    warnings.push(...result.warnings)
    infos.push(...result.infos)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
  }
}

/**
 * Format validation results for console output.
 *
 * @param result Validation output produced by `validateManifest()`.
 * @returns A human-readable multi-line summary.
 */
export function formatValidation(result: ValidationResult): string {
  const lines: string[] = []

  if (result.errors.length === 0 && result.warnings.length === 0 && result.infos.length === 0) {
    lines.push('All tools validated successfully.')
    return lines.join('\n')
  }

  for (const error of result.errors) {
    lines.push(`ERROR [${error.tool}]: ${error.message}`)
  }

  for (const warning of result.warnings) {
    lines.push(`WARN  [${warning.tool}]: ${warning.message}`)
  }

  for (const info of result.infos) {
    lines.push(`INFO  [${info.tool}]: ${info.message}`)
  }

  lines.push('')
  lines.push(`${result.errors.length} error(s), ${result.warnings.length} warning(s), ${result.infos.length} info(s)`)

  return lines.join('\n')
}
