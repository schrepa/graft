import type { AuthResult } from '../types.js'
import type { HttpMethod } from '../http-method.js'
import type { InternalTool } from '../registry.js'
import type { ToolPipeline } from '../pipeline/types.js'
import { dispatchHttpToolRequest } from '../http/tool-dispatch.js'

type HttpRouteDescriptor = {
  method: HttpMethod
  path: string
  handler: (request: Request, pathParams?: Record<string, string>) => Promise<Response>
}

/**
 * Build framework-agnostic HTTP route descriptors for all HTTP-exposed tools.
 */
export function buildRouteDescriptors<TAuth extends AuthResult>(
  tools: readonly InternalTool<TAuth>[],
  pipeline: ToolPipeline,
): HttpRouteDescriptor[] {
  const routes: HttpRouteDescriptor[] = []

  for (const tool of tools) {
    if (!tool.exposeHttp) continue

    routes.push({
      method: tool.httpMethod,
      path: tool.httpPath,
      handler: async (request, pathParams) => {
        return dispatchHttpToolRequest(tool, pipeline, request, pathParams)
      },
    })
  }

  return routes
}
