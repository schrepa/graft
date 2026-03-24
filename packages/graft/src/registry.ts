import type { z } from 'zod'
import type {
  AnnotationHints,
  AuthResult,
  JsonSchema,
  ParameterLocation,
  ParameterLocationEntry,
  PromptDefinition,
  PromptMessage,
  PromptResolveContext,
  ResourceDefinition,
  ResourceReadContext,
  ResourceTemplateDefinition,
  ToolAuth,
  ToolCallMiddleware,
  ToolContext,
  ToolExample,
  ToolMeta,
} from './types.js'
import type { HttpMethod } from './http-method.js'
import type { ObjectParamsSchema } from './object-schema.js'

/** Visibility modes for registered entities across MCP and HTTP transports. */
export type Exposure = 'both' | 'mcp' | 'http'

/** Flat internal representation of a registered tool — all fields resolved at registration time. */
export interface InternalTool<
  TAuth extends AuthResult = AuthResult,
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string
  title?: string
  description: string
  httpMethod: HttpMethod
  httpPath: string
  inputSchema: JsonSchema | null
  outputSchema?: JsonSchema
  sideEffects: boolean
  tags: string[]
  examples: ToolExample[]
  auth?: ToolAuth
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
  nameIsExplicit: boolean
  deprecated?: boolean | string
  annotations?: AnnotationHints
  validate?(args: Record<string, unknown>): TParams
  handler(parsed: TParams, ctx: ToolContext<TAuth>): unknown | Promise<unknown>
  meta: ToolMeta
  middleware?: ToolCallMiddleware<TAuth>
  exposeMcp: boolean
  exposeHttp: boolean
}

/** Registration-time config stored for a static resource. */
export interface StoredResourceConfig {
  uri: string
  name: string
  title?: string
  description: string
  mimeType?: string
  handler: (ctx: ResourceReadContext) => unknown | Promise<unknown>
  auth?: ToolAuth
  expose?: Exposure
  http?: { path?: string }
}

/** Stored resource plus derived manifest definition and exposure flags. */
export interface StoredResource {
  config: StoredResourceConfig
  definition: ResourceDefinition
  exposeMcp: boolean
  exposeHttp: boolean
}

/** Registration-time config stored for a URI-templated resource. */
export interface StoredResourceTemplateConfig<
  S extends ObjectParamsSchema = ObjectParamsSchema,
  TAuth extends AuthResult = AuthResult,
> {
  uriTemplate: string
  name: string
  title?: string
  description: string
  mimeType?: string
  params?: S
  auth?: ToolAuth
  handler: (params: z.output<S>, ctx: ToolContext<TAuth>) => unknown | Promise<unknown>
  expose?: Exposure
  http?: { path?: string }
}

/** Stored resource template plus derived manifest definition and exposure flags. */
export interface StoredResourceTemplate<
  S extends ObjectParamsSchema = ObjectParamsSchema,
  TAuth extends AuthResult = AuthResult,
> {
  config: StoredResourceTemplateConfig<S, TAuth>
  definition: ResourceTemplateDefinition
  exposeMcp: boolean
  exposeHttp: boolean
}

/** Registration-time config stored for a prompt definition. */
export interface StoredPromptConfig<S extends ObjectParamsSchema = ObjectParamsSchema> {
  name: string
  title?: string
  description: string
  params?: S
  handler: (params: z.output<S>, ctx: PromptResolveContext) => PromptMessage[] | Promise<PromptMessage[]>
  expose?: Exposure
  http?: { path?: string }
}

/** Stored prompt plus derived manifest definition and exposure flags. */
export interface StoredPrompt<S extends ObjectParamsSchema = ObjectParamsSchema> {
  config: StoredPromptConfig<S>
  definition: PromptDefinition
  exposeMcp: boolean
  exposeHttp: boolean
}

/** Explicit HTTP route registered outside the tool/resource abstractions. */
export interface ExplicitRoute {
  method: HttpMethod
  path: string
  handler: (request: Request) => Promise<Response>
}
