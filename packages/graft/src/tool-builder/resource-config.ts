import type { z } from 'zod'
import type {
  AuthResult,
  PromptDefinition,
  PromptMessage,
  PromptResolveContext,
  ResourceDefinition,
  ResourceReadContext,
  ResourceTemplateDefinition,
  ToolAuth,
  ToolContext,
} from '../types.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import { zodToJsonSchemaOrNull } from '../schema.js'
import type { Exposure, StoredPrompt, StoredResource, StoredResourceTemplate } from '../registry.js'

/** Builder input for a concrete resource registration. */
export interface BuilderResourceConfig {
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

/** Builder input for a URI-templated resource registration. */
export interface BuilderResourceTemplateConfig<
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

/** Builder input for a stored prompt registration. */
export interface BuilderPromptConfig<S extends ObjectParamsSchema = ObjectParamsSchema> {
  name: string
  title?: string
  description: string
  params?: S
  handler: (params: z.output<S>, ctx: PromptResolveContext) => PromptMessage[] | Promise<PromptMessage[]>
  expose?: Exposure
  http?: { path?: string }
}

/** Build a stored resource registration record. */
export function buildStoredResource(config: BuilderResourceConfig): StoredResource {
  const definition: ResourceDefinition = {
    uri: config.uri,
    name: config.name,
    title: config.title,
    description: config.description,
    mimeType: config.mimeType,
  }
  return { config, definition, exposeMcp: true, exposeHttp: true }
}

/** Build a stored resource template registration record. */
export function buildStoredResourceTemplate<S extends ObjectParamsSchema, TAuth extends AuthResult = AuthResult>(
  config: BuilderResourceTemplateConfig<S, TAuth>,
): StoredResourceTemplate<S, TAuth> {
  const definition: ResourceTemplateDefinition = {
    uriTemplate: config.uriTemplate,
    name: config.name,
    title: config.title,
    description: config.description,
    mimeType: config.mimeType,
    params: zodToJsonSchemaOrNull(config.params),
  }
  return { config, definition, exposeMcp: true, exposeHttp: true }
}

/** Build a stored prompt registration record. */
export function buildStoredPrompt<S extends ObjectParamsSchema>(config: BuilderPromptConfig<S>): StoredPrompt<S> {
  const definition: PromptDefinition = {
    name: config.name,
    title: config.title,
    description: config.description,
    params: zodToJsonSchemaOrNull(config.params),
  }
  return { config, definition, exposeMcp: true, exposeHttp: false }
}
