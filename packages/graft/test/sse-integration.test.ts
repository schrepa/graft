import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '../src/app.js'
import { GraftError } from '../src/errors.js'
import type { ServerHandle } from '../src/server.js'
import { createDeferred, silentLogger } from './helpers/common.js'
import { canListenOnLoopback, getBoundPort, loopbackUrl } from './test-server.js'

const describeLoopback = await canListenOnLoopback() ? describe : describe.skip

describeLoopback('SSE integration', () => {
  let handle: ServerHandle | undefined

  afterEach(async () => {
    if (handle) {
      await handle.close().catch(() => {})
      handle = undefined
    }
  })

  it('SSE route with request.signal — client disconnect fires signal, stream closes', async () => {
    let cleanedUp = false
    const cleaned = createDeferred<void>()
    const app = createApp({ name: 'sse-test', logger: silentLogger() })
    app.tool('greet', { description: 'hi', handler: () => 'hello' })

    app.route('GET', '/events', async (request) => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          // Send initial event
          controller.enqueue(encoder.encode(`data: hello\n\n`))

          const cleanup = () => {
            cleanedUp = true
            cleaned.resolve()
            controller.close()
          }
          if (request.signal.aborted) {
            cleanup()
          } else {
            request.signal.addEventListener('abort', cleanup, { once: true })
          }
        },
      })
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      })
    })

    handle = await app.serve({ port: 0, host: '127.0.0.1' })
    const port = getBoundPort(handle.server)

    // Connect to SSE endpoint
    const ac = new AbortController()
    const response = await fetch(loopbackUrl(port, '/events'), { signal: ac.signal })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')

    // Read initial event
    const reader = response.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('data: hello')

    // Disconnect the client
    ac.abort()
    reader.cancel().catch(() => {})

    await cleaned.promise
    expect(cleanedUp).toBe(true)
  })

  it('SSE route with request.signal — server shutdown aborts long-lived streams after timeout', async () => {
    let cleanedUp = false
    const cleaned = createDeferred<void>()
    const app = createApp({ name: 'sse-test', logger: silentLogger() })
    app.tool('greet', { description: 'hi', handler: () => 'hello' })

    app.route('GET', '/events', async (request) => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: started\n\n`))

          const cleanup = () => {
            cleanedUp = true
            cleaned.resolve()
            controller.close()
          }
          if (request.signal.aborted) {
            cleanup()
          } else {
            request.signal.addEventListener('abort', cleanup, { once: true })
          }
        },
      })
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      })
    })

    handle = await app.serve({ port: 0, host: '127.0.0.1', shutdownTimeoutMs: 200 })
    const port = getBoundPort(handle.server)

    // Connect to SSE endpoint
    const response = await fetch(loopbackUrl(port, '/events'))
    expect(response.status).toBe(200)

    // Read initial event
    const reader = response.body!.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain('data: started')

    // Shut down server — signal should fire
    await handle.close()
    handle = undefined

    await cleaned.promise
    expect(cleanedUp).toBe(true)

    // Clean up reader
    reader.cancel().catch(() => {})
  })

  it('auth works in SSE route via app.authenticate()', async () => {
    const app = createApp({
      name: 'sse-auth-test',
      logger: silentLogger(),
      authenticate: async (req) => {
        const token = req.headers.get('authorization')
        if (!token) throw new GraftError('Unauthorized', 401)
        return { subject: token }
      },
    })
    app.tool('greet', { description: 'hi', handler: () => 'hello' })

    app.route('GET', '/events', async (request) => {
      const auth = await app.authenticate(request)
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ user: auth.subject })}\n\n`))
          controller.close()
        },
      })
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    handle = await app.serve({ port: 0, host: '127.0.0.1' })
    const port = getBoundPort(handle.server)

    // Authenticated request
    const res = await fetch(loopbackUrl(port, '/events'), {
      headers: { authorization: 'user-42' },
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"user":"user-42"')

    // Unauthenticated request — GraftError(401) propagates through the router
    const res2 = await fetch(loopbackUrl(port, '/events'))
    expect(res2.status).toBe(401)
  })
})
