import { describe, it, expect } from 'vitest'
import { matchUriTemplate, uriTemplateToHttpPath } from '../src/uri-template.js'

describe('matchUriTemplate', () => {
  it('matches single param', () => {
    expect(matchUriTemplate('products://abc', 'products://{id}'))
      .toEqual({ id: 'abc' })
  })

  it('matches multi-segment param', () => {
    expect(matchUriTemplate('orders://user123/order456', 'orders://{userId}/{orderId}'))
      .toEqual({ userId: 'user123', orderId: 'order456' })
  })

  it('returns null on non-match (different scheme)', () => {
    expect(matchUriTemplate('orders://abc', 'products://{id}'))
      .toBeNull()
  })

  it('returns null on non-match (extra segments)', () => {
    expect(matchUriTemplate('products://abc/extra', 'products://{id}'))
      .toBeNull()
  })

  it('returns null on non-match (fewer segments)', () => {
    expect(matchUriTemplate('orders://abc', 'orders://{userId}/{orderId}'))
      .toBeNull()
  })

  it('decodes URI-encoded params', () => {
    expect(matchUriTemplate('products://hello%20world', 'products://{id}'))
      .toEqual({ id: 'hello world' })
  })

  it('matches template with no params (exact match)', () => {
    expect(matchUriTemplate('config://settings', 'config://settings'))
      .toEqual({})
  })

  it('returns null for partial match', () => {
    expect(matchUriTemplate('products://abc123', 'products://{id}/details'))
      .toBeNull()
  })
})

describe('uriTemplateToHttpPath', () => {
  it('converts single param', () => {
    expect(uriTemplateToHttpPath('products://{id}'))
      .toBe('/products/:id')
  })

  it('converts multi-param', () => {
    expect(uriTemplateToHttpPath('orders://{userId}/{orderId}'))
      .toBe('/orders/:userId/:orderId')
  })

  it('handles nested paths', () => {
    expect(uriTemplateToHttpPath('api://users/{id}/posts'))
      .toBe('/api/users/:id/posts')
  })

  it('handles no params', () => {
    expect(uriTemplateToHttpPath('config://settings'))
      .toBe('/config/settings')
  })
})
