import { GraftError } from '../errors.js'
import type { ObjectParamsSchema } from '../object-schema.js'
import type {
  InternalTool,
  StoredResource,
  StoredResourceTemplate,
} from '../registry.js'
import type { AuthResult, ToolAuth } from '../types.js'

interface NamedAuthEntry {
  label: 'Tool' | 'Resource' | 'Resource template'
  name: string
  auth?: ToolAuth
}

function assertUniqueToolNames<TAuth extends AuthResult>(
  tools: readonly InternalTool<TAuth>[],
): void {
  const seenNames = new Set<string>()
  for (const tool of tools) {
    if (seenNames.has(tool.name)) {
      throw new GraftError(`Tool name collision: "${tool.name}" is registered more than once.`, 500)
    }
    seenNames.add(tool.name)
  }
}

function assertAuthenticateHookForProtectedEntries(
  entries: readonly NamedAuthEntry[],
  authenticate: ((req: Request) => unknown) | undefined,
): void {
  if (authenticate) return

  for (const entry of entries) {
    if (!entry.auth) continue
    const guidance = entry.label === 'Tool'
      ? ' Either remove the auth field, or use --entry with a custom app that includes an authenticate hook.'
      : ''
    throw new GraftError(
      `${entry.label} "${entry.name}" requires auth but no authenticate hook is configured.${guidance}`,
      500,
    )
  }
}

/** Validate duplicate names + auth config when no authenticate hook is provided. */
export function validateAuthConfig<TAuth extends AuthResult>(
  tools: readonly InternalTool<TAuth>[],
  storedResources: readonly StoredResource[],
  storedResourceTemplates: readonly StoredResourceTemplate<ObjectParamsSchema, TAuth>[],
  authenticate: ((req: Request) => TAuth | Promise<TAuth>) | undefined,
): void {
  assertUniqueToolNames(tools)
  assertAuthenticateHookForProtectedEntries(
    [
      ...tools.map((tool) => ({ label: 'Tool' as const, name: tool.name, auth: tool.auth })),
      ...storedResourceTemplates.map(({ config }) => ({
        label: 'Resource template' as const,
        name: config.name,
        auth: config.auth,
      })),
      ...storedResources.map(({ config }) => ({
        label: 'Resource' as const,
        name: config.name,
        auth: config.auth,
      })),
    ],
    authenticate,
  )
}
