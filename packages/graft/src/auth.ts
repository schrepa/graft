import type { ToolAuth, ToolAuthConfig, AuthResult } from './types.js'
import { AuthError, GraftError } from './errors.js'
import { buildSyntheticRequest } from './headers.js'

/** Auth config after normalization.
 *  Object presence = auth required. `undefined` = public. */
export interface NormalizedAuth {
  roles?: string[]
}

/**
 * Auth requirements after normalizing boolean, array, and object shorthands.
 */
export interface ResolvedToolAuth {
  requiresAuthentication: boolean
  roles: readonly string[]
}

function isToolAuthConfig(auth: ToolAuth): auth is ToolAuthConfig {
  return typeof auth === 'object' && auth !== null && !Array.isArray(auth)
}

/**
 * Normalize a raw auth setting into the internal auth contract.
 *
 * @param auth Raw auth value from a tool, resource, or prompt.
 * @returns Normalized authentication and role requirements.
 */
export function resolveToolAuth(auth: ToolAuth | undefined): ResolvedToolAuth {
  if (auth === undefined || auth === false) {
    return { requiresAuthentication: false, roles: [] }
  }
  if (auth === true) {
    return { requiresAuthentication: true, roles: [] }
  }
  if (Array.isArray(auth)) {
    return { requiresAuthentication: true, roles: [...auth] }
  }
  if (isToolAuthConfig(auth)) {
    return {
      requiresAuthentication: true,
      roles: auth.roles ? [...auth.roles] : [],
    }
  }
  return { requiresAuthentication: true, roles: [] }
}

/**
 * Normalize a ToolAuth value into structured form.
 * - `undefined`/`false`       → `undefined` (no auth needed)
 * - `true`                    → `{}` (auth required, any role)
 * - `['admin']`               → `{ roles: ['admin'] }` (string[] shorthand)
 * - `{ roles: ['admin'] }`    → `{ roles: ['admin'] }` (explicit form)
 */
export function normalizeAuth(auth: ToolAuth | undefined): NormalizedAuth | undefined {
  const resolved = resolveToolAuth(auth)
  if (!resolved.requiresAuthentication) return undefined
  if (resolved.roles.length === 0) return {}
  return { roles: [...resolved.roles] }
}

function hasRequiredRoles(
  resolved: ResolvedToolAuth,
  authResult: AuthResult,
): boolean {
  if (resolved.roles.length === 0) return true
  const userRoles = authResult.roles ?? []
  return resolved.roles.some((role) => userRoles.includes(role))
}

function isPublicAuth(auth: ToolAuth | undefined): boolean {
  return !resolveToolAuth(auth).requiresAuthentication
}

/**
 * Assert that an auth result exists when the resolved auth requires it.
 *
 * @param resolved Normalized auth requirements for the current item.
 * @param authResult Current authenticated user, if any.
 * @throws {AuthError} When authentication is required but missing.
 */
export function requireAuthenticated(
  resolved: ResolvedToolAuth,
  authResult: AuthResult | undefined,
): asserts authResult is AuthResult {
  if (!resolved.requiresAuthentication) return
  if (!authResult) {
    throw new AuthError('Unauthorized: authentication required', 401)
  }
}

/**
 * Validate a resolved auth contract against the current auth result.
 *
 * @param resolved Normalized auth requirements for the current item.
 * @param authResult Current authenticated user, if any.
 * @throws {AuthError} When authentication is missing or roles are insufficient.
 */
export function checkResolvedAuth(
  resolved: ResolvedToolAuth,
  authResult: AuthResult | undefined,
): void {
  requireAuthenticated(resolved, authResult)
  if (!hasRequiredRoles(resolved, authResult)) {
    throw new AuthError('Forbidden: insufficient roles', 403)
  }
}

/**
 * Check whether the auth result satisfies the tool's auth requirements.
 * Returns `true` if the tool is public or the user has a matching role.
 */
export function isAuthorized(auth: ToolAuth | undefined, authResult: AuthResult | undefined): boolean {
  const resolved = resolveToolAuth(auth)
  if (!resolved.requiresAuthentication) return true
  if (!authResult) return false
  return hasRequiredRoles(resolved, authResult)
}

/**
 * Validate that the auth result satisfies the tool's auth requirements.
 * Normalizes `auth` internally — callers pass the raw ToolAuth value.
 * Throws AuthError(401) when auth is required but missing.
 * Throws AuthError(403) when auth is present but lacks required roles.
 */
export function checkAuth(
  auth: ToolAuth | undefined,
  authResult: AuthResult | undefined,
): void {
  checkResolvedAuth(resolveToolAuth(auth), authResult)
}

function getPublicItems<T>(items: T[], getAuth: (item: T) => ToolAuth | undefined): T[] {
  return items.filter((item) => isPublicAuth(getAuth(item)))
}

function shouldReturnPublicItemsOnly(headers?: Record<string, string>): boolean {
  return !headers || Object.keys(headers).length === 0
}

function isVisibilityAuthFailure(error: unknown): boolean {
  return error instanceof AuthError ||
    (error instanceof GraftError && (error.statusCode === 401 || error.statusCode === 403))
}

async function authenticateVisibility<TAuth extends AuthResult>(
  headers: Record<string, string>,
  authenticate: (request: Request) => TAuth | Promise<TAuth>,
): Promise<TAuth | undefined> {
  try {
    return await authenticate(buildSyntheticRequest(headers))
  } catch (error) {
    if (isVisibilityAuthFailure(error)) return undefined
    throw new GraftError(
      `Failed to evaluate auth visibility: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      undefined,
      { cause: error },
    )
  }
}

async function filterAuthorizedItems<T, TAuth extends AuthResult>(
  items: T[],
  getAuth: (item: T) => ToolAuth | undefined,
  authResult: TAuth,
  authorize: (item: T, authResult: TAuth) => boolean | Promise<boolean>,
): Promise<T[]> {
  const visible: T[] = []
  for (const item of items) {
    if (isPublicAuth(getAuth(item))) {
      visible.push(item)
      continue
    }
    if (await authorize(item, authResult)) {
      visible.push(item)
    }
  }
  return visible
}

/**
 * Filter a list of items by auth — for list endpoints (tools/list, resources/list).
 * Items that fail auth are silently hidden (never throws).
 * Public items always pass through regardless of auth state.
 */
export async function filterByAuth<T, TAuth extends AuthResult = AuthResult>(
  items: T[],
  getAuth: (item: T) => ToolAuth | undefined,
  options: {
    headers?: Record<string, string>
    authenticate: (request: Request) => TAuth | Promise<TAuth>
    authorize?: (item: T, authResult: TAuth) => boolean | Promise<boolean>
  },
): Promise<T[]> {
  const publicItems = getPublicItems(items, getAuth)

  if (shouldReturnPublicItemsOnly(options.headers)) {
    return publicItems
  }

  const authResult = await authenticateVisibility(options.headers ?? {}, options.authenticate)
  if (!authResult) return publicItems

  if (options.authorize) {
    return filterAuthorizedItems(items, getAuth, authResult, options.authorize)
  }

  return items.filter((item) => isAuthorized(getAuth(item), authResult))
}
