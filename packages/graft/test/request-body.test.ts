import { describe, expect, it } from 'vitest'
import { GraftError } from '../src/errors.js'
import { parseJsonBody, Router } from '../src/http.js'
import { readJsonRpcBody } from '../src/mcp/transport.js'

function createAbortingRequest(): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new DOMException('aborted', 'AbortError'))
    },
  })

  return new Request('http://localhost/test', {
    method: 'POST',
    body,
    duplex: 'half',
  })
}

describe('Router', () => {
  it('passes decoded path params to route handlers explicitly', async () => {
    const router = new Router()
    router.add('GET', '/items/:itemId/orders/:orderId', (_request, pathParams) =>
      Response.json(pathParams),
    )

    const response = await router.fetch(
      new Request('http://localhost/items/widget%201/orders/order%2F2'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      itemId: 'widget 1',
      orderId: 'order/2',
    })
  })
})

describe('parseJsonBody', () => {
  it('wraps invalid JSON as an HTTP validation error', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })

    await expect(parseJsonBody(request)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_JSON_BODY',
    })
  })

  it('maps aborted body reads to REQUEST_CANCELLED', async () => {
    await expect(parseJsonBody(createAbortingRequest())).rejects.toBeInstanceOf(GraftError)
    await expect(parseJsonBody(createAbortingRequest())).rejects.toMatchObject({
      statusCode: 499,
      code: 'REQUEST_CANCELLED',
    })
  })
})

describe('readJsonRpcBody', () => {
  it('keeps invalid JSON on the MCP parse-error path', async () => {
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })

    const result = await readJsonRpcBody(request)
    expect(result).toBeInstanceOf(Response)

    const response = result as Response
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    })
  })

  it('maps aborted MCP body reads to REQUEST_CANCELLED', async () => {
    await expect(readJsonRpcBody(createAbortingRequest())).rejects.toBeInstanceOf(GraftError)
    await expect(readJsonRpcBody(createAbortingRequest())).rejects.toMatchObject({
      statusCode: 499,
      code: 'REQUEST_CANCELLED',
    })
  })
})
