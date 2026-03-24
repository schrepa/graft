import type { HttpMethod } from '../http-method.js'
import type { ToolAuth } from './auth.js'

/** Where a parameter should be sent in the HTTP request */
export type ParameterLocation = 'path' | 'query' | 'header' | 'body'

/** Full parameter location entry with optional name remapping */
export interface ParameterLocationEntry {
  in: ParameterLocation
  /** HTTP name when different from arg name. Enables: if_match → If-Match */
  name?: string
}

/** User-provided MCP annotation overrides */
export interface AnnotationHints {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** Example invocation for a tool */
export interface ToolExample {
  name?: string
  args: Record<string, unknown>
  description?: string
  result?: unknown
}

/** Minimal JSON Schema object shape — just enough to avoid `as any` when accessing
 *  standard properties. Extends Record so arbitrary JSON Schema keywords still work. */
export interface JsonSchema extends Record<string, unknown> {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  description?: string
}

/** The single intermediate representation. Produced by frontends, stored by registry, emitted by backend.
 *
 *  Lifecycle:
 *  ```
 *  BuilderToolConfig (user input)
 *      ↓ buildInternalTool()
 *  InternalTool (runtime: handler + validate + middleware + exposure)
 *      ↓ createToolPipeline()
 *  PipelineTool (dispatch: structurally satisfied by InternalTool)
 *      ↓ toDefinition()
 *  ToolDefinition (serializable: manifest, MCP, OpenAPI)
 *  ```
 */
export interface ToolDefinition {
  // Identity
  name: string
  title?: string
  description: string

  // HTTP routing (optional for greenfield tools that dispatch by name)
  method?: HttpMethod
  path?: string

  // Schemas (always JSON Schema — never Zod)
  inputSchema: JsonSchema | null
  outputSchema?: JsonSchema

  // Behavior
  sideEffects: boolean

  // Metadata
  examples: ToolExample[]
  tags: string[]
  auth?: ToolAuth
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>

  // Progressive enrichment
  deprecated?: boolean | string
  annotations?: AnnotationHints
}
