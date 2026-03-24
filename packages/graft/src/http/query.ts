import { isAbortError } from '../abort.js'
import { GraftError } from '../errors.js'
import { isPlainRecord } from '../object-schema.js'
import type { JsonSchema } from '../types.js'

/** Coerce a scalar string using the JSON Schema primitive type when known. */
export function coerceScalar(value: string, type?: string): unknown {
  if (type === 'integer') {
    return /^-?\d+$/.test(value) ? Number(value) : value
  }
  if (type === 'number') {
    if (value.trim() === '') return value
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  if (type === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }
  return value
}

/** Deserialize query params using the tool's JSON Schema for type awareness. */
export function deserializeQuery(
  searchParams: URLSearchParams,
  schema: JsonSchema | null | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!schema) {
    for (const key of new Set(searchParams.keys())) {
      result[key] = readRawQueryValue(searchParams, key)
    }
    return result
  }

  const properties = schema.properties ?? {}
  for (const key of new Set(searchParams.keys())) {
    const propSchema = properties[key]
    if (!propSchema) {
      result[key] = readRawQueryValue(searchParams, key)
      continue
    }

    result[key] = readTypedQueryValue(searchParams, key, propSchema)
  }

  return result
}

/** Coerce raw string path params using the tool's JSON Schema property types. */
export function coercePathParams(
  raw: Record<string, string>,
  schema: JsonSchema | null | undefined,
): Record<string, unknown> {
  if (!schema) return { ...raw }

  const properties = schema.properties ?? {}
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(raw)) {
    const propSchema = properties[key]
    result[key] = propSchema ? coerceScalar(value, propSchema.type) : value
  }

  return result
}

/** Parse POST/PUT/PATCH body. Empty body becomes `{}`. */
export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return parseJsonObject(await readRequestText(request))
  } catch (error) {
    if (error instanceof GraftError) throw error
    throw new GraftError('Invalid JSON body', 400, 'INVALID_JSON_BODY', {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function readRequestText(request: Request): Promise<string> {
  try {
    return await request.text()
  } catch (error) {
    if (isAbortError(error)) {
      throw new GraftError('Request cancelled', 499, 'REQUEST_CANCELLED', {
        cause: error instanceof Error ? error : undefined,
      })
    }
    throw error
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = text.trim().length === 0 ? {} : JSON.parse(text)
  if (!isPlainRecord(parsed)) {
    throw new GraftError('Request body must be a JSON object', 400, 'INVALID_JSON_BODY')
  }
  return parsed
}

function readRawQueryValue(
  searchParams: URLSearchParams,
  key: string,
): string | string[] | null {
  const values = searchParams.getAll(key)
  return values.length > 1 ? values : values[0]
}

function readTypedQueryValue(
  searchParams: URLSearchParams,
  key: string,
  schema: NonNullable<JsonSchema['properties']>[string],
): unknown {
  if (schema.type === 'array') {
    return searchParams.getAll(key).map((value) => coerceScalar(value, schema.items?.type))
  }

  const value = searchParams.get(key)
  return value === null ? null : coerceScalar(value, schema.type)
}
