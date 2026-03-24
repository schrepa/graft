import { expectTypeOf, test } from 'vitest'
import { createApp, z, defineTool } from '../src/index.js'
import type { AuthResult } from '../src/index.js'

test('app.tool() infers handler params from Zod schema', () => {
  const app = createApp({ name: 'test' })
  app.tool('greet', {
    description: 'Greet',
    params: z.object({ name: z.string() }),
    handler: (p) => {
      expectTypeOf(p).toEqualTypeOf<{ name: string }>()
    },
  })
})

test('defineTool() infers handler params from Zod schema', () => {
  const tool = defineTool('greet', {
    description: 'Greet',
    params: z.object({ name: z.string() }),
    handler: (p) => {
      expectTypeOf(p).toEqualTypeOf<{ name: string }>()
    },
  })
  // Config type is precise, not generic
  expectTypeOf(tool.config).not.toBeAny()
})

test('app.tool() accepts JsonSchemaToolConfig', () => {
  const app = createApp({ name: 'test' })
  app.tool('json-tool', {
    description: 'JSON Schema tool',
    inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
    handler: (p) => {
      expectTypeOf(p).toEqualTypeOf<Record<string, unknown>>()
    },
  })
})

test('app.tool() accepts NoSchemaToolConfig', () => {
  const app = createApp({ name: 'test' })
  app.tool('no-schema', {
    description: 'No schema',
    handler: (p) => {
      expectTypeOf(p).toEqualTypeOf<Record<string, unknown>>()
    },
  })
})

test('app.tools() does not infer per-tool params (known limitation)', () => {
  const app = createApp({ name: 'test' })
  // Just verifies it compiles — no per-tool inference expected
  app.tools({
    add: {
      description: 'Add numbers',
      params: z.object({ a: z.number(), b: z.number() }),
      handler: (params: unknown) => {
        const { a, b } = params as { a: number; b: number }
        return a + b
      },
    },
  })
})

test('ctx.meta.auth reflects TAuth generic', () => {
  interface MyAuth extends AuthResult { org: string }
  const app = createApp<MyAuth>({
    name: 'test',
    authenticate: async () => ({ subject: 'u', org: 'acme' }),
  })
  app.tool('t', {
    description: 'test',
    handler: (_p, ctx) => {
      expectTypeOf(ctx.meta.auth).toEqualTypeOf<MyAuth | undefined>()
    },
  })
})

test('defineTool() with DefinedTool passed to app.tool()', () => {
  const greetTool = defineTool('greet', {
    description: 'Greet',
    params: z.object({ name: z.string() }),
    handler: (p) => ({ message: `Hello ${p.name}` }),
  })
  const app = createApp({ name: 'test' })
  app.tool(greetTool)
})

test('app.tool() rejects scalar Zod params', () => {
  const app = createApp({ name: 'test' })
  app.tool('bad', {
    description: 'Bad',
    // @ts-expect-error tool params must be object-shaped
    params: z.string(),
    handler: (_params) => 'nope',
  })
})

test('defineTool() rejects scalar Zod params', () => {
  defineTool('bad', {
    description: 'Bad',
    // @ts-expect-error tool params must be object-shaped
    params: z.string(),
    handler: (_params) => 'nope',
  })
})

test('app.prompt() rejects scalar Zod params', () => {
  const app = createApp({ name: 'test' })
  app.prompt({
    name: 'bad-prompt',
    description: 'Bad prompt',
    // @ts-expect-error prompt params must be object-shaped
    params: z.string(),
    handler: () => [],
  })
})

test('app.resourceTemplate() rejects scalar Zod params', () => {
  const app = createApp({ name: 'test' })
  app.resourceTemplate({
    uriTemplate: 'resource://items/{id}',
    name: 'bad-resource',
    description: 'Bad resource',
    // @ts-expect-error resource template params must be object-shaped
    params: z.string(),
    handler: () => ({ ok: true }),
  })
})
