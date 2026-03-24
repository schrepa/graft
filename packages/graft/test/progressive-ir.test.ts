/**
 * Tests for progressive tool declaration: IR expansion, annotation resolution,
 * example validation, defineTool, z re-export, deprecated flow.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.js'
import { buildInternalTool, defineTool, toDefinition } from '../src/tool-builder.js'
import { resolveAnnotations } from '../src/mcp.js'
import { generateOpenApiSpec } from '../src/openapi-gen.js'
import { createMcpTestClient } from '../src/testing.js'
import type { ToolDefinition } from '../src/types.js'
import type { InternalTool } from '../src/registry.js'

// =========================================================================
// Example validation
// =========================================================================

describe('example validation', () => {
  it('accepts example with valid args', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        params: z.object({ name: z.string() }),
        examples: [{ name: 'basic', args: { name: 'Alice' } }],
        handler: () => 'hi',
      })
    ).not.toThrow()
  })

  it('throws on example with invalid args', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        params: z.object({ name: z.string() }),
        examples: [{ name: 'bad', args: { name: 42 } }],
        handler: () => 'hi',
      })
    ).toThrow(/Tool "greet": example "bad" has invalid args/)
  })

  it('uses "unnamed" for examples without a name', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        params: z.object({ name: z.string() }),
        examples: [{ args: { name: 42 } }],
        handler: () => 'hi',
      })
    ).toThrow(/example "unnamed" has invalid args/)
  })

  it('accepts example with valid result', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        params: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
        examples: [{ name: 'basic', args: { name: 'Alice' }, result: { message: 'Hi Alice' } }],
        handler: () => ({ message: 'hi' }),
      })
    ).not.toThrow()
  })

  it('throws on example with invalid result', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        params: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
        examples: [{ name: 'bad_result', args: { name: 'Alice' }, result: { message: 123 } }],
        handler: () => ({ message: 'hi' }),
      })
    ).toThrow(/Tool "greet": example "bad_result" has invalid result/)
  })

  it('skips result validation when no output schema', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        params: z.object({ name: z.string() }),
        examples: [{ name: 'basic', args: { name: 'Alice' }, result: { anything: true } }],
        handler: () => 'hi',
      })
    ).not.toThrow()
  })

  it('skips validation for no-schema tools with examples', () => {
    expect(() =>
      buildInternalTool('greet', {
        description: 'Greet',
        examples: [{ name: 'basic', args: { name: 42 } }],
        handler: () => 'hi',
      })
    ).not.toThrow()
  })
})

// =========================================================================
// Annotation resolution
// =========================================================================

describe('resolveAnnotations', () => {
  function toolDef(overrides: Partial<ToolDefinition>): ToolDefinition {
    return {
      name: 'test',
      description: 'test',
      inputSchema: null,
      sideEffects: false,
      examples: [],
      tags: [],
      ...overrides,
    }
  }

  it('GET tool: readOnly, not destructive, idempotent', () => {
    const ann = resolveAnnotations(toolDef({ method: 'GET', sideEffects: false }))
    expect(ann.readOnlyHint).toBe(true)
    expect(ann.destructiveHint).toBe(false)
    expect(ann.idempotentHint).toBe(true)
  })

  it('POST tool without sideEffects: not readOnly, not destructive, not idempotent', () => {
    const ann = resolveAnnotations(toolDef({ method: 'POST', sideEffects: false }))
    expect(ann.readOnlyHint).toBe(true)  // sideEffects:false → readOnly
    expect(ann.destructiveHint).toBe(false)  // sideEffects:false + method not DELETE
    expect(ann.idempotentHint).toBe(false)  // POST not in idempotent list
  })

  it('DELETE tool: not readOnly, destructive, idempotent', () => {
    const ann = resolveAnnotations(toolDef({ method: 'DELETE', sideEffects: true }))
    expect(ann.readOnlyHint).toBe(false)
    expect(ann.destructiveHint).toBe(true)
    expect(ann.idempotentHint).toBe(true)
  })

  it('POST tool with sideEffects:true: destructive (safe default)', () => {
    const ann = resolveAnnotations(toolDef({ method: 'POST', sideEffects: true }))
    expect(ann.readOnlyHint).toBe(false)
    expect(ann.destructiveHint).toBe(true)  // sideEffects:true → safe default
    expect(ann.idempotentHint).toBe(false)
  })

  it('user annotations.destructiveHint:false overrides sideEffects:true default', () => {
    const ann = resolveAnnotations(toolDef({
      method: 'POST',
      sideEffects: true,
      annotations: { destructiveHint: false },
    }))
    expect(ann.destructiveHint).toBe(false)
  })

  it('user annotations.readOnlyHint:true overrides POST default', () => {
    const ann = resolveAnnotations(toolDef({
      method: 'POST',
      sideEffects: true,
      annotations: { readOnlyHint: true },
    }))
    expect(ann.readOnlyHint).toBe(true)
  })

  it('deprecated:true → x-deprecated:true in annotations', () => {
    const ann = resolveAnnotations(toolDef({ deprecated: true }))
    expect(ann['x-deprecated']).toBe(true)
    expect(ann['x-deprecated-message']).toBeUndefined()
  })

  it('deprecated string → x-deprecated:true + x-deprecated-message', () => {
    const ann = resolveAnnotations(toolDef({ deprecated: 'Use v2' }))
    expect(ann['x-deprecated']).toBe(true)
    expect(ann['x-deprecated-message']).toBe('Use v2')
  })

  it('openWorldHint defaults to true', () => {
    const ann = resolveAnnotations(toolDef({}))
    expect(ann.openWorldHint).toBe(true)
  })

  it('user annotations.openWorldHint:false overrides default', () => {
    const ann = resolveAnnotations(toolDef({ annotations: { openWorldHint: false } }))
    expect(ann.openWorldHint).toBe(false)
  })
})

// =========================================================================
// New fields flow through pipeline
// =========================================================================

describe('deprecated + annotations flow through', () => {
  function mkTool(overrides: Partial<InternalTool> & { name: string }): InternalTool {
    return {
      description: '',
      httpMethod: 'GET',
      httpPath: `/${overrides.name}`,
      inputSchema: null,
      sideEffects: false,
      tags: [],
      examples: [],
      nameIsExplicit: false,
      handler: () => null,
      meta: {} as any,
      exposeMcp: true,
      exposeHttp: true,
      ...overrides,
    } as InternalTool
  }

  it('deprecated:true appears in OpenAPI spec', () => {
    const spec = generateOpenApiSpec([mkTool({ name: 'old_tool', deprecated: true })])
    const op = (spec.paths as any)['/old_tool'].get
    expect(op.deprecated).toBe(true)
    expect(op['x-deprecated-message']).toBeUndefined()
  })

  it('deprecated string appears in OpenAPI spec with x-deprecated-message', () => {
    const spec = generateOpenApiSpec([mkTool({ name: 'old_tool', deprecated: 'Use new_tool' })])
    const op = (spec.paths as any)['/old_tool'].get
    expect(op.deprecated).toBe(true)
    expect(op['x-deprecated-message']).toBe('Use new_tool')
  })

  it('annotations override shows in MCP tools/list', async () => {
    const app = createApp({ name: 'test' })
    app.tool('safe_delete', {
      description: 'Soft delete',
      sideEffects: true,
      annotations: { destructiveHint: false },
      http: { method: 'DELETE', path: '/soft-del' },
      handler: () => null,
    })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    const tool = tools.find((entry) => entry.name === 'safe_delete')
    expect(tool).toBeDefined()
    const annotations = (tool?.annotations ?? {}) as { destructiveHint?: boolean }
    expect(annotations.destructiveHint).toBe(false)
  })

  it('example.result appears in OpenAPI response examples', () => {
    const spec = generateOpenApiSpec([
      mkTool({
        name: 'greet',
        httpMethod: 'POST',
        httpPath: '/greet',
        inputSchema: { properties: { name: { type: 'string' } } },
        examples: [{ name: 'basic', args: { name: 'Alice' }, result: { message: 'Hello Alice' } }],
      }),
    ])

    const op = (spec.paths as any)['/greet'].post
    expect(op.responses['200'].content['application/json'].examples).toEqual({
      basic: { value: { message: 'Hello Alice' } },
    })
  })

  it('example args appear in OpenAPI request body examples', () => {
    const spec = generateOpenApiSpec([
      mkTool({
        name: 'greet',
        httpMethod: 'POST',
        httpPath: '/greet',
        inputSchema: { properties: { name: { type: 'string' } } },
        examples: [{ name: 'basic', args: { name: 'Alice' }, description: 'Say hello' }],
      }),
    ])

    const op = (spec.paths as any)['/greet'].post
    expect(op.requestBody.content['application/json'].examples).toEqual({
      basic: { summary: 'Say hello', value: { name: 'Alice' } },
    })
  })

  it('deprecated appears in agent.json', async () => {
    const app = createApp({ name: 'test' })
    app.tool('old_tool', {
      description: 'Old',
      deprecated: 'Use new_tool',
      handler: () => null,
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    const json = await res.json() as any
    const tool = json.tools.find((t: any) => t.name === 'old_tool')
    expect(tool.deprecated).toBe('Use new_tool')
  })

  it('deprecated:undefined is stripped from agent.json', async () => {
    const app = createApp({ name: 'test' })
    app.tool('current_tool', {
      description: 'Current',
      handler: () => null,
    })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    const json = await res.json() as any
    const tool = json.tools.find((t: any) => t.name === 'current_tool')
    expect(tool.deprecated).toBeUndefined()
  })

  it('toDefinition includes deprecated and annotations', () => {
    const internal = buildInternalTool('test', {
      description: 'Test',
      deprecated: 'Use v2',
      annotations: { destructiveHint: false },
      handler: () => null,
    })
    const def = toDefinition(internal)
    expect(def.deprecated).toBe('Use v2')
    expect(def.annotations).toEqual({ destructiveHint: false })
  })
})

// =========================================================================
// Description passthrough
// =========================================================================

describe('app description passthrough', () => {
  it('description appears in OpenAPI info', async () => {
    const app = createApp({ name: 'My API', description: 'A great API' })
    app.tool('ping', { description: 'Ping', handler: () => 'pong' })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/openapi.json'))
    const spec = await res.json() as any
    expect(spec.info.description).toBe('A great API')
  })

  it('description appears in agent.json', async () => {
    const app = createApp({ name: 'My API', description: 'A great API' })
    app.tool('ping', { description: 'Ping', handler: () => 'pong' })

    const { fetch } = app.build()
    const res = await fetch(new Request('http://localhost:3000/.well-known/agent.json'))
    const json = await res.json() as any
    expect(json.description).toBe('A great API')
  })
})

// =========================================================================
// defineTool
// =========================================================================

describe('defineTool', () => {
  it('app.tool(defineTool(...)) registers correctly', async () => {
    const greetTool = defineTool('greet', {
      description: 'Greet someone',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })

    const app = createApp({ name: 'test' })
    app.tool(greetTool)

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('greet')

    const result = await client.callTool('greet', { name: 'Alice' })
    expect(result).toEqual({ message: 'Hello, Alice!' })
  })

  it('defineTool preserves config fields', () => {
    const def = defineTool('test', {
      description: 'Test',
      deprecated: 'Use v2',
      annotations: { readOnlyHint: true },
      handler: () => null,
    })

    expect(def.name).toBe('test')
    expect(def.config.deprecated).toBe('Use v2')
    expect(def.config.annotations).toEqual({ readOnlyHint: true })
  })

  it('app.tool with string + config still works', async () => {
    const app = createApp({ name: 'test' })
    app.tool('greet', {
      description: 'Greet',
      params: z.object({ name: z.string() }),
      handler: ({ name }) => ({ message: `Hello, ${name}!` }),
    })

    const client = createMcpTestClient(app)
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('greet')
  })
})

// =========================================================================
// z re-export
// =========================================================================

describe('z re-export', () => {
  it('z.object works from index re-export', async () => {
    // Import from the source index to verify the export exists
    const { z: reExportedZ } = await import('../src/index.js')
    const schema = reExportedZ.object({ name: reExportedZ.string() })
    expect(schema.parse({ name: 'Alice' })).toEqual({ name: 'Alice' })
  })
})
