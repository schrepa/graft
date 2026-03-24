import { normalizeAuth } from '../auth.js'
import { isIdempotentHttpMethod } from '../http-method.js'
import type { AnnotationHints, ToolDefinition } from '../types.js'

function isIdempotentByMethod(tool: ToolDefinition): boolean {
  return tool.method
    ? isIdempotentHttpMethod(tool.method)
    : !tool.sideEffects
}

function isDestructiveByMethod(tool: ToolDefinition): boolean {
  return tool.sideEffects ? true : tool.method === 'DELETE'
}

/**
 * Resolve MCP annotation hints for a tool definition.
 *
 * @param tool Tool metadata from the runtime manifest.
 * @returns The MCP annotations object exposed via `tools/list`.
 */
export function resolveAnnotations(tool: ToolDefinition): Record<string, unknown> {
  const explicit: AnnotationHints = tool.annotations ?? {}
  const auth = normalizeAuth(tool.auth)
  const annotations = buildBaseAnnotations(tool, explicit)
  applyMetadataAnnotations(annotations, tool, auth)
  return annotations
}

function buildBaseAnnotations(
  tool: ToolDefinition,
  explicit: AnnotationHints,
): Record<string, unknown> {
  return {
    readOnlyHint: explicit.readOnlyHint ?? !tool.sideEffects,
    destructiveHint: explicit.destructiveHint ?? isDestructiveByMethod(tool),
    idempotentHint: explicit.idempotentHint ?? isIdempotentByMethod(tool),
    openWorldHint: explicit.openWorldHint ?? true,
  }
}

function applyMetadataAnnotations(
  annotations: Record<string, unknown>,
  tool: ToolDefinition,
  auth: ReturnType<typeof normalizeAuth>,
): void {
  if (tool.deprecated) annotations['x-deprecated'] = true
  if (typeof tool.deprecated === 'string') annotations['x-deprecated-message'] = tool.deprecated
  if (auth) annotations['x-auth-required'] = true
  if (auth?.roles?.length) annotations['x-auth-roles'] = auth.roles
}
