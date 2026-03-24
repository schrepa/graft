import type { z } from 'zod'
import type { Dispatchable } from '../pipeline/types.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import { parseZod } from '../schema.js'
import type {
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import type {
  AuthResult,
  ToolAuth,
  ToolMeta,
} from '../types.js'
import { composeScopedMiddleware } from './middleware.js'
import type { RuntimeMiddleware } from './types.js'

function buildResourceTemplateDispatchable<TAuth extends AuthResult>(
  config: StoredResourceTemplate<ObjectParamsSchema, TAuth>['config'],
  middleware: RuntimeMiddleware<TAuth> | undefined,
): Dispatchable<TAuth, z.output<ObjectParamsSchema>> {
  const meta: ToolMeta = {
    kind: 'resource',
    name: config.name,
    tags: [],
    auth: config.auth,
    sideEffects: false,
  }
  const paramsSchema = config.params

  return {
    kind: 'resource',
    name: config.name,
    auth: config.auth,
    validate: paramsSchema
      ? (args: Record<string, unknown>) => parseZod(paramsSchema, args)
      : undefined,
    handler: (parsed, ctx) => config.handler(parsed, ctx),
    middleware: composeScopedMiddleware(meta, middleware),
    meta,
    sideEffects: false,
    tags: [],
  }
}

/** Build resource dispatchables without mutating registered tools. */
export function buildResourceDispatchables<TAuth extends AuthResult>(
  storedResources: readonly StoredResource[],
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[],
  middleware: RuntimeMiddleware<TAuth> | undefined,
): Dispatchable<TAuth>[] {
  const resourceDispatchables: Dispatchable<TAuth>[] = []

  for (const { config } of storedResources) {
    const meta: ToolMeta = {
      kind: 'resource',
      name: config.name,
      tags: [],
      auth: config.auth,
      sideEffects: false,
    }
    resourceDispatchables.push({
      kind: 'resource',
      name: config.name,
      auth: config.auth,
      handler: (_parsed, ctx) => config.handler({
        headers: ctx.meta.headers,
        signal: ctx.signal,
      }),
      middleware: composeScopedMiddleware(meta, middleware),
      meta,
      sideEffects: false,
      tags: [],
    })
  }

  for (const { config } of storedResourceTemplates) {
    resourceDispatchables.push(buildResourceTemplateDispatchable(config, middleware))
  }

  return resourceDispatchables
}

/** Build auth lookup maps for MCP resource and resource-template listing. */
export function collectResourceAuthMaps<TAuth extends AuthResult>(
  storedResources: readonly StoredResource[],
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[],
): {
  resourceAuth: Map<string, ToolAuth>
  resourceTemplateAuth: Map<string, ToolAuth>
} {
  const resourceAuth = new Map<string, ToolAuth>()
  for (const { config } of storedResources) {
    if (config.auth) resourceAuth.set(config.uri, config.auth)
  }

  const resourceTemplateAuth = new Map<string, ToolAuth>()
  for (const { config } of storedResourceTemplates) {
    if (config.auth) resourceTemplateAuth.set(config.name, config.auth)
  }

  return { resourceAuth, resourceTemplateAuth }
}
