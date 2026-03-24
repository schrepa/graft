/**
 * Interactive API docs page — /docs
 * Serves a single HTML page that loads Scalar API Reference from CDN.
 */

/**
 * Options for the generated docs HTML page.
 */
export interface DocsHtmlOptions {
  name?: string
  specUrl?: string
}

/**
 * Generate the `/docs` HTML shell that loads Scalar against the app's OpenAPI document.
 *
 * @param options Optional page title and OpenAPI URL overrides.
 * @returns A complete HTML document string.
 * @example
 * generateDocsHtml({ name: 'Example API', specUrl: '/openapi.json' })
 */
export function generateDocsHtml(options?: DocsHtmlOptions): string {
  const name = options?.name ?? 'API Reference'
  const specUrl = options?.specUrl ?? '/openapi.json'

  return `<!doctype html>
<html>
<head>
  <title>${escapeHtml(name)} — API Reference</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  <script>
    Scalar.createApiReference('#app', {
      url: '${specUrl}',
    })
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
