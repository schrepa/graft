import { describe, expect, it } from 'vitest'
import { GraftError, ToolError, ValidationError } from '../src/errors.js'
import { errorResponse, toHttpResponse } from '../src/http/responses.js'
import type { DispatchSuccess } from '../src/types.js'

describe('errorResponse', () => {
  it('preserves ToolError headers and explicit codes', async () => {
    const response = errorResponse(
      new ToolError('Rate limited', 429, {
        code: 'RATE_LIMITED',
        headers: { 'Retry-After': '60' },
      }),
      'req-1',
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('x-request-id')).toBe('req-1')
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.json()).toEqual({
      error: 'Rate limited',
      code: 'RATE_LIMITED',
    })
  })

  it('preserves validation details for thrown ValidationError values', async () => {
    const response = errorResponse(
      new ValidationError('Invalid input', [{ path: 'name', message: 'Required' }]),
      'req-2',
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid input',
      details: [{ path: 'name', message: 'Required' }],
    })
  })

  it('preserves explicit codes for thrown GraftError values', async () => {
    const response = errorResponse(new GraftError('Conflict', 409, 'ALREADY_EXISTS'), 'req-3')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Conflict',
      code: 'ALREADY_EXISTS',
    })
  })
})

describe('toHttpResponse', () => {
  it('treats application/problem+json as JSON content', async () => {
    const outcome: DispatchSuccess = {
      requestId: 'req-4',
      ok: true,
      value: { title: 'Conflict' },
      response: { contentType: 'application/problem+json', statusCode: 409 },
    }

    const response = toHttpResponse(outcome)
    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({ title: 'Conflict' })
  })
})
