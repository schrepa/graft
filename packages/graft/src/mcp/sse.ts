import { toPlainRecord } from '../object-schema.js'
import type { Logger } from '../types.js'
import {
  normalizeMcpProtocolVersion,
  supportsSseEventIdPreamble,
} from './protocol-version.js'
import type { McpMethodContext, McpMethodHandler } from './shared.js'

interface ProgressChannel {
  stream: ReadableStream<string>
  onProgress: (progress: number, total?: number) => void
  onLog: (level: string, message: string, data?: Record<string, unknown>) => void
  close: () => void
}

/**
 * Build the SSE payload for an MCP progress notification.
 */
export function buildProgressNotification(
  progressToken: unknown,
  progress: number,
  total?: number,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { progressToken, progress, ...(total != null ? { total } : {}) },
  }
}

/**
 * Build the SSE payload for an MCP log notification.
 */
export function buildLogNotification(
  level: string,
  message: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  const mcpLevel = level === 'warn' ? 'warning' : level
  return {
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level: mcpLevel, data: message, ...(data ? { logger: data } : {}) },
  }
}

/**
 * Detect stream errors that can be ignored during SSE shutdown/cancellation.
 */
export function isRecoverableSseStreamError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'InvalidStateError'
  }
  if (!(error instanceof Error)) return false
  return /aborted|already closed|closed|closing|released|locked/i.test(error.message)
}

function safeEnqueueMessage(
  controller: ReadableStreamDefaultController<string> | undefined,
  payload: Record<string, unknown>,
): void {
  if (!controller) return
  try {
    controller.enqueue(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
  } catch (error) {
    if (!isRecoverableSseStreamError(error)) throw error
  }
}

function createProgressChannel(progressToken?: unknown): ProgressChannel {
  let controller: ReadableStreamDefaultController<string> | undefined
  const stream = new ReadableStream<string>({
    start(nextController) {
      controller = nextController
    },
  })

  return {
    stream,
    onProgress(progress, total) {
      if (progressToken == null) return
      safeEnqueueMessage(controller, buildProgressNotification(progressToken, progress, total))
    },
    onLog(level, message, data) {
      safeEnqueueMessage(controller, buildLogNotification(level, message, data))
    },
    close() {
      if (!controller) return
      try {
        controller.close()
      } catch (error) {
        if (!isRecoverableSseStreamError(error)) throw error
      }
    },
  }
}

function encodeSseChunk(encoder: TextEncoder, payload: string): Uint8Array {
  return encoder.encode(payload)
}

async function writeSsePreamble(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  requestVersion?: string,
): Promise<void> {
  const protocolVersion = normalizeMcpProtocolVersion(requestVersion)
  if (supportsSseEventIdPreamble(protocolVersion)) {
    await writer.write(encodeSseChunk(encoder, `id: ${crypto.randomUUID()}\ndata: \n\n`))
  }
}

async function pumpProgressStream(
  reader: ReadableStreamDefaultReader<string>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    await writer.write(encodeSseChunk(encoder, value))
  }
}

async function writeSseResult(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  result: Record<string, unknown>,
): Promise<void> {
  await writer.write(
    encodeSseChunk(encoder, `event: message\ndata: ${JSON.stringify(result)}\n\n`),
  )
}

function warnSseFailure(
  logger: Pick<Logger, 'warn'> | undefined,
  message: string,
  error: unknown,
): void {
  ;(logger ?? console).warn(`[graft] ${message}:`, error)
}

async function closeSseWriter(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  logger?: Pick<Logger, 'warn'>,
): Promise<void> {
  try {
    await writer.close()
  } catch (error) {
    if (!isRecoverableSseStreamError(error)) {
      warnSseFailure(logger, 'Failed to close SSE writer cleanly', error)
    }
  }
}

async function streamSseResponse(
  channel: ProgressChannel,
  resultPromise: Promise<Record<string, unknown>>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  requestVersion?: string,
): Promise<void> {
  await writeSsePreamble(writer, encoder, requestVersion)
  const reader = channel.stream.getReader()
  const pump = pumpProgressStream(reader, writer, encoder)
  const [result] = await Promise.all([resultPromise, pump])
  await writeSseResult(writer, encoder, result)
}

function buildSseResponse(
  channel: ProgressChannel,
  resultPromise: Promise<Record<string, unknown>>,
  requestVersion?: string,
  logger?: Pick<Logger, 'warn'>,
): Response {
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()

  void (async () => {
    const writer = writable.getWriter()
    try {
      await streamSseResponse(channel, resultPromise, writer, encoder, requestVersion)
    } catch (error) {
      if (!isRecoverableSseStreamError(error)) {
        warnSseFailure(logger, 'Unexpected SSE stream failure', error)
      }
    } finally {
      await closeSseWriter(writer, logger)
    }
  })()

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}

/**
 * Dispatch a tools/call request over SSE and stream progress/log notifications
 * before the final JSON-RPC result payload.
 */
export function dispatchSSE(options: {
  handler: McpMethodHandler
  params: Record<string, unknown>
  ctx: McpMethodContext
  id: unknown
  requestVersion?: string
  logger?: Pick<Logger, 'warn'>
  formatError: (error: unknown, id: unknown) => Record<string, unknown>
}): Response {
  const meta = toPlainRecord(options.params._meta)
  const progressToken = meta?.progressToken
  const channel = createProgressChannel(progressToken)

  const ctxWithChannel: McpMethodContext = {
    ...options.ctx,
    contextIngredients: {
      ...options.ctx.contextIngredients,
      onProgress: channel.onProgress,
      onLog: channel.onLog,
    },
  }

  const resultPromise = (async () => {
    try {
      const result = await options.handler(options.params, ctxWithChannel)
      return { jsonrpc: '2.0' as const, result: result ?? {}, id: options.id }
    } catch (error) {
      return options.formatError(error, options.id)
    } finally {
      channel.close()
    }
  })()

  return buildSseResponse(channel, resultPromise, options.requestVersion, options.logger)
}
