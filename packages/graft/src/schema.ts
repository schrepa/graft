import { ZodError, toJSONSchema } from 'zod'
import type { JsonSchema } from './types.js'
import { ValidationError } from './errors.js'

type JsonSchemaSource = Parameters<typeof toJSONSchema>[0]

function isZodSchema(value: unknown): value is JsonSchemaSource {
  return Boolean(value && typeof value === 'object' && '_zod' in value)
}

function isJsonSchemaObject(value: unknown): value is JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Convert a Zod schema to JSON Schema.
 * Returns null if the input is not a Zod schema.
 *
 * Note: .refine() and .transform() are silently dropped during conversion —
 * they can't be represented in JSON Schema. These are still enforced at
 * runtime but invisible to agents.
 */
export function zodToJsonSchemaOrNull(zodSchema: unknown): JsonSchema | null {
  if (!isZodSchema(zodSchema)) return null

  try {
    const jsonSchema = toJSONSchema(zodSchema, {
      reused: 'inline',
      io: 'input',
      unrepresentable: 'any',
    })
    if (!isJsonSchemaObject(jsonSchema)) {
      throw new TypeError('Zod schema conversion produced a non-object schema')
    }
    const schemaObject: JsonSchema = jsonSchema

    // Strip the top-level $schema key for MCP compatibility
    const { $schema: _$schema, ...rest } = schemaObject
    return rest
  } catch (err) {
    // Zod v4 crashes on z.record(z.string()) — single-arg record missing key schema
    const msg = err instanceof TypeError && String(err.message).includes('_zod')
      ? 'Zod schema conversion failed. If using z.record(), provide both key and value types: z.record(z.string(), z.string()) instead of z.record(z.string())'
      : `Zod schema conversion failed: ${err instanceof Error ? err.message : err}`
    throw new Error(msg, {
      cause: err instanceof Error ? err : undefined,
    })
  }
}

/** Parse with Zod and convert ZodError → ValidationError at the boundary */
export function parseZod<T>(schema: { parse: (args: unknown) => T }, args: unknown): T {
  try {
    return schema.parse(args)
  } catch (err) {
    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
        message: issue.message,
      }))
      throw new ValidationError('Validation error', details)
    }
    throw err
  }
}
