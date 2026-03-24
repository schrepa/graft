import type { DiscoveryEndpoint } from '../discovery.js'
import type { AuthResult } from '../types.js'
import { generateOpenApiSpec } from '../openapi-gen.js'
import { generateLlmsTxt, generateLlmsFullTxt } from '../llms-txt.js'
import { generateMcpCard } from '../mcp-card.js'
import { generateDocsHtml } from '../docs.js'
import { generateAgentJson } from '../mcp/agent-json.js'
import { CURRENT_MCP_PROTOCOL_VERSION } from '../mcp/protocol-version.js'
import { GRAFT_VERSION } from '../version.js'
import {
  readCachedJsonDiscoveryFile,
  readCachedTextDiscoveryFile,
} from './discovery-cache.js'
import { toRouteKey, type RouteKey } from './route-key.js'
import type { RouteMountPlan } from './route-plan.js'
import type { Router } from './router.js'

function mountTextEndpoint<TAuth extends AuthResult>(
  router: Router,
  path: string,
  option: DiscoveryEndpoint | undefined,
  defaultFn: () => string,
  contentType: string,
  reserved: Set<RouteKey>,
  plan: RouteMountPlan<TAuth>,
): void {
  if (option === false) return
  reserved.add(toRouteKey('GET', path))

  if (typeof option === 'string') {
    router.add('GET', path, async () => {
      return new Response(
        await readCachedTextDiscoveryFile(plan.discoveryCache, option, path),
        { headers: { 'content-type': contentType } },
      )
    })
    return
  }

  if (typeof option === 'function') {
    router.add('GET', path, () => {
      const content = option(plan.manifest)
      return new Response(content, { headers: { 'content-type': contentType } })
    })
    return
  }

  router.add('GET', path, () => {
    return new Response(defaultFn(), { headers: { 'content-type': contentType } })
  })
}

function mountJsonEndpoint<T, TAuth extends AuthResult>(
  router: Router,
  path: string,
  option: DiscoveryEndpoint<T> | undefined,
  defaultFn: (request: Request) => T,
  reserved: Set<RouteKey>,
  plan: RouteMountPlan<TAuth>,
): void {
  if (option === false) return
  reserved.add(toRouteKey('GET', path))

  if (typeof option === 'string') {
    router.add('GET', path, async () => {
      return Response.json(
        await readCachedJsonDiscoveryFile(plan.discoveryCache, option, path),
      )
    })
    return
  }

  if (typeof option === 'function') {
    router.add('GET', path, () => Response.json(option(plan.manifest)))
    return
  }

  router.add('GET', path, (request) => Response.json(defaultFn(request)))
}

function resolveBaseUrl<TAuth extends AuthResult>(
  request: Request,
  plan: RouteMountPlan<TAuth>,
): string {
  if (plan.apiUrl) return plan.apiUrl.replace(/\/$/, '')
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

/**
 * Mount the built-in health endpoint.
 */
export function mountHealthRoute<TAuth extends AuthResult>(
  plan: RouteMountPlan<TAuth>,
  reserved: Set<RouteKey>,
): void {
  if (plan.healthCheck === false) return

  const healthPath = typeof plan.healthCheck === 'object' && plan.healthCheck.path
    ? plan.healthCheck.path
    : '/health'

  reserved.add(toRouteKey('GET', healthPath))
  plan.router.add('GET', healthPath, () => Response.json({
    status: 'ok',
    name: plan.appName ?? 'graft',
    version: plan.appVersion ?? GRAFT_VERSION,
    tools: plan.manifest.tools.length,
    resources: plan.manifest.resources.length + plan.manifest.resourceTemplates.length,
    prompts: plan.manifest.prompts.length,
    uptime: Math.floor((Date.now() - plan.startedAt) / 1000),
    mcp: CURRENT_MCP_PROTOCOL_VERSION,
  }))
}

/**
 * Mount the MCP transport route set.
 */
export function mountMcpTransportRoute<TAuth extends AuthResult>(
  plan: RouteMountPlan<TAuth>,
  reserved: Set<RouteKey>,
): void {
  plan.router.add('POST', '/mcp', (request) => plan.mcp.handleMcp(request))
  plan.router.add('GET', '/mcp', (request) => plan.mcp.handleMcp(request))
  plan.router.add('DELETE', '/mcp', (request) => plan.mcp.handleMcp(request))
  reserved.add(toRouteKey('POST', '/mcp'))
  reserved.add(toRouteKey('GET', '/mcp'))
  reserved.add(toRouteKey('DELETE', '/mcp'))
}

/**
 * Mount discovery/documentation endpoints.
 */
export function mountDiscoveryRoutes<TAuth extends AuthResult>(
  plan: RouteMountPlan<TAuth>,
  reserved: Set<RouteKey>,
): void {
  const discovery = plan.discovery ?? {}

  mountJsonEndpoint(plan.router, '/.well-known/agent.json', discovery.agentJson, (request) => {
    return generateAgentJson(plan.manifest, {
      url: resolveBaseUrl(request, plan),
      name: plan.appName,
      description: plan.appDescription,
    })
  }, reserved, plan)

  mountJsonEndpoint(plan.router, '/.well-known/mcp.json', discovery.mcpCard, (request) => {
    return generateMcpCard({
      name: plan.appName,
      version: plan.appVersion,
      description: plan.appDescription,
      baseUrl: resolveBaseUrl(request, plan),
      manifest: plan.manifest,
    })
  }, reserved, plan)

  mountJsonEndpoint(plan.router, '/openapi.json', discovery.openapi, (request) => {
    return generateOpenApiSpec(plan.httpTools, {
      title: plan.appName,
      version: plan.appVersion,
      description: plan.appDescription,
      serverUrl: resolveBaseUrl(request, plan),
    })
  }, reserved, plan)

  mountTextEndpoint(
    plan.router,
    '/llms.txt',
    discovery.llmsTxt,
    () => generateLlmsTxt(plan.manifest, { name: plan.appName, description: plan.appDescription }),
    'text/plain; charset=utf-8',
    reserved,
    plan,
  )

  mountTextEndpoint(
    plan.router,
    '/llms-full.txt',
    discovery.llmsFullTxt,
    () => generateLlmsFullTxt(plan.manifest, { name: plan.appName, description: plan.appDescription }),
    'text/plain; charset=utf-8',
    reserved,
    plan,
  )

  mountTextEndpoint(
    plan.router,
    '/docs',
    discovery.docs,
    () => generateDocsHtml({ name: plan.appName }),
    'text/html; charset=utf-8',
    reserved,
    plan,
  )
}
