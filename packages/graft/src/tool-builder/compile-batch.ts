import type { HttpMethodInput } from '../http-method.js'
import { nameToPath } from '../derivation.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type { AuthResult } from '../types.js'
import type { InternalTool } from '../registry.js'
import {
  buildInternalTool,
  hasJsonSchema,
  hasZodParams,
  type BuilderSharedToolOptions,
  type BuilderToolConfig,
  type ToolConfigBase,
} from './tool-config.js'

type ToolHttpConfig = { method?: HttpMethodInput; path?: string }

function pickConfigValue<T>(value: T | undefined, fallback: T | undefined): T | undefined {
  return value ?? fallback
}

function resolveSharedHttpConfig<TAuth extends AuthResult>(
  entry: BuilderToolConfig<ObjectParamsSchema, TAuth>,
  shared?: BuilderSharedToolOptions,
  name?: string,
): ToolHttpConfig | undefined {
  const sharedPathPrefix = shared?.http?.pathPrefix
  if (!sharedPathPrefix || entry.http?.path || !name) return entry.http
  return { ...entry.http, path: `${sharedPathPrefix}${nameToPath(name)}` }
}

function commonToolConfigFields<TAuth extends AuthResult>(
  entry: BuilderToolConfig<ObjectParamsSchema, TAuth>,
  shared?: BuilderSharedToolOptions,
  name?: string,
): ToolConfigBase & { http?: ToolHttpConfig } {
  const http = resolveSharedHttpConfig(entry, shared, name)

  return {
    title: entry.title,
    description: entry.description,
    sideEffects: pickConfigValue(entry.sideEffects, shared?.sideEffects),
    tags: pickConfigValue(entry.tags, shared?.tags),
    auth: pickConfigValue(entry.auth, shared?.auth),
    examples: entry.examples,
    parameterLocations: entry.parameterLocations,
    expose: pickConfigValue(entry.expose, shared?.expose),
    http,
    deprecated: entry.deprecated,
    annotations: entry.annotations,
  }
}

/** Merge one tool config with `app.tools()` shared defaults. */
export function mergeSharedToolOptions<TAuth extends AuthResult>(
  entry: BuilderToolConfig<ObjectParamsSchema, TAuth>,
  shared?: BuilderSharedToolOptions,
  name?: string,
): BuilderToolConfig<ObjectParamsSchema, TAuth> {
  const base = commonToolConfigFields(entry, shared, name)
  if (hasZodParams(entry)) {
    return { ...base, params: entry.params, output: entry.output, handler: entry.handler }
  }
  if (hasJsonSchema(entry)) {
    return { ...base, inputSchema: entry.inputSchema, handler: entry.handler }
  }
  return { ...base, handler: entry.handler }
}

/** Compiled batch entry containing the internal tool and final exposure mode. */
export interface CompiledBatchTool<TAuth extends AuthResult = AuthResult> {
  tool: InternalTool<TAuth>
  expose: BuilderSharedToolOptions['expose']
}

/** Compile a batch of tool definitions with shared defaults while preserving expose metadata. */
export function compileToolBatch<TAuth extends AuthResult = AuthResult>(
  map: Record<string, BuilderToolConfig<ObjectParamsSchema, TAuth>>,
  shared?: BuilderSharedToolOptions,
): CompiledBatchTool<TAuth>[] {
  return Object.entries(map).map(([name, entry]) => {
    const merged = mergeSharedToolOptions(entry, shared, name)
    return {
      tool: buildInternalTool(name, merged),
      expose: entry.expose ?? shared?.expose,
    }
  })
}

/** Build multiple InternalTools from a map with shared defaults applied. */
export function buildBatchTools<TAuth extends AuthResult = AuthResult>(
  map: Record<string, BuilderToolConfig<ObjectParamsSchema, TAuth>>,
  shared?: BuilderSharedToolOptions,
): InternalTool<TAuth>[] {
  return compileToolBatch(map, shared).map(({ tool }) => tool)
}
