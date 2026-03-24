import type { AuthResult } from '../types.js'
import type {
  CreatePipelineOptions,
  Dispatchable,
  DispatchOptions,
  PipelineTool,
  ToolPipeline,
} from './types.js'
import {
  createDispatchExecutor,
  createNotFoundEntry,
  type EntryShape,
} from './execution.js'

function indexByName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  const indexed = new Map<string, T>()
  for (const item of items) {
    indexed.set(item.name, item)
  }
  return indexed
}

function resolveEntry<TAuth extends AuthResult, TEntry extends EntryShape<TAuth>>(
  entry: TEntry | undefined,
  kind: 'tool' | 'resource',
  name: string,
): EntryShape<TAuth> {
  return entry ?? createNotFoundEntry(kind, name)
}

/**
 * Create a transport-agnostic dispatch pipeline for tools and resources.
 *
 * @param options Registered dispatchables plus auth, middleware, and lifecycle hooks.
 * @returns A dispatcher used by HTTP, MCP, stdio, and tests.
 */
export function createToolPipeline<TAuth extends AuthResult = AuthResult>(
  options: CreatePipelineOptions<TAuth>,
): ToolPipeline<TAuth> {
  const execute = createDispatchExecutor(options)
  const toolMap = indexByName<PipelineTool<TAuth>>(options.tools)
  const resourceMap = indexByName<Dispatchable<TAuth>>(options.resources ?? [])

  return {
    async dispatch(
      toolName: string,
      rawArgs: Record<string, unknown>,
      opts?: DispatchOptions<TAuth>,
    ) {
      return execute(
        resolveEntry(toolMap.get(toolName), 'tool', toolName),
        'tool',
        toolName,
        rawArgs,
        opts,
      )
    },

    async dispatchResource(
      name: string,
      rawArgs: Record<string, unknown>,
      opts?: DispatchOptions<TAuth>,
    ) {
      return execute(
        resolveEntry(resourceMap.get(name), 'resource', name),
        'resource',
        name,
        rawArgs,
        opts,
      )
    },

    async dispatchFromRequest(
      toolName: string,
      rawArgs: Record<string, unknown>,
      request: Request,
    ) {
      return this.dispatch(toolName, rawArgs, { request })
    },

    async dispatchResourceFromRequest(
      name: string,
      rawArgs: Record<string, unknown>,
      request: Request,
    ) {
      return this.dispatchResource(name, rawArgs, { request })
    },
  }
}
