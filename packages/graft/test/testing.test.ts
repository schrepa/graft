import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import {
  createMcpTestClient,
  type McpCallToolError,
  type McpToolCallResult,
} from '../src/testing.js'
import { AuthError } from '../src/errors.js'
import { parseJsonText } from './helpers/common.js'

function isToolCallError(result: McpToolCallResult): result is McpCallToolError {
  return typeof result === 'object' && result !== null && 'error' in result
}

function expectToolCallError(result: McpToolCallResult): McpCallToolError {
  if (!isToolCallError(result)) {
    throw new Error('Expected a tool-call error payload')
  }
  return result
}

// =========================================================================
// Helpers
// =========================================================================

function testApp() {
  return createApp({ name: 'test' })
    .tool('greet', {
      description: 'Greet someone',
      params: z.object({ name: z.string() }),
      handler: (params) => ({ message: `Hello, ${params.name}!` }),
    })
    .tool('echo', {
      description: 'Echo input',
      params: z.object({ text: z.string() }),
      handler: (params) => params.text,
    })
    .tool('no_params', {
      description: 'No params',
      handler: () => ({ ok: true }),
    })
}

// =========================================================================
// callTool
// =========================================================================

describe('callTool', () => {
  it('calls a tool and returns parsed result', async () => {
    const client = createMcpTestClient(testApp())
    const result = await client.callTool('greet', { name: 'World' })
    expect(result).toEqual({ message: 'Hello, World!' })
  })

  it('dispatches tools that do not declare params without requiring an args object', async () => {
    const client = createMcpTestClient(testApp())
    const result = await client.callTool('no_params')
    expect(result).toEqual({ ok: true })
  })

  it('returns string result directly', async () => {
    const client = createMcpTestClient(testApp())
    const result = await client.callTool('echo', { text: 'hello' })
    expect(result).toBe('hello')
  })

  it('returns error envelope for validation errors', async () => {
    const client = createMcpTestClient(testApp())
    const result = expectToolCallError(await client.callTool('greet', {}))
    expect(result.error).toBe('VALIDATION_ERROR')
    expect(result.body?.error).toBe('Validation error')
    expect(result.body?.details).toBeDefined()
  })

  it('returns error for unknown tool', async () => {
    const client = createMcpTestClient(testApp())
    const result = expectToolCallError(await client.callTool('nonexistent', {}))
    expect(result.error).toBeDefined()
  })

  it('auto-increments request IDs', async () => {
    const client = createMcpTestClient(testApp())
    await client.callTool('no_params')
    await client.callTool('no_params')
    // If IDs collided, the second call would fail — success means they're unique
  })

  it('throws a contextual error when tools/call returns non-JSON error text', async () => {
    const client = createMcpTestClient(() =>
      Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { isError: true, content: [{ type: 'text', text: 'not-json' }] },
      }),
    )

    await expect(client.callTool('broken')).rejects.toThrow(
      'Invalid MCP error payload for tools/call',
    )
  })

  it('throws a contextual error when an MCP response body is not JSON', async () => {
    const client = createMcpTestClient(() =>
      new Response('bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    await expect(client.listTools()).rejects.toThrow(
      'Invalid JSON response for tools/list (status 502)',
    )
  })
})

// =========================================================================
// callTool with structuredContent
// =========================================================================

describe('callTool structuredContent', () => {
  it('returns structuredContent when outputSchema is defined', async () => {
    const app = createApp({ name: 'test' })
      .tool('typed', {
        description: 'Typed output',
        params: z.object({ x: z.number() }),
        output: z.object({ doubled: z.number() }),
        handler: (p) => ({ doubled: p.x * 2 }),
      })
    const client = createMcpTestClient(app)
    const result = await client.callTool('typed', { x: 5 })
    expect(result).toEqual({ doubled: 10 })
  })
})

// =========================================================================
// listTools
// =========================================================================

describe('listTools', () => {
  it('lists all registered tools', async () => {
    const client = createMcpTestClient(testApp())
    const tools = await client.listTools()
    const names = tools.map(t => t.name)
    expect(names).toContain('greet')
    expect(names).toContain('echo')
    expect(names).toContain('no_params')
  })

  it('includes description and inputSchema', async () => {
    const client = createMcpTestClient(testApp())
    const tools = await client.listTools()
    const greet = tools.find(t => t.name === 'greet')!
    expect(greet.description).toBe('Greet someone')
    expect(greet.inputSchema).toBeDefined()
  })
})

