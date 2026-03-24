/**
 * Schema utilities for proxy/config/OpenAPI code.
 * These helpers live with the SDK because they shape proxy inputs directly.
 */

import { isPlainRecord } from '../object-schema.js'

function readSchemaProperties(schema: Record<string, unknown> | null): Record<string, unknown> {
  return isPlainRecord(schema?.properties) ? { ...schema.properties } : {}
}

function readRequiredList(schema: Record<string, unknown> | null): string[] {
  return Array.isArray(schema?.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** Extract :param and {param} segments from a route path */
export function extractPathParams(path: string): string[] {
  return path.split('/').filter(Boolean).flatMap(seg => {
    if (seg.startsWith(':')) return [seg.slice(1)]
    if (seg.startsWith('{') && seg.endsWith('}')) return [seg.slice(1, -1)]
    return []
  })
}

/** Merge path parameters into an inputSchema, filling gaps without overriding developer-provided properties */
export function mergePathParams(schema: Record<string, unknown> | null, pathParams: string[]): Record<string, unknown> | null {
  if (pathParams.length === 0) return schema

  const properties = readSchemaProperties(schema)
  const required = readRequiredList(schema)

  for (const param of pathParams) {
    if (!(param in properties)) {
      properties[param] = { type: 'string', description: `Path parameter: ${param}` }
    }
    if (!required.includes(param)) {
      required.push(param)
    }
  }

  return { ...(schema ?? {}), type: 'object', properties, required }
}

/**
 * Merge an array of JSON Schema objects (allOf semantics).
 * Properties are unioned, required arrays are unioned, later entries win for other fields.
 */
export function mergeAllOf(schemas: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  const allProperties: Record<string, unknown> = {}
  const allRequired: string[] = []

  for (const schema of schemas) {
    for (const [key, value] of Object.entries(schema)) {
      mergeSchemaEntry(merged, allProperties, allRequired, key, value)
    }
  }

  if (Object.keys(allProperties).length > 0) {
    merged.properties = allProperties
  }
  if (allRequired.length > 0) {
    merged.required = [...new Set(allRequired)]
  }

  return merged
}

function mergeSchemaEntry(
  merged: Record<string, unknown>,
  allProperties: Record<string, unknown>,
  allRequired: string[],
  key: string,
  value: unknown,
): void {
  if (key === 'properties' && isPlainRecord(value)) {
    Object.assign(allProperties, value)
    return
  }
  if (key === 'required' && Array.isArray(value)) {
    allRequired.push(...value)
    return
  }
  merged[key] = value
}

/**
 * Recursively resolve $ref pointers and allOf in a JSON Schema object.
 *
 * - Replaces `{ $ref: '<prefix>X' }` with deep-cloned definition
 * - Merges allOf via mergeAllOf()
 * - Cycle detection via Set of currently-resolving ref names
 * - Returns resolved object (input untouched)
 */
export function resolveJsonSchemaRefs(
  obj: unknown,
  definitions: Record<string, unknown>,
  refPrefix: string = '#/definitions/'
): unknown {
  return resolveRefs(obj, definitions, refPrefix, new Set<string>())
}

function resolveRefs(
  obj: unknown,
  definitions: Record<string, unknown>,
  refPrefix: string,
  resolving: Set<string>
): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(item => resolveRefs(item, definitions, refPrefix, resolving))
  if (!isPlainRecord(obj)) return obj

  const record = obj

  const resolvedReference = resolveReference(record, definitions, refPrefix, resolving)
  if (resolvedReference !== undefined) return resolvedReference

  const mergedAllOf = resolveAllOf(record, definitions, refPrefix, resolving)
  if (mergedAllOf !== undefined) return mergedAllOf

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, resolveRefs(value, definitions, refPrefix, resolving)]),
  )
}

function resolveReference(
  record: Record<string, unknown>,
  definitions: Record<string, unknown>,
  refPrefix: string,
  resolving: Set<string>,
): unknown | undefined {
  if (typeof record.$ref !== 'string' || !record.$ref.startsWith(refPrefix)) {
    return undefined
  }

  const refName = record.$ref.slice(refPrefix.length)
  if (resolving.has(refName)) {
    throw new Error(`Circular $ref detected: ${[...resolving, refName].join(' → ')}`)
  }

  const definition = definitions[refName]
  if (definition === undefined) {
    return record
  }

  resolving.add(refName)
  try {
    return resolveRefs(structuredClone(definition), definitions, refPrefix, resolving)
  } finally {
    resolving.delete(refName)
  }
}

function resolveAllOf(
  record: Record<string, unknown>,
  definitions: Record<string, unknown>,
  refPrefix: string,
  resolving: Set<string>,
): Record<string, unknown> | undefined {
  if (!Array.isArray(record.allOf)) {
    return undefined
  }

  const resolvedSchemas = record.allOf.flatMap((schema) => {
    const resolvedSchema = resolveRefs(schema, definitions, refPrefix, resolving)
    return isPlainRecord(resolvedSchema) ? [resolvedSchema] : []
  })
  const { allOf: _ignoredAllOf, ...rest } = record
  const resolved = resolveRefs({ ...rest, ...mergeAllOf(resolvedSchemas) }, definitions, refPrefix, resolving)
  return isPlainRecord(resolved) ? resolved : {}
}
