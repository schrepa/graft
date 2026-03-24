/**
 * Level 1 RFC 6570 URI template matching and conversion.
 * Supports simple `{param}` expansion only.
 */

/** Escape a string for use in a RegExp */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match a URI against a URI template, returning extracted params or null.
 *
 * Example: matchUriTemplate('products://abc', 'products://{id}') → { id: 'abc' }
 */
export function matchUriTemplate(
  uri: string,
  template: string
): Record<string, string> | null {
  const paramNames: string[] = []

  // Split template into literal parts and {param} tokens
  const parts = template.split(/(\{[^}]+\})/)
  let regexStr = ''
  for (const part of parts) {
    const m = part.match(/^\{([^}]+)\}$/)
    if (m) {
      paramNames.push(m[1])
      regexStr += '([^/]+)'
    } else {
      regexStr += escapeRegex(part)
    }
  }

  const match = uri.match(new RegExp(`^${regexStr}$`))
  if (!match) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < paramNames.length; i++) {
    params[paramNames[i]] = decodeURIComponent(match[i + 1])
  }
  return params
}

/**
 * Convert a URI template to an Express-style HTTP path.
 * The scheme becomes the first path segment.
 *
 * Example: 'products://{id}' → '/products/:id'
 *          'records://{userId}/{recordId}' → '/records/:userId/:recordId'
 */
export function uriTemplateToHttpPath(template: string): string {
  // Replace "://" with "/" to turn scheme into first path segment
  const asPath = template.replace('://', '/')
  // Ensure leading slash
  const path = asPath.startsWith('/') ? asPath : `/${asPath}`
  // Convert {param} → :param
  return path.replace(/\{([^}]+)\}/g, ':$1')
}
