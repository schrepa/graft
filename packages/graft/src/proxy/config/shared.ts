import type {
  JsonSchema,
  ParameterLocation,
  ParameterLocationEntry,
  ToolAuth,
  ToolExample,
} from '../../types.js'
import type { HttpMethodInput } from '../../http-method.js'

/** Loose proxy-config document shape before validation and normalization. */
export interface ProxyConfigDocument {
  target?: unknown
  name?: unknown
  version?: unknown
  headers?: unknown
  definitions?: unknown
  tools?: unknown
}

/**
 * Error raised when a proxy config file cannot be read, parsed, or validated.
 */
export class ProxyConfigError extends Error {
  constructor(
    readonly filePath: string,
    readonly field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${filePath}${field ? ` (${field})` : ''}: ${message}`, options)
    this.name = 'ProxyConfigError'
  }
}

/**
 * Parsed proxy configuration consumed by `configToToolDefinitions()`.
 */
export interface ProxyConfig {
  target: string
  name?: string
  version?: string
  headers?: Record<string, string>
  /** Shared JSON Schema definitions for $ref resolution */
  definitions?: Record<string, unknown>
  tools: ConfigTool[]
}

/**
 * Optional environment inputs for loading a proxy config file.
 */
export interface LoadProxyConfigOptions {
  env: Readonly<Record<string, string | undefined>>
}

/**
 * Normalized proxy tool entry loaded from YAML or JSON config.
 */
export interface ConfigTool {
  method: HttpMethodInput
  path: string
  description: string
  name?: string
  parameters?: JsonSchema
  outputSchema?: JsonSchema
  tags?: string[]
  auth?: ToolAuth
  examples?: ToolExample[]
  parameterLocations?: Record<string, ParameterLocation | ParameterLocationEntry>
}

/** Convert an unknown thrown value into a stable config error message. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Create a typed proxy-config error with optional cause information. */
export function createConfigError(
  filePath: string,
  field: string,
  message: string,
  cause?: unknown,
): ProxyConfigError {
  return new ProxyConfigError(filePath, field, message, {
    cause: cause instanceof Error ? cause : undefined,
  })
}

/** Throw a typed proxy-config error immediately. */
export function failConfig(
  filePath: string,
  field: string,
  message: string,
  cause?: unknown,
): never {
  throw createConfigError(filePath, field, message, cause)
}

/** Wrap parser work so arbitrary failures become `ProxyConfigError`. */
export function wrapConfigError<T>(
  filePath: string,
  field: string,
  work: () => T,
): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof ProxyConfigError) throw error
    throw createConfigError(filePath, field, getErrorMessage(error), error)
  }
}
