import type {
  JsonSchema,
  ParameterLocation,
  ParameterLocationEntry,
} from './types.js'

/**
 * Options for creating an MCP test client.
 *
 * Use shared headers to simulate authenticated callers or transport metadata
 * consistently across a test suite.
 */
export interface McpTestClientOptions {
  /** Headers sent with every request (e.g. authorization). */
  headers?: Record<string, string>
}

/**
 * JSON value returned from parsed MCP payloads.
 *
 * This mirrors the JSON-compatible subset that Graft serializes through MCP
 * helper utilities during tests.
 */
export type JsonValue =
  | boolean
  | number
  | null
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * JSON object returned from parsed MCP payloads.
 */
export interface JsonObject {
  [key: string]: JsonValue
}

/**
 * Parsed MCP tool-call error payload.
 *
 * This mirrors the JSON object encoded into `tools/call` error content items.
 */
export interface McpCallToolError {
  error: string
  status?: number
  body?: JsonObject
  headers?: Record<string, string>
}

/**
 * Parsed MCP tool call result.
 *
 * Successful calls return structured JSON-compatible data; tool and auth
 * failures return parsed error envelopes so tests can assert on their fields.
 */
export type McpToolCallResult = JsonValue | McpCallToolError

/**
 * Backward-compatible alias for `McpToolCallResult`.
 */
export type CallToolResult = McpToolCallResult

/**
 * Tool entry returned from `tools/list`.
 */
export interface McpToolInfo {
  name: string
  title?: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  annotations?: Record<string, unknown>
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
}

/**
 * Resource entry returned from `resources/list`.
 */
export interface McpResourceInfo {
  uri: string
  name: string
  title?: string
  description: string
  mimeType?: string
}

/**
 * Resource content item returned from `resources/read`.
 */
export interface McpResourceContent {
  text?: string
  blob?: string
  uri: string
  mimeType?: string
}

/**
 * Resource template entry returned from `resources/templates/list`.
 */
export interface McpResourceTemplateInfo {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

/**
 * Prompt entry returned from `prompts/list`.
 */
export interface McpPromptInfo {
  name: string
  title?: string
  description: string
}

/**
 * Prompt message content returned from `prompts/get`.
 */
export interface McpPromptContent {
  type: 'text'
  text: string
}

/**
 * Prompt message returned from `prompts/get`.
 */
export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: McpPromptContent
}

/**
 * Prompt payload returned from `prompts/get`.
 */
export interface McpPromptResult {
  messages: McpPromptMessage[]
  description?: string
}

/**
 * Lightweight MCP test client with JSON-RPC boilerplate removed.
 *
 *  All methods unwrap the MCP JSON-RPC envelope so tests read like plain function calls.
 *  See individual method docs for the exact return shape.
 */
export interface McpTestClient {
  /**
   * Call a tool and return the unwrapped result.
   *
   * Unwraps the MCP `content[0].text` envelope and parses it as JSON.
   * When `structuredContent` is present, returns that instead.
   * If the text is not valid JSON, returns the raw string.
   *
   * **Error paths:**
   * - Tool/auth errors (tool threw, 401, 403, etc.) → returns the parsed error
   *   object, e.g. `{ error: 'FORBIDDEN', status: 403 }`. Check `result.error`.
   * - Protocol errors (unknown method, parse error) → **throws** an Error
   *   with message `"MCP error -326xx: ..."`.
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult>
  /**
   * List all tools visible to this client.
   *
   * Returns the `tools` array directly — not `{ tools: [...] }`.
   */
  listTools(): Promise<McpToolInfo[]>
  /**
   * List all resources.
   *
   * Returns the `resources` array directly — not `{ resources: [...] }`.
   */
  listResources(): Promise<McpResourceInfo[]>
  /**
   * Read a resource by URI.
   *
   * Returns the first `contents[0]` entry (with `text`, `uri`, `mimeType`) —
   * not the full `{ contents: [...] }` envelope.
   */
  readResource(uri: string): Promise<McpResourceContent>
  /**
   * List all resource templates.
   *
   * Returns the `resourceTemplates` array directly.
   */
  listResourceTemplates(): Promise<McpResourceTemplateInfo[]>
  /**
   * List all prompts.
   *
   * Returns the `prompts` array directly — not `{ prompts: [...] }`.
   */
  listPrompts(): Promise<McpPromptInfo[]>
  /**
   * Get a prompt by name.
   *
   * Returns the full result object with `messages` array and optional `description`.
   * Unlike other methods, this does NOT unwrap — you get the complete result.
   */
  getPrompt(name: string, args?: Record<string, unknown>): Promise<McpPromptResult>
}
