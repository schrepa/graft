import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

describe('router path decoding', () => {
  it('returns 400 for malformed percent-encoded path params', async () => {
    const app = createApp({ name: 'router-test' })
    app.tool('get_item', {
      description: 'Read one item',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      http: { method: 'GET', path: '/items/:id' },
      handler: ({ id }) => ({ id }),
    })

    const response = await app.build().fetch(new Request('http://localhost:3000/items/%E0%A4%A'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid URL path encoding' })
  })
})
