import { describe, expect, it } from 'vitest'
import { parseHttpMethod } from '../src/http-method.js'

describe('parseHttpMethod', () => {
  it('normalizes lowercase methods to the canonical union', () => {
    expect(parseHttpMethod('patch')).toBe('PATCH')
  })

  it('throws for unsupported methods', () => {
    expect(() => parseHttpMethod('TRACE')).toThrow('HTTP method: unsupported value "TRACE"')
  })
})
