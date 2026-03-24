/**
 * Graft error hierarchy.
 *
 * Each error carries a `statusCode` so catch blocks in the router,
 * HTTP bridge, and MCP handler can map it to the correct HTTP status
 * or MCP error code without string-matching.
 */

import type { ValidationDetail } from './types.js'

/**
 * Base error type used across Graft runtime boundaries.
 *
 * Carries an HTTP status code and optional machine-readable error code so
 * routers, transports, and test helpers can translate failures consistently.
 */
export class GraftError extends Error {
  /** HTTP status code to return (default 500) */
  readonly statusCode: number
  /** Machine-readable error code. Surfaces as the error string in MCP responses.
   *  When omitted, derived from statusCode (e.g. 404 → 'NOT_FOUND'). */
  readonly code?: string

  constructor(message: string, statusCode = 500, code?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GraftError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** Thrown when a tool handler fails */
export class ToolError extends GraftError {
  /** Response headers from upstream (e.g. Retry-After on 429) */
  readonly headers?: Record<string, string>

  constructor(message: string, statusCode = 500, options?: {
    headers?: Record<string, string>
    code?: string
    cause?: Error
  }) {
    super(message, statusCode, options?.code, { cause: options?.cause })
    this.name = 'ToolError'
    this.headers = options?.headers
  }
}

/** Thrown when input validation fails (Zod, JSON Schema, etc.) */
export class ValidationError extends GraftError {
  /** Structured validation details — always an array, empty if no specific fields */
  readonly details: ValidationDetail[]

  constructor(message: string, details: ValidationDetail[] = [], options?: ErrorOptions) {
    super(message, 400, undefined, options)
    this.name = 'ValidationError'
    this.details = details
  }
}

/** Thrown when authentication or authorization fails */
export class AuthError extends GraftError {
  constructor(message = 'Unauthorized', statusCode = 401, options?: ErrorOptions) {
    super(message, statusCode, undefined, options)
    this.name = 'AuthError'
  }
}
