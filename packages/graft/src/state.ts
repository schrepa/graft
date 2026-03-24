import type { ToolContext } from './types.js'

/**
 * Create a typed key for `ctx.state`.
 *
 * @param name Debug-friendly label used when creating the backing symbol.
 * @returns Getter and setter helpers scoped to a single logical state slot.
 */
export function createStateKey<T>(name: string): {
  get(ctx: ToolContext): T | undefined
  set(ctx: ToolContext, value: T): void
} {
  const key = Symbol(name)
  const store = new WeakMap<ToolContext, T>()

  return {
    get(ctx) {
      return store.get(ctx)
    },
    set(ctx, value) {
      store.set(ctx, value)
      ctx.state[key] = value
    },
  }
}
