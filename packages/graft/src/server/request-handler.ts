import type { IncomingMessage, ServerResponse } from 'node:http'
import { GraftError, ToolError } from '../errors.js'
import type { Logger } from '../types.js'
import { DEFAULT_MAX_BODY_SIZE } from './constants.js'
import {
  BodyTooLargeError,
  buildWebRequest,
  writeWebResponse,
} from './web-bridge.js'
import type { NodeRequestHandlerOptions } from './types.js'

interface RequestHandlerRuntimeOptions {
  port: number
  maxBodySize: number
  fetchHandler: (request: Request) => Promise<Response>
  signal: AbortSignal
  logger: Logger
}

/**
 * Write a JSON response to a Node.js `ServerResponse`.
 *
 * @param res Node.js response writer.
 * @param status HTTP status code to emit.
 * @param body JSON-serializable payload.
 * @param headers Optional response headers merged after the JSON content type.
 */
export function writeJsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

function writeKnownErrorResponse(res: ServerResponse, error: GraftError): void {
  const headers = error instanceof ToolError ? (error.headers ?? {}) : {}
  writeJsonResponse(
    res,
    error.statusCode,
    {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    },
    headers,
  )
}

function trackRequestAbort(
  res: ServerResponse,
  requestAbortSignal?: AbortSignal,
): AbortSignal {
  const requestAbort = new AbortController()
  res.on('close', () => requestAbort.abort())
  return requestAbortSignal
    ? AbortSignal.any([requestAbortSignal, requestAbort.signal])
    : requestAbort.signal
}

async function readIncomingRequest(
  req: IncomingMessage,
  port: number,
  maxBodySize: number,
  signal: AbortSignal,
): Promise<Request> {
  try {
    return await buildWebRequest(req, port, maxBodySize, signal)
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error
    throw new Error('Failed to read incoming request', {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function writeOutgoingResponse(
  res: ServerResponse,
  response: Response,
  signal: AbortSignal,
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    await writeWebResponse(res, response, signal, logger)
  } catch (error) {
    throw new Error('Failed to write outgoing response', {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: RequestHandlerRuntimeOptions,
): Promise<void> {
  try {
    const webRequest = await readIncomingRequest(
      req,
      options.port,
      options.maxBodySize,
      options.signal,
    )
    const webResponse = await options.fetchHandler(webRequest)
    await writeOutgoingResponse(res, webResponse, options.signal, options.logger)
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      writeJsonResponse(res, 413, { error: 'Request body too large' })
      return
    }
    if (error instanceof GraftError) {
      writeKnownErrorResponse(res, error)
      return
    }
    options.logger.error('[graft] Request error:', error)
    writeJsonResponse(res, 500, { error: 'Internal server error' })
  }
}

/**
 * Create a Node.js request handler that converts `IncomingMessage` requests into web `Request`s.
 *
 * @param options Bridge configuration for request decoding, body limits, logging,
 * and optional shutdown-aware cancellation.
 * @returns An async handler suitable for `http.createServer()` or custom Node
 * server integrations.
 * @throws {Error} When request decoding or response writing fails.
 * @example
 * const handler = createNodeRequestHandler({ fetch: app.toFetch(), maxBodySize: 1_048_576 })
 * createServer((req, res) => void handler(req, res))
 */
export function createNodeRequestHandler(
  options: NodeRequestHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const logger = options.logger ?? console
  const port = options.port ?? 0
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE

  return async (req, res) => {
    const signal = trackRequestAbort(res, options.shutdownSignal)
    await handleRequest(req, res, {
      port,
      maxBodySize,
      fetchHandler: options.fetch,
      signal,
      logger,
    })
  }
}
