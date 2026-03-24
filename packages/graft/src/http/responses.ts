import type { DispatchFailure, DispatchOutcome } from '../types.js'
import { isBinaryBytes, toBytes } from '../binary.js'
import { GraftError } from '../errors.js'
import { ToolError, ValidationError } from '../errors.js'
import { isBinaryMediaType, isJsonMediaType, normalizeMediaType } from '../media-type.js'

/** Convert a DispatchOutcome to an HTTP Response, handling 204, binary content, and JSON. */
export function toHttpResponse(outcome: DispatchOutcome, requestId?: string): Response {
  if (!outcome.ok) {
    return buildFailureResponse(outcome, buildBaseHeaders(requestId ?? outcome.requestId))
  }

  return buildSuccessResponse(outcome, buildBaseHeaders(requestId ?? outcome.requestId))
}

function buildFailureResponse(
  failure: DispatchFailure,
  extraHeaders: Record<string, string>,
): Response {
  if (failure.error.headers) {
    Object.assign(extraHeaders, failure.error.headers)
  }

  return buildJsonResponse(
    {
      error: failure.error.message,
      ...(failure.error.code ? { code: failure.error.code } : {}),
      ...(failure.error.details ? { details: failure.error.details } : {}),
    },
    failure.error.statusCode,
    extraHeaders,
  )
}

/** Build an error Response with a request ID header. */
export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof GraftError) {
    return buildJsonResponse(
      {
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err instanceof ValidationError && err.details.length ? { details: err.details } : {}),
      },
      err.statusCode,
      {
        'x-request-id': requestId,
        ...(err instanceof ToolError ? err.headers ?? {} : {}),
      },
    )
  }

  return buildJsonResponse(
    { error: err instanceof Error ? err.message : 'Internal server error' },
    500,
    { 'x-request-id': requestId },
  )
}

function buildBaseHeaders(requestId?: string): Record<string, string> {
  return requestId ? { 'x-request-id': requestId } : {}
}

function buildSuccessResponse(
  outcome: Extract<DispatchOutcome, { ok: true }>,
  baseHeaders: Record<string, string>,
): Response {
  const headers = mergeResponseHeaders(baseHeaders, outcome.response?.headers)
  const contentType = normalizeMediaType(outcome.response?.contentType)

  if (outcome.value == null && outcome.response?.statusCode === undefined) {
    return new Response(null, { status: 204, headers })
  }

  if (contentType && !isJsonMediaType(contentType)) {
    return buildTypedBodyResponse(outcome, headers, contentType)
  }

  return buildJsonResponse(
    outcome.value,
    outcome.response?.statusCode ?? 200,
    headers,
    contentType || undefined,
  )
}

function mergeResponseHeaders(
  baseHeaders: Record<string, string>,
  responseHeaders?: Record<string, string>,
): Record<string, string> {
  return responseHeaders ? { ...baseHeaders, ...responseHeaders } : baseHeaders
}

function buildJsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string>,
  contentType?: string,
): Response {
  const normalizedHeaders = new Headers(headers)
  const responseContentType = contentType ?? normalizedHeaders.get('content-type') ?? 'application/json'
  normalizedHeaders.set('content-type', responseContentType)
  return new Response(JSON.stringify(body) ?? 'null', { status, headers: normalizedHeaders })
}

function buildTypedBodyResponse(
  outcome: Extract<DispatchOutcome, { ok: true }>,
  headers: Record<string, string>,
  contentType: string,
): Response {
  const body = isBinaryMediaType(contentType)
    ? buildBinaryBody(outcome.value)
    : String(outcome.value)

  return new Response(body, {
    status: outcome.response?.statusCode ?? 200,
    headers: { 'content-type': contentType ?? 'text/plain', ...headers },
  })
}

function buildBinaryBody(value: unknown): Uint8Array | string {
  if (typeof value === 'string' || isBinaryBytes(value)) {
    return toBytes(value)
  }
  return String(value)
}
