/**
 * Normalize an HTTP media type by stripping parameters and lowercasing it.
 *
 * @param contentType Raw `Content-Type` header value.
 * @returns The normalized media type without parameters.
 */
export function normalizeMediaType(contentType?: string): string {
  return (contentType ?? '').split(';', 1)[0].trim().toLowerCase()
}

/**
 * Check whether a media type should be treated as JSON.
 *
 * @param contentType Raw `Content-Type` header value.
 * @returns `true` for `application/json` and `application/*+json`.
 */
export function isJsonMediaType(contentType?: string): boolean {
  const mediaType = normalizeMediaType(contentType)
  return mediaType === 'application/json' || mediaType.endsWith('+json')
}

/**
 * Check whether a media type should be treated as binary content.
 *
 * @param contentType Raw `Content-Type` header value.
 * @returns `true` for image and audio media types.
 */
export function isBinaryMediaType(contentType?: string): boolean {
  const mediaType = normalizeMediaType(contentType)
  return mediaType.startsWith('image/') || mediaType.startsWith('audio/')
}
