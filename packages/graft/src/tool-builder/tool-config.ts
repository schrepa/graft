import type { z } from 'zod'
import type {
  AnnotationHints,
  AuthResult,
  JsonSchema,
  ParameterLocation,
  ParameterLocationEntry,
  ToolAuth,
  ToolContext,
  ToolExample,
  ToolMeta,
} from '../types.js'
import type { HttpMethod, HttpMethodInput } from '../http-method.js'
import { GraftError } from '../errors.js'
import { nameToPath } from '../derivation.js'
import { hasSideEffects, parseHttpMethod } from '../http-method.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import { validateParameterLocation } from '../parameter-location.js'
import { parseZod, zodToJsonSchemaOrNull } from '../schema.js'
import type { Exposure, InternalTool } from '../registry.js'

/** Base fields shared by all tool configs. */
export interface ToolConfigBase {
  title?: string
  description: string
  sideEffects?: boolean
  tags?: string[]
  auth?: ToolAuth
  examples?: ToolExample[]
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
  expose?: Exposure
  http?: { method?: HttpMethodInput; path?: string }
  deprecated?: boolean | string
  annotations?: AnnotationHints
}

/** Tool config backed by Zod validation. */
export interface ZodToolConfig<S extends ObjectParamsSchema, TAuth extends AuthResult = AuthResult> extends ToolConfigBase {
  params: S
  inputSchema?: never
  output?: z.ZodTypeAny
  handler: (params: z.output<S>, ctx: ToolContext<TAuth>) => unknown | Promise<unknown>
}

/** Tool config backed by raw JSON Schema. */
export interface JsonSchemaToolConfig<TAuth extends AuthResult = AuthResult> extends ToolConfigBase {
  params?: never
  inputSchema: JsonSchema | null
  output?: never
  handler: (params: Record<string, unknown>, ctx: ToolContext<TAuth>) => unknown | Promise<unknown>
}

/** Tool config with no validation schema. */
export interface NoSchemaToolConfig<TAuth extends AuthResult = AuthResult> extends ToolConfigBase {
  params?: never
  inputSchema?: never
  output?: never
  handler: (params: Record<string, unknown>, ctx: ToolContext<TAuth>) => unknown | Promise<unknown>
}

/** Union of the tool config shapes accepted by the builder APIs. */
export type BuilderToolConfig<
  S extends ObjectParamsSchema = ObjectParamsSchema,
  TAuth extends AuthResult = AuthResult,
> = ZodToolConfig<S, TAuth> | JsonSchemaToolConfig<TAuth> | NoSchemaToolConfig<TAuth>

/** Shared defaults applied to every tool registered through `app.tools()`. */
export interface BuilderSharedToolOptions {
  tags?: string[]
  auth?: ToolAuth
  sideEffects?: boolean
  expose?: Exposure
  http?: { pathPrefix?: string }
}

/** Check whether a builder config uses Zod-based params. */
export function hasZodParams<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  config: BuilderToolConfig<S, TAuth>,
): config is ZodToolConfig<S, TAuth> {
  return 'params' in config && config.params != null
}

/** Check whether a builder config uses raw JSON Schema input. */
export function hasJsonSchema<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  config: BuilderToolConfig<S, TAuth>,
): config is JsonSchemaToolConfig<TAuth> {
  return 'inputSchema' in config && config.inputSchema !== undefined
}

function validateExamples<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  name: string,
  zodConfig: ZodToolConfig<S, TAuth>,
  examples: ToolExample[],
): void {
  for (const example of examples) {
    const result = zodConfig.params.safeParse(example.args)
    if (!result.success) {
      throw new GraftError(
        `Tool "${name}": example "${example.name ?? 'unnamed'}" has invalid args: ${result.error.message}`,
        500,
      )
    }
  }

  if (!zodConfig.output) return

  for (const example of examples) {
    if (example.result === undefined) continue
    const result = zodConfig.output.safeParse(example.result)
    if (!result.success) {
      throw new GraftError(
        `Tool "${name}": example "${example.name ?? 'unnamed'}" has invalid result: ${result.error.message}`,
        500,
      )
    }
  }
}

function resolveSchemas<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  config: BuilderToolConfig<S, TAuth>,
): {
  inputSchema: ReturnType<typeof zodToJsonSchemaOrNull>
  outputSchema: ReturnType<typeof zodToJsonSchemaOrNull> | undefined
} {
  const inputSchema = hasJsonSchema(config)
    ? config.inputSchema
    : hasZodParams(config)
      ? zodToJsonSchemaOrNull(config.params)
      : null
  const outputSchema = hasZodParams(config) && config.output
    ? zodToJsonSchemaOrNull(config.output)
    : undefined
  return { inputSchema, outputSchema }
}

