import type { HttpMethod } from './http-method.js'
import { usesQueryParametersForMethod } from './http-method.js'
import { getParameterLocationWireName } from './parameter-location.js'
import type { ParameterLocation, ParameterLocationEntry, ToolExample } from './types.js'

type OperationFieldTool = {
  httpMethod: HttpMethod
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
}

type RequestExampleTool = {
  examples: ToolExample[]
}

/** Extract path parameter names from an Express-style path. */
export function extractPathParamNames(httpPath: string): Set<string> {
  const names = new Set<string>()
  for (const match of httpPath.matchAll(/:(\w+)/g)) {
    names.add(match[1])
  }
  return names
}

/** Build path parameter definitions. */
export function buildPathParams(
  properties: Record<string, unknown>,
  pathParamNames: Set<string>,
): Record<string, unknown>[] {
  const parameters: Record<string, unknown>[] = []
  for (const name of pathParamNames) {
    const schema = properties[name] ?? { type: 'string' }
    parameters.push({ name, in: 'path', required: true, schema })
  }
  return parameters
}

/** Build request body object for operations that send args in JSON. */
export function buildRequestBodyObject(
  bodyProperties: Record<string, unknown>,
  bodyRequired: string[],
  requestExamples?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (Object.keys(bodyProperties).length === 0) return undefined

  const jsonContent: Record<string, unknown> = {
    schema: {
      type: 'object',
      properties: bodyProperties,
      ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
    },
  }
  if (requestExamples) jsonContent.examples = requestExamples

  return {
    required: true,
    content: { 'application/json': jsonContent },
  }
}

/** Split schema properties into OpenAPI parameters and JSON request-body fields. */
export function buildOperationFields(
  tool: OperationFieldTool,
  properties: Record<string, unknown> | undefined,
  required: string[] | undefined,
  pathParamNames: Set<string>,
): {
  parameters: Record<string, unknown>[]
  bodyProperties: Record<string, unknown>
  bodyRequired: string[]
  bodyFieldNames: Set<string>
} {
  const parameters = buildPathParams(properties ?? {}, pathParamNames)
  const bodyProperties: Record<string, unknown> = {}
  const bodyRequired: string[] = []
  const bodyFieldNames = new Set<string>()

  if (!properties) {
    return { parameters, bodyProperties, bodyRequired, bodyFieldNames }
  }

  for (const [name, schema] of Object.entries(properties)) {
    const location = resolveFieldLocation(tool, name, pathParamNames)
    if (location === 'path') continue

    if (location === 'query' || location === 'header') {
      parameters.push({
        name: getHttpName(tool, name),
        in: location,
        ...(required?.includes(name) ? { required: true } : {}),
        schema,
      })
      continue
    }

    bodyProperties[name] = schema
    bodyFieldNames.add(name)
    if (required?.includes(name)) bodyRequired.push(name)
  }

  return { parameters, bodyProperties, bodyRequired, bodyFieldNames }
}

/** Build OpenAPI request examples from tool.examples, selecting only body-routed fields. */
export function buildRequestExamples(
  tool: RequestExampleTool,
  bodyFieldNames: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!tool.examples.length || bodyFieldNames.size === 0) return undefined
  const examples: Record<string, unknown> = {}
  for (const example of tool.examples) {
    const bodyArgs = pickFields(example.args, bodyFieldNames)
    if (Object.keys(bodyArgs).length === 0) continue
    const key = example.name ?? `example_${Object.keys(examples).length}`
    examples[key] = {
      ...(example.description ? { summary: example.description } : {}),
      value: bodyArgs,
    }
  }
  return Object.keys(examples).length > 0 ? examples : undefined
}

function getHttpName(tool: OperationFieldTool, paramName: string): string {
  const location = tool.parameterLocations?.[paramName]
  return location ? getParameterLocationWireName(paramName, location) : paramName
}

function resolveFieldLocation(
  tool: OperationFieldTool,
  name: string,
  pathParamNames: Set<string>,
): ParameterLocation {
  if (pathParamNames.has(name)) return 'path'

  const location = tool.parameterLocations?.[name]
  const configured = typeof location === 'string' ? location : location?.in
  if (configured === 'query' || configured === 'header' || configured === 'body') {
    return configured
  }

  return usesQueryParametersForMethod(tool.httpMethod) ? 'query' : 'body'
}

function pickFields(
  args: Record<string, unknown>,
  fieldNames: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (!fieldNames.has(key)) continue
    result[key] = value
  }
  return result
}
