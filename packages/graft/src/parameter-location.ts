import type { ParameterLocation, ParameterLocationEntry } from './types.js'

/**
 * Check whether a value is one of Graft's supported parameter locations.
 *
 * @param value Candidate location value.
 * @returns `true` when the value is `path`, `query`, `header`, or `body`.
 */
export function isParameterLocation(value: unknown): value is ParameterLocation {
  return value === 'path' || value === 'query' || value === 'header' || value === 'body'
}

/**
 * Validate and normalize a parameter-location declaration.
 *
 * `name` overrides are only supported for query-string and header parameters.
 *
 * @param value User-provided parameter-location value.
 * @param label Error label used when validation fails.
 * @param fail Callback that throws a caller-specific error.
 * @returns A normalized object entry with `in` and optional `name`.
 */
export function validateParameterLocation(
  value: unknown,
  label: string,
  fail: (message: string) => never,
): ParameterLocationEntry {
  const candidate = typeof value === 'string' ? { in: value } : value

  if (typeof candidate !== 'object' || candidate === null) {
    fail(`${label} must be a string or object`)
  }

  const entry = candidate as { in?: unknown; name?: unknown }

  if (!isParameterLocation(entry.in)) {
    fail(`${label}.in must be one of path, query, header, or body`)
  }

  if (entry.name !== undefined && typeof entry.name !== 'string') {
    fail(`${label}.name must be a string`)
  }

  if (entry.name !== undefined && entry.in !== 'header' && entry.in !== 'query') {
    fail(`${label}.name is only supported for query or header parameter locations`)
  }

  return entry.name === undefined ? { in: entry.in } : { in: entry.in, name: entry.name }
}

/**
 * Resolve the wire-level parameter name for header/query routing.
 *
 * @param paramName Schema/property name used inside Graft.
 * @param location Parameter-location configuration.
 * @returns The external wire name when supported, otherwise the original name.
 */
export function getParameterLocationWireName(
  paramName: string,
  location: ParameterLocation | ParameterLocationEntry,
): string {
  const entry = typeof location === 'string' ? { in: location } : location
  return entry.in === 'header' || entry.in === 'query'
    ? entry.name ?? paramName
    : paramName
}
