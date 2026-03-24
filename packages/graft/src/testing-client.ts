import type { App } from './app/builder.js'
import type { AuthResult } from './types.js'
import type {
  McpTestClient,
  McpTestClientOptions,
} from './testing-types.js'
import {
  isGetPromptEnvelope,
  isJsonRpcSuccessEnvelope,
  isListPromptsEnvelope,
  isListResourcesEnvelope,
  isListResourceTemplatesEnvelope,
  isListToolsEnvelope,
  isMcpCallSuccessEnvelope,
  isReadResourceEnvelope,
} from './testing-guards.js'
import {
  assertNoJsonRpcError,
  expectRpcResult,
  getFirstTextContent,
  parseCallToolError,
  parseCallToolText,
  readJsonRpcResponse,
} from './testing-rpc.js'

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

function createJsonRpcInvoker(
  fetchImpl: (request: Request) => Response | Promise<Response>,
  headers: Record<string, string>,
): <TResult>(
  method: string,
  params: Record<string, unknown>,
  isResult: (value: unknown) => value is TResult,
) => Promise<TResult> {
  let id = 0

  return async function rpc<TResult>(
    method: string,
    params: Record<string, unknown>,
    isResult: (value: unknown) => value is TResult,
  ): Promise<TResult> {
    const response = await fetchImpl(new Request('http://localhost/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }))
    const body = await readJsonRpcResponse(method, response)

    assertNoJsonRpcError(method, body)
    if (!isJsonRpcSuccessEnvelope(body)) {
      throw new Error(`Invalid MCP response for ${method}`)
    }

    return expectRpcResult(method, body.result, isResult)
  }
}

/**
 * Create a test client for a Graft app or a raw MCP handler.
 *
 * Handles MCP protocol boilerplate — JSON-RPC envelopes, headers, response
 * unwrapping — so tests read like plain function calls.
 *
 * ```ts
 * // With App
 * const client = createMcpTestClient(app)
 *
 * // With raw handler function
 * const client = createMcpTestClient((req) => handleMcp(req))
 *
 * const result = await client.callTool('greet', { name: 'World' })
 * expect(result).toEqual({ message: 'Hello, World!' })
 * ```
 *
 * All methods unwrap the MCP JSON-RPC response envelope. For `callTool()`:
 * - Success → parsed JSON from `content[0].text` (or `structuredContent`)
 * - Tool/auth errors → parsed error object (e.g. `{ error: 'FORBIDDEN', status: 403 }`)
 * - Protocol errors → **throws** `Error("MCP error -326xx: ...")`
 *
 * Pass `options.headers` to simulate authenticated requests:
 *
 * @example
 * const admin = createMcpTestClient(app, { headers: { authorization: 'Bearer admin-token' } })
 *
 * @param appOrHandler App instance or raw MCP request handler.
 * @param options Request headers applied to every MCP call.
 * @returns A lightweight MCP client with JSON-RPC boilerplate removed.
 * @throws {Error} When the transport returns a non-JSON body, a JSON-RPC error,
 * or an invalid success envelope.
 */
export function createMcpTestClient<TAuth extends AuthResult = AuthResult>(
  appOrHandler: App<TAuth> | ((request: Request) => Response | Promise<Response>),
  options?: McpTestClientOptions,
): McpTestClient {
  const fetchImpl = typeof appOrHandler === 'function'
    ? appOrHandler
    : appOrHandler.toFetch()
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    ...options?.headers,
  }
  const rpc = createJsonRpcInvoker(fetchImpl, headers)

  return {
    async callTool(name, args = {}) {
      const result = await rpc('tools/call', { name, arguments: args }, isMcpCallSuccessEnvelope)

      if (result.isError) {
        const text = getFirstTextContent(result.content)
        if (!text) {
          throw new Error('Invalid MCP error payload for tools/call')
        }
        return parseCallToolError(text)
      }

      if (result.structuredContent) {
        return result.structuredContent
      }

      const text = getFirstTextContent(result.content)
      if (text == null) return {}
      return parseCallToolText(text)
    },

    async listTools() {
      return (await rpc('tools/list', {}, isListToolsEnvelope)).tools
    },

    async listResources() {
      return (await rpc('resources/list', {}, isListResourcesEnvelope)).resources
    },

    async readResource(uri) {
      const result = await rpc('resources/read', { uri }, isReadResourceEnvelope)
      const firstContent = result.contents[0]
      if (!firstContent) {
        throw new Error('Invalid MCP response for resources/read')
      }
      return firstContent
    },

    async listResourceTemplates() {
      return (await rpc('resources/templates/list', {}, isListResourceTemplatesEnvelope)).resourceTemplates
    },

    async listPrompts() {
      return (await rpc('prompts/list', {}, isListPromptsEnvelope)).prompts
    },

    async getPrompt(name, args = {}) {
      return rpc('prompts/get', { name, arguments: args }, isGetPromptEnvelope)
    },
  }
}