// =========================================================================
// Auth via headers
// =========================================================================

describe('auth headers', () => {
  function authApp() {
    return createApp({
      name: 'test',
      authenticate: async (req) => {
        const token = req.headers.get('authorization')
        if (token === 'Bearer admin') return { subject: 'admin', roles: ['admin'] }
        throw new AuthError('Unauthorized', 401)
      },
    })
      .tool('public_tool', {
        description: 'Public',
        handler: () => ({ public: true }),
      })
      .tool('admin_tool', {
        description: 'Admin only',
        auth: ['admin'],
        handler: () => ({ secret: true }),
      })
  }

  it('authed client can call protected tool', async () => {
    const client = createMcpTestClient(authApp(), {
      headers: { authorization: 'Bearer admin' },
    })
    const result = await client.callTool('admin_tool')
    expect(result).toEqual({ secret: true })
  })

  it('unauthed client gets error on protected tool', async () => {
    const client = createMcpTestClient(authApp())
    const result = expectToolCallError(await client.callTool('admin_tool'))
    expect(result.error).toBeDefined()
  })

  it('unauthed client can call public tool', async () => {
    const client = createMcpTestClient(authApp())
    const result = await client.callTool('public_tool')
    expect(result).toEqual({ public: true })
  })
})

// =========================================================================
// Resources
// =========================================================================

describe('resources', () => {
  function resourceApp() {
    return createApp({ name: 'test' })
      .tool('noop', { description: 'noop', handler: () => ({}) })
      .resource({
        uri: 'config://app',
        name: 'App Config',
        description: 'Application configuration',
        handler: () => ({ theme: 'dark', version: '1.0' }),
      })
  }

  it('lists resources', async () => {
    const client = createMcpTestClient(resourceApp())
    const resources = await client.listResources()
    expect(resources).toHaveLength(1)
    expect(resources[0].uri).toBe('config://app')
    expect(resources[0].name).toBe('App Config')
  })

  it('reads a resource by URI', async () => {
    const client = createMcpTestClient(resourceApp())
    const result = await client.readResource('config://app')
    expect(result.uri).toBe('config://app')
    expect(result.text).toBeDefined()
    const parsed = parseJsonText<{ theme: string; version: string }>(result.text)
    expect(parsed.theme).toBe('dark')
  })

  it('throws when resources/read omits contents[0]', async () => {
    const client = createMcpTestClient(() =>
      Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { contents: [] },
      }),
    )

    await expect(client.readResource('config://missing')).rejects.toThrow(
      'Invalid MCP response for resources/read',
    )
  })
})

// =========================================================================
// Resource templates
// =========================================================================

describe('resource templates', () => {
  function templateApp() {
    return createApp({ name: 'test' })
      .tool('noop', { description: 'noop', handler: () => ({}) })
      .resourceTemplate({
        uriTemplate: 'users://{id}/profile',
        name: 'User Profile',
        description: 'Get user profile',
        params: z.object({ id: z.string() }),
        handler: (params) => ({ id: params.id, name: 'Alice' }),
      })
  }

  it('lists resource templates', async () => {
    const client = createMcpTestClient(templateApp())
    const templates = await client.listResourceTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0].uriTemplate).toBe('users://{id}/profile')
  })

  it('reads a templated resource', async () => {
    const client = createMcpTestClient(templateApp())
    const result = await client.readResource('users://42/profile')
    const parsed = parseJsonText<{ id: string; name: string }>(result.text)
    expect(parsed.id).toBe('42')
    expect(parsed.name).toBe('Alice')
  })
})

// =========================================================================
// Prompts
// =========================================================================

describe('prompts', () => {
  function promptApp() {
    return createApp({ name: 'test' })
      .tool('noop', { description: 'noop', handler: () => ({}) })
      .prompt({
        name: 'suggest',
        description: 'Suggest something',
        params: z.object({ preferences: z.string() }),
        handler: (params) => [
          { role: 'user' as const, content: `Suggest something for someone who likes ${params.preferences}` },
        ],
      })
  }

  it('lists prompts', async () => {
    const client = createMcpTestClient(promptApp())
    const prompts = await client.listPrompts()
    expect(prompts).toHaveLength(1)
    expect(prompts[0].name).toBe('suggest')
  })

  it('gets a prompt with arguments', async () => {
    const client = createMcpTestClient(promptApp())
    const result = await client.getPrompt('suggest', { preferences: 'vegan' })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[0].content.text).toContain('vegan')
  })
})
