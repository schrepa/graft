import type { AuthResult, ToolCallMiddleware } from './types.js'

/**
 * Compose middleware in registration order.
 *
 * @param middlewares Middleware functions to run around a tool call.
 * @returns A single composed middleware, or `undefined` when no middleware is registered.
 * @example
 * const middleware = composeMiddleware([timingMiddleware, loggingMiddleware])
 */
export function composeMiddleware<TAuth extends AuthResult = AuthResult>(
  middlewares: ToolCallMiddleware<TAuth>[],
): ToolCallMiddleware<TAuth> | undefined {
  if (middlewares.length === 0) return undefined
  if (middlewares.length === 1) return middlewares[0]
  return (ctx, next) => {
    let i = 0
    const run = (): Promise<unknown> => {
      const middleware = middlewares[i++]
      if (middleware) return Promise.resolve(middleware(ctx, run))
      return next()
    }
    return run()
  }
}
