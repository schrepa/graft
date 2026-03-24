import type { ParameterLocationEntry } from '../../types.js'
import type { OpenApiComponents, OpenApiParameter, OpenApiSchema } from './types.js'
import {
  isRecordSchema,
  readParameters,
  resolveOpenApiParameter,
  resolveOpenApiSchema,
  resolveRef,
  toContentMap,
  toRecord,
} from './shared.js'

/** Merge path-level and operation-level OpenAPI parameters with operation precedence. */
export function mergeParameters(
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  components: OpenApiComponents,
  labels: {
    pathParameters?: string
    operationParameters?: string
  } = {},
): OpenApiParameter[] {
  const pathLevelParams = readParameters(
    pathItem.parameters,
    components,
    labels.pathParameters ?? 'OpenAPI path-level parameters',
  )
  const operationParams = readParameters(
    operation.parameters,
    components,
    labels.operationParameters ?? 'OpenAPI operation parameters',
  )
  const operationKeys = new Set(operationParams.map((parameter) => `${parameter.name}:${parameter.in}`))

  return [
    ...operationParams,
    ...pathLevelParams.filter((parameter) => !operationKeys.has(`${parameter.name}:${parameter.in}`)),
  ]
}

/** Build a flattened input schema and parameter-location map for one operation. */
export function buildInputSchema(
  operation: Record<string, unknown>,
  components: OpenApiComponents,
  labels: {
    parameters?: string
    requestBodyContent?: string
  } = {},
): {
  inputSchema: Record<string, unknown> | null
  parameterLocations: Record<string, ParameterLocationEntry> | null
  warnings: string[]
} {
  const properties: Record<string, OpenApiSchema> = {}
  const required: string[] = []
  const parameterLocations: Record<string, ParameterLocationEntry> = {}
  const warnings: string[] = []

  for (const parameter of readParameters(
    operation.parameters,
    components,
    labels.parameters ?? 'OpenAPI operation parameters',
  )) {
    processParameter(parameter, components, properties, required, parameterLocations)
  }

  appendRequestBodySchema(
    operation.requestBody,
    components,
    properties,
    required,
    warnings,
    parameterLocations,
    labels.requestBodyContent ?? 'OpenAPI requestBody.content',
  )

  if (Object.keys(properties).length === 0) {
    return { inputSchema: null, parameterLocations: null, warnings }
  }

  const schema: Record<string, unknown> = { type: 'object', properties }
  if (required.length > 0) {
    schema.required = [...new Set(required)]
  }

  return {
    inputSchema: schema,
    parameterLocations: Object.keys(parameterLocations).length > 0 ? parameterLocations : null,
    warnings,
  }
}

/** Build the JSON response schema for the first successful OpenAPI response. */
export function buildOutputSchema(
  operation: Record<string, unknown>,
  components: OpenApiComponents,
  responseContentLabel = 'OpenAPI response content',
): Record<string, unknown> | null {
  const responses = toRecord(operation.responses)
  if (!responses) return null
  return readJsonResponseSchema(pickSuccessResponse(responses), components, responseContentLabel)
}

function pickSuccessResponse(responses: Record<string, unknown>): unknown {
  return responses['200'] ?? responses['201'] ?? responses['2XX'] ?? responses.default
}

function readJsonResponseSchema(
  response: unknown,
  components: OpenApiComponents,
  responseContentLabel: string,
): Record<string, unknown> | null {
  if (!response) return null

  const resolved = toRecord(resolveRef(response, components))
  const content = toContentMap(resolved?.content, responseContentLabel)
  const jsonContent = content?.['application/json']
  if (!jsonContent?.schema) return null

  const schema = resolveRef(jsonContent.schema, components)
  return isRecordSchema(schema) ? schema : null
}

function appendRequestBodySchema(
  requestBody: unknown,
  components: OpenApiComponents,
  properties: Record<string, OpenApiSchema>,
  required: string[],
  warnings: string[],
  parameterLocations: Record<string, ParameterLocationEntry>,
  requestBodyContentLabel: string,
): void {
  const body = toRecord(requestBody)
  if (!body) return

  const bodyResult = mergeRequestBodyProps(body, components, requestBodyContentLabel)
  if (!bodyResult) return

  const duplicateNames = Object.keys(bodyResult.properties).filter((name) =>
    name in properties || name in parameterLocations,
  )
  if (duplicateNames.length > 0) {
    const quotedNames = duplicateNames.map((name) => `"${name}"`).join(', ')
    throw new Error(
      `${requestBodyContentLabel} reuses flattened input name(s): ${quotedNames}. ` +
      'Body properties and path/query/header parameters must have distinct names.',
    )
  }

  Object.assign(properties, bodyResult.properties)
  required.push(...bodyResult.required)
  warnings.push(...bodyResult.warnings)
}

function mergeRequestBodyProps(
  requestBody: Record<string, unknown>,
  components: OpenApiComponents,
  requestBodyContentLabel: string,
): { properties: Record<string, OpenApiSchema>; required: string[]; warnings: string[] } | null {
  const resolvedBody = toRecord(resolveRef(requestBody, components))
  const content = toContentMap(resolvedBody?.content, requestBodyContentLabel)
  if (!content) return null

  const jsonContent = content['application/json']
  if (!jsonContent?.schema) {
    const contentTypes = Object.keys(content)
    if (contentTypes.length === 0) return null
    return {
      properties: {},
      required: [],
      warnings: [`Unsupported request body content type(s): ${contentTypes.join(', ')}. Only application/json is supported.`],
    }
  }

  const bodySchema = resolveOpenApiSchema(jsonContent.schema, components)
  if (!bodySchema?.type || bodySchema.type !== 'object' || !bodySchema.properties) return null

  const properties = resolveRequestBodyProperties(bodySchema.properties, components)
  const required = Array.isArray(bodySchema.required) ? bodySchema.required : []
  return { properties, required, warnings: [] }
}

function resolveRequestBodyProperties(
  properties: Record<string, OpenApiSchema>,
  components: OpenApiComponents,
): Record<string, OpenApiSchema> {
  const resolved: Record<string, OpenApiSchema> = {}
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    resolved[propertyName] = resolveOpenApiSchema(propertySchema, components) ?? propertySchema
  }
  return resolved
}

function processParameter(
  parameter: unknown,
  components: OpenApiComponents,
  properties: Record<string, OpenApiSchema>,
  required: string[],
  parameterLocations: Record<string, ParameterLocationEntry>,
): void {
  const resolved = resolveOpenApiParameter(parameter, components)
  if (!resolved || !resolved.name) return
  if (resolved.in !== 'path' && resolved.in !== 'query' && resolved.in !== 'header') return

  properties[resolved.name] = { ...resolveParameterSchema(resolved, components) }
  if (resolved.description && !properties[resolved.name].description) {
    properties[resolved.name].description = resolved.description
  }
  if (resolved.required === true || resolved.in === 'path') {
    required.push(resolved.name)
  }
  setParameterLocation(parameterLocations, resolved)
}

function resolveParameterSchema(
  parameter: OpenApiParameter,
  components: OpenApiComponents,
): OpenApiSchema {
  return resolveOpenApiSchema(parameter.schema, components) ?? { type: 'string' }
}

function setParameterLocation(
  parameterLocations: Record<string, ParameterLocationEntry>,
  parameter: OpenApiParameter,
): void {
  if (!parameter.name) return

  if (parameter.in === 'header') {
    parameterLocations[parameter.name] = { in: 'header', name: parameter.name }
    return
  }

  if (parameter.in === 'query') {
    parameterLocations[parameter.name] = { in: 'query' }
  }
}
