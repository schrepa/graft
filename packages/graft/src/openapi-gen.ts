/**
 * OpenAPI 3.1 spec generation from InternalTool definitions.
 */

import type { AuthResult } from './types.js'
import type { InternalTool } from './registry.js'
import { normalizeAuth } from './auth.js'
import {
  buildOperationFields,
  buildRequestBodyObject,
  buildRequestExamples,
  extractPathParamNames,
} from './openapi-operation-fields.js'
import { GRAFT_VERSION } from './version.js'

/**
 * Top-level metadata used when generating an OpenAPI document.
 */
export interface OpenApiOptions {
  title?: string
  version?: string
  description?: string
  serverUrl?: string
}

/**
 * Minimal tool shape required for OpenAPI generation.
 */
export type OpenApiTool<TAuth extends AuthResult = AuthResult> = Pick<
  InternalTool<TAuth>,
  'auth' | 'deprecated' | 'description' | 'examples' | 'httpMethod' | 'httpPath' |
  'inputSchema' | 'name' | 'outputSchema' | 'parameterLocations' | 'tags' | 'title'
>

/**
 * Generated OpenAPI `info` object.
 */
export interface OpenApiInfo {
  title: string
  version: string
  description?: string
}

/**
 * Generated OpenAPI 3.1 document returned by `generateOpenApiSpec`.
 */
export interface OpenApiDocument {
  openapi: '3.1.0'
  info: OpenApiInfo
  paths: Record<string, Record<string, unknown>>
  servers?: Array<{ url: string }>
  components?: {
    securitySchemes: {
      bearerAuth: { type: 'http'; scheme: 'bearer' }
    }
  }
}

/** Build the responses object for an operation */
function buildResponses<TAuth extends AuthResult>(
  tool: OpenApiTool<TAuth>,
  auth: ReturnType<typeof normalizeAuth>,
): Record<string, unknown> {
  const responses: Record<string, unknown> = {}
  const responseExamples = buildResponseExamples(tool)
  if (tool.outputSchema || responseExamples) {
    const jsonContent: Record<string, unknown> = {}
    if (tool.outputSchema) jsonContent.schema = tool.outputSchema
    if (responseExamples) jsonContent.examples = responseExamples
    responses['200'] = {
      description: 'Successful response',
      content: { 'application/json': jsonContent },
    }
  } else {
    responses['200'] = { description: 'Successful response' }
  }
  if (auth) {
    responses['401'] = { description: 'Unauthorized' }
  }
  return responses
}

/** Build the base operation object (metadata fields only) */
function buildBaseOperation<TAuth extends AuthResult>(tool: OpenApiTool<TAuth>): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    operationId: tool.name,
    summary: tool.title ?? tool.name,
  }
  if (tool.description) operation.description = tool.description
  if (tool.tags.length > 0) operation.tags = tool.tags
  if (tool.deprecated) operation.deprecated = true
  if (typeof tool.deprecated === 'string') operation['x-deprecated-message'] = tool.deprecated
  return operation
}

/** Build a complete OpenAPI operation for a single tool */
function buildToolOperation<TAuth extends AuthResult>(tool: OpenApiTool<TAuth>): Record<string, unknown> {
  const pathParamNames = extractPathParamNames(tool.httpPath)
  const operation = buildBaseOperation(tool)
  const auth = normalizeAuth(tool.auth)
  if (auth) operation.security = [{ bearerAuth: [] }]
  const properties = tool.inputSchema?.properties
  const required = tool.inputSchema?.required
  const { parameters, bodyProperties, bodyRequired, bodyFieldNames } = buildOperationFields(
    tool,
    properties,
    required,
    pathParamNames,
  )
  const requestBody = buildRequestBodyObject(
    bodyProperties,
    bodyRequired,
    buildRequestExamples(tool, bodyFieldNames),
  )
  if (parameters.length > 0) operation.parameters = parameters
  if (requestBody) operation.requestBody = requestBody
  operation.responses = buildResponses(tool, auth)
  return operation
}

/**
 * Generate an OpenAPI 3.1 document from registered HTTP-exposed tools.
 *
 * @param tools Tool definitions to serialize.
 * @param options Top-level document metadata overrides.
 * @returns An OpenAPI 3.1 document.
 * @example
 * generateOpenApiSpec(app.build().manifest.tools, { title: 'Example API' })
 */
export function generateOpenApiSpec<TAuth extends AuthResult = AuthResult>(
  tools: readonly OpenApiTool<TAuth>[],
  options?: OpenApiOptions,
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const tool of tools) {
    addToolPath(paths, tool)
  }
  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info: buildOpenApiInfo(options),
    paths,
  }
  if (options?.serverUrl) doc.servers = [{ url: options.serverUrl }]
  if (hasAuthenticatedTools(tools)) {
    doc.components = {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    }
  }

  return doc
}

/** Build OpenAPI response examples from tool.examples that have a result */
function buildResponseExamples<TAuth extends AuthResult>(tool: OpenApiTool<TAuth>): Record<string, unknown> | undefined {
  const withResult = tool.examples.filter(ex => ex.result !== undefined)
  if (!withResult.length) return undefined
  const examples: Record<string, unknown> = {}
  for (const ex of withResult) {
    const key = ex.name ?? `example_${Object.keys(examples).length}`
    examples[key] = {
      ...(ex.description ? { summary: ex.description } : {}),
      value: ex.result,
    }
  }
  return Object.keys(examples).length > 0 ? examples : undefined
}

function addToolPath<TAuth extends AuthResult>(
  paths: Record<string, Record<string, unknown>>,
  tool: OpenApiTool<TAuth>,
): void {
  const openApiPath = tool.httpPath.replace(/:(\w+)/g, '{$1}')
  const method = tool.httpMethod.toLowerCase()
  const existing = paths[openApiPath] ?? {}
  existing[method] = buildToolOperation(tool)
  paths[openApiPath] = existing
}

function buildOpenApiInfo(options?: OpenApiOptions): OpenApiInfo {
  return {
    title: options?.title ?? 'Graft API',
    version: options?.version ?? GRAFT_VERSION,
    ...(options?.description ? { description: options.description } : {}),
  }
}

function hasAuthenticatedTools<TAuth extends AuthResult>(tools: readonly OpenApiTool<TAuth>[]): boolean {
  return tools.some((tool) => normalizeAuth(tool.auth))
}
