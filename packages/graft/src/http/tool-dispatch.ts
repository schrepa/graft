import type { InternalTool } from '../registry.js'
import type { ToolPipeline } from '../pipeline/types.js'
import { errorResponse, toHttpResponse } from './responses.js'
import { readHttpToolParams } from './tool-request.js'

type HttpDispatchableTool = Pick<InternalTool, 'name' | 'httpMethod' | 'inputSchema'>

/**
 * Parse an incoming HTTP request for a tool and dispatch it through the shared pipeline.
 */
export async function dispatchHttpToolRequest(
  tool: HttpDispatchableTool,
  pipeline: ToolPipeline,
  request: Request,
  pathParams: Record<string, string> = {},
): Promise<Response> {
  const requestId = crypto.randomUUID()
  try {
    const params = await readHttpToolParams(
      request,
      tool.httpMethod,
      tool.inputSchema,
      pathParams,
    )
    const result = await pipeline.dispatch(tool.name, params, { request, requestId })
    return toHttpResponse(result)
  } catch (error) {
    return errorResponse(error, requestId)
  }
}
