import type {
  JsonValue,
  McpCallToolError,
  McpToolCallResult,
} from './testing-types.js'
import {
  isJsonRpcErrorEnvelope,
  isJsonValue,
  isMcpCallToolError,
  type McpTextContent,
} from './testing-guards.js'

/** Assert that a parsed RPC response matches the expected result shape. */
export function expectRpcResult<TResult>(
  method: string,
  value: unknown,
  isResult: (value: unknown) => value is TResult,
): TResult {
  if (!isResult(value)) {
    throw new Error(`Invalid MCP response for ${method}`)
  }
  return value
}

/** Read the first text content item from an MCP result payload. */
export function getFirstTextContent(content: McpTextContent[] | undefined): string | undefined {
  const firstItem = content?.[0]
  return typeof firstItem?.text === 'string' ? firstItem.text : undefined
}

function parseJsonValue(text: string, label: string): JsonValue {
  const parsed: unknown = JSON.parse(text)
  if (!isJsonValue(parsed)) {
    throw new Error(`Invalid JSON payload for ${label}`)
  }
  return parsed
}

/** Parse a `tools/call` text payload into either JSON data or raw text. */
export function parseCallToolText(text: string): McpToolCallResult {
  try {
    return parseJsonValue(text, 'tools/call')
  } catch (error) {
    if (error instanceof SyntaxError) {
      return text
    }
    throw error
  }
}

/** Parse a `tools/call` error payload into the structured helper shape. */
export function parseCallToolError(text: string): McpCallToolError {
  try {
    const parsed = parseJsonValue(text, 'tools/call')
    if (isMcpCallToolError(parsed)) {
      return parsed
    }
    throw new Error('Parsed payload is not an MCP tool-call error object')
  } catch (error) {
    throw new Error('Invalid MCP error payload for tools/call', {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

/** Read and parse a JSON-RPC response body. */
export async function readJsonRpcResponse(
  method: string,
  response: Response,
): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON response for ${method} (status ${response.status})`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

/** Throw when a parsed JSON-RPC body contains an `error` envelope. */
export function assertNoJsonRpcError(method: string, body: unknown): void {
  if (isJsonRpcErrorEnvelope(body)) {
    throw Object.assign(
      new Error(`MCP error ${body.error.code}: ${body.error.message}`),
      { method, code: body.error.code, data: body.error.data },
    )
  }
}
