import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Inputs used to infer the default local serve port for CLI commands.
 */
export interface ResolveServeDefaultPortOptions {
  entry?: string
  cwd?: string
}

/**
 * Resolve the default local port for `serve`-style commands.
 *
 * Entry-based apps default to `3000`. Proxy/config projects default to `3001`
 * when `graft.proxy.yaml` is present in the working directory.
 *
 * @param options CLI context used to infer the correct default.
 * @returns The default local port for the current project shape.
 */
export function resolveDefaultServePort(
  options: ResolveServeDefaultPortOptions = {},
): number {
  if (options.entry) return 3000
  const cwd = options.cwd ?? process.cwd()
  return existsSync(resolve(cwd, 'graft.proxy.yaml')) ? 3001 : 3000
}
