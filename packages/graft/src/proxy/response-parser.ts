import { isBinaryMediaType, isJsonMediaType, normalizeMediaType } from '../media-type.js'
import { ToolError } from '../errors.js'

type ProxyBodyParser = (
  response: Response,
  headers: Record<string, string>,
) => Promise<unknown>

const parseJsonProxyBody: ProxyBodyParser = async (response, headers) => {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch (error) {
    throw new ToolError('Proxy returned invalid JSON', 502, {
      headers,
      cause: error instanceof Error ? error : undefined,
    })
  }
}

const parseBinaryProxyBody: ProxyBodyParser = async (response) => {
  const buffer = Buffer.from(await response.arrayBuffer())
  return buffer.toString('base64')
}

const parseTextProxyBody: ProxyBodyParser = async (response) => response.text()

function resolveProxyBodyParser(contentType: string): ProxyBodyParser {
  if (isJsonMediaType(contentType)) return parseJsonProxyBody
  if (isBinaryMediaType(contentType)) return parseBinaryProxyBody
  return parseTextProxyBody
}

async function parseProxyResponseBody(
  response: Response,
  contentType: string,
  headers: Record<string, string>,
): Promise<unknown> {
  return resolveProxyBodyParser(contentType)(response, headers)
}

/**
 * Parse a proxied `Response` into a serializable result shape.
 *
 * @param response Response returned by the upstream service.
 * @returns Status, flattened headers, and a parsed body payload.
 */
export async function parseProxyResponse(response: Response): Promise<{
  status: number
  headers: Record<string, string>
  body: unknown
}> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })

  const contentType = normalizeMediaType(response.headers.get('content-type') ?? undefined)
  const body = await parseProxyResponseBody(response, contentType, headers)

  return { status: response.status, headers, body }
}
