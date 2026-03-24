import { extractHeaders } from '../headers.js'
import { isAbortError } from '../abort.js'
import { GraftError, ToolError, ValidationError } from '../errors.js'
import { toPlainRecord } from '../object-schema.js'
import type { Logger } from '../types.js'
import type { McpMethodContext, McpMethodHandler } from './shared.js'
import { dispatchSSE } from './sse.js'

function statusToJsonRpcCode(status: number): number {
  if (status === 400 || status === 404 || status === 422) return -32602
  if (status === 401 || status === 403) return -32001
  if (status === 409) return -32009
  if (status === 410) return -32010
  if (status === 429) return -32029
  return -32603
}

function buildJsonRpcError(err: unknown, id: unknown): Record<string, unknown> {
  if (err instanceof GraftError) {
    let message = err.message
    const data: Record<string, unknown> = { status: err.statusCode }
    if (err.code) data.code = err.code

    if (err instanceof ValidationError && err.details.length) {
      const fieldErrors = err.details.map((detail) =>
        detail.path ? `${detail.path}: ${detail.message}` : detail.message,
      )
      message = `${err.message}: ${fieldErrors.join(', ')}`
      data.details = err.details
    }

    if (err instanceof ToolError && err.headers && Object.keys(err.headers).length > 0) {
      data.headers = err.headers
    }

    return {
      jsonrpc: '2.0',
      error: { code: statusToJsonRpcCode(err.statusCode), message, data },
      id,
    }
  }

  return {
    jsonrpc: '2.0',
    error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
    id,
  }
}

function acceptsSSE(request: Request): boolean {
  const accept = request.headers.get('accept') ?? ''
  return accept.includes('text/event-stream')
}

type JsonRpcValidation =
  | {
      ok: true
      method: string
      params: Record<string, unknown>
      id: unknown
      isNotification: boolean
      handler: McpMethodHandler
    }
  | {
      ok: false
      error: Record<string, unknown> | null
    }

type JsonRpcId = string | number | null

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

function parseJsonRpcParams(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {}
  return toRecord(value) ?? null
}

function validateJsonRpc(
  body: unknown,
  handlers: Map<string, McpMethodHandler>,
): JsonRpcValidation {
  const envelope = parseJsonRpcEnvelope(body)
  if (!envelope.ok) return envelope

  const { id, isNotification, method, params } = envelope
  const handler = handlers.get(method)
  if (!handler) {
    return isNotification
      ? { ok: false, error: null }
      : { ok: false, error: methodNotFound(method, id) }
  }

  return { ok: true, method, params, id, isNotification, handler }
}

function buildMethodContext(request: Request): McpMethodContext {
  return {
    headers: extractHeaders(request),
    signal: request.signal,
  }
}

async function dispatchUnary(
  validated: Extract<JsonRpcValidation, { ok: true }>,
  request: Request,
): Promise<Record<string, unknown> | null> {
  const ctx = buildMethodContext(request)

  try {
    const result = await validated.handler(validated.params, ctx)
    if (validated.isNotification) return null
    return { jsonrpc: '2.0', result: result ?? {}, id: validated.id }
  } catch (err) {
    if (validated.isNotification) return null
    return buildJsonRpcError(err, validated.id)
  }
}

async function dispatchSingle(
  body: unknown,
  handlers: Map<string, McpMethodHandler>,
  request: Request,
  logger?: Pick<Logger, 'warn'>,
): Promise<Record<string, unknown> | Response | null> {
  const validated = validateJsonRpc(body, handlers)
  if (!validated.ok) return validated.error

  const { method, params, id, isNotification, handler } = validated
  const ctx = buildMethodContext(request)

  if (method === 'tools/call' && !isNotification && acceptsSSE(request)) {
    return dispatchSSE({
      handler,
      params,
      ctx,
      id,
      requestVersion: request.headers.get('mcp-protocol-version') ?? undefined,
      logger,
      formatError: buildJsonRpcError,
    })
  }

  return dispatchUnary(validated, request)
}

/** Handle one MCP Streamable HTTP JSON-RPC request. */
export async function handleJsonRpc(
  handlers: Map<string, McpMethodHandler>,
  request: Request,
  parsedBody?: unknown,
  logger?: Pick<Logger, 'warn'>,
): Promise<Response> {
  const bodyOrResponse = await readJsonRpcBody(request, parsedBody)
  if (bodyOrResponse instanceof Response) return bodyOrResponse
  const body = bodyOrResponse

  if (Array.isArray(body)) {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Batch requests are not supported by MCP Streamable HTTP',
        },
        id: null,
      },
      { status: 200 },
    )
  }

  const result = await dispatchSingle(body, handlers, request, logger)
  if (result === null) return new Response(null, { status: 202 })
  if (result instanceof Response) return result
  return Response.json(result)
}

/** Read and parse the JSON-RPC body for an MCP HTTP request. */
export async function readJsonRpcBody(request: Request, parsedBody?: unknown): Promise<unknown | Response> {
  if (parsedBody !== undefined) {
    return parsedBody
  }

  try {
    return await request.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw new GraftError('Request cancelled', 499, 'REQUEST_CANCELLED', {
        cause: error instanceof Error ? error : undefined,
      })
    }

    return Response.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      { status: 200 },
    )
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return toPlainRecord(value)
}

function invalidRequest(id: unknown = null): JsonRpcValidation {
  return {
    ok: false,
    error: { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id },
  }
}

function methodNotFound(method: string, id: unknown): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    error: { code: -32601, message: `Method not found: ${method}` },
    id,
  }
}

function parseJsonRpcEnvelope(body: unknown):
  | {
      ok: true
      method: string
      params: Record<string, unknown>
      id: unknown
      isNotification: boolean
    }
  | JsonRpcValidation {
  const record = toRecord(body)
  if (!record) return invalidRequest()

  const jsonrpc = record.jsonrpc
  const method = record.method
  const id = record.id
  if (jsonrpc !== '2.0' || typeof method !== 'string') {
    return invalidRequest(isJsonRpcId(id) ? id : null)
  }
  if (id !== undefined && !isJsonRpcId(id)) return invalidRequest()

  const params = parseJsonRpcParams(record.params)
  if (params === null) {
    return invalidRequest(id ?? null)
  }

  return {
    ok: true,
    method,
    params,
    id,
    isNotification: id === undefined,
  }
}
