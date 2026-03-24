import { ToolError, GraftError, ValidationError } from '../../errors.js'
import type {
  AuthResult,
  DispatchEvent,
  DispatchFailure,
  DispatchOutcome,
  DispatchSuccess,
  ToolContext,
} from '../../types.js'
import { isRichResult } from '../rich-result.js'
import type { ToolCallRecord } from '../../telemetry.js'

/** Classify an execution error into dispatch and telemetry failure shapes. */
export function classifyError(requestId: string, err: unknown): {
  dispatchOutcome: DispatchFailure
  telemetryStatus: 'error'
  telemetryError: ToolCallRecord['error']
} {
  const telemetryError: ToolCallRecord['error'] = {
    type: err instanceof GraftError ? err.constructor.name : 'Error',
    message: err instanceof Error ? err.message : 'Unknown error',
    statusCode: err instanceof GraftError ? err.statusCode : 500,
  }

  const dispatchOutcome: DispatchFailure = err instanceof GraftError
    ? {
        requestId,
        ok: false,
        error: {
          message: err.message,
          statusCode: err.statusCode,
          code: err.code,
          headers: err instanceof ToolError ? err.headers : undefined,
          details: err instanceof ValidationError && err.details.length > 0 ? err.details : undefined,
        },
      }
    : {
        requestId,
        ok: false,
        error: {
          message: err instanceof Error ? err.message : 'Internal server error',
          statusCode: 500,
        },
      }

  return { dispatchOutcome, telemetryStatus: 'error', telemetryError }
}

/** Build a dispatch success outcome from a handler return value. */
export function buildSuccessOutcome(requestId: string, result: unknown): DispatchSuccess {
  if (isRichResult(result)) {
    return {
      requestId,
      ok: true,
      value: result.body,
      response: { contentType: result.contentType },
    }
  }

  return {
    requestId,
    ok: true,
    value: result,
  }
}

function mergeSuccessResponse<TAuth extends AuthResult>(
  success: DispatchSuccess,
  ctx: ToolContext<TAuth>,
): DispatchSuccess {
  const headers = ctx.response.headers
  const hasHeaders = Object.keys(headers).length > 0
  const statusCode = ctx.response.status
  const response = success.response

  if (!hasHeaders && statusCode === undefined) {
    return success
  }

  return {
    ...success,
    response: {
      ...response,
      ...(hasHeaders ? { headers: { ...response?.headers, ...headers } } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
    },
  }
}

function mergeFailureHeaders<TAuth extends AuthResult>(
  failure: DispatchFailure,
  ctx: ToolContext<TAuth>,
): DispatchFailure {
  const headers = ctx.response.headers
  if (Object.keys(headers).length === 0) {
    return failure
  }

  return {
    ...failure,
    error: {
      ...failure.error,
      headers: { ...failure.error.headers, ...headers },
    },
  }
}

/** Merge response headers and status set on `ctx.response` back into the outcome. */
export function mergeResponseContext<TAuth extends AuthResult>(
  ctx: ToolContext<TAuth> | undefined,
  dispatchOutcome: DispatchOutcome,
): DispatchOutcome {
  if (!ctx) return dispatchOutcome
  return dispatchOutcome.ok
    ? mergeSuccessResponse(dispatchOutcome, ctx)
    : mergeFailureHeaders(dispatchOutcome, ctx)
}

/** Attach buffered progress and log events to a dispatch outcome. */
export function attachDispatchEvents(
  dispatchOutcome: DispatchOutcome,
  events: DispatchEvent[],
  eventsDropped: number,
): DispatchOutcome {
  if (events.length === 0 && eventsDropped === 0) {
    return dispatchOutcome
  }

  return {
    ...dispatchOutcome,
    ...(events.length > 0 ? { events } : {}),
    ...(eventsDropped > 0 ? { eventsDropped } : {}),
  }
}
