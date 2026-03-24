import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { createNodeHost } from '../src/app/node-host.js'
import { richResult } from '../src/pipeline.js'
import { silentLogger } from './helpers/common.js'
import { canListenOnLoopback, getBoundPort, listenOnLoopback, loopbackUrl } from './test-server.js'

const describeLoopback = await canListenOnLoopback() ? describe : describe.skip

describeLoopback('toNodeHandler', () => {
  const servers: Server[] = []
  afterAll(() => { servers.forEach(s => s.close()) })

  function listenOnFreePort(
    handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
  ): Promise<number> {
    const server = createServer(handler)
    servers.push(server)
    return listenOnLoopback(server)
  }

  it('handles GET tool routes', async () => {
    const app = createApp({ name: 'test' })
    app.tool('greet', {
      description: 'Greet someone',
      params: z.object({ name: z.string() }),
      handler: (params) => ({ message: `Hello, ${params.name}!` }),
    })
    const port = await listenOnFreePort(app.toNodeHandler())
    const res = await fetch(loopbackUrl(port, '/greet?name=World'))
    expect(res.status).toBe(200)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('Hello, World!')
  })

  it('handles POST tool routes', async () => {
    const app = createApp({ name: 'test' })
    app.tool('create_item', {
      description: 'Create an item',
      sideEffects: true,
      params: z.object({ title: z.string() }),
      handler: (params) => ({ id: '1', title: params.title }),
    })
    const port = await listenOnFreePort(app.toNodeHandler())
    const res = await fetch(loopbackUrl(port, '/create-item'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { title: string }
    expect(body.title).toBe('Test')
  })

  it('returns 404 for unknown routes', async () => {
    const app = createApp({ name: 'test' })
    app.tool('greet', {
      description: 'Greet',
      handler: () => ({}),
    })
    const port = await listenOnFreePort(app.toNodeHandler())
    const res = await fetch(loopbackUrl(port, '/nope'))
    expect(res.status).toBe(404)
  })

  it('serves health check', async () => {
    const app = createApp({ name: 'test' })
    app.tool('greet', { description: 'Greet', handler: () => ({}) })
    const port = await listenOnFreePort(app.toNodeHandler())
    const res = await fetch(loopbackUrl(port, '/health'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('returns 413 when the request body exceeds maxBodySize', async () => {
    const app = createApp({ name: 'test' })
    app.tool('create_item', {
      description: 'Create an item',
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const port = await listenOnFreePort(app.toNodeHandler({ maxBodySize: 16 }))
    const res = await fetch(loopbackUrl(port, '/create-item'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'payload that is intentionally too large' }),
    })

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Request body too large' })
  })
})

describe('HTTP binary responses', () => {
  it('writes ArrayBuffer rich results without stringifying bytes', async () => {
    const app = createApp({ name: 'test' })
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer

    app.tool('avatar', {
      description: 'Get avatar bytes',
      handler: () => richResult(bytes, 'image/png'),
    })

    const response = await app.toFetch()(new Request('http://localhost/avatar'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})

describeLoopback('app.serve()', () => {
  it('returns ServerHandle and handle.close() shuts down cleanly', async () => {
    const app = createApp({ name: 'test-app', logger: silentLogger() })
    app.tool('greet', { description: 'hi', handler: () => 'hello' })

    const handle = await app.serve({ port: 0, host: '127.0.0.1' })
    try {
      expect(handle).toBeDefined()
      expect(handle.server).toBeDefined()
      expect(handle.shutdownSignal).toBeInstanceOf(AbortSignal)
      expect(typeof handle.close).toBe('function')
      expect(handle.server.listening).toBe(true)
    } finally {
      await handle.close()
    }

    expect(handle.server.listening).toBe(false)
    expect(handle.shutdownSignal.aborted).toBe(true)
  })

  it('passes configureHttpServer through to startServer', async () => {
    const app = createApp({ name: 'test-app', logger: silentLogger() })
    app.tool('greet', { description: 'hi', handler: () => 'hello' })

    let receivedServer: unknown
    let receivedSignal: unknown

    const handle = await app.serve({
      port: 0,
      host: '127.0.0.1',
      configureHttpServer: (server, signal) => {
        receivedServer = server
        receivedSignal = signal
      },
    })
    try {
      expect(receivedServer).toBeDefined()
      expect(receivedSignal).toBeInstanceOf(AbortSignal)
    } finally {
      await handle.close()
    }
  })

  it('forwards logger and maxBodySize into the standalone server', async () => {
    const logger = silentLogger()
    const app = createApp({ name: 'test-app' })
    app.tool('create_item', {
      description: 'Create',
      sideEffects: true,
      handler: () => ({ ok: true }),
    })

    const handle = await app.serve({
      port: 0,
      host: '127.0.0.1',
      logger,
      maxBodySize: 16,
    })

    try {
      const res = await fetch(loopbackUrl(getBoundPort(handle.server), '/create-item'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'payload that is intentionally too large' }),
      })

      expect(res.status).toBe(413)
      expect(logger.info).toHaveBeenCalled()
    } finally {
      await handle.close()
    }
  })
})

describeLoopback('createNodeHost', () => {
  it('creates a node handler from a build callback', async () => {
    const app = createApp({ name: 'test-app' })
    app.tool('greet', { description: 'hi', handler: () => ({ ok: true }) })

    const host = createNodeHost({ build: () => app.build() })
    const server = createServer(host.toNodeHandler())
    const port = await listenOnLoopback(server)

    try {
      const response = await fetch(loopbackUrl(port, '/greet'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })
})
