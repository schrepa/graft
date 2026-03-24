import type {
  ToolDefinition,
  TransformToolResultHook,
  McpToolResult,
  DispatchFailure,
  DispatchSuccess,
} from '../types.js'
import type { ContextIngredients, ToolPipeline } from '../pipeline/types.js'
import { isBinaryBytes, toBase64 } from '../binary.js'
import { GraftError, ToolError, ValidationError } from '../errors.js'
import { isJsonMediaType, normalizeMediaType } from '../media-type.js'
import { isPlainRecord } from '../object-schema.js'

/**
 * Context needed to format pipeline results into MCP tool results.
 */
export interface FormatContext {
  toolMap: Map<string, ToolDefinition>
  transformToolResult?: TransformToolResultHook
}

/**
 * Build a standardized MCP error payload.
 *
 * @param error Stable MCP/tool error code.
 * @param extra Additional serialized error details.
 * @returns An MCP error result with a single text content item.
 */
export function mcpError(error: string, extra?: Record<string, unknown>): McpToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error, ...extra }) }] }
}

function mcpText(body: unknown): McpToolResult {
  return { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body, null, 2) }] }
}

/**
 * Map HTTP-style status codes onto stable MCP/tool error codes.
 *
 * @param status Dispatch status code.
 * @returns A normalized error code for MCP clients.
 */
export function mapStatusToError(status: number): string {
  if (status === 400) return 'VALIDATION_ERROR'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 410) return 'GONE'
  if (status === 422) return 'VALIDATION_ERROR'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'INTERNAL_ERROR'
  return 'REQUEST_FAILED'
}

function buildMcpContent(body: unknown, contentType: string): McpToolResult {
  if (contentType.startsWith('image/')) return buildBinaryContent('image', body, contentType)
  if (contentType.startsWith('audio/')) return buildBinaryContent('audio', body, contentType)
  if (!contentType || isJsonMediaType(contentType)) {
    return body == null ? { content: [{ type: 'text', text: 'Success' }] } : mcpText(body)
  }

  return body == null
    ? { content: [{ type: 'text', text: 'Success' }] }
    : { content: [{ type: 'text', text: String(body), mimeType: contentType }] }
}

function buildBinaryContent(
  kind: 'image' | 'audio',
  body: unknown,
  mimeType: string,
): McpToolResult {
  const data = isBinaryBytes(body) || typeof body === 'string' ? toBase64(body) : String(body)
  return { content: [{ type: kind, data, mimeType }] }
}

function formatDispatchFailure(
  failure: DispatchFailure,
): McpToolResult {
  return mcpError(failure.error.code ?? mapStatusToError(failure.error.statusCode), {
    status: failure.error.statusCode,
    body: { error: failure.error.message, ...(failure.error.details ? { details: failure.error.details } : {}) },
    ...(failure.error.headers && Object.keys(failure.error.headers).length > 0
      ? { headers: failure.error.headers }
      : {}),
  })
}

function formatDispatchSuccess(
  success: DispatchSuccess,
  toolName: string,
  ctx: FormatContext,
): McpToolResult {
  const contentType = normalizeMediaType(success.response?.contentType)
  const mcpResult = buildMcpContent(success.value, contentType)

  const tool = ctx.toolMap.get(toolName)
  if (tool?.outputSchema && isPlainRecord(success.value)) {
    mcpResult.structuredContent = success.value
  }

  return mcpResult
}

function formatDispatchError(err: unknown): McpToolResult {
  if (err instanceof GraftError) {
    const extra: Record<string, unknown> = { status: err.statusCode, message: err.message }

    if (err instanceof ToolError && err.headers && Object.keys(err.headers).length > 0) {
      extra.headers = err.headers
    }

    if (err instanceof ValidationError && err.details.length) {
      extra.details = err.details
    }

    return mcpError(err.code ?? mapStatusToError(err.statusCode), extra)
  }

  return mcpError('INTERNAL_ERROR', {
    message: err instanceof Error ? err.message : 'Unknown error',
  })
}

async function applyTransformToolResult(
  mcpResult: McpToolResult,
  toolName: string,
  args: Record<string, unknown>,
  dispatchSuccess: DispatchSuccess,
  ctx: FormatContext,
): Promise<McpToolResult> {
  if (ctx.transformToolResult) {
    const tool = ctx.toolMap.get(toolName)
    if (tool) {
      return ctx.transformToolResult(mcpResult, { tool, dispatchSuccess, args })
    }
  }

  return mcpResult
}

/**
 * Dispatch a tool call and translate the dispatch result into MCP content.
 *
 * @param toolName Registered tool name to invoke.
 * @param args Parsed tool arguments.
 * @param pipeline Dispatch pipeline used by the adapter.
 * @param fmtCtx Formatting context for tool metadata and transforms.
 * @param opts Transport-specific headers, abort signal, and progress/log hooks.
 * @returns A formatted MCP tool result.
 */
export async function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  pipeline: ToolPipeline,
  fmtCtx: FormatContext,
  opts: {
    headers?: Record<string, string>
    signal?: AbortSignal
    contextIngredients?: ContextIngredients
  },
  ): Promise<McpToolResult> {
  try {
    const outcome = await pipeline.dispatch(toolName, args, {
      headers: opts.headers,
      requestId: crypto.randomUUID(),
      transport: 'mcp',
      signal: opts.signal,
      contextIngredients: opts.contextIngredients,
    })
    if (!outcome.ok) {
      return formatDispatchFailure(outcome)
    }

    const mcpResult = formatDispatchSuccess(outcome, toolName, fmtCtx)
    return applyTransformToolResult(mcpResult, toolName, args, outcome, fmtCtx)
  } catch (err) {
    return formatDispatchError(err)
  }
}
