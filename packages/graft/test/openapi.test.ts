import { describe, it, expect, vi } from 'vitest'
import { parseOpenApiSpec } from '../src/proxy/openapi.js'

const MINIMAL_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        summary: 'Search items',
        operationId: 'searchItems',
        tags: ['items'],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'archived'] } },
        ],
      },
      post: {
        summary: 'Create an item',
        operationId: 'createItem',
        tags: ['items'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Item name' },
                  price: { type: 'number' },
                },
                required: ['name'],
              },
            },
          },
        },
      },
    },
    '/items/{id}': {
      get: {
        summary: 'Get item by ID',
        operationId: 'getItem',
        tags: ['items'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
      delete: {
        summary: 'Delete an item',
        operationId: 'deleteItem',
        tags: ['items'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
      },
    },
  },
}

describe('parseOpenApiSpec', () => {
  it('parses a basic OpenAPI spec', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    expect(tools).toHaveLength(4)
  })

  it('converts {param} to :param in paths', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    const getItem = tools.find(t => t.name === 'getItem')
    expect(getItem).toBeDefined()
    expect(getItem!.path).toBe('/items/:id')
  })

  it('extracts method, path, and description', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    const search = tools.find(t => t.name === 'searchItems')
    expect(search).toBeDefined()
    expect(search!.method).toBe('GET')
    expect(search!.path).toBe('/items')
    expect(search!.description).toBe('Search items')
  })

  it('uses operationId as tool name', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    const names = tools.map(t => t.name)
    expect(names).toContain('searchItems')
    expect(names).toContain('createItem')
    expect(names).toContain('getItem')
    expect(names).toContain('deleteItem')
  })

  it('throws when operations are missing operationId', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: { summary: 'List items', operationId: 'listItems' },
          post: { summary: 'Create item' },
        },
        '/items/{id}': {
          delete: { summary: 'Delete item' },
        },
      },
    }
    expect(() => parseOpenApiSpec(spec)).toThrow(
      /2 operation\(s\) in your OpenAPI spec are missing operationId/
    )
    expect(() => parseOpenApiSpec(spec)).toThrow(/POST \/items/)
    expect(() => parseOpenApiSpec(spec)).toThrow(/DELETE \/items\/:id/)
    expect(() => parseOpenApiSpec(spec)).toThrow(/Add operationId to each operation/)
  })

  it('still throws when operationId is missing even if nameOverrides are configured', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: { summary: 'List items' },
        },
      },
    }
    expect(() => parseOpenApiSpec(spec, {
      nameOverrides: { listItems: 'list_items' },
    })).toThrow(/missing operationId/)
  })

  it('builds inputSchema from query parameters', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    const search = tools.find(t => t.name === 'searchItems')!
    expect(search.inputSchema).toBeDefined()
    const schema = search.inputSchema as any
    expect(schema.type).toBe('object')
    expect(schema.properties.q).toEqual({ type: 'string', description: 'Search query' })
    expect(schema.properties.category.enum).toEqual(['draft', 'active', 'archived'])
  })

  it('builds inputSchema from path parameters', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    const getItem = tools.find(t => t.name === 'getItem')!
    expect(getItem.inputSchema).toBeDefined()
    const schema = getItem.inputSchema as any
    expect(schema.properties.id).toEqual({ type: 'string' })
    expect(schema.required).toContain('id')
  })

  it('builds inputSchema from request body', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    const create = tools.find(t => t.name === 'createItem')!
    expect(create.inputSchema).toBeDefined()
    const schema = create.inputSchema as any
    expect(schema.properties.name).toEqual({ type: 'string', description: 'Item name' })
    expect(schema.properties.price).toEqual({ type: 'number' })
    expect(schema.required).toContain('name')
  })

  it('extracts tags', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    expect(tools.every(t => t.tags.includes('items'))).toBe(true)
  })

  it('skips operations with x-graft-ignore', () => {
    const spec = {
      ...MINIMAL_SPEC,
      paths: {
        '/health': {
          get: {
            summary: 'Health check',
            'x-graft-ignore': true,
          },
        },
        '/items': MINIMAL_SPEC.paths['/items'],
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools.find(t => t.path === '/health')).toBeUndefined()
  })

  it('filters by includeTags', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: { summary: 'Items', operationId: 'listItems', tags: ['items'] },
        },
        '/admin': {
          get: { summary: 'Admin', operationId: 'getAdmin', tags: ['admin'] },
        },
      },
    }
    const tools = parseOpenApiSpec(spec, { includeTags: ['items'] })
    expect(tools).toHaveLength(1)
    expect(tools[0].path).toBe('/items')
  })

  it('filters by excludeTags', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: { summary: 'Items', operationId: 'listItems', tags: ['items'] },
        },
        '/admin': {
          get: { summary: 'Admin', operationId: 'getAdmin', tags: ['admin'] },
        },
      },
    }
    const tools = parseOpenApiSpec(spec, { excludeTags: ['admin'] })
    expect(tools).toHaveLength(1)
    expect(tools[0].path).toBe('/items')
  })

  it('supports nameOverrides', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC, {
      nameOverrides: { searchItems: 'find_items' },
    })
    const search = tools.find(t => t.path === '/items' && t.method === 'GET')
    expect(search!.name).toBe('find_items')
  })

  it('resolves $ref in request body schema', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/entries': {
          post: {
            summary: 'Create entry',
            operationId: 'createEntry',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/EntryInput' },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          EntryInput: {
            type: 'object',
            properties: {
              itemIds: { type: 'array', items: { type: 'string' } },
              priority: { type: 'number' },
            },
            required: ['itemIds', 'priority'],
          },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools).toHaveLength(1)
    const schema = tools[0].inputSchema as any
    expect(schema.properties.itemIds).toEqual({ type: 'array', items: { type: 'string' } })
    expect(schema.properties.priority).toEqual({ type: 'number' })
    expect(schema.required).toContain('itemIds')
    expect(schema.required).toContain('priority')
  })

  it('parses YAML string input', () => {
    const yaml = `
openapi: "3.0.0"
info:
  title: Test
  version: "1.0"
paths:
  /items:
    get:
      summary: Search items
      operationId: searchItems
`
    const tools = parseOpenApiSpec(yaml)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('searchItems')
    expect(tools[0].description).toBe('Search items')
  })

  it('parses JSON string input', () => {
    const json = JSON.stringify(MINIMAL_SPEC)
    const tools = parseOpenApiSpec(json)
    expect(tools).toHaveLength(4)
  })

  it('returns null inputSchema for operations with no parameters', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/health': {
          get: { summary: 'Health check', operationId: 'healthCheck' },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools).toHaveLength(1)
    expect(tools[0].inputSchema).toBeNull()
  })

  it('returns empty array for spec with no paths', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
    }
    const tools = parseOpenApiSpec(spec as any)
    expect(tools).toHaveLength(0)
  })

  it('includes header parameters in inputSchema and generates parameterLocations', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items/{id}': {
          put: {
            summary: 'Update item',
            operationId: 'updateItem',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' }, description: 'ETag for optimistic concurrency' },
            ],
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    expect(tools).toHaveLength(1)

    // Header param should be in the input schema
    const props = tools[0].inputSchema?.properties as any
    expect(props['If-Match']).toBeDefined()
    expect(props['If-Match'].type).toBe('string')

    // Should generate parameterLocations for header params
    expect(tools[0].parameterLocations).toBeDefined()
    expect(tools[0].parameterLocations!['If-Match']).toEqual({ in: 'header', name: 'If-Match' })
  })

  it('merges requestBody properties alongside path/query/header parameters when names are distinct', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items/{id}': {
          post: {
            summary: 'Update item',
            operationId: 'updateItem',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'q', in: 'query', schema: { type: 'string' } },
              { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                    },
                    required: ['name'],
                  },
                },
              },
            },
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    expect(tools).toHaveLength(1)

    const schema = tools[0].inputSchema as any
    expect(schema.properties.id).toEqual({ type: 'string' })
    expect(schema.properties.q).toEqual({ type: 'string' })
    expect(schema.properties['If-Match']).toEqual({ type: 'string' })
    expect(schema.properties.name).toEqual({ type: 'string' })
    expect(schema.required).toEqual(expect.arrayContaining(['id', 'If-Match', 'name']))
    expect(tools[0].parameterLocations).toEqual({
      q: { in: 'query' },
      'If-Match': { in: 'header', name: 'If-Match' },
    })
  })

  it('throws when requestBody and parameters reuse the same flattened name', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items/{id}': {
          post: {
            summary: 'Update item',
            operationId: 'updateItem',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    expect(() => parseOpenApiSpec(spec)).toThrow(/reuses flattened input name/)
    expect(() => parseOpenApiSpec(spec)).toThrow(/"id"/)
  })

  it('extracts output schema from responses', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items/{id}': {
          get: {
            summary: 'Get item',
            operationId: 'getItem',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    expect(tools[0].outputSchema).toBeDefined()
    expect((tools[0].outputSchema as any).type).toBe('object')
    expect((tools[0].outputSchema as any).properties.id).toEqual({ type: 'string' })
  })

  it('extracts output schema from 201 response', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          post: {
            summary: 'Create item',
            operationId: 'createItem',
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { id: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    expect(tools[0].outputSchema).toBeDefined()
  })

  it('returns null outputSchema when no response schema', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/health': {
          get: { summary: 'Health', operationId: 'health' },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    expect(tools[0].outputSchema).toBeUndefined()
  })

  it('merges path-level parameters into operations', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/users/{userId}/items': {
          parameters: [
            { name: 'userId', in: 'path', required: true, schema: { type: 'string' }, description: 'User ID' },
          ],
          get: {
            summary: 'List user items',
            operationId: 'listUserItems',
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
          },
          post: {
            summary: 'Create user item',
            operationId: 'createUserItem',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
                },
              },
            },
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    expect(tools).toHaveLength(2)

    // GET should have userId (from path-level) + q (from operation-level)
    const getOp = tools.find(t => t.name === 'listUserItems')!
    const getSchema = getOp.inputSchema as any
    expect(getSchema.properties.userId).toBeDefined()
    expect(getSchema.properties.q).toBeDefined()
    expect(getSchema.required).toContain('userId')

    // POST should have userId (from path-level) + name (from requestBody)
    const postOp = tools.find(t => t.name === 'createUserItem')!
    const postSchema = postOp.inputSchema as any
    expect(postSchema.properties.userId).toBeDefined()
    expect(postSchema.properties.name).toBeDefined()
  })

  it('operation-level param overrides path-level param with same name+in', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Path-level desc' },
          ],
          get: {
            summary: 'Get item',
            operationId: 'getItem',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Operation-level desc' },
            ],
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec)
    const getItem = tools.find(t => t.name === 'getItem')!
    const schema = getItem.inputSchema as any
    // Operation-level should win: type integer, not string
    expect(schema.properties.id.type).toBe('integer')
  })

  it('emits warning for non-JSON content type', () => {
    const warnSpy = vi.fn()
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/upload': {
          post: {
            summary: 'Upload file',
            operationId: 'uploadFile',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
                },
              },
            },
          },
        },
      },
    }

    const tools = parseOpenApiSpec(spec, { logger: { warn: warnSpy } })
    expect(tools).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0][0]).toContain('Unsupported request body content type')
    expect(warnSpy.mock.calls[0][0]).toContain('multipart/form-data')
  })

  it('throws descriptive error for malformed JSON string', () => {
    const badJson = '{ "openapi": "3.0.0", }'
    expect(() => parseOpenApiSpec(badJson)).toThrow(/Failed to parse OpenAPI spec as JSON/)
  })

  it('throws when operation tags are not all strings', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: {
            summary: 'List items',
            operationId: 'listItems',
            tags: ['items', 123],
          },
        },
      },
    }

    expect(() => parseOpenApiSpec(spec)).toThrow(/OpenAPI GET \/items tags: expected an array of strings/)
  })

  it('throws when paths is present but not an object', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: [],
    }

    expect(() => parseOpenApiSpec(spec as any)).toThrow(/OpenAPI spec\.paths: expected an object/)
  })

  it('throws when components.schemas entries are malformed', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: {
            summary: 'List items',
            operationId: 'listItems',
          },
        },
      },
      components: {
        schemas: {
          Item: 'not-a-schema',
        },
      },
    }

    expect(() => parseOpenApiSpec(spec as any)).toThrow(/OpenAPI components\.schemas\.Item: expected an object/)
  })

  it('throws when components.parameters entries are malformed', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: {
            summary: 'List items',
            operationId: 'listItems',
          },
        },
      },
      components: {
        parameters: {
          Search: 'not-a-parameter',
        },
      },
    }

    expect(() => parseOpenApiSpec(spec as any)).toThrow(/OpenAPI components\.parameters\.Search: expected an object/)
  })

  it('extracts x-examples from operation', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: {
            summary: 'Search items',
            operationId: 'searchItems',
            'x-examples': [
              { name: 'basic', args: { q: 'widget' }, description: 'Search for widgets' },
              { name: 'filtered', args: { q: 'gadget', limit: 5 } },
            ],
          },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools[0].examples).toHaveLength(2)
    expect(tools[0].examples[0]).toEqual({ name: 'basic', args: { q: 'widget' }, description: 'Search for widgets' })
    expect(tools[0].examples[1]).toEqual({ name: 'filtered', args: { q: 'gadget', limit: 5 }, description: undefined })
  })

  it('extracts requestBody example (singular)', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          post: {
            summary: 'Create item',
            operationId: 'createItem',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                  example: { name: 'Widget' },
                },
              },
            },
          },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools[0].examples).toHaveLength(1)
    expect(tools[0].examples[0].args).toEqual({ name: 'Widget' })
  })

  it('extracts requestBody examples (named map)', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          post: {
            summary: 'Create item',
            operationId: 'createItem',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                  examples: {
                    widget: { value: { name: 'Widget' }, summary: 'A widget example' },
                    gadget: { value: { name: 'Gadget' } },
                  },
                },
              },
            },
          },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools[0].examples).toHaveLength(2)
    expect(tools[0].examples[0]).toEqual({ name: 'widget', args: { name: 'Widget' }, description: 'A widget example' })
    expect(tools[0].examples[1]).toEqual({ name: 'gadget', args: { name: 'Gadget' } })
  })

  it('extracts per-parameter examples as combined ToolExample', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          get: {
            summary: 'Search items',
            operationId: 'searchItems',
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' }, example: 'widget' },
              { name: 'limit', in: 'query', schema: { type: 'number' }, example: 10 },
            ],
          },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools[0].examples).toHaveLength(1)
    expect(tools[0].examples[0].args).toEqual({ q: 'widget', limit: 10 })
  })

  it('x-examples takes priority over requestBody examples', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/items': {
          post: {
            summary: 'Create item',
            operationId: 'createItem',
            'x-examples': [{ args: { name: 'from-x-examples' } }],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                  example: { name: 'from-body' },
                },
              },
            },
          },
        },
      },
    }
    const tools = parseOpenApiSpec(spec)
    expect(tools[0].examples).toHaveLength(1)
    expect(tools[0].examples[0].args.name).toBe('from-x-examples')
  })

  it('returns [] when no examples present (backward compatible)', () => {
    const tools = parseOpenApiSpec(MINIMAL_SPEC)
    // MINIMAL_SPEC has no examples defined
    expect(tools[0].examples).toEqual([])
  })

  it('handles circular $ref with clear error', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
      paths: {
        '/nodes': {
          post: {
            summary: 'Create node',
            operationId: 'createNode',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Node' },
                },
              },
            },
          },
        },
      },
    }

    expect(() => parseOpenApiSpec(spec)).toThrow(/Circular \$ref/)
  })
})
