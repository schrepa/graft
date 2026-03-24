// =========================================================================
// App API
// =========================================================================

export { createApp, App, authenticateNodeRequest } from './app.js'
export { createNodeHost } from './app/node-host.js'
export type {
  AppOptions, ToolConfig, SharedToolOptions, ResourceConfig,
  ResourceTemplateConfig, PromptConfig, BuildResult,
  RouteDescriptor, DiscoveryOptions, DiscoveryEndpoint,
} from './app.js'
export type {
  CreateNodeHostOptions,
  NodeHost,
  NodeHostHandlerOptions,
  NodeHostServeResult,
} from './app/node-host.js'
export type { ServeOptions, ServerHandle } from './server.js'

// =========================================================================
// Zod re-export — one-import DX
// =========================================================================

export { z } from 'zod'

// =========================================================================
// Tool definition helpers
// =========================================================================

export { defineTool } from './tool-builder.js'
export type { DefinedTool, ZodToolConfig, JsonSchemaToolConfig, NoSchemaToolConfig } from './tool-builder.js'

// =========================================================================
// Errors
// =========================================================================

export { GraftError, ToolError, ValidationError, AuthError } from './errors.js'

// =========================================================================
// Middleware + State
// =========================================================================

export { composeMiddleware } from './middleware.js'
export { createStateKey } from './state.js'

// =========================================================================
// Tool result helpers
// =========================================================================

export { richResult } from './pipeline.js'
export type { RichResult } from './pipeline.js'

// =========================================================================
// MCP Adapter (type-only — construction is internal)
// =========================================================================

export type { McpAdapter, Manifest, AgentJsonDocument, AgentJsonOptions } from './mcp.js'
export { resolveAnnotations, generateAgentJson } from './mcp.js'

// =========================================================================
// Diagnostics
// =========================================================================

export { validateManifest, formatValidation } from './diagnostics.js'
export type { ManifestToolSet } from './diagnostics.js'

// =========================================================================
// Renderers — pure functions over the frozen Manifest
// =========================================================================

export { generateLlmsTxt, generateLlmsFullTxt } from './llms-txt.js'
export { generateMcpCard } from './mcp-card.js'
export type { McpCardDocument, McpCardOptions } from './mcp-card.js'
export { generateDocsHtml } from './docs.js'

// =========================================================================
// Types
// =========================================================================

export type { HttpMethod, HttpMethodInput } from './http-method.js'

export type {
  // Tool definitions
  ToolDefinition, ToolExample, ToolAuth, AnnotationHints, JsonSchema,
  ParameterLocation, ParameterLocationEntry,
  // Dispatch
  DispatchOutcome, DispatchSuccess, DispatchFailure, DispatchResponse, DispatchFailureInfo, DispatchEvent,
  // MCP hooks
  ConfigureServerHook, McpHandlerContext, McpToolDefinition, McpToolResult,
  TransformToolDefinitionHook, TransformToolResultHook,
  // Resources + Prompts
  ResourceDefinition, ResourceTemplateDefinition, ResourceHandler, ResourceReadContext,
  PromptDefinition, PromptMessage, PromptHandler, PromptResolveContext,
  // Context + Auth
  ToolContext, ToolMeta, RequestMeta, AuthResult,
  // Authorization
  AuthorizeHook, AuthorizeContext,
  // Response context
  ResponseContext,
  // Lifecycle hooks
  DispatchLifecycleContext, OnDispatchErrorHook, OnDispatchSuccessHook,
  // Middleware
  ToolCallMiddleware,
  // Logging
  LogLevel, Logger,
  // Validation
  ValidationResult, ValidationMessage,
} from './types.js'
