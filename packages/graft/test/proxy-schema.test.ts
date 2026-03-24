import { describe, it, expect } from 'vitest'
import { extractPathParams, mergePathParams, resolveJsonSchemaRefs, mergeAllOf } from '../src/proxy/schema.js'

describe('extractPathParams', () => {
  it('extracts :param segments', () => {
    expect(extractPathParams('/items/:id')).toEqual(['id'])
  })

  it('extracts {param} segments', () => {
    expect(extractPathParams('/items/{id}')).toEqual(['id'])
  })

  it('extracts multiple params', () => {
    expect(extractPathParams('/projects/:projectId/items/:itemId')).toEqual(['projectId', 'itemId'])
  })

  it('returns empty array for no params', () => {
    expect(extractPathParams('/items')).toEqual([])
  })
})

describe('mergePathParams', () => {
  it('creates schema from path params when no base schema', () => {
    const result = mergePathParams(null, ['id'])
    expect(result).toEqual({
      type: 'object',
      properties: { id: { type: 'string', description: 'Path parameter: id' } },
      required: ['id'],
    })
  })

  it('merges path params with existing schema without overriding', () => {
    const base = {
      type: 'object',
      properties: { id: { type: 'string', description: 'Custom desc' } },
    }
    const result = mergePathParams(base, ['id'])!
    expect((result.properties as any).id.description).toBe('Custom desc')
    expect(result.required).toEqual(['id'])
  })

  it('returns null when no path params and no schema', () => {
    expect(mergePathParams(null, [])).toBeNull()
  })

  it('returns original schema when no path params', () => {
    const base = { type: 'object', properties: { q: { type: 'string' } } }
    expect(mergePathParams(base, [])).toBe(base)
  })

  it('does not mutate the original schema when adding path params', () => {
    const base = {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    }

    const result = mergePathParams(base, ['id'])

    expect(result).toEqual({
      type: 'object',
      properties: {
        q: { type: 'string' },
        id: { type: 'string', description: 'Path parameter: id' },
      },
      required: ['q', 'id'],
    })
    expect(base).toEqual({
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    })
  })
})

describe('resolveJsonSchemaRefs', () => {
  it('resolves a simple $ref', () => {
    const definitions = {
      Address: { type: 'object', properties: { street: { type: 'string' } } },
    }
    const input = { $ref: '#/definitions/Address' }
    const result = resolveJsonSchemaRefs(input, definitions)
    expect(result).toEqual({ type: 'object', properties: { street: { type: 'string' } } })
  })

  it('resolves nested $refs', () => {
    const definitions = {
      Name: { type: 'string' },
      Person: { type: 'object', properties: { name: { $ref: '#/definitions/Name' } } },
    }
    const input = { $ref: '#/definitions/Person' }
    const result = resolveJsonSchemaRefs(input, definitions) as any
    expect(result.properties.name).toEqual({ type: 'string' })
  })

  it('resolves $refs inside arrays', () => {
    const definitions = {
      Tag: { type: 'string' },
    }
    const input = { type: 'array', items: { $ref: '#/definitions/Tag' } }
    const result = resolveJsonSchemaRefs(input, definitions) as any
    expect(result.items).toEqual({ type: 'string' })
  })

  it('merges allOf', () => {
    const definitions = {}
    const input = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    }
    const result = resolveJsonSchemaRefs(input, definitions) as any
    expect(result.properties.a).toEqual({ type: 'string' })
    expect(result.properties.b).toEqual({ type: 'number' })
    expect(result.required).toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('detects circular $ref and throws', () => {
    const definitions = {
      A: { $ref: '#/definitions/B' },
      B: { $ref: '#/definitions/A' },
    }
    const input = { $ref: '#/definitions/A' }
    expect(() => resolveJsonSchemaRefs(input, definitions)).toThrow(/Circular \$ref detected/)
  })

  it('supports custom ref prefix', () => {
    const schemas = {
      Item: { type: 'object', properties: { id: { type: 'string' } } },
    }
    const input = { $ref: '#/components/schemas/Item' }
    const result = resolveJsonSchemaRefs(input, schemas, '#/components/schemas/')
    expect(result).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('returns input unchanged for unknown $ref', () => {
    const input = { $ref: '#/definitions/Unknown' }
    const result = resolveJsonSchemaRefs(input, {})
    expect(result).toEqual(input)
  })

  it('passes through primitives unchanged', () => {
    expect(resolveJsonSchemaRefs('hello', {})).toBe('hello')
    expect(resolveJsonSchemaRefs(42, {})).toBe(42)
    expect(resolveJsonSchemaRefs(null, {})).toBe(null)
    expect(resolveJsonSchemaRefs(undefined, {})).toBe(undefined)
  })
})

describe('mergeAllOf', () => {
  it('unions properties from multiple schemas', () => {
    const result = mergeAllOf([
      { type: 'object', properties: { a: { type: 'string' } } },
      { properties: { b: { type: 'number' } } },
    ])
    expect(result.properties).toEqual({ a: { type: 'string' }, b: { type: 'number' } })
  })

  it('unions required arrays', () => {
    const result = mergeAllOf([
      { required: ['a'] },
      { required: ['b', 'a'] },
    ])
    expect(result.required).toEqual(['a', 'b'])
  })

  it('later entries win for non-special fields', () => {
    const result = mergeAllOf([
      { type: 'object', description: 'first' },
      { description: 'second' },
    ])
    expect(result.description).toBe('second')
  })
})
