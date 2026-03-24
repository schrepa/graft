import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger } from '../types.js'
import { DEFAULT_MAX_BODY_SIZE } from './constants.js'

/** Thrown when request body exceeds maxBodySize */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large')
  }
}

/**
 * Convert `IncomingMessage` headers, URL, and method into a minimal `Request`.
 *
 * @param req Node.js request to translate.
 * @param hostFallback Host used when the incoming request does not include one.
 * @returns A request head with method, URL, and headers but no body stream.
 */
export function buildRequestHead(req: IncomingMessage, hostFallback = 'localhost'): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
  }
  const host = req.headers.host ?? hostFallback
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method: (req.method ?? 'GET').toUpperCase(),
    headers,
  })
}

/**
 * Convert a `node:http` `IncomingMessage` into a Web Standard `Request`.
 *
 * @param req Node.js request to translate.
 * @param port Server port used when synthesizing a fallback host.
 * @param maxBodySize Maximum number of request-body bytes to read.
 * @param signal Optional abort signal propagated to the resulting `Request`.
 * @returns A web-standard request ready for fetch-style handlers.
 * @throws {BodyTooLargeError} When the request body exceeds `maxBodySize`.
 */
export async function buildWebRequest(
  req: IncomingMessage,
  port: number,
  maxBodySize = DEFAULT_MAX_BODY_SIZE,
  signal?: AbortSignal,
): Promise<Request> {
  const head = buildRequestHead(req, `localhost${port ? ':' + port : ''}`)
  const method = head.method
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'

  let body: Uint8Array | undefined
  if (hasBody) {
    body = await readRequestBody(req, maxBodySize)
  }

  return new Request(head.url, {
    method,
    headers: head.headers,
    ...(body !== undefined ? { body } : {}),
    ...(signal ? { signal } : {}),
  })
}

async function readRequestBody(req: IncomingMessage, maxBodySize: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalSize += buffer.length
    if (totalSize > maxBodySize) {
      req.resume()
      throw new BodyTooLargeError()
    }
    chunks.push(buffer)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

/**
 * Write a Web Standard `Response` back to a `node:http` `ServerResponse`.
 *
 * @param res Node.js response writer.
 * @param webResponse Response returned by a fetch-style handler.
 * @param signal Optional abort signal used to cancel response streaming.
 * @param logger Logger used when reader cancellation fails.
 * @returns A promise that resolves once the response body has been flushed or aborted.
 */
export async function writeWebResponse(
  res: ServerResponse,
  webResponse: Response,
  signal?: AbortSignal,
  logger: Pick<Logger, 'error'> = console,
): Promise<void> {
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()))

  if (!webResponse.body) {
    res.end()
    return
  }

  const reader = webResponse.body.getReader()
  const detachAbort = bindReaderAbort(reader, signal, logger)

  try {
    await pipeResponseBody(reader, res)
  } catch (err) {
    if (!shouldIgnoreReadError(err, res, signal)) throw err
  } finally {
    detachAbort()
    reader.releaseLock()
    if (!res.destroyed) res.end()
  }
}

function bindReaderAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
  logger: Pick<Logger, 'error'> = console,
): () => void {
  const onAbort = () => {
    reader.cancel().catch((error) => {
      if (!shouldIgnoreReaderCancelError(error)) {
        logger.error('[graft] Failed to cancel response reader:', error)
      }
    })
  }
  if (signal?.aborted) {
    onAbort()
    return () => {}
  }

  signal?.addEventListener('abort', onAbort, { once: true })
  return () => signal?.removeEventListener('abort', onAbort)
}

async function pipeResponseBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: ServerResponse,
): Promise<void> {
  while (true) {
    const { done, value } = await reader.read()
    if (done || res.destroyed) return
    res.write(value)
  }
}

function shouldIgnoreReadError(
  _error: unknown,
  res: ServerResponse,
  signal?: AbortSignal,
): boolean {
  return Boolean(signal?.aborted || res.destroyed)
}

function shouldIgnoreReaderCancelError(
  error: unknown,
): boolean {
  return Boolean(
    (error instanceof DOMException && error.name === 'AbortError'),
  )
}
