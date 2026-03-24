import type { AuthResult, JsonSchema, PromptHandler } from '../types.js'
import type { DiscoveryOptions } from '../discovery.js'
import type { HttpMethod } from '../http-method.js'
import type { Manifest } from '../types.js'
import type { McpAdapter } from '../mcp/shared.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type { ToolPipeline } from '../pipeline/types.js'
import type {
  ExplicitRoute,
  InternalTool,
  StoredPrompt,
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import { uriTemplateToHttpPath } from '../uri-template.js'
import type { DiscoveryCache } from './discovery-cache.js'
import type { Router } from './router.js'

/**
 * Transport-ready HTTP tool route.
 */
export interface ToolRoutePlan {
  name: string
  method: HttpMethod
  path: string
  inputSchema: JsonSchema | null | undefined
  conflictMessage: string
}

/**
 * Transport-ready HTTP resource route.
 */
export interface ResourceRoutePlan {
  name: string
  path: string
  conflictMessage: string
}

/**
 * Transport-ready HTTP resource-template route.
 */
export interface ResourceTemplateRoutePlan {
  name: string
  path: string
  conflictMessage: string
}

/**
 * Transport-ready HTTP prompt route.
 */
export interface PromptRoutePlan {
  name: string
  path: string
  conflictMessage: string
}

/**
 * Complete HTTP mounting plan for one built app.
 */
export interface RouteMountPlan<TAuth extends AuthResult = AuthResult> {
  router: Router
  mcp: McpAdapter
  pipeline: ToolPipeline
  manifest: Manifest
  startedAt: number
  toolRoutes: readonly ToolRoutePlan[]
  resourceRoutes: readonly ResourceRoutePlan[]
  resourceTemplateRoutes: readonly ResourceTemplateRoutePlan[]
  promptRoutes: readonly PromptRoutePlan[]
  explicitRoutes: readonly ExplicitRoute[]
  promptHandler?: PromptHandler
  healthCheck?: boolean | { path?: string }
  appName?: string
  appVersion?: string
  appDescription?: string
  apiUrl?: string
  discovery?: DiscoveryOptions
  discoveryCache: DiscoveryCache
  httpTools: readonly InternalTool<TAuth>[]
}

/**
 * Input for building a transport-ready route plan from registration/runtime state.
 */
export interface BuildRoutePlanInput<TAuth extends AuthResult = AuthResult> {
  router: Router
  mcp: McpAdapter
  pipeline: ToolPipeline
  tools: readonly InternalTool<TAuth>[]
  storedResources: readonly StoredResource[]
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[]
  storedPrompts: readonly StoredPrompt<ObjectParamsSchema>[]
  explicitRoutes: readonly ExplicitRoute[]
  promptHandler?: PromptHandler
  healthCheck?: boolean | { path?: string }
  appName?: string
  appVersion?: string
  appDescription?: string
  apiUrl?: string
  discovery?: DiscoveryOptions
  discoveryCache: DiscoveryCache
}

function toResourceHttpPath(resource: StoredResource): string {
  if (typeof resource.config.http === 'object' && resource.config.http.path) {
    return resource.config.http.path
  }

  const uriPath = resource.config.uri.replace(/^[a-z]+:\/\//, '/')
  return uriPath.startsWith('/') ? uriPath : `/${uriPath}`
}

function toPromptHttpPath(prompt: StoredPrompt): string {
  if (typeof prompt.config.http === 'object' && prompt.config.http.path) {
    return prompt.config.http.path
  }
  return `/prompts/${prompt.config.name}`
}

/**
 * Build a transport-ready HTTP mount plan from the built runtime state.
 */
export function buildRoutePlan<TAuth extends AuthResult = AuthResult>(
  input: BuildRoutePlanInput<TAuth>,
): RouteMountPlan<TAuth> {
  const manifest = input.mcp.getManifest()
  const httpTools = input.tools.filter((tool) => tool.exposeHttp)

  return {
    router: input.router,
    mcp: input.mcp,
    pipeline: input.pipeline,
    manifest,
    startedAt: Date.now(),
    toolRoutes: httpTools.map((tool) => ({
      name: tool.name,
      method: tool.httpMethod,
      path: tool.httpPath,
      inputSchema: tool.inputSchema,
      conflictMessage:
        `Tool "${tool.name}" resolves to ${tool.httpMethod} ${tool.httpPath} which conflicts with a reserved framework route. ` +
        `Use http: { path: '/other-path' } to override.`,
    })),
    resourceRoutes: input.storedResources
      .filter((resource) => resource.exposeHttp)
      .map((resource) => ({
        name: resource.config.name,
        path: toResourceHttpPath(resource),
        conflictMessage:
          `Resource "${resource.config.name}" resolves to GET ${toResourceHttpPath(resource)} which conflicts with a reserved framework route.`,
      })),
    resourceTemplateRoutes: input.storedResourceTemplates
      .filter((template) => template.exposeHttp)
      .map((template) => {
        const path = template.config.http?.path ?? uriTemplateToHttpPath(template.config.uriTemplate)
        return {
          name: template.config.name,
          path,
          conflictMessage:
            `Resource template "${template.config.name}" resolves to GET ${path} which conflicts with a reserved framework route.`,
        }
      }),
    promptRoutes: input.storedPrompts
      .filter((prompt) => prompt.exposeHttp)
      .map((prompt) => {
        const path = toPromptHttpPath(prompt)
        return {
          name: prompt.config.name,
          path,
          conflictMessage:
            `Prompt "${prompt.config.name}" resolves to POST ${path} which conflicts with a reserved framework route.`,
        }
      }),
    explicitRoutes: input.explicitRoutes,
    promptHandler: input.promptHandler,
    healthCheck: input.healthCheck,
    appName: input.appName,
    appVersion: input.appVersion,
    appDescription: input.appDescription,
    apiUrl: input.apiUrl,
    discovery: input.discovery,
    discoveryCache: input.discoveryCache,
    httpTools,
  }
}
