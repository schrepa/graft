import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { zodToJsonSchemaOrNull } from '../src/schema.js'

describe('zodToJsonSchemaOrNull', () => {
  it('converts a simple Zod object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    const result = zodToJsonSchemaOrNull(schema)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('object')
    expect(result!.properties).toBeDefined()
    const props = result!.properties as Record<string, { type: string }>
    expect(props.name.type).toBe('string')
    expect(props.age.type).toBe('number')
  })

  it('returns null for non-Zod values', () => {
    expect(zodToJsonSchemaOrNull(null)).toBeNull()
    expect(zodToJsonSchemaOrNull(undefined)).toBeNull()
    expect(zodToJsonSchemaOrNull(42)).toBeNull()
    expect(zodToJsonSchemaOrNull('string')).toBeNull()
    expect(zodToJsonSchemaOrNull({})).toBeNull()
  })

  it('strips $schema from output', () => {
    const schema = z.object({ x: z.string() })
    const result = zodToJsonSchemaOrNull(schema)
    expect(result).not.toHaveProperty('$schema')
  })

  it('handles optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    })

    const result = zodToJsonSchemaOrNull(schema)
    expect(result).not.toBeNull()
    expect(result!.required).toEqual(['required'])
  })
})
