# @schrepa/graft

Build agent-ready APIs without splitting your server model.

Define tools once, then expose them as both HTTP endpoints and MCP tools from the same server. Graft also generates discovery docs, OpenAPI, and an interactive API reference automatically.

## Install

```bash
npm install @schrepa/graft zod
```

## Minimal example

```typescript
import { createApp, z } from '@schrepa/graft'

const app = createApp({ name: 'my-app' })

app.tool('echo', {
  description: 'Echo a message back to the caller',
  params: z.object({
    message: z.string(),
  }),
  handler: ({ message }) => ({ message }),
})

export default app
```

```bash
graft serve -e src/app.ts
```

That one tool gives you:

- **`POST /mcp`** — MCP endpoint. Agents connect here.
- **`GET /echo?message=hello`** — HTTP endpoint. Any client calls the same tool.
- **`/.well-known/agent.json`** — Agent discovery document.
- **`/.well-known/mcp.json`** — MCP server card.
- **`/openapi.json`** — Auto-generated OpenAPI 3.1 spec.
- **`/docs`** — Interactive API reference ([Scalar](https://scalar.com)).
- **`/health`** — Health check with tool/resource counts.

## Get started

**New app:**

```bash
npx @schrepa/create-graft-app my-app && cd my-app && npm install && npm run dev
```

**Wrap an existing API:**

```bash
npx @schrepa/graft serve --openapi ./spec.yaml --target http://localhost:8000
```

**Add to an existing app:**

```typescript
// Bun / Deno / Cloudflare Workers
export default { fetch: app.toFetch() }

// Node.js
const handler = app.toNodeHandler()
```

## CLI

| Command | Description |
|---------|-------------|
| `graft serve` | Start the server (`--stdio` for MCP stdio transport) |
| `graft dev` | Dev server with auto-restart on file changes |
| `graft check` | Validate tool definitions |
| `graft test` | Run tool examples as smoke tests |
| `graft studio` | Visual tool explorer UI |
| `graft install` | Add to Claude Desktop config |
| `graft add-tool <name>` | Scaffold a new tool file |

## Key features

- **Zod-first schemas** — define params with Zod, get JSON Schema for MCP and OpenAPI automatically
- **Authentication and roles** — `auth: true`, `auth: ['admin']`, or `auth: { roles: ['admin'] }`
- **Middleware** — cross-cutting logic shared across MCP and HTTP calls
- **Resources and prompts** — expose read-only data and reusable message templates to agents
- **Auto-served discovery** — `agent.json`, `mcp.json`, `openapi.json`, `/docs`, `llms.txt`, `/health`
- **Tool examples as tests** — define examples on tools, run `graft test` as smoke tests
- **Dev server** — `graft dev` with file watching and auto-restart
- **Studio** — browse and test tools in a visual UI
- **Proxy mode** — wrap any HTTP API via OpenAPI spec or config file

## Documentation

Full documentation and examples: [github.com/schrepa/graft](https://github.com/schrepa/graft)

## License

Apache-2.0
