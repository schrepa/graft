# Graft 🌱

Build agent-ready APIs without splitting your server model.

Define tools once, then expose them as both HTTP endpoints and [MCP](https://modelcontextprotocol.io) tools from the same server. Graft also generates discovery docs, OpenAPI, and an interactive API reference automatically.

```typescript
import { createApp } from '@schrepa/graft'

const app = createApp()

app.tool('lookup_user', {
  description: 'Look up a user by id.',
  auth: true,
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
  },
  handler: ({ id }) => ({ id, found: true }),
})

export default app
```

That one definition gives you:

- **`POST /mcp`** — MCP endpoint (Streamable HTTP). Agents connect here.
- **`GET /lookup-user?id=123`** — HTTP endpoint. Any client calls the same tool as REST.
- **`/.well-known/agent.json`** — Agent discovery. Tools, resources, capabilities.
- **`/.well-known/mcp.json`** — MCP server card. Protocol version and transport URL.
- **`/openapi.json`** — Auto-generated OpenAPI 3.1 spec.
- **`/docs`** — Interactive API reference ([Scalar](https://scalar.com)).
- **`/health`** — Health check with tool/resource counts and uptime.

Both transports share a single pipeline:

```
Agent (MCP)  → POST /mcp              → auth → validate → middleware → handler
Browser      → GET /lookup-user?id=123 → auth → validate → middleware → handler
```

One handler. Two protocols. Same auth, same validation, same middleware.

## Get started

### New app

```bash
npx @schrepa/create-graft-app my-app
cd my-app
npm install
npm run dev
```

Open the studio to browse and test your tools: `npm run studio`

### Wrap an existing API

If you have an OpenAPI spec:

```bash
npx @schrepa/graft serve --openapi ./openapi.yaml --target http://localhost:8000
```

Or create a `graft.proxy.yaml` to hand-pick the endpoints you want to expose:

```yaml
target: http://localhost:8000
tools:
  - method: GET
    path: /items
    name: list_items
    description: List items with optional filters
    parameters:
      type: object
      properties:
        q: { type: string, description: Search query }
        status: { type: string, enum: [draft, active, archived] }
  - method: POST
    path: /entries
    name: create_entry
    description: Create a new entry
    parameters:
      type: object
      properties:
        title: { type: string }
        tags: { type: array, items: { type: string } }
      required: [title]
```

```bash
npx @schrepa/graft serve
```

Zero code changes. Any language. Any framework.

### Add to an existing app

Use `.toFetch()` for fetch-based runtimes or `.toNodeHandler()` for Node servers:

```typescript
// Bun / Deno / Cloudflare Workers
export default { fetch: app.toFetch() }

// Node.js with your own http server
const handler = app.toNodeHandler()
http.createServer(handler).listen(3000)
```

## Tools

Tools are the core building block. Each tool becomes both an MCP tool and an HTTP endpoint:

```typescript
app.tool('list_items', {
  description: 'List items with optional filters',
  params: z.object({
    q: z.string().optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
  }),
  handler: ({ q, status }) => {
    // Return any JSON-serializable value
    return items.filter((item) => /* ... */)
  },
})
```

- **`name`** — Stable identifier agents depend on. Tool names map to HTTP paths: `list_items` becomes `GET /list-items`.
- **`description`** — Agents read this to decide when to call your tool.
- **`params`** — Zod schema. Validated before your handler runs. Advertised in MCP `tools/list`.
- **`handler(params, ctx)`** — Receives validated params and a `ToolContext` with logging and progress reporting.
- **`sideEffects`** — Set `true` for mutations. Changes the HTTP method from GET to POST.
- **`output`** — Optional Zod schema advertised as `outputSchema` in MCP.
- **`auth`** — See [Authentication](#authentication).
- **`expose`** — Control visibility: `'both'` (default), `'mcp'` (MCP only, no HTTP), `'http'` (HTTP only, hidden from MCP tools/list).
- **`http`** — `{ method, path }` to customize the HTTP route.

```typescript
// MCP-only tool (no HTTP endpoint)
app.tool('internal_task', { description: '...', expose: 'mcp', handler: () => {} })

// Custom HTTP route
app.tool('search', {
  description: '...',
  http: { method: 'POST', path: '/api/search' },
  handler: () => {},
})
```

For larger apps, define tools in modules and register them by passing the
defined tool object:

```typescript
// src/tools/list-items.ts
import { defineTool, z } from '@schrepa/graft'

export const listItemsTool = defineTool('list_items', {
  description: 'List items with optional filters',
  params: z.object({
    q: z.string().optional(),
  }),
  handler: ({ q }) => listItems(q),
})

// src/app.ts
import { createApp } from '@schrepa/graft'
import { listItemsTool } from './tools/list-items.js'

const app = createApp({ name: 'my-app' })
app.tool(listItemsTool)
```

## Resources

Resources expose read-only data to agents.

- `auth` works on both static resources and resource templates.
- HTTP resource routes run through the same dispatch pipeline as tools.
- MCP `resources/read` uses that same pipeline, so auth, middleware, lifecycle hooks, and telemetry stay consistent.

```typescript
app.resource({
  uri: 'config://settings',
  name: 'App Settings',
  description: 'Current application settings',
  mimeType: 'application/json',
  auth: true,
  handler: () => getSettings(),
})
```

Resources auto-generate HTTP GET endpoints (URI `config://settings` becomes `GET /settings`). Set `expose: 'mcp'` to make them MCP-only.

## Prompts

Prompts are reusable message templates for agents:

```typescript
app.prompt({
  name: 'summarize',
  description: 'Summarize content with optional constraints',
  params: z.object({
    style: z.string().optional().describe('Summary style (e.g. brief, detailed)'),
  }),
  handler: ({ style }) => [
    { role: 'user', content: `Summarize the following content.${style ? ` Use a ${style} style.` : ''}` },
  ],
})
```

## Authentication

Protect tools that require user identity:

```typescript
import { createApp, AuthError } from '@schrepa/graft'

const app = createApp({
  name: 'my-app',
  authenticate: (request) => {
    const token = request.headers.get('authorization')
    if (!token) throw new AuthError('Unauthorized', 401)
    const user = verifyToken(token)
    return { subject: user.id, roles: user.roles }
  },
})

// Auth required — authenticate() must return successfully
app.tool('create_entry', { auth: true, /* ... */ })

// Auth with role check
app.tool('delete_user', { auth: ['admin'], /* ... */ })

// Explicit object form also works
app.tool('audit_log', { auth: { roles: ['auditor'] }, /* ... */ })

// No auth — anyone can call this, authenticate() is skipped entirely
app.tool('list_items', { /* ... */ })
```

Auth is only enforced for tools that declare it. Tools without `auth` skip authentication entirely.

## Middleware

Add cross-cutting logic that wraps every tool call:

```typescript
const app = createApp({
  name: 'my-app',
  // Global middleware via options
  onToolCall: async (ctx, next) => {
    const start = Date.now()
    const result = await next()
    console.log(`${ctx.meta.toolName} took ${Date.now() - start}ms`)
    return result
  },
})

// Or add middleware with .use() — runs in registration order
app.use(async (ctx, next) => {
  console.log(`calling ${ctx.meta.toolName}`)
  return next()
})
```

Middleware runs for both MCP and HTTP calls through the same pipeline.

## HTTP routes

Register non-tool HTTP endpoints:

```typescript
app.route('GET', '/ping', () => ({ status: 'ok' }))
app.route('POST', '/webhooks/stripe', async (request) => {
  const body = await request.json()
  // handle webhook
  return new Response('ok')
})
```

These are plain HTTP routes — not MCP tools, not visible to agents.

## Deployment

### Node.js

```typescript
// src/app.ts
export default app
```

```bash
graft serve -e src/app.ts --port 3000
```

Or use `.serve()` directly:

```typescript
app.serve({ port: 3000 })
```

### Bun, Deno, Cloudflare Workers

```typescript
// Bun
export default { fetch: app.toFetch() }

// Deno
Deno.serve(app.toFetch())

// Cloudflare Workers
export default { fetch: app.toFetch() }
```

### Frontend + Backend on different origins

Set `apiUrl` so discovery documents point to the real backend regardless of which host serves them:

```typescript
const app = createApp({
  name: 'my-api',
  apiUrl: process.env.API_URL ?? 'http://localhost:3000',
})
```

Then proxy `/.well-known/*` from your frontend to the backend. Next.js example:

```typescript
// next.config.ts
async rewrites() {
  return [{ source: '/.well-known/:path*', destination: 'http://localhost:3000/.well-known/:path*' }]
}
```

### Lifecycle hooks

```typescript
const app = createApp({
  name: 'my-app',
  onStart: () => console.log('Server starting'),
  onShutdown: () => db.close(),
})
```

## Auto-served docs and discovery

Every Graft server auto-serves these framework endpoints alongside your tool and resource routes:

| Endpoint | Description |
|----------|-------------|
| `/.well-known/agent.json` | Agent discovery — tools, resources, and MCP endpoint |
| `/.well-known/mcp.json` | MCP server card — protocol version, capabilities, transport URL |
| `/openapi.json` | Auto-generated OpenAPI 3.1 spec for all HTTP tool endpoints |
| `/docs` | Interactive API reference UI ([Scalar](https://scalar.com)) |
| `/llms.txt` | Compact tool listing for LLMs |
| `/llms-full.txt` | Detailed tool listing with parameters, examples, and auth info |
| `/health` | Health check — status, tool/resource/prompt counts, uptime |

Disable or customize any endpoint:

```typescript
const app = createApp({
  name: 'my-app',
  discovery: {
    docs: false,           // disable /docs
    llmsTxt: './llms.txt', // serve from static file
  },
  healthCheck: { path: '/api/health' }, // customize health path
})
```

## Connect to Claude Desktop

The quickest way:

```bash
npx @schrepa/graft install -e src/app.ts --stdio
```

This writes the config automatically. Or add it manually:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Stdio transport** (Claude launches your app):
```json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["@schrepa/graft", "serve", "--stdio", "-e", "src/app.ts"]
    }
  }
}
```

**HTTP transport** (your server must be running):
```json
{
  "mcpServers": {
    "my-app": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## CLI

| Command | Description |
|---------|-------------|
| `graft serve` | Start the server (`--stdio` for MCP stdio transport) |
| `graft dev` | Start dev server with auto-restart on file changes |
| `graft check` | Validate tool definitions without starting a server |
| `graft test` | Run tool examples as smoke tests (source apps only) |
| `graft studio` | Open the visual tool explorer UI |
| `graft install` | Add your server to Claude Desktop config |
| `graft add-tool <name>` | Generate a new tool file with scaffold |

```bash
# Source app
graft serve -e src/app.ts               # HTTP server on :3000
graft dev -e src/app.ts                  # dev server with auto-restart
graft serve -e src/app.ts --stdio        # stdio transport (for Claude Desktop)
graft check -e src/app.ts               # validate tool definitions
graft test -e src/app.ts                 # run example smoke tests
graft test -e src/app.ts -t echo          # test a single tool
graft studio -e src/app.ts              # open visual studio UI
graft install -e src/app.ts --stdio     # add to Claude Desktop config
graft add-tool search_docs              # scaffold a new tool file

# Proxy (OpenAPI or config file)
graft serve --openapi ./spec.yaml --target http://localhost:8000
graft dev --openapi ./spec.yaml --target http://localhost:8000
graft check --openapi ./spec.yaml
graft studio --openapi ./spec.yaml --target http://localhost:8000

# Studio with a running server
graft studio --url http://localhost:3000/mcp
```

Options: `--port <port>`, `--header k=v` (repeatable), `--locked-header k=v` (repeatable, cannot be overridden by callers).

## Testing

Define examples on your tools and Graft runs them as smoke tests:

```typescript
app.tool('echo', {
  description: 'Echo a message back to the caller',
  params: z.object({ message: z.string() }),
  examples: [
    { name: 'hello', args: { message: 'hello' }, result: { message: 'hello' } },
  ],
  handler: ({ message }) => ({ message }),
})
```

```bash
graft test -e src/app.ts
```

Each example is dispatched through the full pipeline (auth, validation, middleware, handler) and the result is compared using deep partial matching — your expected result only needs to be a subset of the actual output.

Testing is available for source-based apps (`-e` flag). Use `-t <name>` to test a single tool.

## Packages

| Package | Description |
|---------|-------------|
| [`@schrepa/graft`](./packages/graft) | CLI, `createApp()`, and proxy mode |
| [`@schrepa/create-graft-app`](./packages/create-graft-app) | Project scaffolding |

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

Apache-2.0
