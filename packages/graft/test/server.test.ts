import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import { buildWebRequest, buildRequestHead, writeWebResponse, startServer } from '../src/server.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { GraftError, ToolError } from '../src/errors.js'
import { createDeferred, silentLogger } from './helpers/common.js'
import { canListenOnLoopback, listenOnLoopback, loopbackUrl } from './test-server.js'

function stubMcp() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    getManifest: () => ({ tools: [], resources: [], resourceTemplates: [], prompts: [] }),
  } as any
}

const describeLoopback = await canListenOnLoopback() ? describe : describe.skip

/** Find a free port by binding to port 0 */
async function freePort(): Promise<number> {
  const srv = createServer()
  const port = await listenOnLoopback(srv)
  await new Promise<void>((resolve, reject) => srv.close((err) => err ? reject(err) : resolve()))
  return port
}

// ---------------------------------------------------------------------------
// buildWebRequest
// ---------------------------------------------------------------------------

describe('buildWebRequest', () => {
  it('attaches signal to resulting Request when provided', async () => {
    const ac = new AbortController()
    // Simulate a minimal IncomingMessage for a GET (no body)
    const req = {
      method: 'GET',
      url: '/test',
      headers: { host: 'localhost:3000' },
      [Symbol.asyncIterator]: async function* () {},
    } as unknown as IncomingMessage

    const result = await buildWebRequest(req, 3000, undefined, ac.signal)
    // The signal is passed through to the Request — aborting the source aborts the request
    expect(result.signal.aborted).toBe(false)
    ac.abort()
    expect(result.signal.aborted).toBe(true)
  })

  it('builds a Request with the default signal when none is provided', async () => {
    const req = {
      method: 'GET',
      url: '/test',
      headers: { host: 'localhost:3000' },
      [Symbol.asyncIterator]: async function* () {},
    } as unknown as IncomingMessage

    const result = await buildWebRequest(req, 3000)
    // The request should still have a signal (the default one) but not our custom one
    expect(result.url).toBe('http://localhost:3000/test')
  })
})

// ---------------------------------------------------------------------------
// writeWebResponse
// ---------------------------------------------------------------------------

describe('writeWebResponse', () => {
  function mockRes(): ServerResponse {
    const chunks: Uint8Array[] = []
    let ended = false
    const res = {
      writeHead: vi.fn(),
      write: vi.fn((chunk: Uint8Array) => { chunks.push(chunk) }),
      end: vi.fn(() => { ended = true }),
      destroyed: false,
      headersSent: false,
      _chunks: chunks,
      _ended: () => ended,
    }
    return res as unknown as ServerResponse
  }

  it('writes a normal response body to completion', async () => {
    const res = mockRes()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'))
        controller.close()
      },
    })
    const webResponse = new Response(body, { status: 200 })

    await writeWebResponse(res, webResponse)
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.write).toHaveBeenCalled()
    expect(res.end).toHaveBeenCalled()
  })

  it('handles response with no body', async () => {
    const res = mockRes()
    const webResponse = new Response(null, { status: 204 })

    await writeWebResponse(res, webResponse)
    expect(res.end).toHaveBeenCalled()
    expect(res.write).not.toHaveBeenCalled()
  })

  it('closes the response stream immediately after abort', async () => {
    const ac = new AbortController()
    const res = mockRes()

    const body = new ReadableStream({
      start(_controller) {
        // Stream stays open — simulates SSE idle stream
      },
    })
    const webResponse = new Response(body, { status: 200 })

    const writePromise = writeWebResponse(res, webResponse, ac.signal)
    ac.abort()

    await writePromise
    expect(res.end).toHaveBeenCalled()
  })

  it('cancels reader when signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort() // pre-aborted
    const res = mockRes()

    const body = new ReadableStream({
      start(_controller) {
        // idle stream
      },
    })
    const webResponse = new Response(body, { status: 200 })

    await writeWebResponse(res, webResponse, ac.signal)
    expect(res.end).toHaveBeenCalled()
  })

  it('logs reader cancel failures through the injected logger', async () => {
    const res = mockRes()
    const logger = { error: vi.fn() }
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ac = new AbortController()
    ac.abort()

    const reader = {
      read: vi.fn(async () => ({ done: true, value: undefined })),
      cancel: vi.fn(() => Promise.reject(new Error('cancel failed'))),
      releaseLock: vi.fn(),
    }
    const webResponse = {
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response

    try {
      await writeWebResponse(res, webResponse, ac.signal, logger)
      await Promise.resolve()

      expect(logger.error).toHaveBeenCalledWith('[graft] Failed to cancel response reader:', expect.any(Error))
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('propagates real stream errors (not abort)', async () => {
    const res = mockRes()
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('stream broke'))
      },
    })
    const webResponse = new Response(body, { status: 200 })

    await expect(writeWebResponse(res, webResponse)).rejects.toThrow('stream broke')
  })

  it('exits cleanly when res is destroyed mid-stream', async () => {
    const res = mockRes()
    // Pre-destroy the socket — writeWebResponse should break out of the loop
    ;(res as any).destroyed = true

    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data'))
        // Don't close — simulates an ongoing stream
      },
    })
    const webResponse = new Response(body, { status: 200 })

    // Should not throw — exits the loop when res.destroyed is detected
    await writeWebResponse(res, webResponse)
    // write() should not be called since destroyed is checked after read()
    expect(res.write).not.toHaveBeenCalled()
    // end() should not be called on a destroyed socket
    expect(res.end).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

