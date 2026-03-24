import { describe, it, expect } from 'vitest'
import * as graft from '../src/index.js'
import * as openapi from '../src/openapi.js'
import * as server from '../src/server.js'
import * as testing from '../src/testing.js'

describe('public API surface', () => {
  // ---- Main entry point (graft) ----

  const EXPECTED_VALUES = [
    // App
    'authenticateNodeRequest', 'createApp', 'createNodeHost', 'App',
    // Zod
    'z',
    // Tool builder
    'defineTool',
    // Errors
    'GraftError', 'ToolError', 'ValidationError', 'AuthError',
    // Middleware + State
    'composeMiddleware', 'createStateKey',
    // Tool result helpers
    'richResult',
    // MCP
    'resolveAnnotations', 'generateAgentJson',
    // Diagnostics
    'validateManifest', 'formatValidation',
    // Renderers
    'generateLlmsTxt', 'generateLlmsFullTxt', 'generateMcpCard', 'generateDocsHtml',
  ].sort()

  it('exports exactly the expected value names', () => {
    const actual = Object.keys(graft).sort()
    expect(actual).toEqual(EXPECTED_VALUES)
  })

  // Internal names that must never leak through the public entry point
  const BLOCKLIST = [
    'InternalTool',
    'buildRuntime',
    'BuildRuntimeInput',
    'BuildRuntimeResult',
    'buildInternalTool',
    'StoredResource',
    'Router',
    'mountRoutes',
    'createToolPipeline',
    'generateOpenApiSpec',
    'OpenApiOptions',
    'createMcpAdapter',
    'buildMethodHandlers',
    'handleJsonRpc',
  ]

  it('does not export internal implementation details', () => {
    for (const name of BLOCKLIST) {
      expect(graft).not.toHaveProperty(name)
    }
  })

  // ---- Testing entry point (graft/testing) ----

  const EXPECTED_TESTING_VALUES = [
    'createMcpTestClient',
  ].sort()

  it('testing entry exports exactly the expected value names', () => {
    const actual = Object.keys(testing).sort()
    expect(actual).toEqual(EXPECTED_TESTING_VALUES)
  })

  it('server entry exports only the server helpers', () => {
    expect(Object.keys(server).sort()).toEqual([
      'buildRequestHead',
      'buildWebRequest',
      'createNodeRequestHandler',
      'startServer',
      'writeWebResponse',
    ])
  })

  it('openapi entry exports only OpenAPI generation helpers', () => {
    expect(Object.keys(openapi).sort()).toEqual([
      'generateOpenApiSpec',
    ])
  })
})
