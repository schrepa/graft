import { describe, it, expect } from 'vitest'
import { generateOpenApiSpec } from '../src/openapi-gen.js'
import type { InternalTool } from '../src/registry.js'

/** Build a minimal InternalTool for testing — only fields generateOpenApiSpec reads */
function tool(overrides: Partial<InternalTool> & { name: string }): InternalTool {
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
    meta: {},
    exposeMcp: true,
    exposeHttp: true,
    ...overrides,
  } as InternalTool
}

describe('generateOpenApiSpec', () => {
  it('returns a valid OpenAPI 3.1 skeleton for empty tools', () => {
    const spec = generateOpenApiSpec([])
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.paths).toEqual({})
    expect(spec.info).toEqual({ title: 'Graft API', version: '0.1.0' })
  })

  it('uses custom title, version, description, and serverUrl', () => {
    const spec = generateOpenApiSpec([], {
      title: 'My API',
      version: '2.0.0',
      description: 'A test API',
      serverUrl: 'https://example.com',
    })
    expect((spec.info as any).title).toBe('My API')
    expect((spec.info as any).version).toBe('2.0.0')
    expect((spec.info as any).description).toBe('A test API')
    expect(spec.servers).toEqual([{ url: 'https://example.com' }])
  })

  it('generates a GET route with query params', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'search',
        description: 'Search items',
        httpMethod: 'GET',
        httpPath: '/search',
        inputSchema: {
          properties: { q: { type: 'string' }, limit: { type: 'integer' } },
          required: ['q'],
        },
      }),
    ])

    const op = (spec.paths as any)['/search'].get
    expect(op.operationId).toBe('search')
    expect(op.description).toBe('Search items')
    expect(op.parameters).toHaveLength(2)

    const qParam = op.parameters.find((p: any) => p.name === 'q')
    expect(qParam.in).toBe('query')
    expect(qParam.required).toBe(true)
    expect(qParam.schema).toEqual({ type: 'string' })

    const limitParam = op.parameters.find((p: any) => p.name === 'limit')
    expect(limitParam.in).toBe('query')
    expect(limitParam.required).toBeUndefined()
  })

  it('generates a POST route with request body', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'create_item',
        httpMethod: 'POST',
        httpPath: '/items',
        inputSchema: {
          properties: { title: { type: 'string' }, count: { type: 'integer' } },
          required: ['title'],
        },
      }),
    ])

    const op = (spec.paths as any)['/items'].post
    expect(op.operationId).toBe('create_item')
    expect(op.requestBody.required).toBe(true)

    const bodySchema = op.requestBody.content['application/json'].schema
    expect(bodySchema.properties.title).toEqual({ type: 'string' })
    expect(bodySchema.properties.count).toEqual({ type: 'integer' })
    expect(bodySchema.required).toEqual(['title'])
    expect(op.parameters).toBeUndefined()
  })

  it('converts :id path params to {id} and adds path parameter entries', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'get_user',
        httpMethod: 'GET',
        httpPath: '/users/:userId',
        inputSchema: {
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
      }),
    ])

    // Path uses OpenAPI {userId} syntax
    expect((spec.paths as any)['/users/{userId}']).toBeDefined()
    const op = (spec.paths as any)['/users/{userId}'].get
    const pathParam = op.parameters.find((p: any) => p.in === 'path')
    expect(pathParam.name).toBe('userId')
    expect(pathParam.required).toBe(true)
  })

  it('maps outputSchema to 200 response schema', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'get_item',
        httpMethod: 'GET',
        httpPath: '/item',
        outputSchema: { properties: { id: { type: 'string' } } },
      }),
    ])

    const responses = (spec.paths as any)['/item'].get.responses
    expect(responses['200'].content['application/json'].schema).toEqual({
      properties: { id: { type: 'string' } },
    })
  })

  it('uses title as operation summary', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'do_thing', title: 'Do a Thing' }),
    ])
    expect((spec.paths as any)['/do_thing'].get.summary).toBe('Do a Thing')
  })

  it('falls back to name when title is absent', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'do_thing' }),
    ])
    expect((spec.paths as any)['/do_thing'].get.summary).toBe('do_thing')
  })

  it('includes tags on the operation', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'tagged', tags: ['alpha', 'beta'] }),
    ])
    expect((spec.paths as any)['/tagged'].get.tags).toEqual(['alpha', 'beta'])
  })

  it('omits tags when empty', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'no_tags', tags: [] }),
    ])
    expect((spec.paths as any)['/no_tags'].get.tags).toBeUndefined()
  })

  it('adds security requirement and bearerAuth scheme for auth tools', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'secret', auth: true }),
    ])

    const op = (spec.paths as any)['/secret'].get
    expect(op.security).toEqual([{ bearerAuth: [] }])
    expect(op.responses['401']).toEqual({ description: 'Unauthorized' })

    // components.securitySchemes added at doc level
    expect((spec.components as any).securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
    })
  })

  it('does not add security components when no tool requires auth', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'public' }),
    ])
    expect(spec.components).toBeUndefined()
  })

  it('handles parameterLocations with header params', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'with_header',
        httpMethod: 'GET',
        httpPath: '/with-header',
        inputSchema: {
          properties: { apiKey: { type: 'string' }, q: { type: 'string' } },
        },
        parameterLocations: { apiKey: 'header' },
      }),
    ])

    const params = (spec.paths as any)['/with-header'].get.parameters
    const headerParam = params.find((p: any) => p.name === 'apiKey')
    expect(headerParam.in).toBe('header')
    const queryParam = params.find((p: any) => p.name === 'q')
    expect(queryParam.in).toBe('query')
  })

  it('keeps explicit header/query params out of POST request bodies', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'create_user',
        httpMethod: 'POST',
        httpPath: '/users/:id',
        inputSchema: {
          properties: {
            id: { type: 'string' },
            traceId: { type: 'string' },
            dryRun: { type: 'boolean' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
        parameterLocations: {
          traceId: { in: 'header', name: 'X-Trace-Id' },
          dryRun: 'query',
        },
        examples: [{ name: 'create', args: { id: '1', traceId: 'abc', dryRun: true, name: 'Ada' } }],
      }),
    ])

    const op = (spec.paths as any)['/users/{id}'].post
    expect(op.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'X-Trace-Id', in: 'header' }),
      expect.objectContaining({ name: 'dryRun', in: 'query' }),
    ]))

    expect(op.requestBody.content['application/json'].schema.properties).toEqual({
      name: { type: 'string' },
    })
    expect(op.requestBody.content['application/json'].schema.required).toEqual(['name'])
    expect(op.requestBody.content['application/json'].examples).toEqual({
      create: {
        value: { name: 'Ada' },
      },
    })
  })

  it('allows GET tools to opt specific fields into requestBody', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'search_with_body',
        httpMethod: 'GET',
        httpPath: '/search',
        inputSchema: {
          properties: {
            q: { type: 'string' },
            filter: { type: 'string' },
          },
          required: ['filter'],
        },
        parameterLocations: { filter: 'body' },
        examples: [{ name: 'search', args: { q: 'ada', filter: 'recent' } }],
      }),
    ])

    const op = (spec.paths as any)['/search'].get
    expect(op.parameters).toEqual([
      { name: 'q', in: 'query', schema: { type: 'string' } },
    ])
    expect(op.requestBody.content['application/json'].schema.properties).toEqual({
      filter: { type: 'string' },
    })
    expect(op.requestBody.content['application/json'].schema.required).toEqual(['filter'])
    expect(op.requestBody.content['application/json'].examples).toEqual({
      search: {
        value: { filter: 'recent' },
      },
    })
  })

  it('handles DELETE method', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'delete_item',
        httpMethod: 'DELETE',
        httpPath: '/items/:id',
        inputSchema: {
          properties: { id: { type: 'string' }, reason: { type: 'string' } },
        },
      }),
    ])

    const op = (spec.paths as any)['/items/{id}'].delete
    expect(op.operationId).toBe('delete_item')
    // id is a path param, reason goes to request body
    const pathParam = op.parameters.find((p: any) => p.in === 'path')
    expect(pathParam.name).toBe('id')
    // reason in request body
    expect(op.requestBody.content['application/json'].schema.properties.reason).toEqual({ type: 'string' })
  })

  it('handles mixed GET/POST/DELETE tools', () => {
    const spec = generateOpenApiSpec([
      tool({ name: 'list', httpMethod: 'GET', httpPath: '/items' }),
      tool({ name: 'create', httpMethod: 'POST', httpPath: '/items' }),
      tool({ name: 'remove', httpMethod: 'DELETE', httpPath: '/items/:id' }),
    ])

    const paths = spec.paths as any
    expect(paths['/items'].get.operationId).toBe('list')
    expect(paths['/items'].post.operationId).toBe('create')
    expect(paths['/items/{id}'].delete.operationId).toBe('remove')
  })

  it('POST with path params puts non-path params in body', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'update_user',
        httpMethod: 'POST',
        httpPath: '/users/:id',
        inputSchema: {
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
        },
      }),
    ])

    const op = (spec.paths as any)['/users/{id}'].post
    // id is path param
    const pathParam = op.parameters.find((p: any) => p.in === 'path')
    expect(pathParam.name).toBe('id')
    // name is in body, not in parameters
    expect(op.requestBody.content['application/json'].schema.properties).toEqual({ name: { type: 'string' } })
    expect(op.requestBody.content['application/json'].schema.required).toEqual(['name'])
  })

  it('parameterLocations with object entry uses custom name', () => {
    const spec = generateOpenApiSpec([
      tool({
        name: 'custom_name',
        httpMethod: 'GET',
        httpPath: '/test',
        inputSchema: {
          properties: { apiKey: { type: 'string' } },
        },
        parameterLocations: { apiKey: { in: 'header', name: 'X-Api-Key' } },
      }),
    ])

    const params = (spec.paths as any)['/test'].get.parameters
    expect(params[0].name).toBe('X-Api-Key')
    expect(params[0].in).toBe('header')
  })
})
