import type { z } from 'zod'

/** Object-shaped Zod schema used for named-argument APIs. */
export type ObjectParamsSchema = z.ZodObject<z.ZodRawShape>

/** Narrow unknown values to plain object records. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return a plain object record when the input has the expected shape. */
export function toPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined
}

/**
 * Require a plain object record at a trust boundary.
 *
 * @param value Untrusted input.
 * @param label Context used in the thrown error message.
 * @returns The narrowed plain object record.
 * @throws {Error} When the input is not a non-array object.
 */
export function expectPlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error(`${label}: expected an object`)
  }
  return value
}
