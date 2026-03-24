import { describe, it, expect } from 'vitest'
import { deriveToolName, deriveSideEffects } from '../src/derivation.js'

describe('deriveToolName', () => {
  // Method-as-prefix: GET
  it('GET /items → get_items (collection keeps plural)', () => {
    expect(deriveToolName('GET', '/items')).toBe('get_items')
  })

  it('GET /products → get_products', () => {
    expect(deriveToolName('GET', '/products')).toBe('get_products')
  })

  it('GET /users → get_users', () => {
    expect(deriveToolName('GET', '/users')).toBe('get_users')
  })

  // GET with param → singularize last
  it('GET /items/:id → get_item', () => {
    expect(deriveToolName('GET', '/items/:id')).toBe('get_item')
  })

  it('GET /users/:userId → get_user', () => {
    expect(deriveToolName('GET', '/users/:userId')).toBe('get_user')
  })

  it('GET /categories/:id → get_category', () => {
    expect(deriveToolName('GET', '/categories/:id')).toBe('get_category')
  })

  // POST → always singularize last
  it('POST /items → post_item', () => {
    expect(deriveToolName('POST', '/items')).toBe('post_item')
  })

  it('POST /users → post_user', () => {
    expect(deriveToolName('POST', '/users')).toBe('post_user')
  })

  // PUT → method-as-prefix
  it('PUT /items/:id → put_item', () => {
    expect(deriveToolName('PUT', '/items/:id')).toBe('put_item')
  })

  // PATCH → method-as-prefix
  it('PATCH /items/:id → patch_item', () => {
    expect(deriveToolName('PATCH', '/items/:id')).toBe('patch_item')
  })

  // DELETE → method-as-prefix
  it('DELETE /items/:id → delete_item', () => {
    expect(deriveToolName('DELETE', '/items/:id')).toBe('delete_item')
  })

  // Nested resources — intermediates singularized
  it('GET /books/:id/sessions → get_book_sessions', () => {
    expect(deriveToolName('GET', '/books/:id/sessions')).toBe('get_book_sessions')
  })

  it('POST /books/:id/sessions → post_book_session', () => {
    expect(deriveToolName('POST', '/books/:id/sessions')).toBe('post_book_session')
  })

  it('GET /users/:userId/orders → get_user_orders', () => {
    expect(deriveToolName('GET', '/users/:userId/orders')).toBe('get_user_orders')
  })

  it('GET /users/:userId/orders/:orderId → get_user_order', () => {
    expect(deriveToolName('GET', '/users/:userId/orders/:orderId')).toBe('get_user_order')
  })

  // Strip /api/ prefix
  it('GET /api/items → get_items', () => {
    expect(deriveToolName('GET', '/api/items')).toBe('get_items')
  })

  it('GET /api/items/:id → get_item', () => {
    expect(deriveToolName('GET', '/api/items/:id')).toBe('get_item')
  })

  // Strip /v1/ prefix
  it('GET /v1/items → get_items', () => {
    expect(deriveToolName('GET', '/v1/items')).toBe('get_items')
  })

  it('GET /v2/items/:id → get_item', () => {
    expect(deriveToolName('GET', '/v2/items/:id')).toBe('get_item')
  })

  // Edge cases
  it('GET / → get', () => {
    expect(deriveToolName('GET', '/')).toBe('get')
  })

  it('handles curly-brace params: GET /items/{id}', () => {
    expect(deriveToolName('GET', '/items/{id}')).toBe('get_item')
  })

  // Singularization edge cases
  it('singularizes -ies → -y', () => {
    expect(deriveToolName('GET', '/categories/:id')).toBe('get_category')
  })

  it('singularizes -ses → strips -es', () => {
    expect(deriveToolName('DELETE', '/addresses/:id')).toBe('delete_address')
  })

  it('POST /statuses → post_status', () => {
    expect(deriveToolName('POST', '/statuses')).toBe('post_status')
  })

  // Irregular plurals (-ves)
  it('POST /shelves → post_shelf', () => {
    expect(deriveToolName('POST', '/shelves')).toBe('post_shelf')
  })

  it('GET /shelves/:id → get_shelf', () => {
    expect(deriveToolName('GET', '/shelves/:id')).toBe('get_shelf')
  })

  it('GET /shelves → get_shelves (collection keeps plural)', () => {
    expect(deriveToolName('GET', '/shelves')).toBe('get_shelves')
  })

  it('DELETE /knives/:id → delete_knife', () => {
    expect(deriveToolName('DELETE', '/knives/:id')).toBe('delete_knife')
  })

  // All lowercase
  it('normalizes to lowercase', () => {
    expect(deriveToolName('GET', '/API/Items')).toBe('get_items')
  })

  // Action routes
  it('POST /users/:id/activate → post_user_activate', () => {
    expect(deriveToolName('POST', '/users/:id/activate')).toBe('post_user_activate')
  })
})

describe('deriveSideEffects', () => {
  it('GET has no side effects', () => {
    expect(deriveSideEffects('GET')).toBe(false)
  })

  it('HEAD has no side effects', () => {
    expect(deriveSideEffects('HEAD')).toBe(false)
  })

  it('OPTIONS has no side effects', () => {
    expect(deriveSideEffects('OPTIONS')).toBe(false)
  })

  it('POST has side effects', () => {
    expect(deriveSideEffects('POST')).toBe(true)
  })

  it('PUT has side effects', () => {
    expect(deriveSideEffects('PUT')).toBe(true)
  })

  it('PATCH has side effects', () => {
    expect(deriveSideEffects('PATCH')).toBe(true)
  })

  it('DELETE has side effects', () => {
    expect(deriveSideEffects('DELETE')).toBe(true)
  })
})
