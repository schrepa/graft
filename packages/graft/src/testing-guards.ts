import { isPlainRecord } from './object-schema.js'
import type {
  JsonObject,
  JsonValue,
  McpCallToolError,
  McpPromptInfo,
  McpPromptMessage,
  McpPromptResult,
  McpResourceContent,
  McpResourceInfo,
  McpResourceTemplateInfo,
  McpToolInfo,
} from './testing-types.js'

interface JsonRpcErrorBody {
  code: number
  message: string
  data?: unknown
}

/** JSON-RPC error payload returned by MCP transport helpers. */
export interface JsonRpcErrorEnvelope {
  error: JsonRpcErrorBody
}

/** JSON-RPC success payload carrying a typed `result` field. */
export interface JsonRpcSuccessEnvelope<TResult> {
  result: TResult
}

/** Minimal MCP text content item used by the testing helpers. */
export interface McpTextContent {
  type: 'text'
  text: string
}

/** Successful `tools/call` response shape used by the test client. */
export interface McpCallSuccessEnvelope {
  isError?: boolean
  content?: McpTextContent[]
  structuredContent?: JsonObject
}

/** Envelope returned by `tools/list`. */
export interface ListToolsEnvelope {
  tools: McpToolInfo[]
}

/** Envelope returned by `resources/list`. */
export interface ListResourcesEnvelope {
  resources: McpResourceInfo[]
}

/** Envelope returned by `resources/read`. */
export interface ReadResourceEnvelope {
  contents: McpResourceContent[]
}

/** Envelope returned by `resources/templates/list`. */
export interface ListResourceTemplatesEnvelope {
  resourceTemplates: McpResourceTemplateInfo[]
}

/** Envelope returned by `prompts/list`. */
export interface ListPromptsEnvelope {
  prompts: McpPromptInfo[]
}

/** Envelope returned by `prompts/get`. */
export interface GetPromptEnvelope extends McpPromptResult {
  messages: McpPromptMessage[]
}

/** Check whether a value is JSON-compatible test data. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item))
  return isPlainRecord(value) && Object.values(value).every((item) => isJsonValue(item))
}

/** Check whether a value is a JSON object. */
export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainRecord(value) && Object.values(value).every((item) => isJsonValue(item))
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

/** Check whether a parsed MCP tool-call error matches the helper shape. */
export function isMcpCallToolError(value: unknown): value is McpCallToolError {
  return isJsonObject(value)
    && typeof value.error === 'string'
    && (value.status === undefined || typeof value.status === 'number')
    && (value.body === undefined || isJsonObject(value.body))
    && (value.headers === undefined || isStringRecord(value.headers))
}

/** Check whether a value is a JSON-RPC error envelope. */
export function isJsonRpcErrorEnvelope(value: unknown): value is JsonRpcErrorEnvelope {
  if (!isPlainRecord(value) || !('error' in value) || !isPlainRecord(value.error)) return false
  return typeof value.error.code === 'number' && typeof value.error.message === 'string'
}

/** Check whether a value is a JSON-RPC success envelope. */
export function isJsonRpcSuccessEnvelope<TResult>(value: unknown): value is JsonRpcSuccessEnvelope<TResult> {
  return isPlainRecord(value) && 'result' in value
}

function isTextContentArray(value: unknown): value is McpTextContent[] {
  return Array.isArray(value) && value.every((item) => (
    isPlainRecord(item) &&
    item.type === 'text' &&
    typeof item.text === 'string'
  ))
}

/** Check whether a value is a successful MCP tool-call response. */
export function isMcpCallSuccessEnvelope(value: unknown): value is McpCallSuccessEnvelope {
  return isPlainRecord(value)
    && (!('isError' in value) || typeof value.isError === 'boolean')
    && (!('content' in value) || isTextContentArray(value.content))
    && (!('structuredContent' in value) || isPlainRecord(value.structuredContent))
    && (!('structuredContent' in value) || isJsonValue(value.structuredContent))
}

/** Check whether a value is the envelope returned by `tools/list`. */
export function isListToolsEnvelope(value: unknown): value is ListToolsEnvelope {
  return isPlainRecord(value) && Array.isArray(value.tools)
}

/** Check whether a value is the envelope returned by `resources/list`. */
export function isListResourcesEnvelope(value: unknown): value is ListResourcesEnvelope {
  return isPlainRecord(value) && Array.isArray(value.resources)
}

function isReadResourceContent(value: unknown): value is ReadResourceEnvelope['contents'][number] {
  return isPlainRecord(value)
    && typeof value.uri === 'string'
    && (!('text' in value) || typeof value.text === 'string')
    && (!('blob' in value) || typeof value.blob === 'string')
    && (!('mimeType' in value) || typeof value.mimeType === 'string')
}

/** Check whether a value is the envelope returned by `resources/read`. */
export function isReadResourceEnvelope(value: unknown): value is ReadResourceEnvelope {
  return isPlainRecord(value)
    && Array.isArray(value.contents)
    && value.contents.every((content) => isReadResourceContent(content))
}

/** Check whether a value is the envelope returned by `resources/templates/list`. */
export function isListResourceTemplatesEnvelope(value: unknown): value is ListResourceTemplatesEnvelope {
  return isPlainRecord(value) && Array.isArray(value.resourceTemplates)
}

/** Check whether a value is the envelope returned by `prompts/list`. */
export function isListPromptsEnvelope(value: unknown): value is ListPromptsEnvelope {
  return isPlainRecord(value) && Array.isArray(value.prompts)
}

/** Check whether a value is the envelope returned by `prompts/get`. */
export function isGetPromptEnvelope(value: unknown): value is GetPromptEnvelope {
  return isPlainRecord(value)
    && Array.isArray(value.messages)
    && value.messages.every((message) => (
      isPlainRecord(message)
      && (message.role === 'user' || message.role === 'assistant')
      && isPlainRecord(message.content)
      && message.content.type === 'text'
      && typeof message.content.text === 'string'
    ))
}
