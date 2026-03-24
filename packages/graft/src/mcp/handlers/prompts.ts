import type {
  AuthResult,
  PromptDefinition,
} from '../../types.js'
import { GraftError } from '../../errors.js'
import {
  asGetPromptParams,
  type McpHandlerOptions,
  type McpMethodContext,
  type McpMethodHandler,
  type McpServerData,
} from '../shared.js'

function buildPromptArguments(
  params: NonNullable<PromptDefinition['params']>,
): Array<Record<string, unknown>> {
  const required = params.required ?? []
  return Object.entries(params.properties ?? {}).map(([name, schema]) => ({
    name,
    description: schema.description,
    required: required.includes(name),
  }))
}

function buildPromptsList(manifest: { prompts: PromptDefinition[] }): { prompts: Array<Record<string, unknown>> } {
  return {
    prompts: manifest.prompts.map((prompt) => ({
      name: prompt.name,
      ...(prompt.title ? { title: prompt.title } : {}),
      description: prompt.description,
      ...(prompt.params ? { arguments: buildPromptArguments(prompt.params) } : {}),
    })),
  }
}

async function getPrompt<TAuth extends AuthResult = AuthResult>(
  params: Record<string, unknown>,
  data: McpServerData,
  options: McpHandlerOptions<TAuth>,
  ctx: McpMethodContext,
): Promise<{ description: string; messages: Array<Record<string, unknown>> }> {
  const { name: promptName, arguments: args = {} } = asGetPromptParams(params)
  const prompt = data.promptMap.get(promptName)

  if (!prompt) {
    throw new GraftError(`Unknown prompt: ${promptName}`, 404)
  }

  if (!options.promptHandler) {
    throw new GraftError('No prompt handler configured', 500)
  }

  const messages = await options.promptHandler(promptName, args, { signal: ctx.signal })
  return {
    description: prompt.description,
    messages: messages.map((message) => ({
      role: message.role,
      content: { type: 'text' as const, text: message.content },
    })),
  }
}

/** Register the MCP prompt handlers on the shared handler map. */
export function registerPromptHandlers<TAuth extends AuthResult = AuthResult>(
  handlers: Map<string, McpMethodHandler>,
  data: McpServerData,
  options: McpHandlerOptions<TAuth>,
): void {
  handlers.set('prompts/list', async () => buildPromptsList(data.manifest))
  handlers.set('prompts/get', async (params, ctx) => getPrompt(params, data, options, ctx))
}
