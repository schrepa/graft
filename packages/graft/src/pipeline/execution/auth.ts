import { checkResolvedAuth, requireAuthenticated, resolveToolAuth } from '../../auth.js'
import { AuthError, GraftError } from '../../errors.js'
import { buildSyntheticRequest } from '../../headers.js'
import type { AuthResult } from '../../types.js'
import type { CreatePipelineOptions } from '../types.js'
import type { EntryShape, ExecutionDeps, NormalizedOptions } from './shared.js'

/** Resolve the auth result for one dispatch, authenticating on demand when needed. */
export async function resolveAuth<TAuth extends AuthResult>(
  deps: ExecutionDeps<TAuth>,
  entry: EntryShape<TAuth>,
  normalized: NormalizedOptions<TAuth>,
): Promise<TAuth | undefined> {
  if (normalized.authResult) return normalized.authResult
  if (!resolveToolAuth(entry.auth).requiresAuthentication || !deps.authenticate) return undefined

  try {
    const request = normalized.request ?? buildSyntheticRequest(normalized.headers)
    return await deps.authenticate(request)
  } catch (err) {
    if (err instanceof GraftError) throw err
    throw new GraftError(
      `Authentication provider error: ${err instanceof Error ? err.message : String(err)}`,
      500,
    )
  }
}

/** Enforce tool-level authorization once authentication has been resolved. */
export async function checkAuthorization<TAuth extends AuthResult>(
  authorize: CreatePipelineOptions<TAuth>['authorize'],
  entry: EntryShape<TAuth>,
  authResult: TAuth | undefined,
  rawArgs: Record<string, unknown>,
): Promise<void> {
  const resolvedAuth = resolveToolAuth(entry.auth)
  if (!resolvedAuth.requiresAuthentication) return
  requireAuthenticated(resolvedAuth, authResult)

  if (authorize && entry.meta) {
    const allowed = await authorize(entry.meta, authResult, { phase: 'call', params: rawArgs })
    if (!allowed) {
      throw new AuthError('Forbidden: insufficient permissions', 403)
    }
    return
  }

  checkResolvedAuth(resolvedAuth, authResult)
}
