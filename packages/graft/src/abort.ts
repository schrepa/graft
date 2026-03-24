/**
 * Detect Web/API abort errors across Node.js and browser runtimes.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