function resolveHttpConfig<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  name: string,
  config: BuilderToolConfig<S, TAuth>,
): { httpMethod: HttpMethod; httpPath: string; sideEffects: boolean } {
  const explicitMethod = config.http?.method
    ? parseHttpMethod(config.http.method, `Tool "${name}" http.method`)
    : undefined
  const sideEffects = config.sideEffects ?? (explicitMethod ? hasSideEffects(explicitMethod) : false)
  return {
    httpMethod: explicitMethod ?? (sideEffects ? 'POST' : 'GET'),
    httpPath: config.http?.path ?? nameToPath(name),
    sideEffects,
  }
}

function createRuntimeHandler<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  config: BuilderToolConfig<S, TAuth>,
): InternalTool<TAuth>['handler'] {
  if (hasZodParams(config)) {
    return (parsed: z.output<S>, ctx: ToolContext<TAuth>) => config.handler(parsed, ctx)
  }

  return (parsed: Record<string, unknown>, ctx: ToolContext<TAuth>) => config.handler(parsed, ctx)
}

function validateToolConfig<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  name: string,
  config: BuilderToolConfig<S, TAuth>,
): void {
  if (hasZodParams(config) && hasJsonSchema(config)) {
    throw new GraftError(
      `Tool "${name}": provide either params (Zod) or inputSchema (JSON Schema), not both.`,
      500,
    )
  }

  if (Array.isArray(config.auth) && config.auth.length === 0) {
    throw new GraftError(`Tool "${name}": empty roles array — did you mean \`auth: true\`?`, 500)
  }

  if (config.parameterLocations) {
    for (const [paramName, location] of Object.entries(config.parameterLocations)) {
      validateParameterLocation(
        location,
        `Tool "${name}" parameterLocations.${paramName}`,
        (message) => {
          throw new GraftError(message, 500)
        },
      )
    }
  }
}

function buildValidateFn<S extends ObjectParamsSchema, TAuth extends AuthResult>(
  config: BuilderToolConfig<S, TAuth>,
): InternalTool<TAuth>['validate'] {
  if (!hasZodParams(config)) return undefined
  return (args: Record<string, unknown>) => parseZod(config.params, args)
}

function buildToolMeta(
  name: string,
  tags: string[],
  auth: ToolAuth | undefined,
  sideEffects: boolean,
): ToolMeta {
  return { kind: 'tool', name, tags, auth, sideEffects }
}

/** Build the runtime representation for a single tool definition. */
export function buildInternalTool<S extends ObjectParamsSchema, TAuth extends AuthResult = AuthResult>(
  name: string,
  config: BuilderToolConfig<S, TAuth>,
): InternalTool<TAuth> {
  validateToolConfig(name, config)
  const { inputSchema, outputSchema } = resolveSchemas(config)
  const { httpMethod, httpPath, sideEffects } = resolveHttpConfig(name, config)
  const zodConfig = hasZodParams(config) ? config : undefined

  if (zodConfig && config.examples?.length) {
    validateExamples(name, zodConfig, config.examples)
  }

  const tags = config.tags ?? []
  const handler = createRuntimeHandler(config)
  return {
    name,
    title: config.title,
    description: config.description,
    httpMethod,
    httpPath,
    sideEffects,
    inputSchema,
    outputSchema: outputSchema ?? undefined,
    tags,
    examples: config.examples ?? [],
    auth: config.auth,
    parameterLocations: config.parameterLocations,
    nameIsExplicit: true,
    deprecated: config.deprecated,
    annotations: config.annotations,
    validate: buildValidateFn(config),
    handler,
    meta: buildToolMeta(name, tags, config.auth, sideEffects),
    exposeMcp: true,
    exposeHttp: true,
  }
}

/**
 * Standalone tool definition created by `defineTool()` for later registration.
 */
export interface DefinedTool<TConfig = BuilderToolConfig<ObjectParamsSchema, AuthResult>> {
  readonly name: string
  readonly config: TConfig
}

/**
 * Define a tool in a standalone module for later registration.
 *
 * @param name Stable tool name used at registration time.
 * @param config Tool configuration, including validation and handler logic.
 * @returns A deferred tool definition that can be registered later.
 */
export function defineTool<S extends ObjectParamsSchema, TAuth extends AuthResult = AuthResult>(
  name: string,
  config: ZodToolConfig<S, TAuth>,
): DefinedTool<ZodToolConfig<S, TAuth>>
export function defineTool<TAuth extends AuthResult = AuthResult>(
  name: string,
  config: JsonSchemaToolConfig<TAuth>,
): DefinedTool<JsonSchemaToolConfig<TAuth>>
export function defineTool<TAuth extends AuthResult = AuthResult>(
  name: string,
  config: NoSchemaToolConfig<TAuth>,
): DefinedTool<NoSchemaToolConfig<TAuth>>
export function defineTool(
  name: string,
  config: BuilderToolConfig<ObjectParamsSchema, AuthResult>,
): DefinedTool {
  return { name, config }
}
