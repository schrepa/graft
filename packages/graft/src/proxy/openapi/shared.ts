import YAML from 'yaml'
import { expectPlainRecord, isPlainRecord, toPlainRecord } from '../../object-schema.js'
import { resolveJsonSchemaRefs } from '../schema.js'
import type { OpenApiComponents, OpenApiParameter, OpenApiSchema } from './types.js'

const REF_PREFIX = '#/components/schemas/'

/** Parse a raw OpenAPI JSON or YAML string into a plain record. */
export function parseStringSpec(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (trimmed.startsWith('{')) {
    try {
      return expectPlainRecord(JSON.parse(trimmed), 'OpenAPI spec')
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAPI spec as JSON: ${getErrorMessage(error)}\n\n` +
        `  If this is a YAML file, ensure it doesn't start with '{'.`,
      )
    }
  }

  return expectPlainRecord(YAML.parse(trimmed), 'OpenAPI spec')
}

export { toPlainRecord as toRecord }

/** Read a string field if present. */
export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Read an optional string array, throwing when the shape is invalid. */
export function readStringArray(value: unknown, label = 'value'): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label}: expected an array of strings`)
  }
  return [...value]
}

/** Convert an unknown thrown value into a stable string message. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Normalize `components` into typed schema and parameter maps. */
export function readComponents(value: unknown): OpenApiComponents {
  if (value === undefined) return {}

  const record = expectPlainRecord(value, 'OpenAPI components')

  const schemas = toSchemaMap(record.schemas, 'OpenAPI components.schemas')
  const parameters = toParameterMap(record.parameters, 'OpenAPI components.parameters')
  return {
    ...record,
    ...(schemas ? { schemas } : {}),
    ...(parameters ? { parameters } : {}),
  }
}

/** Read the OpenAPI `paths` object when present. */
export function getOpenApiPaths(spec: Record<string, unknown>): Record<string, Record<string, unknown>> | undefined {
  if (spec.paths === undefined) return undefined
  return toPathMap(spec.paths, 'OpenAPI spec.paths')
}

/** Resolve local `$ref` pointers against OpenAPI components. */
export function resolveRef(obj: unknown, components: OpenApiComponents): unknown {
  const record = toPlainRecord(obj)
  if (!record) return obj
  if (!record.$ref || typeof record.$ref !== 'string') return obj

  const ref = record.$ref
  if (ref.startsWith('#/components/parameters/')) {
    const name = ref.slice('#/components/parameters/'.length)
    const resolved = components.parameters?.[name]
    return resolved ? resolveRef(resolved, components) : obj
  }

  return resolveJsonSchemaRefs(obj, components.schemas ?? {}, REF_PREFIX)
}

/** Read an OpenAPI content map keyed by media type. */
export function toContentMap(
  value: unknown,
  label = 'OpenAPI content',
): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) return undefined

  const record = expectPlainRecord(value, label)

  const content: Record<string, Record<string, unknown>> = {}
  for (const [contentType, entry] of Object.entries(record)) {
    content[contentType] = expectPlainRecord(entry, `${label}.${contentType}`)
  }
  return content
}

/** Check whether a value is a plain record suitable for schema handling. */
export function isRecordSchema(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value)
}

function toPathMap(
  value: unknown,
  label: string,
): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) return undefined

  const record = expectPlainRecord(value, label)

  const paths: Record<string, Record<string, unknown>> = {}
  for (const [path, pathItem] of Object.entries(record)) {
    paths[path] = expectPlainRecord(pathItem, `${label}.${path}`)
  }
  return paths
}

function toSchemaMap(
  value: unknown,
  label: string,
): Record<string, OpenApiSchema> | undefined {
  if (value === undefined) return undefined

  const record = expectPlainRecord(value, label)

  const schemas: Record<string, OpenApiSchema> = {}
  for (const [name, schema] of Object.entries(record)) {
    schemas[name] = expectPlainRecord(schema, `${label}.${name}`)
  }
  return schemas
}

function toParameterMap(
  value: unknown,
  label: string,
): Record<string, OpenApiParameter> | undefined {
  if (value === undefined) return undefined

  const record = expectPlainRecord(value, label)

  const parameters: Record<string, OpenApiParameter> = {}
  for (const [name, parameter] of Object.entries(record)) {
    parameters[name] = expectPlainRecord(parameter, `${label}.${name}`)
  }
  return parameters
}

function isOpenApiSchema(value: unknown): value is OpenApiSchema {
  return isPlainRecord(value)
}

function isOpenApiParameter(value: unknown): value is OpenApiParameter {
  return isPlainRecord(value)
}

/** Resolve a value into an OpenAPI schema when possible. */
export function resolveOpenApiSchema(
  value: unknown,
  components: OpenApiComponents,
): OpenApiSchema | undefined {
  const resolved = resolveRef(value, components)
  return isOpenApiSchema(resolved) ? resolved : undefined
}

/** Resolve a value into an OpenAPI parameter when possible. */
export function resolveOpenApiParameter(
  value: unknown,
  components: OpenApiComponents,
): OpenApiParameter | undefined {
  const resolved = resolveRef(value, components)
  return isOpenApiParameter(resolved) ? resolved : undefined
}

/** Read and resolve an array of OpenAPI parameters. */
export function readParameters(
  value: unknown,
  components: OpenApiComponents,
  label = 'OpenAPI parameters',
): OpenApiParameter[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected an array`)
  }

  const parameters: OpenApiParameter[] = []
  for (const [index, parameter] of value.entries()) {
    const resolved = resolveOpenApiParameter(parameter, components)
    if (!resolved) {
      throw new Error(`${label}[${index}]: expected a parameter object`)
    }
    parameters.push(resolved)
  }
  return parameters
}
