import { composeMiddleware } from '../middleware.js'
import type { InternalTool } from '../registry.js'
import type {
  AuthResult,
  ToolCallMiddleware,
  ToolMeta,
} from '../types.js'
import type { RuntimeMiddleware } from './types.js'

/** Compose middleware for a resource meta shape. */
export function composeScopedMiddleware<TAuth extends AuthResult>(
  meta: ToolMeta,
  middleware: RuntimeMiddleware<TAuth> | undefined,
): ToolCallMiddleware<TAuth> | undefined {
  if (!middleware) return undefined
  const mws: ToolCallMiddleware<TAuth>[] = []
  if (middleware.onToolCall) mws.push(middleware.onToolCall)
  for (const { fn, filter } of middleware.scoped) {
    if (!filter || filter(meta)) mws.push(fn)
  }
  return composeMiddleware(mws)
}

/** Attach scoped middleware to each tool dispatchable without mutating the originals. */
export function buildToolDispatchables<TAuth extends AuthResult>(
  tools: readonly InternalTool<TAuth>[],
  middleware: RuntimeMiddleware<TAuth> | undefined,
): InternalTool<TAuth>[] {
  return tools.map((tool) => ({
    ...tool,
    middleware: composeScopedMiddleware(tool.meta, middleware),
  }))
}
