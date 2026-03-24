/**
 * Marker symbol used to tag rich handler results.
 */
const RICH_RESULT_MARKER = Symbol('richResult')

/**
 * Rich tool result used to override the HTTP content type for a response body.
 */
export interface RichResult {
  [RICH_RESULT_MARKER]: true
  body: unknown
  contentType: string
}

/**
 * Wrap a handler return value with an explicit content type.
 *
 * @param body Response body value.
 * @param contentType HTTP content type to attach.
 * @returns A tagged rich result.
 */
export function richResult(body: unknown, contentType: string): RichResult {
  return { [RICH_RESULT_MARKER]: true, body, contentType }
}

/** Check whether a value is a `richResult()` wrapper. */
export function isRichResult(value: unknown): value is RichResult {
  return value !== null && typeof value === 'object' && RICH_RESULT_MARKER in value
}
