import type { HttpMethod } from '../http-method.js'
import type { JsonSchema } from '../types.js'
import { usesQueryParametersForMethod } from '../http-method.js'
import { coercePathParams, deserializeQuery, parseJsonBody } from './query.js'

/**
 * Read HTTP tool params using a single merge policy for both router-mounted routes
 * and externally mounted route descriptors.
 */
export async function readHttpToolParams(
  request: Request,
  method: HttpMethod,
  inputSchema: JsonSchema | null | undefined,
  rawPathParams: Record<string, string>,
): Promise<Record<string, unknown>> {
  const pathParams = coercePathParams(rawPathParams, inputSchema)

  if (usesQueryParametersForMethod(method)) {
    const queryParams = deserializeQuery(new URL(request.url).searchParams, inputSchema)
    return { ...queryParams, ...pathParams }
  }

  const body = await parseJsonBody(request)
  return { ...pathParams, ...body }
}
