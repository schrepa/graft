import type { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js'
import type { AnyObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type * as McpSchemas from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Logger } from '../types.js'
import { SKIP_HEADERS, flattenHeaders } from '../headers.js'
import { isPlainRecord } from '../object-schema.js'
import {
  type McpMethodContext,
  type McpMethodHandler,
  type SdkRequestExtra,
  toParamRecord,
} from './shared.js'

type SdkRequestSchema = Parameters<McpSdkServer['setRequestHandler']>[0]

const SDK_OWNED_METHODS = new Set([
  'initialize',
  'notifications/initialized',
])

type BuiltInRequestRegistration = {
  method: string
  schema: SdkRequestSchema
  withNotifications?: boolean
}

function getBuiltInRequests(schemas: typeof McpSchemas): ReadonlyArray<BuiltInRequestRegistration> {
  return [
    { method: 'tools/list', schema: schemas.ListToolsRequestSchema },
    { method: 'tools/call', schema: schemas.CallToolRequestSchema, withNotifications: true },
    { method: 'resources/list', schema: schemas.ListResourcesRequestSchema },
    { method: 'resources/templates/list', schema: schemas.ListResourceTemplatesRequestSchema },
    { method: 'resources/read', schema: schemas.ReadResourceRequestSchema },
    { method: 'prompts/list', schema: schemas.ListPromptsRequestSchema },
    { method: 'prompts/get', schema: schemas.GetPromptRequestSchema },
  ]
}

const BUILT_IN_METHODS: ReadonlySet<string> = new Set([
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
])

function isSdkRequestExtra(value: unknown): value is SdkRequestExtra {
  if (!isPlainRecord(value)) return false
  const requestInfo = value.requestInfo
  const signal = value.signal
  return (
    (requestInfo === undefined || isPlainRecord(requestInfo)) &&
    (signal === undefined || signal instanceof AbortSignal)
  )
}

function extractSdkHeaders(extra: unknown): Record<string, string> {
  const incomingHeaders = isSdkRequestExtra(extra) ? extra.requestInfo?.headers : undefined
  if (!incomingHeaders || typeof incomingHeaders !== 'object') return {}

  const filtered: Record<string, string | string[] | undefined> = {}
  for (const [key, value] of Object.entries(incomingHeaders)) {
    const lower = key.toLowerCase()
    if (value !== undefined && !SKIP_HEADERS.has(lower)) {
      filtered[lower] = value
    }
  }

  return Object.keys(filtered).length > 0 ? flattenHeaders(filtered) : {}
}

function getRequiredHandler(
  handlers: Map<string, McpMethodHandler>,
  method: string,
): McpMethodHandler {
  const handler = handlers.get(method)
  if (!handler) throw new Error(`Missing MCP handler for "${method}"`)
  return handler
}

function readRequestParams(request: unknown): unknown {
  if (!isPlainRecord(request)) return undefined
  return request.params
}

function readProgressToken(params: unknown): unknown {
  const meta = toParamRecord(toParamRecord(params)._meta)
  return meta?.progressToken
}

function createRequestContext(
  extra: unknown,
  contextIngredients?: McpMethodContext['contextIngredients'],
): McpMethodContext {
  const sdkExtra = isSdkRequestExtra(extra) ? extra : undefined

  return {
    headers: extractSdkHeaders(extra),
    signal: sdkExtra?.signal,
    ...(contextIngredients ? { contextIngredients } : {}),
  }
}

function invokeSdkHandler(
  handler: McpMethodHandler,
  params: unknown,
  extra: unknown,
  contextIngredients?: McpMethodContext['contextIngredients'],
): Promise<Record<string, unknown>> {
  return Promise.resolve(handler(
    toParamRecord(params),
    createRequestContext(extra, contextIngredients),
  ))
    .then((result) => isPlainRecord(result) ? result : {})
}

function isIgnorableNotificationError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'InvalidStateError'
  }
  if (!(error instanceof Error)) return false
  return /aborted|already closed|closed|closing|disposed|released/i.test(error.message)
}

function toSdkLogLevel(level: string): 'debug' | 'info' | 'warning' | 'error' {
  if (level === 'debug') return 'debug'
  if (level === 'warn') return 'warning'
  if (level === 'error') return 'error'
  return 'info'
}

function createNotificationEmitter(
  server: McpSdkServer,
  logger: Pick<Logger, 'warn'>,
  serverName: string,
  progressToken?: unknown,
): McpMethodContext['contextIngredients'] {
  const notify = (label: string, send: () => Promise<void>) =>
    send().catch((error) => {
      if (!isIgnorableNotificationError(error)) {
        logger.warn(`[${serverName}] Failed to emit ${label}:`, error)
      }
    })

  return {
    onLog(level, message) {
      const mappedLevel = toSdkLogLevel(level)
      notify('MCP log notification', () => server.sendLoggingMessage({ level: mappedLevel, data: message }))
    },
    onProgress(progress, total) {
      if (progressToken == null) return
      notify('MCP progress notification', () => server.notification({
        method: 'notifications/progress',
        params: { progressToken, progress, total: total ?? 0 },
      }))
    },
  }
}

function createCustomRequestSchema(method: string): AnyObjectSchema {
  return z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number(), z.null()]),
    method: z.literal(method),
    params: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()
}

/** Register the built-in MCP request handlers with the SDK server. */
export function registerBuiltInHandlers(
  server: McpSdkServer,
  schemas: typeof McpSchemas,
  handlers: Map<string, McpMethodHandler>,
  logger: Pick<Logger, 'warn'>,
  serverName: string,
): void {
  for (const registration of getBuiltInRequests(schemas)) {
    if (!handlers.has(registration.method)) continue

    server.setRequestHandler(registration.schema, async (request, extra) =>
      invokeSdkHandler(
        getRequiredHandler(handlers, registration.method),
        readRequestParams(request),
        extra,
        registration.withNotifications
          ? createNotificationEmitter(
              server,
              logger,
              serverName,
              readProgressToken(readRequestParams(request)),
            )
          : undefined,
      ),
    )
  }
}

/** Register custom MCP request handlers that are not owned by the SDK. */
export function registerCustomRequestHandlers(
  server: McpSdkServer,
  handlers: Map<string, McpMethodHandler>,
  logger: Pick<Logger, 'warn'>,
  serverName: string,
): void {
  for (const method of handlers.keys()) {
    if (SDK_OWNED_METHODS.has(method) || BUILT_IN_METHODS.has(method)) continue

    server.setRequestHandler(createCustomRequestSchema(method), async (request, extra) =>
      invokeSdkHandler(
        getRequiredHandler(handlers, method),
        readRequestParams(request),
        extra,
        createNotificationEmitter(
          server,
          logger,
          serverName,
          readProgressToken(readRequestParams(request)),
        ),
      ),
    )
  }
}

/** Install stdio cleanup handlers for SIGINT and SIGTERM. */
export function installStdioSignalHandlers(
  cleanup: () => Promise<void>,
  logger: Logger,
  serverName: string,
): () => void {
  const onSignal = () => {
    cleanup().catch((error) => {
      logger.error(`[${serverName}] Failed to clean up stdio transport:`, error)
    })
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  return () => {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}

/** Send a best-effort MCP notification when a stdio server is active. */
export async function sendNotification(
  stdioServer: McpSdkServer | null,
  method: string,
): Promise<void> {
  if (stdioServer) {
    await stdioServer.notification({ method, params: {} })
  }
}
