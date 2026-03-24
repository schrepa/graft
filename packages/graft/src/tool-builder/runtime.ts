import type { AuthResult, PromptHandler, ResourceHandler, ValidationDetail } from '../types.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import { AuthError, GraftError, ToolError, ValidationError } from '../errors.js'
import type { ToolPipeline } from '../pipeline/types.js'
import type { StoredPrompt, StoredResource, StoredResourceTemplate } from '../registry.js'
import { parseZod } from '../schema.js'
import { matchUriTemplate } from '../uri-template.js'

function isValidationDetails(value: unknown): value is ValidationDetail[] {
  return Array.isArray(value) && value.every((item) => (
    item !== null &&
    typeof item === 'object' &&
    'path' in item &&
    typeof item.path === 'string' &&
    'message' in item &&
    typeof item.message === 'string'
  ))
}

function unwrapResourceDispatchResult(
  result: Awaited<ReturnType<ToolPipeline['dispatchResource']>>,
  mimeType?: string,
): { content: unknown; mimeType?: string } {
  if (!result.ok) {
    const message = result.error.message

    if (isValidationDetails(result.error.details)) {
      throw new ValidationError(message, result.error.details)
    }

    if (result.error.statusCode === 401 || result.error.statusCode === 403) {
      throw new AuthError(message, result.error.statusCode)
    }

    throw new ToolError(message, result.error.statusCode, {
      code: result.error.code,
      headers: result.error.headers,
    })
  }

  return { content: result.value, mimeType }
}

/** Build the runtime resource handler used by MCP resources/read. */
export function buildResourceHandler<TAuth extends AuthResult = AuthResult>(
  storedResources: readonly StoredResource[],
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[],
  pipeline: ToolPipeline,
): ResourceHandler | undefined {
  const resourceMap = new Map<string, StoredResource['config']>()
  for (const { config } of storedResources) {
    resourceMap.set(config.uri, config)
  }

  if (resourceMap.size === 0 && storedResourceTemplates.length === 0) return undefined

  return async (uri: string, options) => {
    const staticConfig = resourceMap.get(uri)
    if (staticConfig) {
      const result = await pipeline.dispatchResource(staticConfig.name, {}, {
        headers: options?.headers,
        signal: options?.signal,
        transport: 'mcp',
      })
      return unwrapResourceDispatchResult(result, staticConfig.mimeType)
    }

    for (const { config } of storedResourceTemplates) {
      const matched = matchUriTemplate(uri, config.uriTemplate)
      if (!matched) continue

      const result = await pipeline.dispatchResource(config.name, matched, {
        headers: options?.headers,
        signal: options?.signal,
        transport: 'mcp',
      })
      return unwrapResourceDispatchResult(result, config.mimeType)
    }

    throw new GraftError(`Unknown resource: ${uri}`, 404)
  }
}

/** Build the runtime prompt handler used by MCP prompts/get. */
export function buildPromptHandler(storedPrompts: readonly StoredPrompt[]): PromptHandler | undefined {
  const promptMap = new Map<string, StoredPrompt['config']>()
  for (const { config } of storedPrompts) {
    promptMap.set(config.name, config)
  }

  if (promptMap.size === 0) return undefined

  return async (name: string, args: Record<string, unknown>, ctx) => {
    const config = promptMap.get(name)
    if (!config) throw new GraftError(`Unknown prompt: ${name}`, 404)
    const parsed = config.params ? parseZod(config.params, args) : args
    return config.handler(parsed, { signal: ctx?.signal })
  }
}
