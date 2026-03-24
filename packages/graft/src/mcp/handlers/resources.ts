import type {
  AuthResult,
  Manifest,
  ToolAuth,
  ToolMeta,
} from '../../types.js'
import { filterByAuth } from '../../auth.js'
import { GraftError } from '../../errors.js'
import { toBase64 } from '../../binary.js'
import {
  asReadResourceParams,
  type McpHandlerOptions,
  type McpMethodContext,
  type McpMethodHandler,
} from '../shared.js'

function buildResourceMeta(name: string, auth: ToolAuth | undefined): ToolMeta {
  return {
    kind: 'resource',
    name,
    tags: [],
    auth,
    sideEffects: false,
  }
}

function toListResource(resource: Manifest['resources'][number]): Record<string, unknown> {
  return {
    uri: resource.uri,
    name: resource.name,
    ...(resource.title ? { title: resource.title } : {}),
    description: resource.description,
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  }
}

function toListResourceTemplate(
  template: Manifest['resourceTemplates'][number],
): Record<string, unknown> {
  return {
    uriTemplate: template.uriTemplate,
    name: template.name,
    ...(template.title ? { title: template.title } : {}),
    description: template.description,
    ...(template.mimeType ? { mimeType: template.mimeType } : {}),
  }
}

async function filterVisibleResources<TAuth extends AuthResult = AuthResult>(
  resources: Manifest['resources'],
  options: McpHandlerOptions<TAuth>,
  ctx: McpMethodContext,
): Promise<Manifest['resources']> {
  const resourceAuth = options.resourceAuth
  const authorize = options.authorize
  if (!resourceAuth?.size || !options.authenticate) return resources

  return filterByAuth(resources, (resource) => resourceAuth.get(resource.uri), {
    headers: ctx.headers,
    authenticate: options.authenticate,
    authorize: authorize
      ? (resource, authResult) =>
          authorize(
            buildResourceMeta(resource.name, resourceAuth.get(resource.uri)),
            authResult,
            { phase: 'list' },
          )
      : undefined,
  })
}

async function filterVisibleResourceTemplates<TAuth extends AuthResult = AuthResult>(
  resourceTemplates: Manifest['resourceTemplates'],
  options: McpHandlerOptions<TAuth>,
  ctx: McpMethodContext,
): Promise<Manifest['resourceTemplates']> {
  const resourceTemplateAuth = options.resourceTemplateAuth
  const authorize = options.authorize
  if (!resourceTemplateAuth?.size || !options.authenticate) return resourceTemplates

  return filterByAuth(resourceTemplates, (template) => resourceTemplateAuth.get(template.name), {
    headers: ctx.headers,
    authenticate: options.authenticate,
    authorize: authorize
      ? (template, authResult) =>
          authorize(
            buildResourceMeta(template.name, resourceTemplateAuth.get(template.name)),
            authResult,
            { phase: 'list' },
          )
      : undefined,
  })
}

async function handleResourcesList<TAuth extends AuthResult = AuthResult>(
  manifest: Manifest,
  options: McpHandlerOptions<TAuth>,
  ctx: McpMethodContext,
): Promise<{ resources: Array<Record<string, unknown>> }> {
  const visibleResources = await filterVisibleResources(manifest.resources, options, ctx)
  return { resources: visibleResources.map(toListResource) }
}

async function readResource<TAuth extends AuthResult = AuthResult>(
  uri: string,
  options: McpHandlerOptions<TAuth>,
  ctx: McpMethodContext,
): Promise<{ contents: Array<Record<string, unknown>> }> {
  if (!options.resourceHandler) {
    throw new GraftError('No resource handler configured', 500)
  }

  const result = await options.resourceHandler(uri, {
    headers: ctx.headers,
    signal: ctx.signal,
  })

  if (result.content instanceof Uint8Array || result.content instanceof ArrayBuffer) {
    return {
      contents: [{
        uri,
        ...(result.mimeType ? { mimeType: result.mimeType } : {}),
        blob: toBase64(result.content),
      }],
    }
  }

  const content = typeof result.content === 'string'
    ? result.content
    : JSON.stringify(result.content, null, 2)

  return {
    contents: [{
      uri,
      ...(result.mimeType ? { mimeType: result.mimeType } : {}),
      text: content,
    }],
  }
}

/** Register the MCP resource handlers on the shared handler map. */
export function registerResourceHandlers<TAuth extends AuthResult = AuthResult>(
  handlers: Map<string, McpMethodHandler>,
  manifest: Manifest,
  options: McpHandlerOptions<TAuth>,
): void {
  handlers.set('resources/list', async (_params, ctx) => handleResourcesList(manifest, options, ctx))

  handlers.set('resources/templates/list', async (_params, ctx) => {
    const visibleTemplates = await filterVisibleResourceTemplates(
      manifest.resourceTemplates,
      options,
      ctx,
    )

    return { resourceTemplates: visibleTemplates.map(toListResourceTemplate) }
  })

  handlers.set('resources/read', async (params, ctx) => {
    const { uri } = asReadResourceParams(params)
    return readResource(uri, options, ctx)
  })
}