describeLoopback('startServer', () => {
  let handles: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    for (const h of handles) {
      await h.close().catch(() => {})
    }
    handles = []
  })

  it('returns ServerHandle with server, shutdownSignal, and close', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      logger: silentLogger() as any,
    })
    handles.push(handle)

    expect(handle.server).toBeDefined()
    expect(handle.shutdownSignal).toBeInstanceOf(AbortSignal)
    expect(handle.shutdownSignal.aborted).toBe(false)
    expect(typeof handle.close).toBe('function')
  })

  it('preserves GraftError status codes thrown by the fetch handler', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => {
        throw new GraftError('Forbidden', 403, 'FORBIDDEN')
      },
      logger: silentLogger() as any,
    })
    handles.push(handle)

    const response = await fetch(loopbackUrl(port, '/forbidden'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' })
  })

  it('preserves ToolError headers thrown by the fetch handler', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => {
        throw new ToolError('Rate limited', 429, { headers: { 'Retry-After': '60' } })
      },
      logger: silentLogger() as any,
    })
    handles.push(handle)

    const response = await fetch(loopbackUrl(port, '/rate-limited'))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ error: 'Rate limited' })
  })

  it('shutdown aborts shutdownSignal', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      logger: silentLogger() as any,
    })
    handles.push(handle)

    expect(handle.shutdownSignal.aborted).toBe(false)
    await handle.close()
    expect(handle.shutdownSignal.aborted).toBe(true)
  })

  it('close() is memoized — multiple calls return the same promise', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      logger: silentLogger() as any,
    })
    handles.push(handle)

    const p1 = handle.close()
    const p2 = handle.close()
    expect(p1).toBe(p2)
    await p1
  })

  it('close() awaits server.close() before resolving', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      logger: silentLogger() as any,
    })
    handles.push(handle)

    await handle.close()
    // After close resolves, server should no longer be listening
    expect(handle.server.listening).toBe(false)
  })

  it('close() calls onShutdown and mcp.close()', async () => {
    const port = await freePort()
    const onShutdown = vi.fn()
    const mcp = stubMcp()
    const handle = await startServer({
      mcp,
      port,
      fetch: async () => new Response('ok'),
      onShutdown,
      logger: silentLogger() as any,
    })
    handles.push(handle)

    await handle.close()
    expect(onShutdown).toHaveBeenCalled()
    expect(mcp.close).toHaveBeenCalled()
  })

  it('listen failure (EADDRINUSE) rejects the promise', async () => {
    const port = await freePort()
    // Start a server on that port first
    const blocker = createServer()
    await listenOnLoopback(blocker, port)

    const mcp = stubMcp()
    try {
      await expect(
        startServer({
          mcp,
          port,
          host: '127.0.0.1',
          fetch: async () => new Response('ok'),
          logger: silentLogger() as any,
        })
      ).rejects.toThrow()

      // mcp.close() should still be called for cleanup
      expect(mcp.close).toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) =>
        blocker.close((err) => err ? reject(err) : resolve())
      )
    }
  })

  it('per-request signal fires on response close and is attached to request', async () => {
    const port = await freePort()
    let receivedSignal: AbortSignal | undefined

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async (request) => {
        receivedSignal = request.signal
        return new Response('ok')
      },
      host: '127.0.0.1',
      logger: silentLogger() as any,
    })
    handles.push(handle)

    // Make a request
    const res = await fetch(loopbackUrl(port, '/test'))
    expect(res.status).toBe(200)
    expect(receivedSignal).toBeDefined()
    expect(receivedSignal).toBeInstanceOf(AbortSignal)
  })

  it('draining server returns 503', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      host: '127.0.0.1',
      fetch: async () => new Response('ok'),
      logger: silentLogger() as any,
    })
    handles.push(handle)

    // Start shutdown (don't await — we want to make a request while draining)
    const closePromise = handle.close()

    try {
      const res = await fetch(loopbackUrl(port, '/test'))
      // Should be 503 or connection refused (depending on timing)
      if (res) {
        expect(res.status).toBe(503)
      }
    } catch {
      // Connection refused is also acceptable after shutdown
    }

    await closePromise
  })

  it('force-destroys connections after shutdown timeout', async () => {
    const port = await freePort()
    const logger = silentLogger()
    let receivedSignal: AbortSignal | undefined

    let resolveRequest: () => void
    const requestStarted = new Promise<void>(r => { resolveRequest = r })

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      host: '127.0.0.1',
      fetch: async (request) => {
        receivedSignal = request.signal
        resolveRequest!()
        // Simulate a slow request that never completes
        await new Promise(() => {})
        return new Response('ok')
      },
      shutdownTimeoutMs: 200, // Very short timeout for test
      logger: logger as any,
    })
    handles.push(handle)

    // Start a request that will hang
    const reqPromise = fetch(loopbackUrl(port, '/slow')).catch(() => {})

    // Wait for the request to be received
    await requestStarted

    // Trigger shutdown — should force-close after 200ms
    await handle.close()

    // Should have logged warning about force-closing
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('force-closing'))
    expect(receivedSignal?.aborted).toBe(true)

    await reqPromise
  })

  it('lets in-flight requests finish before aborting them during shutdown', async () => {
    const port = await freePort()
    const logger = silentLogger()
    const responseDeferred = createDeferred<Response>()
    const requestStarted = createDeferred<void>()
    let receivedSignal: AbortSignal | undefined

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      host: '127.0.0.1',
      fetch: async (request) => {
        receivedSignal = request.signal
        requestStarted.resolve()
        return responseDeferred.promise
      },
      shutdownTimeoutMs: 200,
      logger: logger as any,
    })
    handles.push(handle)

    const responsePromise = fetch(loopbackUrl(port, '/slow'))
    await requestStarted.promise

    const closePromise = handle.close()
    await Promise.resolve()

    expect(receivedSignal?.aborted).toBe(false)

    responseDeferred.resolve(new Response('ok'))

    const response = await responsePromise
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')

    await closePromise
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('deprecated shutdownTimeout alias still works', async () => {
    const port = await freePort()
    const logger = silentLogger()

    let resolveRequest: () => void
    const requestStarted = new Promise<void>((resolve) => { resolveRequest = resolve })

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      host: '127.0.0.1',
      fetch: async () => {
        resolveRequest!()
        await new Promise(() => {})
        return new Response('ok')
      },
      shutdownTimeout: 200,
      logger: logger as any,
    })
    handles.push(handle)

    const reqPromise = fetch(loopbackUrl(port, '/slow')).catch(() => {})
    await requestStarted
    await handle.close()

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('force-closing'))
    await reqPromise
  })

  // ---------------------------------------------------------------------------
  // configureHttpServer
  // ---------------------------------------------------------------------------

  it('configureHttpServer is called with server + shutdownSignal after onStart, before listen', async () => {
    const port = await freePort()
    const order: string[] = []

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      onStart: () => { order.push('onStart') },
      configureHttpServer: (server, signal) => {
        order.push('configureHttpServer')
        expect(server).toBeDefined()
        expect(signal).toBeInstanceOf(AbortSignal)
        expect(signal.aborted).toBe(false)
      },
      logger: silentLogger() as any,
    })
    handles.push(handle)

    // Both ran, onStart first
    expect(order).toEqual(['onStart', 'configureHttpServer'])
    // Server is listening (configureHttpServer ran before listen)
    expect(handle.server.listening).toBe(true)
  })

  it('configureHttpServer failure prevents start', async () => {
    const port = await freePort()

    await expect(
      startServer({
        mcp: stubMcp(),
        port,
        fetch: async () => new Response('ok'),
        configureHttpServer: () => { throw new Error('hook broke') },
        logger: silentLogger() as any,
      })
    ).rejects.toThrow('configureHttpServer hook failed: hook broke')
  })

  it('onStart failure still runs shutdown cleanup hooks', async () => {
    const port = await freePort()
    const mcp = stubMcp()
    const onShutdown = vi.fn()

    await expect(
      startServer({
        mcp,
        port,
        fetch: async () => new Response('ok'),
        onStart: () => { throw new Error('startup boom') },
        onShutdown,
        logger: silentLogger() as any,
      }),
    ).rejects.toThrow('onStart hook failed: startup boom')

    expect(onShutdown).toHaveBeenCalled()
    expect(mcp.close).toHaveBeenCalled()
  })

  it('configureHttpServer failure still runs shutdown cleanup hooks', async () => {
    const port = await freePort()
    const mcp = stubMcp()
    const onShutdown = vi.fn()

    await expect(
      startServer({
        mcp,
        port,
        fetch: async () => new Response('ok'),
        configureHttpServer: () => { throw new Error('hook broke') },
        onShutdown,
        logger: silentLogger() as any,
      }),
    ).rejects.toThrow('configureHttpServer hook failed: hook broke')

    expect(onShutdown).toHaveBeenCalled()
    expect(mcp.close).toHaveBeenCalled()
  })

  it('listen failure after successful configureHttpServer runs cleanup function', async () => {
    const port = await freePort()
    const cleanupCalled = vi.fn()

    // Block the port so listen fails
    const blocker = createServer()
    await listenOnLoopback(blocker, port)

    try {
      await expect(
        startServer({
          mcp: stubMcp(),
          port,
          fetch: async () => new Response('ok'),
          configureHttpServer: () => cleanupCalled,
          logger: silentLogger() as any,
        })
      ).rejects.toThrow()

      expect(cleanupCalled).toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve, reject) =>
        blocker.close((err) => err ? reject(err) : resolve())
      )
    }
  })

  it('returned cleanup function is awaited during handle.close()', async () => {
    const port = await freePort()
    const cleanupCalled = vi.fn()

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      configureHttpServer: () => cleanupCalled,
      logger: silentLogger() as any,
    })
    handles.push(handle)

    await handle.close()
    expect(cleanupCalled).toHaveBeenCalled()
  })

  it('handle.close() only resolves after cleanup completes', async () => {
    const port = await freePort()
    let cleanupResolved = false
    const cleanupDeferred = createDeferred()

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      configureHttpServer: () => {
        return async () => {
          await cleanupDeferred.promise
          cleanupResolved = true
        }
      },
      logger: silentLogger() as any,
    })
    handles.push(handle)

    const closePromise = handle.close()
    await Promise.resolve()
    expect(cleanupResolved).toBe(false)
    cleanupDeferred.resolve()
    await closePromise
    expect(cleanupResolved).toBe(true)
  })

  it('async setup returning cleanup — the hardest return shape', async () => {
    const port = await freePort()
    const order: string[] = []
    const setupDeferred = createDeferred()

    const startup = startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      configureHttpServer: async (_server, _signal) => {
        order.push('async-setup')
        await setupDeferred.promise
        return () => { order.push('cleanup') }
      },
      logger: silentLogger() as any,
    })
    setupDeferred.resolve()
    const handle = await startup
    handles.push(handle)

    expect(order).toEqual(['async-setup'])

    await handle.close()
    expect(order).toEqual(['async-setup', 'cleanup'])
  })

  it('cleanup failure during shutdown: handle.close() still completes, error is logged', async () => {
    const port = await freePort()
    const logger = silentLogger()

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      configureHttpServer: () => {
        return () => { throw new Error('cleanup boom') }
      },
      logger: logger as any,
    })
    handles.push(handle)

    // close() should not throw even though cleanup throws
    await handle.close()
    expect(logger.error).toHaveBeenCalledWith(
      '[graft] configureHttpServer cleanup failed:',
      expect.any(Error),
    )
  })

  it('shutdown stops accepts before signaling (no new upgrades during cleanup)', async () => {
    const port = await freePort()
    let serverListeningDuringCleanup: boolean | undefined
    let signalAbortedDuringCleanup: boolean | undefined

    const handle = await startServer({
      mcp: stubMcp(),
      port,
      fetch: async () => new Response('ok'),
      configureHttpServer: (server, signal) => {
        return () => {
          serverListeningDuringCleanup = server.listening
          signalAbortedDuringCleanup = signal.aborted
        }
      },
      logger: silentLogger() as any,
    })
    handles.push(handle)

    await handle.close()
    // server.close() called before cleanup — server should no longer be accepting
    expect(serverListeningDuringCleanup).toBe(false)
    // shutdownController.abort() called before cleanup
    expect(signalAbortedDuringCleanup).toBe(true)
  })

  it('returns 413 when the request body exceeds maxBodySize', async () => {
    const port = await freePort()
    const handle = await startServer({
      mcp: stubMcp(),
      port,
      maxBodySize: 16,
      fetch: async () => new Response('ok'),
      logger: silentLogger() as any,
    })
    handles.push(handle)

    const res = await fetch(loopbackUrl(port, '/submit'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'payload that is intentionally too large' }),
    })

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Request body too large' })
  })

  it('skips process signal handler registration when installSignalHandlers is false', async () => {
    const port = await freePort()
    const onceSpy = vi.spyOn(process, 'once')
    const removeListenerSpy = vi.spyOn(process, 'removeListener')

    try {
      const handle = await startServer({
        mcp: stubMcp(),
        port,
        host: '127.0.0.1',
        fetch: async () => new Response('ok'),
        installSignalHandlers: false,
        logger: silentLogger() as any,
      })
      handles.push(handle)

      expect(onceSpy).not.toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(onceSpy).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function))

      await handle.close()

      expect(removeListenerSpy).not.toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(removeListenerSpy).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    } finally {
      onceSpy.mockRestore()
      removeListenerSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// buildRequestHead
// ---------------------------------------------------------------------------

describe('buildRequestHead', () => {
  it('converts IncomingMessage to Request with correct headers/URL/method', () => {
    const req = {
      method: 'POST',
      url: '/api/test?q=1',
      headers: {
        host: 'example.com',
        authorization: 'Bearer token123',
        'content-type': 'application/json',
      },
      httpVersion: '1.1',
    } as unknown as IncomingMessage

    const result = buildRequestHead(req)
    expect(result.url).toBe('http://example.com/api/test?q=1')
    expect(result.method).toBe('POST')
    expect(result.headers.get('authorization')).toBe('Bearer token123')
    expect(result.headers.get('content-type')).toBe('application/json')
  })

  it('uses hostFallback when host header is missing', () => {
    const req = {
      method: 'GET',
      url: '/test',
      headers: {},
    } as unknown as IncomingMessage

    const result = buildRequestHead(req, 'myhost:3000')
    expect(result.url).toBe('http://myhost:3000/test')
  })

  it('defaults to GET method and / URL when missing', () => {
    const req = {
      headers: {},
    } as unknown as IncomingMessage

    const result = buildRequestHead(req)
    expect(result.method).toBe('GET')
    expect(result.url).toBe('http://localhost/')
  })

  it('joins array header values with comma', () => {
    const req = {
      method: 'GET',
      url: '/test',
      headers: {
        host: 'localhost',
        'set-cookie': ['a=1', 'b=2'],
      },
    } as unknown as IncomingMessage

    const result = buildRequestHead(req)
    expect(result.headers.get('set-cookie')).toBe('a=1, b=2')
  })
})
