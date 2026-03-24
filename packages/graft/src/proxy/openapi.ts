import type { ToolDefinition } from '../types.js'
import { deriveSideEffects } from '../derivation.js'
import { parseHttpMethod } from '../http-method.js'
import { extractExamples } from './openapi/examples.js'
import { buildInputSchema, buildOutputSchema, mergeParameters } from './openapi/schema.js'
import {
  getOpenApiPaths,
  parseStringSpec,
  readComponents,
  readString,
  readStringArray,
  toRecord,
} from './openapi/shared.js'
import type { OpenApiComponents, OpenApiLogger, OpenApiOptions } from './openapi/types.js'
import { HTTP_METHODS } from './openapi/types.js'

export type { OpenApiOptions } from './openapi/types.js'

interface ParsedOpenApiTool extends ToolDefinition {
  nameIsExplicit: boolean
}

/**
 * Parse an OpenAPI spec (v3.x) and produce ToolDefinition[] for tool registration.
 *
 * Accepts a raw JSON/YAML string or a pre-parsed object.
 * Returns fully normalized ToolDefinition[] ready for registry storage.
 */
export function parseOpenApiSpec(
  specInput: string | Record<string, unknown>,
  options: OpenApiOptions = {}
): ToolDefinition[] {
  const spec = typeof specInput === 'string' ? parseStringSpec(specInput) : specInput
  const components = readComponents(spec.components)
  const paths = getOpenApiPaths(spec)
  if (!paths) return []

  const log = options.logger ?? console
  const tools: ParsedOpenApiTool[] = []

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    tools.push(...collectPathTools(pathStr, pathItem, components, options, log))
  }

  assertExplicitToolNames(tools)
  return tools.map(({ nameIsExplicit: _nameIsExplicit, ...tool }) => tool)
}

function collectPathTools(
  pathStr: string,
  pathItem: Record<string, unknown>,
  components: OpenApiComponents,
  options: OpenApiOptions,
  log: OpenApiLogger,
): ParsedOpenApiTool[] {
  const tools: ParsedOpenApiTool[] = []
  for (const method of HTTP_METHODS) {
    const operation = toRecord(pathItem[method])
    if (!operation) continue

    const tool = processOperation(pathStr, method, operation, pathItem, components, options, log)
    if (tool) tools.push(tool)
  }
  return tools
}

function assertExplicitToolNames(tools: ParsedOpenApiTool[]): void {
  const missing = tools.filter((tool) => !tool.nameIsExplicit)
  if (missing.length === 0) return

  const list = missing.map((tool) => `  - ${tool.method} ${tool.path}`).join('\n')
  throw new Error(
    `${missing.length} operation(s) in your OpenAPI spec are missing operationId:\n${list}\n\n` +
    `Graft uses operationId as the tool name. Add operationId to each operation in your spec.`
  )
}

/** Check whether an operation should be skipped based on tags */
function shouldSkipByTags(opTags: string[], options: OpenApiOptions): boolean {
  const includeTags = options.includeTags
  if (includeTags && includeTags.length > 0) {
    if (!opTags.some(t => includeTags.includes(t))) return true
  }
  const excludeTags = options.excludeTags
  if (excludeTags && excludeTags.length > 0) {
    if (opTags.some(t => excludeTags.includes(t))) return true
  }
  return false
}

/** Resolve the tool name from operationId and overrides */
function resolveToolName(operation: Record<string, unknown>, options: OpenApiOptions): string | undefined {
  const operationId = readString(operation.operationId)
  if (operationId && options.nameOverrides?.[operationId]) return options.nameOverrides[operationId]
  if (operationId) return operationId
  return undefined
}

/** Process a single OpenAPI operation into a ToolDefinition, or null to skip */
function processOperation(
  pathStr: string,
  method: string,
  operation: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  components: OpenApiComponents,
  options: OpenApiOptions,
  log: OpenApiLogger,
): ParsedOpenApiTool | null {
  if (operation['x-graft-ignore'] === true) return null

  const convertedPath = pathStr.replace(/\{([^}]+)\}/g, ':$1')
  const upperMethod = parseHttpMethod(method, `OpenAPI operation ${method.toUpperCase()} ${pathStr}`)
  const operationLabel = `OpenAPI ${upperMethod} ${pathStr}`
  const opTags = readStringArray(operation.tags, `${operationLabel} tags`)
  if (shouldSkipByTags(opTags, options)) return null
  const name = resolveToolName(operation, options)
  const description =
    readString(operation.summary) ??
    readString(operation.description) ??
    `${upperMethod} ${pathStr}`
  const mergedParams = mergeParameters(pathItem, operation, components, {
    pathParameters: `${operationLabel} path-level parameters`,
    operationParameters: `${operationLabel} parameters`,
  })

  const { inputSchema, parameterLocations, warnings } = buildInputSchema(
    { ...operation, parameters: mergedParams },
    components,
    {
      parameters: `${operationLabel} parameters`,
      requestBodyContent: `${operationLabel} requestBody.content`,
    },
  )

  for (const w of warnings) {
    log.warn(`[graft] ${upperMethod} ${pathStr}: ${w}`)
  }

  const outputSchema = buildOutputSchema(operation, components, `${operationLabel} response content`)
  const toolName = name ?? `${upperMethod} ${convertedPath}`

  return {
    name: toolName,
    description,
    method: upperMethod,
    path: convertedPath,
    inputSchema,
    outputSchema: outputSchema ?? undefined,
    sideEffects: deriveSideEffects(upperMethod),
    examples: extractExamples(operation, components, {
      requestBodyContent: `${operationLabel} requestBody.content`,
      parameters: `${operationLabel} parameters`,
    }),
    tags: opTags,
    nameIsExplicit: !!name,
    ...(parameterLocations && Object.keys(parameterLocations).length > 0
      ? { parameterLocations }
      : {}),
  }
}
