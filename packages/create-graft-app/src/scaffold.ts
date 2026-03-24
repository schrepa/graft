import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import graftPackageManifest from '../../graft/package.json'

const GRAFT_PACKAGE_NAME = '@schrepa/graft'
const GRAFT_REPOSITORY_URL = 'https://github.com/schrepa/graft'
const DEFAULT_PROJECT_VERSION = '0.1.0'
const GRAFT_PACKAGE_VERSION = graftPackageManifest.version

/**
 * Inputs required to create a new scaffolded project directory.
 *
 * `projectDir` controls where files are written; `projectName` controls the
 * generated package metadata and README copy inside the scaffold.
 */
export interface CreateProjectOptions {
  projectDir: string
  projectName: string
}

/**
 * Create a new project directory populated with the greenfield scaffold.
 *
 * @param options Absolute target directory and package name.
 * @throws {Error} When the target directory already exists.
 * @example
 * await createProject({ projectDir: '/tmp/my-app', projectName: 'my-app' })
 */
export async function createProject(options: CreateProjectOptions): Promise<void> {
  if (existsSync(options.projectDir)) {
    throw new Error(`Directory "${options.projectName}" already exists.`)
  }

  await writeProjectFiles(options.projectDir, buildGreenfieldFiles(options.projectName))
}

interface ProjectFile {
  path: string
  contents: string
}

function buildGreenfieldFiles(projectName: string): ProjectFile[] {
  return [
    { path: 'package.json', contents: JSON.stringify(buildPackageJson(projectName), null, 2) + '\n' },
    { path: 'tsconfig.json', contents: JSON.stringify(buildTsconfig(), null, 2) + '\n' },
    { path: join('src', 'app.ts'), contents: renderApp(projectName) },
    { path: join('src', 'tools', 'echo.ts'), contents: renderEchoTool() },
    { path: join('src', 'tools', 'store-value.ts'), contents: renderStoreValueTool() },
    { path: 'README.md', contents: renderReadme(projectName) },
    { path: '.gitignore', contents: 'node_modules/\ndist/\n.env\n' },
  ]
}

async function writeProjectFiles(projectDir: string, files: ProjectFile[]): Promise<void> {
  for (const file of files) {
    const fullPath = join(projectDir, file.path)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, file.contents)
  }
}

function buildPackageJson(projectName: string): Record<string, unknown> {
  return {
    name: projectName,
    version: DEFAULT_PROJECT_VERSION,
    private: true,
    type: 'module',
    scripts: {
      dev: 'graft dev -e src/app.ts',
      start: 'graft serve -e src/app.ts',
      studio: 'graft studio -e src/app.ts',
      check: 'graft check -e src/app.ts',
      test: 'graft test -e src/app.ts',
      build: 'tsup src/app.ts --format esm --dts',
    },
    dependencies: {
      [GRAFT_PACKAGE_NAME]: `^${GRAFT_PACKAGE_VERSION}`,
      zod: '^4.0.0',
    },
    devDependencies: {
      tsx: '^4.0.0',
      tsup: '^8.0.0',
      typescript: '^5.7.0',
    },
  }
}

function buildTsconfig(): Record<string, unknown> {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: './src',
      declaration: true,
    },
    include: ['src/**/*'],
  }
}

function renderApp(projectName: string): string {
  return `import { createApp } from '${GRAFT_PACKAGE_NAME}'
import { echoTool } from './tools/echo.js'
import { storeValueTool } from './tools/store-value.js'

const app = createApp({
  name: '${projectName}',
  version: '${DEFAULT_PROJECT_VERSION}',
})

app.tool(echoTool)
app.tool(storeValueTool)

export default app
`
}

function renderEchoTool(): string {
  return `import { defineTool, z } from '${GRAFT_PACKAGE_NAME}'

export const echoTool = defineTool('echo', {
  description: 'Echo a message back to the caller.',
  params: z.object({
    message: z.string().describe('The message to echo'),
  }),
  examples: [
    { name: 'hello', args: { message: 'hello' }, result: { message: 'hello' } },
  ],
  handler: ({ message }) => {
    return { message }
  },
})
`
}

function renderStoreValueTool(): string {
  return `import { defineTool, z } from '${GRAFT_PACKAGE_NAME}'

const store = new Map<string, string>()

export const storeValueTool = defineTool('store_value', {
  description: 'Store a key-value pair.',
  sideEffects: true,
  params: z.object({
    key: z.string().describe('The key to store'),
    value: z.string().describe('The value to associate with the key'),
  }),
  examples: [
    { name: 'store-greeting', args: { key: 'greeting', value: 'hello' }, result: { ok: true, key: 'greeting', value: 'hello' } },
  ],
  handler: ({ key, value }) => {
    store.set(key, value)
    return { ok: true, key, value }
  },
})
`
}

function renderReadme(projectName: string): string {
  return `# ${projectName}

Built with [Graft](${GRAFT_REPOSITORY_URL}) — define once, serve as HTTP and MCP from the same server.

## Quick start

\`\`\`bash
npm install
npm run dev
\`\`\`

Your server is now running:
- **MCP endpoint**: http://localhost:3000/mcp — agents connect here
- **HTTP API**: http://localhost:3000/echo?message=hello — same tools as REST
- **API docs**: http://localhost:3000/docs — interactive API reference
- **OpenAPI spec**: http://localhost:3000/openapi.json
- **Health check**: http://localhost:3000/health
- **Studio**: run \`npm run studio\` to browse and test tools

## Available tools

| Tool | HTTP | Description |
|------|------|-------------|
| \`echo\` | \`GET /echo\` | Echo a message back to the caller |
| \`store_value\` | \`POST /store-value\` | Store a key-value pair |

## Add a tool

\`\`\`bash
npx graft add-tool my_new_tool
\`\`\`

## Connect to Claude Desktop

\`\`\`json
{
  "mcpServers": {
    "${projectName}": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
\`\`\`

Or use stdio transport:

\`\`\`json
{
  "mcpServers": {
    "${projectName}": {
      "command": "npx",
      "args": ["${GRAFT_PACKAGE_NAME}", "serve", "--stdio", "-e", "src/app.ts"]
    }
  }
}
\`\`\`

## Scripts

| Script | What it does |
|--------|--------------|
| \`npm run dev\` | Start dev server with auto-restart |
| \`npm start\` | Start production server |
| \`npm run studio\` | Browse and test tools in the UI |
| \`npm run check\` | Validate tool definitions |
| \`npm test\` | Run tool examples as smoke tests |
| \`npm run build\` | Build for production |
`
}
